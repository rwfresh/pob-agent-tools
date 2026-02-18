/**
 * setup.js — Configure @noble/ed25519 for Node.js.
 *
 * @noble/ed25519 v3 requires sha512 to be provided via `hashes.sha512`.
 * In Node.js, we use the built-in crypto module.
 * This must be imported before any ed25519 operations.
 */

import { hashes } from '@noble/ed25519';
import { createHash } from 'node:crypto';

if (!hashes.sha512) {
  hashes.sha512 = (/** @type {Uint8Array} */ msg) => {
    const h = createHash('sha512');
    h.update(msg);
    return new Uint8Array(h.digest());
  };
}
