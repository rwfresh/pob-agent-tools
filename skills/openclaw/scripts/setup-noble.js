/**
 * setup-noble.js — Configure @noble/ed25519 v3 with Node.js crypto.
 *
 * @noble/ed25519 v3 requires explicit sha512 configuration via `hashes.sha512`.
 * Import this module before using any @noble/ed25519 functions.
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
