import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, validateFlags } from '../register.js';

describe('register', () => {
  describe('parseArgs', () => {
    it('returns defaults with no arguments', () => {
      const flags = parseArgs(['node', 'register.js']);
      assert.strictEqual(flags.handle, null);
      assert.strictEqual(flags.name, null);
      assert.strictEqual(flags.bio, null);
      assert.strictEqual(flags.pubkey, null);
      assert.strictEqual(flags.apiBase, 'https://plentyofbots.ai/api');
      assert.strictEqual(flags.help, false);
    });

    it('parses all required flags', () => {
      const flags = parseArgs([
        'node', 'register.js',
        '--handle', 'my_bot',
        '--name', 'My Bot',
        '--pubkey', 'AAAA',
      ]);
      assert.strictEqual(flags.handle, 'my_bot');
      assert.strictEqual(flags.name, 'My Bot');
      assert.strictEqual(flags.pubkey, 'AAAA');
    });

    it('parses optional --bio flag', () => {
      const flags = parseArgs([
        'node', 'register.js',
        '--handle', 'my_bot',
        '--name', 'My Bot',
        '--pubkey', 'AAAA',
        '--bio', 'Hello world',
      ]);
      assert.strictEqual(flags.bio, 'Hello world');
    });

    it('parses --api-base flag', () => {
      const flags = parseArgs([
        'node', 'register.js',
        '--handle', 'x',
        '--name', 'x',
        '--pubkey', 'x',
        '--api-base', 'http://localhost:3001/api',
      ]);
      assert.strictEqual(flags.apiBase, 'http://localhost:3001/api');
    });

    it('parses --help flag', () => {
      const flags = parseArgs(['node', 'register.js', '--help']);
      assert.strictEqual(flags.help, true);
    });
  });

  describe('validateFlags', () => {
    it('returns valid for all required flags present', () => {
      const result = validateFlags({
        handle: 'my_bot',
        name: 'My Bot',
        pubkey: 'AAAA',
      });
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.missing, []);
    });

    it('reports missing --handle', () => {
      const result = validateFlags({
        handle: null,
        name: 'My Bot',
        pubkey: 'AAAA',
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.missing.includes('--handle'));
    });

    it('reports missing --name', () => {
      const result = validateFlags({
        handle: 'my_bot',
        name: null,
        pubkey: 'AAAA',
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.missing.includes('--name'));
    });

    it('reports missing --pubkey', () => {
      const result = validateFlags({
        handle: 'my_bot',
        name: 'My Bot',
        pubkey: null,
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.missing.includes('--pubkey'));
    });

    it('reports all missing flags', () => {
      const result = validateFlags({
        handle: null,
        name: null,
        pubkey: null,
      });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.missing.length, 3);
    });
  });
});
