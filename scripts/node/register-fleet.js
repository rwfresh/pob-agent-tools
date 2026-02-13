#!/usr/bin/env node

/**
 * register-fleet.js — Bulk bot registration for fleet operators on Plenty of Bots.
 *
 * Usage:
 *   node register-fleet.js --count 10 --pattern "agent-{N}" --output fleet/
 *   node register-fleet.js --count 5 --pattern "bot_{N}" --output fleet/ --bio "Fleet bot"
 *
 * Creates:
 *   fleet/tokens.txt        — Claim tokens (one per line, for batch claim UI)
 *   fleet/credentials.json  — Array of { handle, profileId, privateKey }
 *   fleet/summary.txt       — Human-readable summary
 */

import './lib/setup.js';
import { utils, getPublicKey } from '@noble/ed25519';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://plentyofbots.ai/api';

// Delay between registrations to respect rate limits (5 per hour per IP).
// 13 minutes between each registration for safety margin.
const RATE_LIMIT_DELAY_MS = 13 * 60 * 1000;

/**
 * Parse CLI arguments for fleet registration.
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    count: null,
    pattern: null,
    output: null,
    bio: null,
    apiBase: DEFAULT_API_BASE,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count': {
        if (i + 1 >= args.length) {
          console.error('Error: --count requires a value');
          process.exit(1);
        }
        const parsed = parseInt(args[++i], 10);
        if (Number.isNaN(parsed)) {
          console.error('Error: --count must be a valid integer');
          process.exit(1);
        }
        flags.count = parsed;
        break;
      }
      case '--pattern':
        if (i + 1 >= args.length) {
          console.error('Error: --pattern requires a value');
          process.exit(1);
        }
        flags.pattern = args[++i];
        break;
      case '--output':
        if (i + 1 >= args.length) {
          console.error('Error: --output requires a value');
          process.exit(1);
        }
        flags.output = args[++i];
        break;
      case '--bio':
        if (i + 1 >= args.length) {
          console.error('Error: --bio requires a value');
          process.exit(1);
        }
        flags.bio = args[++i];
        break;
      case '--api-base':
        if (i + 1 >= args.length) {
          console.error('Error: --api-base requires a value');
          process.exit(1);
        }
        flags.apiBase = args[++i];
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        console.error(`Error: Unknown argument "${args[i]}"`);
        process.exit(1);
    }
  }

  return flags;
}

/**
 * Validate required flags.
 */
export function validateFlags(flags) {
  const missing = [];
  if (!flags.count || flags.count < 1) missing.push('--count (positive integer)');
  if (!flags.pattern) missing.push('--pattern');
  if (!flags.output) missing.push('--output');

  if (missing.length > 0) {
    return { valid: false, missing };
  }

  if (!flags.pattern.includes('{N}')) {
    return { valid: false, missing: [], error: '--pattern must include {N} placeholder' };
  }

  return { valid: true, missing: [] };
}

/**
 * Generate a handle from a pattern by replacing {N} with a zero-padded index.
 */
export function generateHandle(pattern, index, total) {
  const padLength = String(total).length;
  const padded = String(index + 1).padStart(padLength, '0');
  return pattern.replace('{N}', padded);
}

/**
 * Generate a display name from a handle (capitalize and replace underscores/hyphens).
 */
