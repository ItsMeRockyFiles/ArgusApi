import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '..', 'data', 'sdn.json');

let memoryStore = {
  metadata: null,
  entries: [],
  indexedByUid: new Map(),
  loadedAt: null,
};

export function loadStore() {
  console.log(`[store] Loading SDN data from ${DATA_FILE}...`);
  const startTime = Date.now();

  if (!fs.existsSync(DATA_FILE)) {
    console.warn(`[store] WARNING: data/sdn.json not found! Please run 'npm run build:sdn' to generate it.`);
    return false;
  }

  try {
    const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
    const json = JSON.parse(rawData);

    memoryStore.metadata = json.metadata || {};
    memoryStore.entries = json.entries || [];
    memoryStore.indexedByUid.clear();

    for (const entry of memoryStore.entries) {
      if (entry && entry.uid) {
        memoryStore.indexedByUid.set(entry.uid, entry);
      }
    }

    memoryStore.loadedAt = new Date().toISOString();
    const duration = Date.now() - startTime;
    console.log(`[store] Loaded ${memoryStore.entries.length} SDN records into memory in ${duration} ms.`);
    return true;
  } catch (err) {
    console.error(`[store] Error reading/parsing sdn.json:`, err);
    return false;
  }
}

export function isLoaded() {
  return memoryStore.entries.length > 0;
}

export function getEntries() {
  return memoryStore.entries;
}

export function getEntryByUid(uid) {
  const numericUid = Number(uid);
  return memoryStore.indexedByUid.get(numericUid) || null;
}

export function getStats() {
  const mem = process.memoryUsage();
  return {
    isLoaded: isLoaded(),
    loadedAt: memoryStore.loadedAt,
    recordCount: memoryStore.entries.length,
    metadata: memoryStore.metadata,
    memoryUsageMb: {
      rss: (mem.rss / 1024 / 1024).toFixed(2),
      heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
      heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
    },
  };
}

export function reloadStore() {
  return loadStore();
}

// Auto load on module import if file exists
loadStore();

export default {
  loadStore,
  isLoaded,
  getEntries,
  getEntryByUid,
  getStats,
  reloadStore,
};
