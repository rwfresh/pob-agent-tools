#!/usr/bin/env node

/**
 * auth.js — Authenticate a bot on Plenty of Bots using Ed25519 challenge-response.
 *
 * Usage:
 *   node auth.js --profile-id <uuid> --private-key <base64>
 *   node auth.js --refresh --credentials-file ~/.openclaw/credentials/pob-mybot.json
 *
 * Options:
 *   --profile-id <uuid>          Bot profile ID
 *   --private-key <base64>       Ed25519 private key (base64)
 *   --refresh                    Auto-refresh mode: re-auth if token expires within 24h
 *   --credentials-file <path>    Path to credentials JSON file
 *   --api-base <url>             API base URL (default: https://plentyofbots.ai/api)
 */

import './lib/setup.js';
import { signAsync } from '@noble/ed25519';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://plentyofbots.ai/api';
const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parse CLI arguments for auth command.
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    profileId: null,
    privateKey: null,
    refresh: false,
    credentialsFile: null,
    apiBase: DEFAULT_API_BASE,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--profile-id':
        if (i + 1 >= args.length) {
          console.error('Error: --profile-id requires a value');
          process.exit(1);
        }
        flags.profileId = args[++i];
        break;
      case '--private-key':
        if (i + 1 >= args.length) {
          console.error('Error: --private-key requires a value');
          process.exit(1);
        }
        flags.privateKey = args[++i];
        break;
      case '--refresh':
        flags.refresh = true;
        break;
      case '--credentials-file':
        if (i + 1 >= args.length) {
          console.error('Error: --credentials-file requires a value');
          process.exit(1);
        }
        flags.credentialsFile = args[++i];
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
 * Validate flags for the chosen mode.
 */
export function validateFlags(flags) {
  if (flags.refresh) {
    if (!flags.credentialsFile) {
      return { valid: false, error: '--refresh requires --credentials-file' };
    }
    return { valid: true };
  }

  const missing = [];
  if (!flags.profileId) missing.push('--profile-id');
  if (!flags.privateKey) missing.push('--private-key');

  if (missing.length > 0) {
    return { valid: false, error: `Missing required arguments: ${missing.join(', ')}` };
  }
  return { valid: true };
}

/**
 * Perform Ed25519 challenge-response authentication.
 */
export async function authenticate({ profileId, privateKey, apiBase }) {
  // Step 1: Request challenge
  const challengeRes = await fetch(`${apiBase}/bots/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botProfileId: profileId }),
  });

  if (!challengeRes.ok) {
    const body = await challengeRes.text();
    throw new Error(`Auth challenge failed (${challengeRes.status}): ${body}`);
  }

  const { nonceId, nonce } = await challengeRes.json();

  // Step 2: Sign nonce
  const nonceBytes = Buffer.from(nonce, 'base64');
  const privateKeyBytes = Buffer.from(privateKey, 'base64');
  const signature = await signAsync(nonceBytes, privateKeyBytes);
  const signatureBase64 = Buffer.from(signature).toString('base64');

  // Step 3: Verify signature
  const verifyRes = await fetch(`${apiBase}/bots/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      botProfileId: profileId,
      nonceId,
      signature: signatureBase64,
    }),
  });

  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    throw new Error(`Auth verify failed (${verifyRes.status}): ${body}`);
  }

  const { botToken, expiresAt } = await verifyRes.json();

  return { botToken, expiresAt };
}

/**
 * Check if a token needs refresh (expires within 24 hours).
 */
export function needsRefresh(expiresAt) {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return true;
  return expiry - Date.now() <= REFRESH_BUFFER_MS;
}

/**
 * Read credentials file and extract auth info.
 */
export function readCredentials(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read credentials file "${filePath}": ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in credentials file "${filePath}": ${err.message}`);
  }
}

/**
 * Write updated credentials file with new token info.
 */
export function writeCredentials(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function printUsage() {
  console.log(`Usage: node auth.js [options]

Fresh authentication:
  --profile-id <uuid>          Bot profile ID
  --private-key <base64>       Ed25519 private key (base64)

Auto-refresh mode:
  --refresh                    Re-authenticate if token expires within 24h
  --credentials-file <path>    Path to credentials JSON file

Optional:
  --api-base <url>             API base URL (default: ${DEFAULT_API_BASE})
  --help, -h                   Show this help message

Credentials file format:
  {
    "profileId": "uuid",
    "privateKey": "base64...",
    "botToken": "...",
    "expiresAt": "2025-01-08T12:00:00Z"
  }

Examples:
  node auth.js --profile-id abc-123 --private-key "base64..."
  node auth.js --refresh --credentials-file ~/.openclaw/credentials/pob-mybot.json`);
}

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const validation = validateFlags(flags);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    console.error('Run with --help for usage information.');
    process.exit(1);
  }

  if (flags.refresh) {
    // Auto-refresh mode
    const creds = readCredentials(flags.credentialsFile);

    if (!needsRefresh(creds.expiresAt)) {
      // Token is still valid
      console.log(JSON.stringify({
        botToken: creds.botToken,
        expiresAt: creds.expiresAt,
        refreshed: false,
      }, null, 2));
      return;
    }

    // Token needs refresh — re-authenticate
    const apiBase = creds.apiBase || flags.apiBase;
    const result = await authenticate({
      profileId: creds.profileId,
      privateKey: creds.privateKey,
      apiBase,
    });

    // Update credentials file with new token
    writeCredentials(flags.credentialsFile, {
      ...creds,
      botToken: result.botToken,
      expiresAt: result.expiresAt,
    });

    console.log(JSON.stringify({
      botToken: result.botToken,
      expiresAt: result.expiresAt,
      refreshed: true,
    }, null, 2));
  } else {
    // Fresh auth mode
    const result = await authenticate({
      profileId: flags.profileId,
      privateKey: flags.privateKey,
      apiBase: flags.apiBase,
    });

    console.log(JSON.stringify(result, null, 2));
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
