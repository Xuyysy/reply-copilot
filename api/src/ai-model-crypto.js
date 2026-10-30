const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("invalid_key");
  let binary;
  try { binary = atob(value); } catch { throw new Error("invalid_key"); }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(secret) {
  const bytes = base64ToBytes(secret);
  if (bytes.length !== 32) throw new Error("invalid_key");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function associatedData(configId, version) {
  return encoder.encode(`reply-copilot-ai-provider:${configId}:${version}`);
}

export async function encryptProviderApiKey(secret, configId, version, apiKey) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new Error("invalid_api_key");
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData(configId, version), tagLength: 128 }, key, encoder.encode(apiKey)));
  return bytesToBase64(new Uint8Array([...iv, ...cipher]));
}

export async function decryptProviderApiKey(secret, configId, version, ciphertext) {
  const packed = base64ToBytes(ciphertext);
  if (packed.length < 29 || packed.length > 1024) throw new Error("invalid_ciphertext");
  const key = await encryptionKey(secret);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12), additionalData: associatedData(configId, version), tagLength: 128 }, key, packed.slice(12));
    const value = decoder.decode(plain);
    if (value.length < 8 || value.length > 512) throw new Error("invalid_ciphertext");
    return value;
  } catch { throw new Error("invalid_ciphertext"); }
}
