import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {bytesToHex} from '../api/src/crypto-hex.js';

const previous = (bytes) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');

test('fast crypto hex matches prior encoding for all bytes and lengths', () => {
  for (const len of [0, 1, 2, 16, 32, 64, 256, 1024]) {
    const bytes = Uint8Array.from({length: len}, (_, i) => (i * 47 + 13) & 255);
    assert.equal(bytesToHex(bytes), previous(bytes));
  }
  assert.equal(bytesToHex(Uint8Array.from({length: 256}, (_, i) => i)), previous(Uint8Array.from({length: 256}, (_, i) => i)));
  assert.equal(bytesToHex(Uint8Array.from([0, 15, 16, 255])), '000f10ff');
});

test('cryptographic SHA-256 and HMAC encodings are unchanged', async () => {
  const cases = ['', 'token\u0000pepper', '中日🙂', 'x'.repeat(1024)];
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('synthetic-only-secret-for-tests'), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  for (const sample of cases) {
    const data = new TextEncoder().encode(sample);
    const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', data));
    const signature = new Uint8Array(await webcrypto.subtle.sign('HMAC', key, data));
    assert.equal(bytesToHex(digest), previous(digest));
    assert.equal(bytesToHex(signature), previous(signature));
    assert.match(bytesToHex(signature), /^[0-9a-f]{64}$/);
  }
});

test('hot-path security source uses the common encoder for all three call sites', () => {
  const src = readFileSync(new URL('../api/src/security.ts', import.meta.url), 'utf8');
  assert.match(src, /import\s*\{\s*bytesToHex\s*\}\s*from\s*["']\.\/crypto-hex\.js["']/);
  assert.match(src, /export function randomToken\([^)]*\): string \{[^\n]*bytesToHex\(/);
  assert.match(src, /export async function sha256\([^)]*\): Promise<string> \{[^\n]*bytesToHex\(/);
  assert.match(src, /export async function hmac\([^)]*\): Promise<string> \{[\s\S]*?return bytesToHex\(/);
});
