#!/usr/bin/env npx ts-node
/**
 * Seed devices from config.yml into MongoDB.
 *
 * Reads the `devices` array from config.yml and upserts each device
 * into the `devices` collection, keyed by prefix.
 *
 * Usage:
 *   npx ts-node scripts/seed-devices.ts [--config config.yml]
 *
 * Requires MONGODB_URL and optionally MONGODB_DB in .env
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
let configPath = path.join(process.cwd(), 'config.yml');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' && args[i + 1]) {
    configPath = args[++i];
  }
}

const mongoUrl = process.env.MONGODB_URL;
const dbName = process.env.MONGODB_DB ?? 'productionhub';

if (!mongoUrl) {
  console.error('Error: MONGODB_URL not set. Add it to .env or set it in your environment.');
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  console.error(`Error: Config file not found: ${configPath}`);
  process.exit(1);
}

async function main() {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = yaml.parse(raw);

  if (!config.devices || !Array.isArray(config.devices)) {
    console.error('Error: No devices array found in config');
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl!);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection('devices');

  await collection.createIndex({ prefix: 1 }, { unique: true });

  let inserted = 0;
  let updated = 0;

  for (const device of config.devices) {
    const prefix = device.prefix;
    if (!prefix) {
      console.warn('  Skipping device with no prefix:', device);
      continue;
    }

    const result = await collection.updateOne(
      { prefix },
      { $set: device },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      inserted++;
      console.log(`  [INSERT] ${prefix} (${device.type})`);
    } else if (result.modifiedCount > 0) {
      updated++;
      console.log(`  [UPDATE] ${prefix} (${device.type})`);
    } else {
      console.log(`  [NOOP]   ${prefix} (${device.type}) — unchanged`);
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${updated} updated, ${config.devices.length} total`);
  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
