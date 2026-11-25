// Shared fast hex encoding for cryptographic byte arrays. No state, secrets or I/O.
// A small immutable lookup table avoids per-byte closures, padding and arrays.
const HEX_PAIRS = Object.freeze(Array.from({length: 256}, (_, i) => i.toString(16).padStart(2, '0')));

/** @param {Uint8Array} bytes */
export function bytesToHex(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i++) output += HEX_PAIRS[bytes[i]];
  return output;
}
