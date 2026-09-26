# 🛡️ Argus - OFAC SDN Screening API

A fast, lightweight, zero-database **OFAC SDN (Specially Designated Nationals) Screening API** built with **Node.js 20+**, **Express**, **fast-xml-parser**, and **fastest-levenshtein**.

---

## 🧱 The Stack

| Layer | Choice | Why |
| :--- | :--- | :--- |
| **Runtime** | Node.js 20+ | Native ES modules, fast V8 engine, standard local setup. |
| **HTTP Server** | Express | Lightweight, single file setup, zero serverless adapters. |
| **Data Engine** | Local `data/sdn.json` | Downloaded and transformed from OFAC XML feed, loaded in-memory at boot. |
| **Fuzzy Matching** | `fastest-levenshtein` | Fast Levenshtein distance calculation with zero native C++ dependencies. |
| **XML Parser** | `fast-xml-parser` | Pure JS XML parser that handles OFAC XML schema and namespaces seamlessly. |
| **Configuration** | `dotenv` | Clean environment configuration for PORT, URLs, and thresholds. |
| **Dev Runner** | `nodemon` | Hot-reloading development server. |

---

## 📁 Project Structure

```
ArgusApi/
├── src/
│   ├── server.js         # Express HTTP server & API routes
│   ├── screen.js         # Pure fuzzy screening engine (names, AKAs, DOB, country, ID)
│   └── store.js          # In-memory store for data/sdn.json
├── scripts/
│   └── build-sdn.js      # Downloads OFAC SDN XML & transforms into data/sdn.json
├── data/
│   └── sdn.json          # Transformed compact dataset (gitignored)
├── tests/
│   └── screen.test.js    # Unit test suite using node:test
├── .env.example          # Environment variables template
├── .env                  # Local environment file
├── .gitignore            # Git ignore rules
├── package.json          # Node package manifest & scripts
└── README.md             # Documentation
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the SDN Database
Downloads the latest OFAC SDN XML feed from U.S. Treasury, parses the data, and generates `data/sdn.json`.
```bash
npm run build:sdn
```

### 3. Start Development Server
```bash
npm run dev
```

### 4. Run Production Server
```bash
npm start
```

### 5. Run Test Suite
```bash
npm test
```

---

## 📡 API Reference

### 1. Healthcheck & Stats
`GET /health` or `GET /api/stats`

**Response:**
```json
{
  "status": "ok",
  "uptimeSeconds": 45.2,
  "timestamp": "2026-09-26T10:12:00.000Z",
  "store": {
    "isLoaded": true,
    "loadedAt": "2026-09-26T10:11:44.000Z",
    "recordCount": 19391,
    "metadata": {
      "publishDate": "09/23/2026",
      "recordCount": 19391,
      "totalAkas": 24622,
      "totalAddresses": 21951,
      "totalIds": 54313,
      "generatedAt": "2026-09-26T10:11:39.000Z"
    },
    "memoryUsageMb": {
      "rss": "184.20",
      "heapTotal": "142.10",
      "heapUsed": "115.80"
    }
  }
}
```

---

### 2. Screen Entity
`POST /api/screen` or `GET /api/screen`

**Query Parameters / Request Body:**
- `name` *(string, required)*: The name of the entity or individual to screen.
- `type` *(string, optional)*: Filter by type (`Individual`, `Entity`, `Vessel`, `Aircraft`, `all`). Default: `all`.
- `threshold` *(number, optional)*: Match score threshold percentage (0 - 100). Default: `70`.
- `limit` *(number, optional)*: Maximum matches to return (1 - 100). Default: `20`.
- `dob` *(string, optional)*: Date of birth (e.g. `1948` or `10 Dec 1948`).
- `country` *(string, optional)*: Country name to match against address/ID records.
- `idNumber` *(string, optional)*: Passport / Document ID number.

**Example Request:**
```bash
curl -X POST http://localhost:3000/api/screen \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Muhammad Zaydan",
    "type": "Individual",
    "threshold": 70
  }'
```

**Example Response:**
```json
{
  "query": {
    "name": "Muhammad Zaydan",
    "type": "Individual",
    "threshold": 70,
    "limit": 20,
    "dob": null,
    "country": null,
    "idNumber": null
  },
  "totalMatches": 1,
  "returnedMatches": 1,
  "executionTimeMs": 95,
  "results": [
    {
      "uid": 2674,
      "sdnName": "Abu ABBAS",
      "sdnType": "Individual",
      "programs": ["SDGT"],
      "score": 98.5,
      "matchedName": "Muhammad ZAYDAN",
      "matchType": "aka",
      "matchedAlias": {
        "fullName": "Muhammad ZAYDAN",
        "type": "a.k.a."
      },
      "secondaryMatches": {
        "dobMatched": false,
        "countryMatched": false,
        "idMatched": false
      },
      "record": {
        "uid": 2674,
        "sdnType": "Individual",
        "firstName": "Abu",
        "lastName": "ABBAS",
        "fullName": "Abu ABBAS",
        "title": "Director of PALESTINE LIBERATION FRONT",
        "programs": ["SDGT"],
        "akas": [
          {
            "uid": 1795,
            "type": "a.k.a.",
            "category": "strong",
            "firstName": "Muhammad",
            "lastName": "ZAYDAN",
            "fullName": "Muhammad ZAYDAN"
          }
        ]
      }
    }
  ]
}
```

---

### 3. Get Record Details by UID
`GET /api/sdn/:uid`

**Example Request:**
```bash
curl http://localhost:3000/api/sdn/36
```

---

### 4. Trigger Rebuild Data Feed
`POST /api/rebuild`

Triggers downloading the fresh XML feed from Treasury.gov and updating the in-memory dataset dynamically.

---

## 🧠 Screening Logic

1. **Normalization**: Strips diacritics/accents, converts to uppercase, removes special characters, and normalizes spacing.
2. **Hybrid Scoring**: Combines **Normalized Levenshtein Distance** and **Token-Set / Word Overlap Matching** (to handle swapped first/last names or middle names).
3. **Alias Matching**: Evaluates both primary SDN names and all listed alternate names (AKAs).
4. **Secondary Criteria Boosts**: Boosts match scores if secondary fields like Date of Birth, Country, or ID Number match.
