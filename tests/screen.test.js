import test from 'node:test';
import assert from 'node:assert/strict';
import store from '../src/store.js';
import { screenEntity } from '../src/screen.js';
import app from '../src/server.js';
import { ValidationError } from '../src/errors.js';

test('SDN Store loading & immutability', () => {
  assert.equal(store.isLoaded(), true, 'Store should be loaded');
  const stats = store.getStats();
  assert.ok(stats.recordCount > 0, 'Record count should be greater than 0');

  // Verify getEntries returns a copy so consumers cannot mutate store internals
  const entriesCopy = store.getEntries();
  const initialLength = entriesCopy.length;
  entriesCopy.length = 0;
  assert.equal(store.getStats().recordCount, initialLength, 'Mutating getEntries() copy must not alter internal store');
});

test('Screen Entity - Exact Match', () => {
  const res = screenEntity({ name: 'Aerocaribbean Airlines', threshold: 70 });
  assert.ok(res.results.length > 0, 'Should find Aerocaribbean Airlines');
  assert.equal(res.results[0].uid, 36);
  assert.ok(res.results[0].score >= 90);
});

test('Screen Entity - Fuzzy Match & Alias Match with matchedAlias shape validation', () => {
  const res = screenEntity({ name: 'Aero-Caribbean', threshold: 70 });
  assert.ok(res.results.length > 0);
  assert.equal(res.results[0].uid, 36);
  assert.equal(res.results[0].matchType, 'aka');

  // Verify matchedAlias object shape
  const akaMatch = res.results.find((r) => r.matchType === 'aka');
  assert.ok(akaMatch, 'Should find an AKA match');
  assert.ok(akaMatch.matchedAlias, 'AKA match should populate matchedAlias');
  assert.equal(typeof akaMatch.matchedAlias.fullName, 'string');
  assert.equal(typeof akaMatch.matchedAlias.type, 'string');
});

test('Screen Entity - Individual Name & Alias', () => {
  const res = screenEntity({ name: 'Muhammad Zaydan', threshold: 70 });
  assert.ok(res.results.length > 0);
  const found = res.results.find((r) => r.uid === 2674);
  assert.ok(found, 'Should find Abu ABBAS record (UID 2674) via alias Muhammad ZAYDAN');
});

test('Screen Entity - Secondary criteria match boosts (country, dob, idNumber)', () => {
  const resCountry = screenEntity({ name: 'Aerocaribbean', country: 'Cuba', threshold: 50 });
  assert.ok(resCountry.results.length > 0);
  const match = resCountry.results.find((r) => r.uid === 36);
  assert.ok(match, 'Should match Aerocaribbean');
  assert.equal(match.secondaryMatches.countryMatched, true, 'Country match flag should be true');
});

test('Screen Entity - Type Filtering', () => {
  const resEntity = screenEntity({ name: 'Aerocaribbean', type: 'Entity', threshold: 60 });
  assert.ok(resEntity.results.length > 0);
  assert.equal(resEntity.results[0].sdnType, 'Entity');

  const resIndiv = screenEntity({ name: 'Aerocaribbean', type: 'Individual', threshold: 60 });
  assert.equal(resIndiv.results.length, 0, 'No individual should match Aerocaribbean');
});

test('Get Entry By UID - verifies addresses and ids array structures', () => {
  const record36 = store.getEntryByUid(36);
  assert.ok(record36, 'Record UID 36 should exist');
  assert.equal(record36.fullName, 'AEROCARIBBEAN AIRLINES');

  assert.ok(Array.isArray(record36.addresses), 'Record addresses should be an array');
  assert.ok(record36.addresses.length > 0, 'Aerocaribbean should have populated addresses');
  assert.equal(typeof record36.addresses[0].city, 'string');
  assert.equal(typeof record36.addresses[0].country, 'string');

  const recordWithId = store.getEntries().find((e) => e.ids && e.ids.length > 0);
  assert.ok(recordWithId, 'Should find an entry with populated ids');
  assert.ok(Array.isArray(recordWithId.ids), 'Record ids should be an array');
  assert.equal(typeof recordWithId.ids[0].idType, 'string');
});

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
  const res100 = screenEntity({ name: 'Aerocaribbean Airlines', threshold: 100 });
  assert.ok(res100.results.length > 0);
  for (const item of res100.results) {
    assert.equal(item.score, 100, 'All results at threshold 100 must have score 100');
  }

  const res70 = screenEntity({ name: 'Aerocaribbean', threshold: 70 });
  for (const item of res70.results) {
    assert.ok(item.score >= 70, 'All results at threshold 70 must have score >= 70');
  }

  const res0 = screenEntity({ name: 'Aerocaribbean', threshold: 0, limit: 10 });
  assert.equal(res0.returnedMatches, 10);
  assert.ok(res0.results[res0.results.length - 1].score < 70, 'Lowest result should be sub-threshold when threshold=0');
});

