import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SDN_XML_URL = process.env.SDN_XML_URL || 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';
const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'sdn.json');

function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

export function normalizeString(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function buildSdnDatabase() {
  console.log(`[build-sdn] Starting OFAC SDN database build...`);
  console.log(`[build-sdn] Fetching XML from ${SDN_XML_URL}`);
  const startTime = Date.now();

  let xmlText;
  try {
    const response = await fetch(SDN_XML_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    xmlText = await response.text();
  } catch (err) {
    console.error(`[build-sdn] Error fetching OFAC XML: ${err.message}`);
    throw err;
  }

  console.log(`[build-sdn] Downloaded ${(xmlText.length / (1024 * 1024)).toFixed(2)} MB XML data.`);
  console.log(`[build-sdn] Parsing XML...`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    parseNodeValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xmlText);
  const sdnList = parsed.sdnList || parsed['ns1:sdnList'] || {};
  const rawEntries = toArray(sdnList.sdnEntry);
  const publishInfo = sdnList.publshInformation || {};

  console.log(`[build-sdn] Found ${rawEntries.length} raw SDN entries.`);

  let totalAkas = 0;
  let totalAddresses = 0;
  let totalIds = 0;

  const entries = rawEntries.map((raw) => {
    const uid = Number(raw.uid);
    const firstName = raw.firstName ? String(raw.firstName).trim() : null;
    const lastName = raw.lastName ? String(raw.lastName).trim() : null;
    const sdnType = raw.sdnType ? String(raw.sdnType).trim() : 'Entity';
    const title = raw.title ? String(raw.title).trim() : null;
    const remarks = raw.remarks ? String(raw.remarks).trim() : null;

    let fullName = '';
    if (firstName && lastName) {
      fullName = `${firstName} ${lastName}`;
    } else if (lastName) {
      fullName = lastName;
    } else if (firstName) {
      fullName = firstName;
    }

    const normalizedName = normalizeString(fullName);

    // Programs
    const rawPrograms = raw.programList ? toArray(raw.programList.program) : [];
    const programs = rawPrograms.map((p) => String(p).trim()).filter(Boolean);

    // AKAs (Aliases)
    const rawAkas = raw.akaList ? toArray(raw.akaList.aka) : [];
    const akas = rawAkas.map((aka) => {
      totalAkas++;
      const akaFn = aka.firstName ? String(aka.firstName).trim() : null;
      const akaLn = aka.lastName ? String(aka.lastName).trim() : null;
      let akaFull = '';
      if (akaFn && akaLn) akaFull = `${akaFn} ${akaLn}`;
      else if (akaLn) akaFull = akaLn;
      else if (akaFn) akaFull = akaFn;

      return {
        uid: aka.uid ? Number(aka.uid) : null,
        type: aka.type ? String(aka.type).trim() : 'a.k.a.',
        category: aka.category ? String(aka.category).trim() : 'strong',
        firstName: akaFn,
        lastName: akaLn,
        fullName: akaFull,
        normalizedName: normalizeString(akaFull),
      };
    });

    // Addresses
    const rawAddresses = raw.addressList ? toArray(raw.addressList.address) : [];
    const addresses = rawAddresses.map((addr) => {
      totalAddresses++;
      return {
        uid: addr.uid ? Number(addr.uid) : null,
        address1: addr.address1 ? String(addr.address1).trim() : null,
        address2: addr.address2 ? String(addr.address2).trim() : null,
        address3: addr.address3 ? String(addr.address3).trim() : null,
        city: addr.city ? String(addr.city).trim() : null,
        stateOrProvince: addr.stateOrProvince ? String(addr.stateOrProvince).trim() : null,
        postalCode: addr.postalCode ? String(addr.postalCode).trim() : null,
        country: addr.country ? String(addr.country).trim() : null,
      };
    });

    // IDs
    const rawIds = raw.idList ? toArray(raw.idList.id) : [];
    const ids = rawIds.map((idItem) => {
      totalIds++;
      return {
        uid: idItem.uid ? Number(idItem.uid) : null,
        idType: idItem.idType ? String(idItem.idType).trim() : null,
        idNumber: idItem.idNumber ? String(idItem.idNumber).trim() : null,
        idCountry: idItem.idCountry ? String(idItem.idCountry).trim() : null,
        issueDate: idItem.issueDate ? String(idItem.issueDate).trim() : null,
        expirationDate: idItem.expirationDate ? String(idItem.expirationDate).trim() : null,
      };
    });

    // DOBs
    const rawDobs = raw.dateOfBirthList ? toArray(raw.dateOfBirthList.dateOfBirthItem) : [];
    const dobs = rawDobs
      .map((d) => (d.dateOfBirth ? String(d.dateOfBirth).trim() : null))
      .filter(Boolean);

    // POBs
    const rawPobs = raw.placeOfBirthList ? toArray(raw.placeOfBirthList.placeOfBirthItem) : [];
    const pobs = rawPobs
      .map((p) => (p.placeOfBirth ? String(p.placeOfBirth).trim() : null))
      .filter(Boolean);

    return {
      uid,
      sdnType,
      firstName,
      lastName,
      fullName,
      normalizedName,
      title,
      programs,
      akas,
      addresses,
      ids,
      dobs,
      pobs,
      remarks,
    };
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const dataset = {
    metadata: {
      publishDate: publishInfo.Publish_Date || null,
      recordCount: entries.length,
      totalAkas,
      totalAddresses,
      totalIds,
      generatedAt: new Date().toISOString(),
      sourceUrl: SDN_XML_URL,
    },
    entries,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dataset, null, 0), 'utf-8');

  const stats = fs.statSync(OUTPUT_FILE);
  const durationMs = Date.now() - startTime;

  console.log(`[build-sdn] Built SDN database successfully!`);
  console.log(`  - Total Entries: ${entries.length}`);
  console.log(`  - Total AKAs: ${totalAkas}`);
  console.log(`  - Total Addresses: ${totalAddresses}`);
  console.log(`  - Total IDs: ${totalIds}`);
  console.log(`  - Output File: ${OUTPUT_FILE} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`  - Elapsed Time: ${durationMs} ms`);

  return dataset.metadata;
}

// Execute directly if script is run via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildSdnDatabase().catch((err) => {
    console.error('[build-sdn] Build failed:', err);
    process.exit(1);
  });
}
