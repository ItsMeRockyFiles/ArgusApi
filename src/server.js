import express from 'express';
import dotenv from 'dotenv';
import pinoHttp from 'pino-http';
import store from './store.js';
import { screenEntity } from './screen.js';
import { buildSdnDatabase } from '../scripts/build-sdn.js';
import logger from './logger.js';
import { ValidationError } from './errors.js';

dotenv.config();

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

// Structured HTTP Request logger middleware (pino-http)
app.use(
  pinoHttp({
    logger,
    customLogLevel: function (req, res, err) {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  })
);

// JSON Middleware & CORS
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAPI_FILE = path.join(__dirname, '..', 'openapi.json');

// OpenAPI Spec Endpoint
app.get('/openapi.json', (req, res) => {
  if (fs.existsSync(OPENAPI_FILE)) {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(OPENAPI_FILE);
  } else {
    res.status(404).json({ error: 'OpenAPI specification file not found' });
  }
});

// Root / Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Argus OFAC SDN Screening API',
    status: 'online',
    version: '1.0.0',
    documentation: {
      openapi: '/openapi.json',
      healthcheck: '/health',
      screen: '/api/screen (POST or GET)',
      getRecord: '/api/sdn/:uid',
      stats: '/api/stats',
    },
    dataset: store.getStats(),
  });
});

// Healthcheck Endpoint
app.get('/health', (req, res) => {
  const stats = store.getStats();
  const statusCode = stats.isLoaded ? 200 : 503;
  res.status(statusCode).json({
    status: stats.isLoaded ? 'ok' : 'degraded',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
    recordCount: stats.recordCount,
  });
});

// Dataset Stats Endpoint
app.get('/api/stats', (req, res) => {
  res.json(store.getStats());
});

// Screen Endpoint (POST or GET)
const handleScreenRequest = (req, res) => {
  if (!store.isLoaded()) {
    return res.status(503).json({
      error: 'SDN database not loaded yet. Please run build script or wait for boot.',
    });
  }

  // Merge query parameters and body
  const payload = {
    name: req.body?.name || req.query?.name,
    type: req.body?.type || req.query?.type,
    threshold: req.body?.threshold || req.query?.threshold,
    limit: req.body?.limit || req.query?.limit,
    dob: req.body?.dob || req.query?.dob,
    country: req.body?.country || req.query?.country,
    idNumber: req.body?.idNumber || req.query?.idNumber,
  };

  try {
    const screeningResult = screenEntity(payload);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    res.json(screeningResult);
  } catch (err) {
    if (err instanceof ValidationError || err.name === 'ValidationError') {
      const log = req.log || logger;
      log.warn({ err, payload }, 'Screening validation error');
      return res.status(400).json({
        error: err.message,
        code: err.code || 'VALIDATION_ERROR',
        details: err.details || undefined,
        example: '/api/screen?name=Aerocaribbean&threshold=70',
      });
    }

    const log = req.log || logger;
    log.error({ err, payload }, 'Internal screening error');
    res.status(500).json({ error: 'Internal screening error', message: err.message });
  }
};

app.get('/api/screen', handleScreenRequest);
app.post('/api/screen', handleScreenRequest);

// Get SDN entry by UID
app.get('/api/sdn/:uid', (req, res) => {
  const uid = parseInt(req.params.uid, 10);
  if (Number.isNaN(uid)) {
    return res.status(400).json({ error: 'Invalid UID parameter. Must be a numeric identifier.', code: 'INVALID_UID' });
  }

  const record = store.getEntryByUid(uid);
  if (!record) {
    return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND', uid });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  res.json({ record });
});

// Trigger Rebuild Endpoint (Admin / Cron)
app.post('/api/rebuild', async (req, res) => {
  const secret = process.env.REBUILD_SECRET || process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || req.headers['x-rebuild-secret'];

  if (!secret || (authHeader !== `Bearer ${secret}` && authHeader !== secret)) {
    return res.status(401).json({ error: 'Unauthorized. Admin secret required for manual rebuilds.', code: 'UNAUTHORIZED' });
  }

  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'Database rebuild endpoint disabled in serverless deployment.',
      message: 'Database rebuilds occur automatically during the Vercel deployment build pipeline.',
      code: 'NOT_IMPLEMENTED',
    });
  }

  try {
    res.json({ message: 'Database rebuild initiated in background.' });
    logger.info('Rebuild initiated via API request...');
    await buildSdnDatabase();
    store.reloadStore();
    logger.info('Rebuild and reload complete!');
  } catch (err) {
    logger.error({ err }, 'Error during API rebuild');
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && 'body' in err) {
    const log = req.log || logger;
    log.warn({ err: err.message }, 'Malformed JSON request payload');
    return res.status(400).json({ error: 'Malformed JSON payload in request body.', code: 'MALFORMED_JSON' });
  }

  if (err instanceof ValidationError || err.name === 'ValidationError') {
    const log = req.log || logger;
    log.warn({ err }, 'Validation error handled globally');
    return res.status(400).json({ error: err.message, code: err.code || 'VALIDATION_ERROR' });
  }

  const log = req.log || logger;
  log.error({ err }, 'Global server error');
  res.status(500).json({ error: 'Internal server error', message: err.message, code: 'INTERNAL_ERROR' });
});

// Start Server if executed directly
if (process.env.NODE_ENV !== 'test' && process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    logger.info({ port: PORT, endpoint: `http://localhost:${PORT}/api/screen`, healthcheck: `http://localhost:${PORT}/health` }, `Argus OFAC SDN Screening API running on port ${PORT}`);
  });
}

export default app;
