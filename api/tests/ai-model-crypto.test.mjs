import assert from "node:assert/strict";
import test from "node:test";
import { decryptProviderApiKey, encryptProviderApiKey } from "../src/ai-model-crypto.js";

const key = Buffer.alloc(32, 0x42).toString("base64");

test("API key encryption is randomized, authenticated, and bound to config/version", async () => {
  const first = await encryptProviderApiKey(key, "config-a", 1, "provider-secret-key-value");
  const second = await encryptProviderApiKey(key, "config-a", 1, "provider-secret-key-value");
  assert.notEqual(first, second);
  assert.equal(await decryptProviderApiKey(key, "config-a", 1, first), "provider-secret-key-value");
  await assert.rejects(decryptProviderApiKey(key, "config-b", 1, first));
  await assert.rejects(decryptProviderApiKey(key, "config-a", 2, first));
  await assert.rejects(decryptProviderApiKey(Buffer.alloc(32, 0x43).toString("base64"), "config-a", 1, first));
});

test("encryption rejects short, oversized, control-character and malformed keys", async () => {
  for (const value of ["short", "x".repeat(513), "secret\nkey"]) await assert.rejects(encryptProviderApiKey(key, "id", 1, value));
  await assert.rejects(encryptProviderApiKey(Buffer.alloc(31).toString("base64"), "id", 1, "provider-secret-key-value"));
});

test("CF Free CPU: decrypt reuses one scoped non-extractable AES import under concurrency, and isolates/rotates keys",async()=>{
  const a=key,b=Buffer.alloc(32,0x43).toString("base64");
  const sealedA=await encryptProviderApiKey(a,"config-cpu",7,"provider-secret-key-value");
  const sealedB=await encryptProviderApiKey(b,"config-cpu",7,"rotated-provider-secret");
  const subtle=crypto.subtle,original=subtle.importKey,own=Object.getOwnPropertyDescriptor(subtle,"importKey");
  let imports=0;
  Object.defineProperty(subtle,"importKey",{configurable:true,writable:true,value:function(...args){imports++;return original.apply(this,args);}});
  try{
    const scope={AI_CONFIG_ENCRYPTION_KEY:a},other={AI_CONFIG_ENCRYPTION_KEY:a};
    const values=await Promise.all(Array.from({length:5},()=>decryptProviderApiKey(a,"config-cpu",7,sealedA,scope)));
    assert.deepEqual(values,Array(5).fill("provider-secret-key-value"));
    assert.equal(imports,1,"five concurrent decryptions share one WebCrypto key import");
    assert.equal(await decryptProviderApiKey(a,"config-cpu",7,sealedA,other),"provider-secret-key-value");
    assert.equal(imports,2,"separate Env identities never reuse an unrelated key");
    scope.AI_CONFIG_ENCRYPTION_KEY=b;
    assert.equal(await decryptProviderApiKey(b,"config-cpu",7,sealedB,scope),"rotated-provider-secret");
    assert.equal(imports,3,"rotation invalidates scoped key");
    await assert.rejects(decryptProviderApiKey(b,"wrong-config",7,sealedB,scope));
    await assert.rejects(decryptProviderApiKey(a,"config-cpu",7,sealedB,scope));
    assert.equal(imports,4,"different secret cannot reuse cached rotated key");
    await assert.rejects(decryptProviderApiKey("broken-key","config-cpu",7,sealedB,scope));
    assert.equal(imports,4,"malformed secret rejected before import");
  }finally{
    if(own)Object.defineProperty(subtle,"importKey",own);
    else Reflect.deleteProperty(subtle,"importKey");
  }
});

test("CF Free CPU: failed AES key imports cannot poison future scoped decryptions",async()=>{
 const sealed=await encryptProviderApiKey(key,"cpu-retry",2,"provider-secret-key-value");
 const subtle=crypto.subtle,original=subtle.importKey,own=Object.getOwnPropertyDescriptor(subtle,"importKey");
 let fail=true,imports=0;
 Object.defineProperty(subtle,"importKey",{configurable:true,writable:true,value:function(...args){
  imports++;if(fail){fail=false;return Promise.reject(Error("synthetic import failure"));}return original.apply(this,args);
 }});
 try{
  const scope={AI_CONFIG_ENCRYPTION_KEY:key};
  await assert.rejects(decryptProviderApiKey(key,"cpu-retry",2,sealed,scope),/synthetic import failure/);
  assert.equal(await decryptProviderApiKey(key,"cpu-retry",2,sealed,scope),"provider-secret-key-value");
  assert.equal(imports,2,"failed import evicted");
 }finally{
  if(own)Object.defineProperty(subtle,"importKey",own);
  else Reflect.deleteProperty(subtle,"importKey");
 }
});
