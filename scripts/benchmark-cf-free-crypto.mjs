#!/usr/bin/env node
// Synthetic, local-only microbenchmark. Node.js results do NOT certify Cloudflare Free.
import {performance} from 'node:perf_hooks';
import {randomBytes, webcrypto} from 'node:crypto';
import {bytesToHex} from '../api/src/crypto-hex.js';

const baseline = (bytes) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
function bench(label, fn, n) {
  for (let i = 0; i < Math.min(10000, n); i++) fn();
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return {label, iterations: n, meanMicroseconds: Number(((performance.now() - start) * 1000 / n).toFixed(3))};
}
async function cryptoBench(name, rounds, repeat = 4) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('local-synthetic-password-with-secret-pepper'), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(16); // synthetic constant; NEVER use in real password hashing
  const values = [];
  for (let i = 0; i < repeat; i++) {
    const started = performance.now();
    await webcrypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', iterations: rounds, salt}, key, 256);
    values.push(Number((performance.now() - started).toFixed(3)));
  }
  return {name, rounds, elapsedWallMs: values};
}

const payload = randomBytes(32), n = 120000;
if (baseline(payload) !== bytesToHex(payload)) throw new Error('Encoding regression');
const hex = [bench('previous-hex', () => baseline(payload), n), bench('lookup-hex', () => bytesToHex(payload), n)];
const pbkdf2 = [];
for (const count of [10000, 60000, 100000]) pbkdf2.push(await cryptoBench('PBKDF2-SHA256', count));
const report = {runtime: process.version, environment: 'Node.js synthetic local-only', warning: 'Measures JS microbenchmark elapsed wall time and WebCrypto PBKDF2 wall time on Node, NOT Cloudflare Worker invocation CPU or workerd; does not certify CF Free and must not be extrapolated to Production.', hex, pbkdf2};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
