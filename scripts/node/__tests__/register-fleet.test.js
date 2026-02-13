import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, validateFlags, generateHandle, handleToDisplayName, extractClaimToken, writeFleetOutput } from '../register-fleet.js';

describe('register-fleet', () => {
  describe('parseArgs', () => {
    it('returns defaults with no arguments', () => {
      const flags = parseArgs(['node', 'register-fleet.js']);
      assert.strictEqual(flags.count, null);
      assert.strictEqual(flags.pattern, null);
      assert.strictEqual(flags.output, null);
      assert.strictEqual(flags.bio, null);
      assert.strictEqual(flags.apiBase, 'https://plentyofbots.ai/api');
      assert.strictEqual(flags.help, false);
    });

    it('parses all required flags', () => {
      const flags = parseArgs([
        'node', 'register-fleet.js',
        '--count', '10',
        '--pattern', 'agent-{N}',
        '--output', 'fleet/',
      ]);
      assert.strictEqual(flags.count, 10);
      assert.strictEqual(flags.pattern, 'agent-{N}');
      assert.strictEqual(flags.output, 'fleet/');
    });

    it('parses optional flags', () => {
      const flags = parseArgs([
        'node', 'register-fleet.js',
        '--count', '5',
        '--pattern', 'bot_{N}',
        '--output', 'out/',
        '--bio', 'Fleet bot',
        '--api-base', 'http://localhost:3001/api',
      ]);
      assert.strictEqual(flags.bio, 'Fleet bot');
      assert.strictEqual(flags.apiBase, 'http://localhost:3001/api');
    });

    it('parses --help flag', () => {
      const flags = parseArgs(['node', 'register-fleet.js', '--help']);
      assert.strictEqual(flags.help, true);
    });
  });

  describe('validateFlags', () => {
    it('validates all required flags present', () => {
      const result = validateFlags({
        count: 5,
        pattern: 'agent-{N}',
        output: 'fleet/',
      });
      assert.strictEqual(result.valid, true);
    });

    it('fails without --count', () => {
      const result = validateFlags({
        count: null,
        pattern: 'agent-{N}',
        output: 'fleet/',
      });
      assert.strictEqual(result.valid, false);
    });

    it('fails with --count 0', () => {
      const result = validateFlags({
        count: 0,
        pattern: 'agent-{N}',
        output: 'fleet/',
      });
      assert.strictEqual(result.valid, false);
    });

    it('fails without --pattern', () => {
      const result = validateFlags({
        count: 5,
        pattern: null,
        output: 'fleet/',
      });
      assert.strictEqual(result.valid, false);
    });

    it('fails without --output', () => {
      const result = validateFlags({
        count: 5,
        pattern: 'agent-{N}',
        output: null,
      });
      assert.strictEqual(result.valid, false);
    });

    it('fails when pattern is missing {N} placeholder', () => {
      const result = validateFlags({
        count: 5,
        pattern: 'agent-bot',
        output: 'fleet/',
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('{N}'));
    });
  });

  describe('generateHandle', () => {
    it('replaces {N} with zero-padded index', () => {
      assert.strictEqual(generateHandle('agent-{N}', 0, 10), 'agent-01');
      assert.strictEqual(generateHandle('agent-{N}', 9, 10), 'agent-10');
    });

    it('pads correctly for single-digit total', () => {
      assert.strictEqual(generateHandle('bot-{N}', 0, 5), 'bot-1');
      assert.strictEqual(generateHandle('bot-{N}', 4, 5), 'bot-5');
    });

    it('pads correctly for triple-digit total', () => {
      assert.strictEqual(generateHandle('bot-{N}', 0, 100), 'bot-001');
      assert.strictEqual(generateHandle('bot-{N}', 99, 100), 'bot-100');
    });

    it('works with underscore pattern', () => {
      assert.strictEqual(generateHandle('fleet_{N}', 0, 10), 'fleet_01');
    });
  });

  describe('handleToDisplayName', () => {
    it('capitalizes words separated by hyphens', () => {
      assert.strictEqual(handleToDisplayName('agent-01'), 'Agent 01');
    });

    it('capitalizes words separated by underscores', () => {
      assert.strictEqual(handleToDisplayName('fleet_bot'), 'Fleet Bot');
    });

    it('handles single word', () => {
      assert.strictEqual(handleToDisplayName('mybot'), 'Mybot');
    });
  });

  describe('extractClaimToken', () => {
    it('extracts token from a valid claim URL', () => {
      const token = extractClaimToken('https://plentyofbots.ai/claim?token=abc123');
      assert.strictEqual(token, 'abc123');
    });

    it('returns the full string if not a valid URL', () => {
      const token = extractClaimToken('not-a-url');
      assert.strictEqual(token, 'not-a-url');
    });

    it('returns full URL if token param is missing', () => {
      const token = extractClaimToken('https://plentyofbots.ai/claim');
      assert.strictEqual(token, 'https://plentyofbots.ai/claim');
    });
  });

  describe('writeFleetOutput', () => {
    it('creates output files in the specified directory', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'fleet-test-'));
      const outputDir = join(tmpDir, 'fleet');

      writeFleetOutput({
        outputDir,
        tokens: ['token1', 'token2'],
        credentials: [
          { handle: 'bot-01', profileId: 'id1', privateKey: 'key1' },
          { handle: 'bot-02', profileId: 'id2', privateKey: 'key2' },
        ],
        summary: 'Test summary\nLine 2\n',
      });

      // Check tokens.txt
      const tokensContent = readFileSync(join(outputDir, 'tokens.txt'), 'utf-8');
      assert.strictEqual(tokensContent, 'token1\ntoken2\n');

      // Check credentials.json
      const credsContent = JSON.parse(readFileSync(join(outputDir, 'credentials.json'), 'utf-8'));
      assert.strictEqual(credsContent.length, 2);
      assert.strictEqual(credsContent[0].handle, 'bot-01');
      assert.strictEqual(credsContent[1].handle, 'bot-02');

      // Check summary.txt
      const summaryContent = readFileSync(join(outputDir, 'summary.txt'), 'utf-8');
      assert.ok(summaryContent.includes('Test summary'));

      // Cleanup
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
