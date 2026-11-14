import type {Env} from './types';
export declare function createAdminEntitlementActivity(deps:{
 requireAdminSession:(request:Request,env:Env,write?:boolean)=>Promise<unknown>;
 response:(value:unknown,status?:number,env?:Env,request?:Request)=>Response;
 ApiFailure:new(status:number,code:string,message:string)=>Error;
}):(request:Request,env:Env)=>Promise<Response>;
