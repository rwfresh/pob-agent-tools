import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, validateFlags, needsRefresh } from '../auth.js';

describe('auth', () => {
  describe('parseArgs', () => {
    it('returns defaults with no arguments', () => {
      const flags = parseArgs(['node', 'auth.js']);
      assert.strictEqual(flags.profileId, null);
      assert.strictEqual(flags.privateKey, null);
      assert.strictEqual(flags.refresh, false);
      assert.strictEqual(flags.credentialsFile, null);
      assert.strictEqual(flags.apiBase, 'https://plentyofbots.ai/api');
      assert.strictEqual(flags.help, false);
    });

    it('parses fresh auth flags', () => {
      const flags = parseArgs([
        'node', 'auth.js',
        '--profile-id', 'abc-123',
        '--private-key', 'base64key',
      ]);
      assert.strictEqual(flags.profileId, 'abc-123');
      assert.strictEqual(flags.privateKey, 'base64key');
    });

    it('parses refresh flags', () => {
      const flags = parseArgs([
        'node', 'auth.js',
        '--refresh',
        '--credentials-file', '/path/to/creds.json',
      ]);
      assert.strictEqual(flags.refresh, true);
      assert.strictEqual(flags.credentialsFile, '/path/to/creds.json');
    });

    it('parses --api-base flag', () => {
      const flags = parseArgs([
        'node', 'auth.js',
        '--profile-id', 'x',
        '--private-key', 'y',
        '--api-base', 'http://localhost:3001/api',
      ]);
      assert.strictEqual(flags.apiBase, 'http://localhost:3001/api');
    });

    it('parses --help flag', () => {
      const flags = parseArgs(['node', 'auth.js', '--help']);
      assert.strictEqual(flags.help, true);
    });
  });

  describe('validateFlags', () => {
    it('validates fresh auth with both required flags', () => {
      const result = validateFlags({
        profileId: 'abc-123',
        privateKey: 'base64key',
        refresh: false,
      });
      assert.strictEqual(result.valid, true);
    });

    it('fails fresh auth without --profile-id', () => {
      const result = validateFlags({
        profileId: null,
        privateKey: 'base64key',
        refresh: false,
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('--profile-id'));
    });

    it('fails fresh auth without --private-key', () => {
      const result = validateFlags({
        profileId: 'abc-123',
        privateKey: null,
        refresh: false,
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('--private-key'));
    });

    it('validates refresh mode with credentials file', () => {
      const result = validateFlags({
        refresh: true,
        credentialsFile: '/path/to/creds.json',
      });
      assert.strictEqual(result.valid, true);
    });

    it('fails refresh mode without credentials file', () => {
      const result = validateFlags({
        refresh: true,
        credentialsFile: null,
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('--credentials-file'));
    });
  });

  describe('needsRefresh', () => {
    it('returns true when expiresAt is null', () => {
      assert.strictEqual(needsRefresh(null), true);
    });

    it('returns true when expiresAt is undefined', () => {
      assert.strictEqual(needsRefresh(undefined), true);
    });

    it('returns true when token expires within 24 hours', () => {
      const soonExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // 12h from now
      assert.strictEqual(needsRefresh(soonExpiry), true);
    });

    it('returns false when token expires in more than 24 hours', () => {
      const laterExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h from now
      assert.strictEqual(needsRefresh(laterExpiry), false);
    });

    it('returns true when token is already expired', () => {
      const pastExpiry = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
      assert.strictEqual(needsRefresh(pastExpiry), true);
    });

    it('returns true when token expires in exactly 24 hours', () => {
      const exactExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // exactly 24h
      assert.strictEqual(needsRefresh(exactExpiry), true);
    });

    it('returns true when expiresAt is an invalid date string', () => {
      assert.strictEqual(needsRefresh('invalid-date'), true);
    });

    it('returns true when expiresAt is a non-date string', () => {
      assert.strictEqual(needsRefresh('not-a-date'), true);
    });
  });
});
