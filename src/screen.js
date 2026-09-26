import { distance } from 'fastest-levenshtein';
import store from './store.js';
import { normalizeString } from '../scripts/build-sdn.js';
import { ValidationError } from './errors.js';

/**
 * Calculates normalized Levenshtein similarity between two strings (0.0 to 1.0)
 */
function levenshteinSimilarity(a, b) {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;
  if (a === b) return 1.0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const dist = distance(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Calculates token-set similarity to handle word order variations (e.g. "First Last" vs "Last, First")
 */
function tokenSetSimilarity(strA, strB) {
  if (!strA || !strB) return 0.0;
  if (strA === strB) return 1.0;

  const tokensA = strA.split(' ').filter(Boolean);
  const tokensB = strB.split(' ').filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  let totalMatchA = 0;
  for (const tA of tokensA) {
    let bestMatch = 0;
    for (const tB of tokensB) {
      const sim = levenshteinSimilarity(tA, tB);
      if (sim > bestMatch) bestMatch = sim;
    }
    totalMatchA += bestMatch;
  }

  let totalMatchB = 0;
  for (const tB of tokensB) {
    let bestMatch = 0;
    for (const tA of tokensA) {
      const sim = levenshteinSimilarity(tA, tB);
      if (sim > bestMatch) bestMatch = sim;
    }
    totalMatchB += bestMatch;
  }

  const scoreA = totalMatchA / tokensA.length;
  const scoreB = totalMatchB / tokensB.length;

  return (scoreA + scoreB) / 2;
}

/**
 * Computes hybrid similarity score between query name and target name (0 to 100)
 */
function computeNameScore(normQuery, normTarget) {
  if (!normQuery || !normTarget) return 0;
  if (normQuery === normTarget) return 100;

  const levSim = levenshteinSimilarity(normQuery, normTarget);
  const tokenSim = tokenSetSimilarity(normQuery, normTarget);

  let baseScore = Math.max(levSim, tokenSim) * 100;

  // Substring bonus if one string completely contains the other (and isn't trivially short)
  if (normQuery.length >= 3 && normTarget.length >= 3) {
    if (normTarget.includes(normQuery) || normQuery.includes(normTarget)) {
      const ratio = Math.min(normQuery.length, normTarget.length) / Math.max(normQuery.length, normTarget.length);
      baseScore = Math.max(baseScore, ratio * 95);
    }
  }

  return baseScore;
}

const VALID_TYPES = new Set(['individual', 'entity', 'vessel', 'aircraft', 'all']);

/**
 * Pure screening function to search SDN database for matching names/entities
 *
 * @param {Object} options
 * @param {string} options.name - The query name to screen (required)
 * @param {string} [options.type='all'] - Entity type filter: 'Individual', 'Entity', 'Vessel', 'Aircraft', 'all'
 * @param {number} [options.threshold=70] - Minimum match score threshold (0 - 100)
 * @param {number} [options.limit=20] - Max results to return
 * @param {string} [options.dob] - Optional date of birth string
 * @param {string} [options.country] - Optional country string
 * @param {string} [options.idNumber] - Optional ID or passport number
 * @returns {Object} Screening result summary & matched records
 */
export function screenEntity(options = {}) {
  const startTime = Date.now();

  const queryName = options.name ? String(options.name).trim() : '';
  if (!queryName) {
    throw new ValidationError('Parameter "name" is required for screening.');
  }

  const typeFilter = options.type ? String(options.type).trim() : 'all';
  if (!VALID_TYPES.has(typeFilter.toLowerCase())) {
    throw new ValidationError(
      `Invalid "type" parameter: "${options.type}". Allowed values: Individual, Entity, Vessel, Aircraft, all.`
    );
  }

  const thresholdRaw = options.threshold !== undefined ? options.threshold : 70;
  const threshold = Number(thresholdRaw);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
    throw new ValidationError('Parameter "threshold" must be a number between 0 and 100.');
  }

  const limitRaw = options.limit !== undefined ? options.limit : 20;
  const limitNum = Number(limitRaw);
  if (Number.isNaN(limitNum) || limitNum < 1) {
    throw new ValidationError('Parameter "limit" must be a positive integer.');
  }
  const limit = Math.min(Math.floor(limitNum), 100);

  const queryDob = options.dob ? normalizeString(options.dob) : null;
  const queryCountry = options.country ? normalizeString(options.country) : null;
  const queryId = options.idNumber ? normalizeString(options.idNumber) : null;

  const normQueryName = normalizeString(queryName);
  const entries = store.getEntries();

  const matchedResults = [];

  for (const entry of entries) {
    // Type Filter
    if (typeFilter !== 'all' && typeFilter.toLowerCase() !== entry.sdnType.toLowerCase()) {
      continue;
    }

    let highestScore = 0;
    let matchedName = entry.fullName;
    let matchType = 'primary';
    let matchedAlias = null;

    // 1. Check Primary Name
    const primaryScore = computeNameScore(normQueryName, entry.normalizedName);
    if (primaryScore > highestScore) {
      highestScore = primaryScore;
      matchedName = entry.fullName;
      matchType = 'primary';
    }

    // 2. Check AKAs (Aliases)
    if (entry.akas && entry.akas.length > 0) {
      for (const aka of entry.akas) {
        if (!aka.normalizedName) continue;
        const akaScore = computeNameScore(normQueryName, aka.normalizedName);
        if (akaScore > highestScore) {
          highestScore = akaScore;
          matchedName = aka.fullName;
          matchType = 'aka';
          matchedAlias = aka;
        }
      }
    }

    // Secondary Criteria checks
    let dobMatched = false;
    let countryMatched = false;
    let idMatched = false;

    // Check DOB
    if (queryDob && entry.dobs && entry.dobs.length > 0) {
      for (const dob of entry.dobs) {
        if (normalizeString(dob).includes(queryDob) || queryDob.includes(normalizeString(dob))) {
          dobMatched = true;
          break;
        }
      }
    }

    // Check Country (in Addresses or IDs)
    if (queryCountry) {
      if (entry.addresses) {
        for (const addr of entry.addresses) {
          if (addr.country && normalizeString(addr.country).includes(queryCountry)) {
            countryMatched = true;
            break;
          }
        }
      }
      if (!countryMatched && entry.ids) {
        for (const idObj of entry.ids) {
          if (idObj.idCountry && normalizeString(idObj.idCountry).includes(queryCountry)) {
            countryMatched = true;
            break;
          }
        }
      }
    }

    // Check ID Number
    if (queryId && entry.ids) {
      for (const idObj of entry.ids) {
        if (idObj.idNumber && normalizeString(idObj.idNumber).includes(queryId)) {
          idMatched = true;
          break;
        }
      }
    }

    // Apply Boosts for secondary criteria matches
    let finalScore = highestScore;

    if (idMatched) {
      // Exact ID match boosts score significantly or sets to 100
      finalScore = Math.max(finalScore, 100);
    } else {
      if (dobMatched) finalScore = Math.min(100, finalScore + 10);
      if (countryMatched) finalScore = Math.min(100, finalScore + 5);
    }

    // Filter by score threshold
    if (finalScore >= threshold) {
      matchedResults.push({
        uid: entry.uid,
        sdnName: entry.fullName,
        sdnType: entry.sdnType,
        programs: entry.programs,
        score: Math.round(finalScore * 10) / 10,
        matchedName,
        matchType,
        matchedAlias: matchedAlias ? { fullName: matchedAlias.fullName, type: matchedAlias.type } : null,
        secondaryMatches: {
          dobMatched,
          countryMatched,
          idMatched,
        },
        record: entry,
      });
    }
  }

  // Sort descending by score, then ascending by uid
  matchedResults.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.uid - b.uid;
  });

  const slicedResults = matchedResults.slice(0, limit);
  const durationMs = Date.now() - startTime;

  return {
    query: {
      name: queryName,
      type: typeFilter,
      threshold,
      limit,
      dob: options.dob || null,
      country: options.country || null,
      idNumber: options.idNumber || null,
    },
    totalMatches: matchedResults.length,
    returnedMatches: slicedResults.length,
    executionTimeMs: durationMs,
    results: slicedResults,
  };
}

export default screenEntity;
