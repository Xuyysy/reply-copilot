import {rmSync} from 'node:fs';

export function cleanProductionOutput(directory){
  rmSync(directory,{recursive:true,force:true});
}
