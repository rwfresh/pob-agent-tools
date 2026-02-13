/**
 * setup.js — Configure @noble/ed25519 for Node.js.
 *
 * @noble/ed25519 v2 requires sha512 to be provided. In Node.js, we use
 * the built-in crypto module. This must be imported before any ed25519 operations.
 */

import { etc } from '@noble/ed25519';
import { createHash } from 'node:crypto';

if (!etc.sha512Sync) {
  etc.sha512Sync = (/** @type {Uint8Array} */ ...msgs) => {
    const h = createHash('sha512');
    for (const msg of msgs) h.update(msg);
    return new Uint8Array(h.digest());
  };
}
