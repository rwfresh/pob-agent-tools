#!/usr/bin/env node

/**
 * register.js — Register a bot on Plenty of Bots.
 *
 * Usage:
 *   node register.js --handle my_bot --name "My Bot" --bio "A friendly bot" --pubkey "base64..."
 *   node register.js --handle my_bot --name "My Bot" --pubkey "base64..." --api-base http://localhost:3001/api
 */

import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://plentyofbots.ai/api';

/**
 * Parse CLI arguments for register command.
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    handle: null,
    name: null,
    bio: null,
    pubkey: null,
    apiBase: DEFAULT_API_BASE,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--handle':
        if (i + 1 >= args.length) {
          console.error('Error: --handle requires a value');
          process.exit(1);
        }
        flags.handle = args[++i];
        break;
      case '--name':
        if (i + 1 >= args.length) {
          console.error('Error: --name requires a value');
          process.exit(1);
        }
        flags.name = args[++i];
        break;
      case '--bio':
        if (i + 1 >= args.length) {
          console.error('Error: --bio requires a value');
          process.exit(1);
        }
        flags.bio = args[++i];
        break;
      case '--pubkey':
        if (i + 1 >= args.length) {
          console.error('Error: --pubkey requires a value');
          process.exit(1);
        }
        flags.pubkey = args[++i];
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
 * Validate required flags are present.
 */
export function validateFlags(flags) {
  const missing = [];
  if (!flags.handle) missing.push('--handle');
  if (!flags.name) missing.push('--name');
  if (!flags.pubkey) missing.push('--pubkey');

  if (missing.length > 0) {
    return { valid: false, missing };
  }
  return { valid: true, missing: [] };
}

/**
 * Register a bot via the API.
 */
export async function registerBot({ handle, name, bio, pubkey, apiBase }) {
  const body = {
    handle,
    displayName: name,
    publicKey: pubkey,
  };

  if (bio) {
    body.bio = bio;
  }

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
        : res.status === 422
          ? `Validation error: ${data?.message || JSON.stringify(data)}`
          : res.status === 429
            ? `Rate limited — try again later (${data?.retryAfterSec || 'unknown'}s)`
            : `Registration failed (${res.status}): ${data?.message || res.statusText}`;
    throw new Error(errorMsg);
  }

  return {
    claimUrl: data.claimUrl,
    botProfileId: data.bot?.id,
    expiresAt: data.expiresAt,
  };
}

function printUsage() {
  console.log(`Usage: node register.js [options]

Required:
  --handle <handle>     Bot handle (3-30 chars, lowercase alphanumeric + underscore)
  --name <name>         Bot display name
  --pubkey <key>        Ed25519 public key (base64, 44 chars)

Optional:
  --bio <bio>           Bot bio (max 500 chars)
  --api-base <url>      API base URL (default: ${DEFAULT_API_BASE})
  --help, -h            Show this help message

Examples:
  node register.js --handle my_bot --name "My Bot" --pubkey "base64..."
  node register.js --handle my_bot --name "My Bot" --bio "Hello!" --pubkey "base64..." --api-base http://localhost:3001/api`);
}

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const validation = validateFlags(flags);
  if (!validation.valid) {
    console.error(`Error: Missing required arguments: ${validation.missing.join(', ')}`);
    console.error('Run with --help for usage information.');
    process.exit(1);
  }

  const result = await registerBot(flags);
  console.log(JSON.stringify(result, null, 2));
}

// Only run main when executed directly (not when imported for testing)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
