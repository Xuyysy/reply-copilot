// Isolated pilot ONLY. Exact legacy PBKDF2-SHA256 compatibility experiment.
// Never used by production auth, and not a new password creation profile.
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";

export function verifyLegacy210k(pepper: string | undefined, password: string, stored: string): boolean {
  if (typeof password !== "string" || password.length > 256 || typeof stored !== "string" ||
      !/^pbkdf2-sha256:210000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored)) return false;
  if (typeof pepper !== "string" || pepper.length < 24) throw Error("PILOT_PEPPER_UNAVAILABLE");
  const [, , saltHex, expectedHex] = stored.split(":");
  const decode = (hex: string) => Uint8Array.from(hex.match(/../g) || [], pair => parseInt(pair, 16));
  const material = new TextEncoder().encode(password + "\u0000" + pepper);
  const salt = decode(saltHex);
  const expected = decode(expectedHex);
  let actual: Uint8Array | undefined;
  try {
    actual = pbkdf2(sha256, material, salt, { c: 210000, dkLen: 32 });
    let mismatch = 0;
    for (let i = 0; i < 32; i++) mismatch |= actual[i] ^ expected[i];
    return mismatch === 0;
  } finally {
    material.fill(0);
    salt.fill(0);
    expected.fill(0);
    actual?.fill(0);
  }
}
