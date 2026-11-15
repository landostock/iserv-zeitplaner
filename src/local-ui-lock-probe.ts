import { DavError, WebDav, parseProbeLock, parseOwnProbeLock, safeLockToken } from './dav.ts';
import { AppError, demoAllowed, origin, path, readLimited, sha256 } from './security.ts';
import { UI_PROBE_ORIGINAL } from './ui-lock-probe-feedback.ts';
import type { Env, Principal } from './types.ts';
import type { UiLockEvent, UiLockReport, UiObservation } from './ui-lock-probe-feedback.ts';

interface Active {
  school:string;owner:string;cancelled:boolean;ready:boolean;endsAt:number;
  observation?:UiObservation;wake?:()=>void;
}
// Local diagnostic only. No password or lock token is placed in this map or persisted.
const active=new Map<string,Active>();
const ORIGINAL=new TextEncoder().encode(UI_PROBE_ORIGINAL);

export class UiLockProbeDav extends WebDav {
  async acquire(file:string,base:string,onToken:(token:string)=>void){
    const started=Date.now();
    const response=await this.request('LOCK',file,{headers:{Depth:'0',Timeout:'Second-120','Content-Type':'application/xml; charset=utf-8'},
      body:'<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>'});
    const token=response.headers.get('Lock-Token')||'';
    if(response.status>=200&&response.status<300&&safeLockToken(token))onToken(token);
    if(response.status!==200){await response.body?.cancel();throw new DavError(response.status,!([401,403,404,405,409,412,423,429,501,507].includes(response.status)));}
    try{
      const xml=new TextDecoder('utf-8',{fatal:true}).decode(await readLimited(response,65536));
      return started+parseProbeLock(xml,token,base,file)*1000-5000;
    }finally{await response.body?.cancel().catch(()=>{});}
  }
  async held(file:string,token:string){
    const response=await this.request('PROPFIND',file,{headers:{Depth:'0','Content-Type':'application/xml; charset=utf-8'},
      body:'<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>'});
    if(response.status===404){await response.body?.cancel();return false;}
    if(response.status!==207){await response.body?.cancel();throw new DavError(response.status);}
    try{return parseOwnProbeLock(new TextDecoder('utf-8',{fatal:true}).decode(await readLimited(response,65536)),token,this.serverOrigin,file);}
    finally{await response.body?.cancel().catch(()=>{});}
  }
  constructor(private serverOrigin:string,authorization:string,fetcher?:typeof fetch){super(serverOrigin,authorization,'/Files/','/Files/',1024,fetcher);}
  async release(file:string,token:string){
    if(!safeLockToken(token))throw new AppError('lock_probe_invalid_response');
    const response=await this.request('UNLOCK',file,{headers:{'Lock-Token':token}});await response.body?.cancel();
    if(response.status!==204)throw new DavError(response.status,true);
  }
}
function requireLocal(env:Env){if(!demoAllowed(env)||!env.LOCAL_DAV_ORIGIN)throw new AppError('not_found',404);}
export function decideUiLockProbe(env:Env,p:Principal,id:string,input:any){
  requireLocal(env);const state=active.get(id);
  if(!state||state.school!==p.school||state.owner!==p.owner)throw new AppError('not_found',404);
  if(!state.ready||state.cancelled||state.observation||Date.now()>=state.endsAt)throw new AppError('probe_window_closed',409);
  if(!['blocked','changed','not_attempted'].includes(input.observation))throw new AppError('invalid_request');
  state.observation=input.observation;state.wake?.();return {accepted:true};
}
export function startUiLockProbe(env:Env,p:Principal,input:any,ctx?:Pick<ExecutionContext,'waitUntil'>,options:{windowMs?:number;fetcher?:typeof fetch}={}):Response {
  requireLocal(env);
  if(input.consent!=='create-private-file-and-compare-iserv-ui')throw new AppError('ui_probe_consent_required',400);
  const folder=path(input.path);
  if(!folder.startsWith('/Files/')||!folder.endsWith('/'))throw new AppError('write_probe_private_only');
  if(typeof input.testId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.testId))throw new AppError('invalid_request');
  if(typeof input.username!=='string'||!input.username||input.username.length>200||input.username.includes(':')||typeof input.password!=='string'||!input.password||input.password.length>1024)throw new AppError('invalid_request');
  if(active.size>=4||[...active.values()].some(value=>value.school===p.school&&value.owner===p.owner))throw new AppError('probe_already_running',409);
  const file=folder+'zeitplaner-test-'+input.testId+'.txt';path(file);
  const base=origin(env.LOCAL_DAV_ORIGIN!);
  const dav=new UiLockProbeDav(base,'Basic '+Buffer.from(input.username+':'+input.password).toString('base64'),options.fetcher);
  const id=crypto.randomUUID(),state:Active={school:p.school,owner:p.owner,cancelled:false,ready:false,endsAt:0};active.set(id,state);
  const result:UiLockReport={testFile:file,outcome:'failed',possibleFile:false,possibleLock:false,unlockConfirmed:false,originalVerified:false,lockBefore:false,lockAfter:false,source:'unreadable'};
  let token='',deadline=0;
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      const emit=(event:UiLockEvent)=>{if(state.cancelled)return;try{controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));}catch{state.cancelled=true;state.wake?.();}};
      const run=async()=>{
        try{
          emit({type:'preparing',id,testFile:file});if(state.cancelled)return;
          try{await dav.put(file,ORIGINAL);result.possibleFile=true;}catch(error){result.possibleFile=error instanceof DavError&&error.uncertain;throw error;}
          if(state.cancelled)return;
          result.possibleLock=true;
          try{deadline=await dav.acquire(file,base,value=>{token=value;});}
          catch(error){if(error instanceof DavError&&!error.uncertain)result.possibleLock=false;throw error;}
          const observe=async()=>{
            const before=await dav.held(file,token);
            let source:UiLockReport['source']='unreadable';
            try{const info=await dav.inspect(file);source=!info?'missing':info.size===ORIGINAL.length&&info.sha256===sha256(ORIGINAL)?'original':'changed';}
            catch(error){if(error instanceof AppError&&error.code==='file_too_large')source='changed';else throw error;}
            const after=await dav.held(file,token);
            return {held:before&&after,source};
          };
          const initial=await observe();result.lockBefore=initial.held;result.originalVerified=initial.source==='original';result.source=initial.source;
          if(!initial.held||!result.originalVerified)throw new AppError('ui_probe_initial_state',502);
          if(state.cancelled)return;
          const available=deadline-Date.now()-15000;
          if(available<15000)throw new AppError('lock_probe_expired',502);
          state.endsAt=Date.now()+Math.min(options.windowMs??90000,available);state.ready=true;
          emit({type:'ready',id,testFile:file,windowEndsAt:state.endsAt});
          if(!state.observation&&!state.cancelled)await new Promise<void>(resolve=>{
            const timer=setTimeout(resolve,Math.max(1,state.endsAt-Date.now()));
            state.wake=()=>{clearTimeout(timer);resolve();};
          });
          state.ready=false;emit({type:'checking'});result.observation=state.observation;
          if(state.cancelled)return;
          const final=await observe();result.lockAfter=final.held;result.source=final.source;
          const confirmed=result.lockBefore&&result.lockAfter&&Date.now()<deadline;
          result.outcome=confirmed&&['changed','missing'].includes(result.source)?'bypass_detected'
            :confirmed&&result.source==='original'&&state.observation==='blocked'?'blocked_reported':'inconclusive';
        }catch(error){if(result.originalVerified)result.outcome='inconclusive';result.failure=error instanceof AppError?error.code:'ui_probe_unexpected';if(error instanceof DavError&&error.httpStatus)result.httpStatus=error.httpStatus;}
        finally{
          state.ready=false;
          if(token){
            try{await dav.release(file,token);result.unlockConfirmed=true;result.possibleLock=false;
              if(await dav.held(file,token)){result.possibleLock=true;result.outcome='inconclusive';}}
            catch(error){result.possibleLock=true;result.outcome='inconclusive';if(error instanceof DavError&&error.httpStatus)result.httpStatus=error.httpStatus;}
          }
          active.delete(id);emit({type:'result',report:result});try{controller.close();}catch{}
        }
      };
      const task=run();ctx?.waitUntil(task);
    },
    cancel(){state.cancelled=true;state.ready=false;state.wake?.();}
  });
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