test('Input Validation - screenEntity throws ValidationError with stable error codes', () => {
  // Missing name
  assert.throws(
    () => screenEntity({}),
    (err) => err instanceof ValidationError && err.code === 'MISSING_NAME'
  );

  // Invalid threshold
  assert.throws(
    () => screenEntity({ name: 'Test', threshold: 'invalid' }),
    (err) => err instanceof ValidationError && err.code === 'INVALID_THRESHOLD'
  );

  // Invalid type filter
  assert.throws(
    () => screenEntity({ name: 'Test', type: 'SuperHero' }),
    (err) => err instanceof ValidationError && err.code === 'INVALID_TYPE'
  );

  // Invalid limit
  assert.throws(
    () => screenEntity({ name: 'Test', limit: -5 }),
    (err) => err instanceof ValidationError && err.code === 'INVALID_LIMIT'
  );
});

test('HTTP Integration - Express API routes, error codes, and endpoint coverage', async () => {
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
    assert.ok(healthJson.recordCount > 0);

    // 2. GET /api/stats
    const statsRes = await fetch(`${baseUrl}/api/stats`);
    assert.equal(statsRes.status, 200);
    const statsJson = await statsRes.json();
    assert.equal(statsJson.isLoaded, true);
    assert.ok(statsJson.recordCount > 0);

    // 3. GET /openapi.json
    const specRes = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(specRes.status, 200);
    const specJson = await specRes.json();
    assert.equal(specJson.openapi, '3.0.3');

    // 4. GET /api/screen?name=Aerocaribbean&threshold=70
    const getRes = await fetch(`${baseUrl}/api/screen?name=Aerocaribbean&threshold=70`);
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.match(getRes.headers.get('cache-control'), /public, max-age=3600/);
    const directResult = screenEntity({ name: 'Aerocaribbean', threshold: 70 });
    assert.equal(getJson.totalMatches, directResult.totalMatches);
    assert.equal(getJson.results[0].uid, directResult.results[0].uid);
    assert.equal(getJson.results[0].score, directResult.results[0].score);

    // 5. POST /api/screen
    const postRes = await fetch(`${baseUrl}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Muhammad Zaydan', threshold: 70 }),
    });
    assert.equal(postRes.status, 200);
    assert.match(postRes.headers.get('cache-control'), /public, max-age=3600/);
    const postJson = await postRes.json();
    assert.ok(postJson.results.some((r) => r.uid === 2674));

    // 6. Validation Errors return HTTP 400 with stable error codes
    const errMissingName = await fetch(`${baseUrl}/api/screen`);
    assert.equal(errMissingName.status, 400);
    const errMissingNameJson = await errMissingName.json();
    assert.equal(errMissingNameJson.code, 'MISSING_NAME');

    const errBadThreshold = await fetch(`${baseUrl}/api/screen?name=Aerocaribbean&threshold=invalid`);
    assert.equal(errBadThreshold.status, 400);
    const errBadThresholdJson = await errBadThreshold.json();
    assert.equal(errBadThresholdJson.code, 'INVALID_THRESHOLD');

    const errBadType = await fetch(`${baseUrl}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Aerocaribbean', type: 'InvalidType' }),
    });
    assert.equal(errBadType.status, 400);
    const errBadTypeJson = await errBadType.json();
    assert.equal(errBadTypeJson.code, 'INVALID_TYPE');

    // 7. GET /api/sdn/:uid Handling
    const uidRes = await fetch(`${baseUrl}/api/sdn/36`);
    assert.equal(uidRes.status, 200);
    assert.match(uidRes.headers.get('cache-control'), /public, max-age=3600/);
    const uidJson = await uidRes.json();
    assert.equal(uidJson.record.fullName, 'AEROCARIBBEAN AIRLINES');

    // Invalid non-numeric UID -> HTTP 400 JSON with INVALID_UID code
    const uidInvalidRes = await fetch(`${baseUrl}/api/sdn/abc`);
    assert.equal(uidInvalidRes.status, 400);
    const uidInvalidJson = await uidInvalidRes.json();
    assert.equal(uidInvalidJson.code, 'INVALID_UID');
    assert.match(uidInvalidJson.error, /numeric/i);

    // Non-existent UID -> HTTP 404 JSON with RECORD_NOT_FOUND code
    const uidNotFoundRes = await fetch(`${baseUrl}/api/sdn/12345`);
    assert.equal(uidNotFoundRes.status, 404);
    const uidNotFoundJson = await uidNotFoundRes.json();
    assert.equal(uidNotFoundJson.code, 'RECORD_NOT_FOUND');
    assert.equal(uidNotFoundJson.uid, 12345);

    // AKA UID -> HTTP 404 JSON
    const uidAkaRes = await fetch(`${baseUrl}/api/sdn/6500`);
    assert.equal(uidAkaRes.status, 404);
    const uidAkaJson = await uidAkaRes.json();
    assert.equal(uidAkaJson.code, 'RECORD_NOT_FOUND');
    assert.equal(uidAkaJson.uid, 6500);

    // 8. Security & Payload Validation (Malformed JSON & Disabled Header)
    assert.equal(healthRes.headers.get('x-powered-by'), null, 'X-Powered-By header must be disabled');

    const malformedJsonRes = await fetch(`${baseUrl}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json payload',
    });
    assert.equal(malformedJsonRes.status, 400);
    const malformedJsonObj = await malformedJsonRes.json();
    assert.equal(malformedJsonObj.code, 'MALFORMED_JSON');
    assert.match(malformedJsonObj.error, /malformed/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Health Readiness Check - 503 when store degraded vs 200 when loaded', async () => {
  try {
    const server = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Normal loaded state -> 200 OK
      const resOk = await fetch(`${baseUrl}/health`);
      assert.equal(resOk.status, 200);
      const jsonOk = await resOk.json();
      assert.equal(jsonOk.status, 'ok');
      assert.ok(jsonOk.recordCount > 0);

      // 2. Unload store using test helper -> 503 Service Unavailable
      store._unloadStoreForTest();
      const resDegraded = await fetch(`${baseUrl}/health`);
      assert.equal(resDegraded.status, 503);
      const jsonDegraded = await resDegraded.json();
      assert.equal(jsonDegraded.status, 'degraded');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    store.reloadStore();
    assert.equal(store.isLoaded(), true, 'Store should be restored after test');
    assert.ok(store.getStats().recordCount > 0, 'Store should have records after reload');
  }
});

test('RapidAPI Proxy Secret Authentication Middleware', async () => {
  const originalSecret = process.env.RAPIDAPI_PROXY_SECRET;
  try {
    process.env.RAPIDAPI_PROXY_SECRET = 'my-secret-key-123';
    const server = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Missing secret header -> 403 Forbidden
      const resNoHeader = await fetch(`${baseUrl}/api/screen?name=Aerocaribbean`);
      assert.equal(resNoHeader.status, 403);
      const jsonNoHeader = await resNoHeader.json();
      assert.equal(jsonNoHeader.code, 'UNAUTHORIZED');
      assert.match(jsonNoHeader.error, /missing RapidAPI Proxy Secret/i);

      // 2. Invalid secret header -> 403 Forbidden
      const resWrongHeader = await fetch(`${baseUrl}/api/sdn/36`, {
        headers: { 'X-RapidAPI-Proxy-Secret': 'wrong-secret' },
      });
      assert.equal(resWrongHeader.status, 403);
      const jsonWrongHeader = await resWrongHeader.json();
      assert.equal(jsonWrongHeader.code, 'UNAUTHORIZED');

      // 3. Valid secret header -> 200 OK
      const resValidHeader = await fetch(`${baseUrl}/api/screen?name=Aerocaribbean&threshold=70`, {
        headers: { 'X-RapidAPI-Proxy-Secret': 'my-secret-key-123' },
      });
      assert.equal(resValidHeader.status, 200);

      // 4. Public endpoints remain un-gated
      const healthRes = await fetch(`${baseUrl}/health`);
      assert.equal(healthRes.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    if (originalSecret !== undefined) {
      process.env.RAPIDAPI_PROXY_SECRET = originalSecret;
    } else {
      delete process.env.RAPIDAPI_PROXY_SECRET;
    }
  }
});
