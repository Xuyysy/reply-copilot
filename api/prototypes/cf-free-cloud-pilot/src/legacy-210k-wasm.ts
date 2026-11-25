// Synthetic pilot only; pinned, ahead-of-time compiled RustCrypto module.
import compiled from "./legacy-210k.wasm";
export const legacyWasmArtifactSha256="2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838";
export function verifyLegacy210kWasm(pepper: string|undefined,password:string,stored:string):boolean {
  if(typeof password!=="string"||password.length>256||typeof stored!=="string"||
     !/^pbkdf2-sha256:210000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored))return false;
  if(typeof pepper!=="string"||pepper.length<24)throw Error("PILOT_PEPPER_UNAVAILABLE");
  const material=new TextEncoder().encode(password+"\u0000"+pepper);
  if(material.length>1024){material.fill(0);throw Error("PILOT_INPUT_TOO_LONG");}
  const [, ,saltHex,expectedHex]=stored.split(":");
  const decode=(hex:string)=>Uint8Array.from(hex.match(/../g)||[],pair=>parseInt(pair,16));
  const salt=decode(saltHex),expected=decode(expectedHex);
  // Fresh instance per verification; never retain secret-dependent WASM memory.
  let memory:WebAssembly.Memory|undefined,p:number|undefined;
  try{
    const instance=new WebAssembly.Instance(compiled);
    const exports=instance.exports as {memory:WebAssembly.Memory;buffer_ptr:()=>number;derive_210k:(n:number)=>number};
    memory=exports.memory;p=exports.buffer_ptr();
    const view=new Uint8Array(memory.buffer,p,1072);view.fill(0);
    view.set(material);view.set(salt,1024);
    if(exports.derive_210k(material.length)!==1)throw Error("PILOT_WASM_FAILED");
    const actual=new Uint8Array(memory.buffer,p+1040,32);
    let mismatch=0;for(let i=0;i<32;i++)mismatch|=actual[i]^expected[i];
    return mismatch===0;
  }finally{
    if(memory&&p!==undefined)new Uint8Array(memory.buffer,p,1072).fill(0);
    material.fill(0);salt.fill(0);expected.fill(0);
  }
}
