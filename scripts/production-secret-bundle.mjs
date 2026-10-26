import {closeSync,chmodSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {createPrivateKey,createPublicKey,randomBytes} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const requiredNames=['DEEPSEEK_API_KEY','MAIL_API_KEY','MK99_PID','MK99_PRIVATE_KEY','MK99_PLATFORM_PUBLIC_KEY'];
const privatePem=/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+-----END PRIVATE KEY-----\s*$/;
const publicPem=/^-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/;

export function prepareProductionSecretBundle(values,directory='/private/tmp'){
  if(!values||typeof values!=='object'||requiredNames.some(name=>typeof values[name]!=='string'||!values[name].trim())){
    throw new Error('Missing required Production credential.');
  }
  if(!/^2088[0-9]+$/.test(values.MK99_PID)||values.MK99_PID!==values.MK99_PID.trim()||
     values.DEEPSEEK_API_KEY!==values.DEEPSEEK_API_KEY.trim()||values.MAIL_API_KEY!==values.MAIL_API_KEY.trim()||
     !privatePem.test(values.MK99_PRIVATE_KEY)||!publicPem.test(values.MK99_PLATFORM_PUBLIC_KEY)){
    throw new Error('Invalid Production credential format.');
  }
  try{
    const merchantPrivateKey=createPrivateKey(values.MK99_PRIVATE_KEY);
    const platformPublicKey=createPublicKey(values.MK99_PLATFORM_PUBLIC_KEY);
    if(merchantPrivateKey.asymmetricKeyType!=='rsa'||(merchantPrivateKey.asymmetricKeyDetails?.modulusLength??0)<2048||
       platformPublicKey.asymmetricKeyType!=='rsa'||(platformPublicKey.asymmetricKeyDetails?.modulusLength??0)<2048){
      throw new Error('unsupported key');
    }
  }catch{
    throw new Error('Invalid Production credential format.');
  }
  const file=path.join(directory,`reply-copilot-production-secrets-${randomBytes(16).toString('hex')}.json`);
  const descriptor=openSync(file,'wx',0o600);
  try{
    writeFileSync(descriptor,JSON.stringify(Object.fromEntries(requiredNames.map(name=>[name,values[name]]))));
    closeSync(descriptor);
    chmodSync(file,0o600);
    return {path:file,mode:0o600,secretNames:[...requiredNames]};
  }catch{
    try{closeSync(descriptor);}catch{}
    try{unlinkSync(file);}catch{}
    throw new Error('Could not safely write the temporary Production credential bundle.');
  }
}

function readHidden(rl,prompt){
  return new Promise((resolve,reject)=>{
    rl.question(prompt,value=>resolve(value));
    rl.once('SIGINT',()=>reject(new Error('cancelled')));
  });
}
function readPath(rl,prompt){return new Promise((resolve,reject)=>{rl.question(prompt,value=>resolve(value));rl.once('SIGINT',()=>reject(new Error('cancelled')));});}
function terminalSettings(){return execFileSync('stty',['-g'],{stdio:['inherit','pipe','ignore'],encoding:'utf8'}).trim();}
function restoreTerminalSettings(settings){execFileSync('stty',[settings],{stdio:['inherit','ignore','ignore']});}

async function main(){
  if(!process.stdin.isTTY||!process.stderr.isTTY)throw new Error('Run this helper directly in a local terminal.');
  let rl,originalTerminalSettings,restored=false;
  const restore=()=>{
    if(originalTerminalSettings&&!restored){restoreTerminalSettings(originalTerminalSettings);restored=true;}
  };
  const interrupt=()=>{
    rl?.close();
    try{restore();}catch{}
    process.stderr.write('\nCredential preparation stopped; no credential values were displayed.\n');
    process.exit(130);
  };
  process.once('SIGINT',interrupt);
  try{
    originalTerminalSettings=terminalSettings();
    execFileSync('stty',['-echo'],{stdio:['inherit','ignore','ignore']});
    rl=createInterface({input:process.stdin,output:process.stderr,terminal:false});
    process.stderr.write('Reuse existing credentials when their account, scope and merchant settings allow Production. Input is hidden; RSA keys are read from local files.\n');
    const deepseek=await readHidden(rl,'Existing DeepSeek API key: ');
    const resend=await readHidden(rl,'Existing Resend API key (after verifying its production-domain scope): ');
    const pid=await readHidden(rl,'Existing MK99 merchant PID (if approved for Production): ');
    const privatePath=await readPath(rl,'Path to the existing merchant PKCS#8 private-key PEM: ');
    const publicPath=await readPath(rl,'Path to the official MK99 platform public-key PEM: ');
    const result=prepareProductionSecretBundle({
      DEEPSEEK_API_KEY:deepseek,
      MAIL_API_KEY:resend,
      MK99_PID:pid,
      MK99_PRIVATE_KEY:readFileSync(privatePath,'utf8'),
      MK99_PLATFORM_PUBLIC_KEY:readFileSync(publicPath,'utf8'),
    });
    process.stdout.write(`Temporary Worker secret bundle prepared: ${result.path}\n`);
    process.stdout.write('It was not uploaded. Use it only with the approved Production Worker versions upload, then delete the temporary file.\n');
  }finally{
    process.off('SIGINT',interrupt);
    rl?.close();
    restore();
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{process.stderr.write('Credential preparation stopped; no credential values were displayed.\n');process.exitCode=1;});
}
