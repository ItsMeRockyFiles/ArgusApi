import express from 'express';
import dotenv from 'dotenv';
import store from './store.js';
import { screenEntity } from './screen.js';
import { buildSdnDatabase } from '../scripts/build-sdn.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// Request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
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

  if (!payload.name) {
    return res.status(400).json({
      error: 'Missing required parameter: "name".',
      example: '/api/screen?name=Aerocaribbean&threshold=70',
    });
  }

  try {
    const screeningResult = screenEntity(payload);
    res.json(screeningResult);
  } catch (err) {
    console.error('[server] Error performing screening:', err);
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
    console.log('[server] Rebuild initiated via API request...');
    await buildSdnDatabase();
    store.reloadStore();
    console.log('[server] Rebuild and reload complete!');
  } catch (err) {
    console.error('[server] Error during API rebuild:', err);
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[server] Global error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

import { fileURLToPath } from 'node:url';

// Start Server if executed directly
if (process.env.NODE_ENV !== 'test' && process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Argus OFAC SDN Screening API running on port ${PORT}`);
    console.log(`📍 Endpoint: http://localhost:${PORT}/api/screen`);
    console.log(`🏥 Healthcheck: http://localhost:${PORT}/health`);
    console.log(`====================================================`);
  });
}

export default app;
