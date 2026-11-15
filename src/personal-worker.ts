import {AccessGate,Publisher} from './durable-worker.ts';
import worker from './durable-worker.ts';
import {secureResponse} from './worker.ts';
import {AppError,readLimited} from './security.ts';
import {personalOrigin} from './personal-config.ts';
import {installation} from './personal-binding.ts';
import type {DurableEnv} from './durable-worker.ts';
import type {Env} from './types.ts';
export {PersonalInstallation} from './personal-installation.ts';
export {SqliteObjects} from './sqlite-object-store.ts';
async function configured(env:Env):Promise<Partial<Env>>{const r=await installation(env).fetch('https://installation.internal/config');if(!r.ok)throw new AppError('setup_required',503);return r.json();}
export class PersonalAccessGate extends AccessGate{
 private resolved:DurableEnv;private raw:DurableEnv;
 constructor(ctx:DurableObjectState,raw:DurableEnv){const env={...raw};super(ctx,env);this.resolved=env;this.raw=raw;ctx.blockConcurrencyWhile(async()=>{Object.assign(env,await configured(raw));});}
 override async fetch(r:Request){Object.assign(this.resolved,await configured(this.raw));return super.fetch(r);}
 override async alarm(){Object.assign(this.resolved,await configured(this.raw));return super.alarm();}
}
export class PersonalPublisher extends Publisher{
 private resolved:DurableEnv;private raw:DurableEnv;
 constructor(ctx:DurableObjectState,raw:DurableEnv){const env={...raw};super(ctx,env);this.resolved=env;this.raw=raw;ctx.blockConcurrencyWhile(async()=>{Object.assign(env,await configured(raw));});}
 override async fetch(r:Request){Object.assign(this.resolved,await configured(this.raw));return super.fetch(r);}
 override async alarm(){Object.assign(this.resolved,await configured(this.raw));return super.alarm();}
}
export default {
 async fetch(request:Request,raw:DurableEnv){
  try{
   const u=new URL(request.url),origin=personalOrigin(u.origin);let response:Response;
   if(u.pathname.startsWith('/_internal/')||u.pathname==='/config')throw new AppError('not_found',404);
   if(u.pathname==='/setup/status')response=await installation(raw).fetch('https://installation.internal/public');
   else if(u.pathname==='/setup/initialize'){
    if(request.method!=='POST'||request.headers.get('Origin')!==origin)throw new AppError('forbidden',403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AppError('invalid_request',415);
    if(!raw.AUTH_LIMIT||!(await raw.AUTH_LIMIT.limit({key:'setup:'+request.headers.get('CF-Connecting-IP')})).success)throw new AppError('too_many_requests',429);
    let data;try{data=JSON.parse(new TextDecoder().decode(await readLimited(request,4096)));}catch{throw new AppError('invalid_request');}
    response=await installation(raw).fetch('https://installation.internal/initialize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,origin})});
   }else if(!u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/auth/')&&u.pathname!=='/health'){
    if(!['GET','HEAD'].includes(request.method))throw new AppError('not_found',404);
    if(u.pathname==='/'){const ready=await installation(raw).fetch('https://installation.internal/public');if(!(await ready.json()as any).configured)return secureResponse(new Response(null,{status:303,headers:{Location:'/einrichten'}}),{...raw,APP_ORIGIN:origin});}
    const target=new URL(u);if(u.pathname==='/')target.pathname='/index.html';else if(['/einrichten','/installieren'].includes(u.pathname))target.pathname=u.pathname+'.html';
    response=await raw.ASSETS.fetch(new Request(target,request));
   }else{
    const env={...raw,...await configured(raw)} as DurableEnv;if(env.APP_ORIGIN!==origin)throw new AppError('canonical_address_required',421);
    response=await worker.fetch(request,env);
   }
   return secureResponse(response,{...raw,APP_ORIGIN:origin});
  }catch(e){return secureResponse(Response.json({error:e instanceof AppError?e.code:'unexpected_error'},{status:e instanceof AppError?e.status:500}),{...raw,APP_ORIGIN:'https://unconfigured.invalid'});}
 },
 async scheduled(event:ScheduledController,raw:DurableEnv,ctx:ExecutionContext){
  // Before ownership is established there is deliberately no publisher to run.
  const status=await installation(raw).fetch('https://installation.internal/public');if(!(await status.json()as any).configured)return;
  await worker.scheduled(event,{...raw,...await configured(raw)} as DurableEnv);
 }
} satisfies ExportedHandler<DurableEnv>;
