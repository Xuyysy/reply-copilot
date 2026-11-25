// Private standalone SQLite DO candidate. No public verification routes.
import {PasswordVerifierDO as NativePasswordVerifierDO} from "../../cf-free-password-do/src/index";
import {verifyLegacy210kWasm} from "./legacy-210k-wasm";
export class PasswordVerifierDO extends NativePasswordVerifierDO {
  async verify(password:string,stored:string):Promise<boolean>{
    if(typeof password!=="string"||password.length>256||typeof stored!=="string"||stored.length>180)return false;
    if(stored.startsWith("pbkdf2-sha256:210000:"))
      return verifyLegacy210kWasm(this.env.PASSWORD_PEPPER,password,stored);
    return super.verify(password,stored);
  }
}
export default {async fetch():Promise<Response>{
  return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
}};
