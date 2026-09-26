import test from 'node:test';
import assert from 'node:assert/strict';
import store from '../src/store.js';
import { screenEntity } from '../src/screen.js';
import app from '../src/server.js';
import { ValidationError } from '../src/errors.js';

test('SDN Store loading', () => {
  assert.equal(store.isLoaded(), true, 'Store should be loaded');
  const stats = store.getStats();
  assert.ok(stats.recordCount > 0, 'Record count should be greater than 0');
});

test('Screen Entity - Exact Match', () => {
  const res = screenEntity({ name: 'Aerocaribbean Airlines', threshold: 70 });
  assert.ok(res.results.length > 0, 'Should find Aerocaribbean Airlines');
  assert.equal(res.results[0].uid, 36);
  assert.ok(res.results[0].score >= 90);
});

test('Screen Entity - Fuzzy Match & Alias Match', () => {
  const res = screenEntity({ name: 'Aero-Caribbean', threshold: 70 });
  assert.ok(res.results.length > 0);
  assert.equal(res.results[0].uid, 36);
  assert.equal(res.results[0].matchType, 'aka');
});

test('Screen Entity - Individual Name & Alias', () => {
  const res = screenEntity({ name: 'Muhammad Zaydan', threshold: 70 });
  assert.ok(res.results.length > 0);
  const found = res.results.find((r) => r.uid === 2674);
  assert.ok(found, 'Should find Abu ABBAS record (UID 2674) via alias Muhammad ZAYDAN');
});

test('Screen Entity - Type Filtering', () => {
  const resEntity = screenEntity({ name: 'Aerocaribbean', type: 'Entity', threshold: 60 });
  assert.ok(resEntity.results.length > 0);
  assert.equal(resEntity.results[0].sdnType, 'Entity');

  const resIndiv = screenEntity({ name: 'Aerocaribbean', type: 'Individual', threshold: 60 });
  assert.equal(resIndiv.results.length, 0, 'No individual should match Aerocaribbean');
});

test('Get Entry By UID', () => {
  const record = store.getEntryByUid(36);
  assert.ok(record, 'Record UID 36 should exist');
  assert.equal(record.fullName, 'AEROCARIBBEAN AIRLINES');
});

// ==========================================
// NEW TEST SUITES FOR FLAGGED GAPS
// ==========================================

test('False Positive Guard - Common non-sanctioned name returns 0 matches', () => {
  const res = screenEntity({ name: 'John Smith', threshold: 70 });
  assert.equal(
    res.results.length,
    0,
    'Common non-sanctioned name John Smith should return 0 results at threshold 70'
  );
});

test('Transliteration & Spelling Variant - "Vladimir Poutine" finds "Vladimir PUTIN"', () => {
  const res = screenEntity({ name: 'Vladimir Poutine', threshold: 70 });
  assert.ok(res.results.length > 0, 'Should return matching results for transliteration');
  const putinMatch = res.results.find((r) => r.uid === 35096);
  assert.ok(putinMatch, 'Should find Vladimir Vladimirovich PUTIN (UID 35096)');
  assert.ok(
    putinMatch.score >= 70,
    `Match score (${putinMatch.score}) for transliteration should be >= 70`
  );
});

test('Threshold Boundaries - behavior at 100, 70, and 0', () => {
  // Threshold 100: Only exact score 100 matches allowed
  const res100 = screenEntity({ name: 'Aerocaribbean Airlines', threshold: 100 });
  assert.ok(res100.results.length > 0);
  for (const item of res100.results) {
    assert.equal(item.score, 100, 'All results at threshold 100 must have score 100');
  }

  // Threshold 70: All results must have score >= 70
  const res70 = screenEntity({ name: 'Aerocaribbean', threshold: 70 });
  for (const item of res70.results) {
    assert.ok(item.score >= 70, 'All results at threshold 70 must have score >= 70');
  }

  // Threshold 0: Returns results down to 0 up to requested limit
  const res0 = screenEntity({ name: 'Aerocaribbean', threshold: 0, limit: 10 });
  assert.equal(res0.returnedMatches, 10);
  assert.ok(res0.results[res0.results.length - 1].score < 70, 'Lowest result should be sub-threshold when threshold=0');
});

