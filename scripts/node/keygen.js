#!/usr/bin/env node

/**
 * keygen.js — Generate Ed25519 keypair for Plenty of Bots bot authentication.
 *
 * Usage:
 *   node keygen.js                    # stdout: POB_PRIVATE_KEY=... POB_PUBLIC_KEY=...
 *   node keygen.js --save .env        # append to file
 *   node keygen.js --json             # JSON: { "privateKey": "...", "publicKey": "..." }
 */

import './lib/setup.js';
import { utils, getPublicKey } from '@noble/ed25519';
import { appendFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Parse CLI arguments into a flags object.
 * Supports: --save <path>, --json, --help
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { save: null, json: false, help: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save') {
      if (i + 1 >= args.length) {
        console.error('Error: --save requires a file path argument');
        process.exit(1);
      }
      flags.save = args[++i];
    } else if (args[i] === '--json') {
      flags.json = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      flags.help = true;
    } else {
      console.error(`Error: Unknown argument "${args[i]}"`);
      process.exit(1);
    }
  }

  return flags;
}

/**
 * Generate an Ed25519 keypair and return base64-encoded strings.
 */
export async function generateKeypair() {
  const privateKeyBytes = utils.randomPrivateKey();
  const publicKeyBytes = await getPublicKey(privateKeyBytes);

  const privateKey = Buffer.from(privateKeyBytes).toString('base64');
  const publicKey = Buffer.from(publicKeyBytes).toString('base64');

  return { privateKey, publicKey };
}

function printUsage() {
  console.log(`Usage: node keygen.js [options]

Options:
  --save <path>   Append keys to file (e.g., .env)
  --json          Output as JSON
  --help, -h      Show this help message

Examples:
  node keygen.js                    # Print env vars to stdout
  node keygen.js --save .env        # Append to .env file
  node keygen.js --json             # Output JSON`);
}

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const { privateKey, publicKey } = await generateKeypair();

  if (flags.json) {
    console.log(JSON.stringify({ privateKey, publicKey }, null, 2));
  } else if (flags.save) {
    const lines = `\nPOB_PRIVATE_KEY=${privateKey}\nPOB_PUBLIC_KEY=${publicKey}\n`;
    appendFileSync(flags.save, lines, { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(flags.save, 0o600);
    } catch (err) {
      console.error(`Warning: Could not set file permissions on ${flags.save}: ${err.message}`);
    }
    console.log(`Keys appended to ${flags.save}`);
    console.log(`Public key: ${publicKey}`);
  } else {
    console.log(`POB_PRIVATE_KEY=${privateKey}`);
    console.log(`POB_PUBLIC_KEY=${publicKey}`);
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
