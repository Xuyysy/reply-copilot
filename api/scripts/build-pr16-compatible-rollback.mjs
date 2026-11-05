// Code-only rollback: preserve recovery APIs / late-result fencing for new clients,
// while restoring the pre-release conservative quota precheck path.
import {build} from 'esbuild';import {readFileSync,mkdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
export function conservativeQuotaSource(source){
 const start=source.indexOf('export async function checkGenerationReplay('),end=source.indexOf('export async function finishGeneration(',start);
 if(start<0||end<0||!source.includes('if(!options.prechecked){'))throw Error('Rollback transformation source mismatch');
 return (source.slice(0,start)+`export async function checkGenerationReplay(env: Env, session: Session, requestId: string, requestHash: string): Promise<Reservation | null> {
 const now=nowMs();await releaseExpiredDeliveryReservations(env,now,session.user_id);
 const prior=await existing(env,session.user_id,requestId);
 return prior?replay(env,session.user_id,requestId,requestHash,prior,now):null;
}\n\n`+source.slice(end)).replace('if(!options.prechecked){','if(true){');
}
export async function buildCompatibleRollback(outfile,{format='esm',platform='browser'}={}){
 mkdirSync(path.dirname(outfile),{recursive:true});
 await build({entryPoints:[fileURLToPath(new URL('../src/index.ts',import.meta.url))],bundle:true,format,platform,target:'es2022',outfile,plugins:[{name:'retain-recovery-restore-quota-prechecks',setup(build){build.onLoad({filter:/[/\\]quota\.ts$/},args=>({contents:conservativeQuotaSource(readFileSync(args.path,'utf8')),loader:'ts',resolveDir:path.dirname(args.path)}));}}]});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('Explicit isolated output file required');await buildCompatibleRollback(path.resolve(process.argv[2]));}