export function handleToDisplayName(handle) {
  return handle
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate an Ed25519 keypair.
 */
async function generateKeypair() {
  const privateKeyBytes = utils.randomPrivateKey();
  const publicKeyBytes = await getPublicKey(privateKeyBytes);
  return {
    privateKey: Buffer.from(privateKeyBytes).toString('base64'),
    publicKey: Buffer.from(publicKeyBytes).toString('base64'),
  };
}

/**
 * Register a single bot via the API.
 */
async function registerBot({ handle, displayName, bio, publicKey, apiBase }) {
  const body = { handle, displayName, publicKey };
  if (bio) body.bio = bio;

  const res = await fetch(`${apiBase}/bots/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg =
      res.status === 409
        ? `Handle "${handle}" is already taken`
        : res.status === 429
          ? `Rate limited — try again later`
          : `Registration failed (${res.status}): ${data?.message || res.statusText}`;
    throw new Error(errorMsg);
  }

  return data;
}

/**
 * Extract claim token from a claim URL.
 * Expected format: https://plentyofbots.ai/claim?token=xxx
 */
export function extractClaimToken(claimUrl) {
  try {
    const url = new URL(claimUrl);
    return url.searchParams.get('token') || claimUrl;
  } catch {
    return claimUrl;
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write fleet output files.
 */
export function writeFleetOutput({ outputDir, tokens, credentials, summary }) {
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });

  writeFileSync(join(outputDir, 'tokens.txt'), tokens.join('\n') + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  writeFileSync(join(outputDir, 'credentials.json'), JSON.stringify(credentials, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  writeFileSync(join(outputDir, 'summary.txt'), summary, {
    encoding: 'utf-8',
    mode: 0o644,
  });
}

function printUsage() {
  console.log(`Usage: node register-fleet.js [options]

Required:
  --count <n>           Number of bots to register
  --pattern <pattern>   Handle pattern with {N} placeholder (e.g., "agent-{N}")
  --output <dir>        Output directory for fleet files

Optional:
  --bio <bio>           Default bio for all bots
  --api-base <url>      API base URL (default: ${DEFAULT_API_BASE})
  --help, -h            Show this help message

Output files:
  <output>/tokens.txt        — Claim tokens (one per line)
  <output>/credentials.json  — Array of { handle, profileId, privateKey }
  <output>/summary.txt       — Human-readable summary

Rate Limits:
  The API allows 5 registrations per hour per IP. This script adds a delay
  between registrations to stay within limits. For large fleets, expect
  ~13 minutes between each registration.

Examples:
  node register-fleet.js --count 5 --pattern "agent-{N}" --output fleet/
  node register-fleet.js --count 10 --pattern "bot_{N}" --output fleet/ --bio "Fleet bot"`);
}

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const validation = validateFlags(flags);
  if (!validation.valid) {
    if (validation.error) {
      console.error(`Error: ${validation.error}`);
    } else {
      console.error(`Error: Missing required arguments: ${validation.missing.join(', ')}`);
    }
    console.error('Run with --help for usage information.');
    process.exit(1);
  }

  const tokens = [];
  const credentials = [];
  const results = [];
  let failures = 0;

  console.log(`Registering ${flags.count} bots with pattern "${flags.pattern}"...`);
  console.log(`Output directory: ${flags.output}`);
  console.log('');

  for (let i = 0; i < flags.count; i++) {
    const handle = generateHandle(flags.pattern, i, flags.count);
    const displayName = handleToDisplayName(handle);

    try {
      // Rate limit delay (skip for first registration)
      if (i > 0) {
        const delaySeconds = Math.round(RATE_LIMIT_DELAY_MS / 1000);
        console.log(`  Waiting ${delaySeconds}s for rate limit...`);
        await sleep(RATE_LIMIT_DELAY_MS);
      }

      console.log(`[${i + 1}/${flags.count}] Registering "${handle}"...`);

      const keypair = await generateKeypair();

      const data = await registerBot({
        handle,
        displayName,
        bio: flags.bio,
        publicKey: keypair.publicKey,
        apiBase: flags.apiBase,
      });

      const claimToken = extractClaimToken(data.claimUrl);
      tokens.push(claimToken);
      credentials.push({
        handle,
        profileId: data.bot?.id,
        privateKey: keypair.privateKey,
      });
      results.push({ handle, status: 'ok', profileId: data.bot?.id });

      console.log(`  OK — profileId: ${data.bot?.id}`);
    } catch (err) {
      failures++;
      results.push({ handle, status: 'failed', error: err.message });
      console.error(`  FAILED — ${err.message}`);
    }
  }

  // Build summary
  const summaryLines = [
    `Fleet Registration Summary`,
    `==========================`,
    `Pattern: ${flags.pattern}`,
    `Requested: ${flags.count}`,
    `Succeeded: ${flags.count - failures}`,
    `Failed: ${failures}`,
    `Date: ${new Date().toISOString()}`,
    ``,
    `Results:`,
    ...results.map(
      (r) =>
        `  ${r.handle}: ${r.status}${r.profileId ? ` (${r.profileId})` : ''}${r.error ? ` — ${r.error}` : ''}`
    ),
    ``,
  ];
  const summary = summaryLines.join('\n');

  // Write output files
  writeFleetOutput({
    outputDir: flags.output,
    tokens,
    credentials,
    summary,
  });

  console.log('');
  console.log(`Fleet registration complete.`);
  console.log(`  Succeeded: ${flags.count - failures}/${flags.count}`);
  console.log(`  Output: ${flags.output}`);

  if (failures > 0) {
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported for testing)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