test('Input Validation - screenEntity throws ValidationError for invalid inputs', () => {
  // Missing name
  assert.throws(
    () => screenEntity({}),
    (err) => err instanceof ValidationError && err.message.includes('name')
  );

  // Invalid threshold (NaN, negative, >100)
  assert.throws(
    () => screenEntity({ name: 'Test', threshold: 'invalid' }),
    (err) => err instanceof ValidationError && err.message.includes('threshold')
  );
  assert.throws(
    () => screenEntity({ name: 'Test', threshold: 150 }),
    (err) => err instanceof ValidationError && err.message.includes('threshold')
  );

  // Invalid type filter
  assert.throws(
    () => screenEntity({ name: 'Test', type: 'SuperHero' }),
    (err) => err instanceof ValidationError && err.message.includes('type')
  );

  // Invalid limit
  assert.throws(
    () => screenEntity({ name: 'Test', limit: -5 }),
    (err) => err instanceof ValidationError && err.message.includes('limit')
  );
});

test('HTTP Integration - Express API returns identical payload to screenEntity()', async () => {
  // Start server on dynamic port
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');

    // 2. GET /api/screen?name=Aerocaribbean&threshold=70
    const getRes = await fetch(`${baseUrl}/api/screen?name=Aerocaribbean&threshold=70`);
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    const directResult = screenEntity({ name: 'Aerocaribbean', threshold: 70 });
    assert.equal(getJson.totalMatches, directResult.totalMatches);
    assert.equal(getJson.results[0].uid, directResult.results[0].uid);
    assert.equal(getJson.results[0].score, directResult.results[0].score);

    // 3. POST /api/screen
    const postRes = await fetch(`${baseUrl}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Muhammad Zaydan', threshold: 70 }),
    });
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.ok(postJson.results.some((r) => r.uid === 2674));

    // 4. Validation Errors return HTTP 400 Bad Request
    const errMissingName = await fetch(`${baseUrl}/api/screen`);
    assert.equal(errMissingName.status, 400);
    const errMissingNameJson = await errMissingName.json();
    assert.ok(errMissingNameJson.error.includes('name'));

    const errBadThreshold = await fetch(`${baseUrl}/api/screen?name=Aerocaribbean&threshold=invalid`);
    assert.equal(errBadThreshold.status, 400);
    const errBadThresholdJson = await errBadThreshold.json();
    assert.ok(errBadThresholdJson.error.includes('threshold'));

    const errBadType = await fetch(`${baseUrl}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Aerocaribbean', type: 'InvalidType' }),
    });
    assert.equal(errBadType.status, 400);
    const errBadTypeJson = await errBadType.json();
    assert.ok(errBadTypeJson.error.includes('type'));
    // 5. GET /api/sdn/:uid Handling
    // Valid UID
    const uidRes = await fetch(`${baseUrl}/api/sdn/36`);
    assert.equal(uidRes.status, 200);
    const uidJson = await uidRes.json();
    assert.equal(uidJson.record.fullName, 'AEROCARIBBEAN AIRLINES');

    // Invalid non-numeric UID -> HTTP 400 JSON
    const uidInvalidRes = await fetch(`${baseUrl}/api/sdn/abc`);
    assert.equal(uidInvalidRes.status, 400);
    const uidInvalidJson = await uidInvalidRes.json();
    assert.ok(uidInvalidJson.error.includes('numeric'));

    // Non-existent UID -> HTTP 404 JSON
    const uidNotFoundRes = await fetch(`${baseUrl}/api/sdn/12345`);
    assert.equal(uidNotFoundRes.status, 404);
    const uidNotFoundJson = await uidNotFoundRes.json();
    assert.equal(uidNotFoundJson.error, 'Record not found');
    assert.equal(uidNotFoundJson.uid, 12345);

    // AKA UID (not directly queryable as primary entry) -> HTTP 404 JSON
    const uidAkaRes = await fetch(`${baseUrl}/api/sdn/6500`);
    assert.equal(uidAkaRes.status, 404);
    const uidAkaJson = await uidAkaRes.json();
    assert.equal(uidAkaJson.error, 'Record not found');
    assert.equal(uidAkaJson.uid, 6500);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

