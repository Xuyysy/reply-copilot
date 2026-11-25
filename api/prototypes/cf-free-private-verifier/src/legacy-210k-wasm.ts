// Private release candidate, exact pinned RustCrypto artifact from the synthetic pilot.
import compiled from "./legacy-210k.wasm";
export const legacyWasmArtifactSha256="2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838";
const encoder=new TextEncoder();
export async function verifyLegacy210kWasm(pepper:string|undefined,password:string,stored:string):Promise<boolean>{
  if(typeof password!=="string"||password.length>256||typeof stored!=="string"||
     !/^pbkdf2-sha256:210000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored))return false;
  if(typeof pepper!=="string"||pepper.length<24)throw Error("VERIFIER_NOT_CONFIGURED");
  const material=encoder.encode(password+"\u0000"+pepper);
  let key=material;
  const [,,saltHex,expectedHex]=stored.split(":");
  const decode=(hex:string)=>Uint8Array.from(hex.match(/../g)||[],pair=>parseInt(pair,16));
  const salt=decode(saltHex),expected=decode(expectedHex);
  let memory:WebAssembly.Memory|undefined,p:number|undefined;
  try{
    // RFC 2104: hash a SHA-256 HMAC key longer than 64 bytes first.
    // Only prehash when necessary for the pinned WASM buffer. Preserve
    // PBKDF2-HMAC-SHA256 and its full 210k work factor.
    if(material.length>1024){
      key=new Uint8Array(await crypto.subtle.digest("SHA-256",material));
      material.fill(0);
    }
    const instance=new WebAssembly.Instance(compiled);
    const exports=instance.exports as {memory:WebAssembly.Memory;buffer_ptr:()=>number;derive_210k:(n:number)=>number};
    memory=exports.memory;
    const offset=exports.buffer_ptr();
    if(!Number.isSafeInteger(offset)||offset<0||offset+1072>memory.buffer.byteLength)throw Error("VERIFIER_BUFFER_INVALID");
    p=offset;
    const view=new Uint8Array(memory.buffer,p,1072);view.fill(0);
    view.set(key);view.set(salt,1024);
    if(exports.derive_210k(key.length)!==1)throw Error("VERIFIER_DERIVE_FAILED");
    const actual=new Uint8Array(memory.buffer,p+1040,32);
    let mismatch=0;for(let i=0;i<32;i++)mismatch|=actual[i]^expected[i];
    return mismatch===0;
  }finally{
    // Clear explicitly owned byte arrays; do not claim zeroization of
    // runtime copies, Rust stack, or JS strings.
    if(memory&&p!==undefined)new Uint8Array(memory.buffer,p,1072).fill(0);
    key.fill(0);material.fill(0);salt.fill(0);expected.fill(0);
  }
}
