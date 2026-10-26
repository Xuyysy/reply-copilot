import {createHash,createPublicKey} from 'node:crypto';
// The Web Store dashboard public key is public metadata, never a private PEM.
export function extensionIdentity(value,expectedId){
 const key=typeof value==='string'?value.trim():'';
 if(!key||!/^[A-Za-z0-9+/]+={0,2}$/.test(key))throw new Error('Use the Web Store base64 public key only');
 const der=Buffer.from(key,'base64');
 if(der.toString('base64')!==key)throw new Error('Invalid public key encoding');
 let parsed;try{parsed=createPublicKey({key:der,format:'der',type:'spki'});}catch{throw new Error('Invalid public key');}
 if(parsed.asymmetricKeyType!=='rsa')throw new Error('Expected an RSA public key');
 const id=[...createHash('sha256').update(der).digest().subarray(0,16)].flatMap(b=>[b>>4,b&15]).map(n=>String.fromCharCode(97+n)).join('');
 if(expectedId&&(!/^[a-p]{32}$/.test(expectedId)||expectedId!==id))throw new Error('Extension ID mismatch');
 return {key,id};
}
