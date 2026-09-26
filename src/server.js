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

// Root / Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Argus OFAC SDN Screening API',
    status: 'online',
    version: '1.0.0',
    documentation: {
      healthcheck: '/health',
      screen: '/api/screen (POST or GET)',
      getRecord: '/api/sdn/:uid',
      stats: '/api/stats',
      rebuild: '/api/rebuild (POST)',
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
    store: stats,
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
    res.json(screeningResult);
  } catch (err) {
    if (err instanceof ValidationError || err.name === 'ValidationError') {
      const log = req.log || logger;
      log.warn({ err, payload }, 'Screening validation error');
      return res.status(400).json({
        error: err.message,
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
  const uid = req.params.uid;
  const record = store.getEntryByUid(uid);

  if (!record) {
    return res.status(404).json({
      error: `SDN record with UID ${uid} not found.`,
    });
  }

  res.json({ record });
});

// Trigger Rebuild Endpoint
app.post('/api/rebuild', async (req, res) => {
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
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  if (err instanceof ValidationError || err.name === 'ValidationError') {
    const log = req.log || logger;
    log.warn({ err }, 'Validation error handled globally');
    return res.status(400).json({ error: err.message });
  }

  const log = req.log || logger;
  log.error({ err }, 'Global server error');
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

import { fileURLToPath } from 'node:url';

// Start Server if executed directly
if (process.env.NODE_ENV !== 'test' && process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    logger.info({ port: PORT, endpoint: `http://localhost:${PORT}/api/screen`, healthcheck: `http://localhost:${PORT}/health` }, `Argus OFAC SDN Screening API running on port ${PORT}`);
  });
}

export default app;
