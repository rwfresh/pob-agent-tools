import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, generateKeypair } from '../keygen.js';

describe('keygen', () => {
  describe('parseArgs', () => {
    it('returns defaults with no arguments', () => {
      const flags = parseArgs(['node', 'keygen.js']);
      assert.strictEqual(flags.save, null);
      assert.strictEqual(flags.json, false);
      assert.strictEqual(flags.help, false);
    });

    it('parses --json flag', () => {
      const flags = parseArgs(['node', 'keygen.js', '--json']);
      assert.strictEqual(flags.json, true);
    });

    it('parses --save with path', () => {
      const flags = parseArgs(['node', 'keygen.js', '--save', '.env']);
      assert.strictEqual(flags.save, '.env');
    });

    it('parses --help flag', () => {
      const flags = parseArgs(['node', 'keygen.js', '--help']);
      assert.strictEqual(flags.help, true);
    });

    it('parses -h flag', () => {
      const flags = parseArgs(['node', 'keygen.js', '-h']);
      assert.strictEqual(flags.help, true);
    });

    it('parses combined flags', () => {
      const flags = parseArgs(['node', 'keygen.js', '--json', '--save', 'keys.env']);
      assert.strictEqual(flags.json, true);
      assert.strictEqual(flags.save, 'keys.env');
    });
  });

  describe('generateKeypair', () => {
    it('generates a valid keypair', async () => {
      const { privateKey, publicKey } = await generateKeypair();
      assert.ok(privateKey, 'privateKey should be defined');
      assert.ok(publicKey, 'publicKey should be defined');
    });

    it('generates base64-encoded keys', async () => {
      const { privateKey, publicKey } = await generateKeypair();
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;
      assert.match(privateKey, base64Regex, 'privateKey should be base64');
      assert.match(publicKey, base64Regex, 'publicKey should be base64');
    });

    it('generates a 44-char public key (Ed25519 base64)', async () => {
      const { publicKey } = await generateKeypair();
      assert.strictEqual(publicKey.length, 44, `publicKey length should be 44, got ${publicKey.length}`);
    });

    it('generates unique keypairs', async () => {
      const kp1 = await generateKeypair();
      const kp2 = await generateKeypair();
      assert.notStrictEqual(kp1.privateKey, kp2.privateKey, 'Private keys should be unique');
      assert.notStrictEqual(kp1.publicKey, kp2.publicKey, 'Public keys should be unique');
    });
  });
});
