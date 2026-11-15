import { AppError,demoAllowed,origin,path,encodedPath,readLimited,sha256 } from './security.ts';
import type { Env } from './types.ts';
import type { TargetProbeResult } from './target-probe-feedback.ts';
/** Opt-in private synthetic files only. No MOVE, DELETE, LOCK, password storage or automatic restart. */
export async function localTargetProbe(env:Env,input:any,fetcher:typeof fetch=globalThis.fetch.bind(globalThis),pause:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<TargetProbeResult>{
  if(!demoAllowed(env)||!env.LOCAL_DAV_ORIGIN)throw new AppError('not_found',404);
  if(input.consent!=='create-private-target-test-files')throw new AppError('target_probe_consent_required');
  const folder=path(input.path);
  if(!folder.startsWith('/Files/')||!folder.endsWith('/'))throw new AppError('write_probe_private_only');
  if(typeof input.username!=='string'||!input.username||input.username.length>200||/[:\x00-\x1f\x7f]/.test(input.username)||typeof input.password!=='string'||!input.password||input.password.length>1024||typeof input.testId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.testId))throw new AppError('invalid_request');
  const base=origin(env.LOCAL_DAV_ORIGIN),authorization='Basic '+Buffer.from(input.username+':'+input.password).toString('base64');
  const files=['einzeln','gleichzeitig','uebertragung'].map(name=>folder+'zeitplaner-zieltest-'+input.testId+'-'+name+'.txt');
  const result:TargetProbeResult={files,createVerified:false,collisionBlocked:false,concurrentCreateSafe:false,streamVerified:false,visibility:'not_tested',steps:[]};
  async function checkedRead(file:string,expected:Uint8Array){
    const response=await read(file),verified=matches(response.body,expected);
    result.steps!.push({phase:result.phase!,statuses:[response.status],verified,...(response.body?{bytes:response.body.length}:{})});
    if(!verified){result.httpStatus=response.status;result.error='target_probe_content_unconfirmed';}
    return verified;
  }
  async function send(method:string,file:string,body?:BodyInit,signal?:AbortSignal){
    const r=await fetcher(base+encodedPath(file),{method,body,headers:{Authorization:authorization,...(method==='PUT'?{'If-None-Match':'*','Content-Type':'text/plain; charset=utf-8'}:{})},redirect:'manual',signal:signal||AbortSignal.timeout(15000)});
    if(r.status>=300&&r.status<400){await r.body?.cancel();throw new AppError('target_probe_redirect',502);}return r;
  }
  async function write(file:string,body:Uint8Array){const r=await send('PUT',file,body as BodyInit);await r.body?.cancel();return r.status;}
  async function read(file:string,signal?:AbortSignal){const r=await send('GET',file,undefined,signal);if(r.status!==200){await r.body?.cancel();return {status:r.status,body:null};}return {status:200,body:await readLimited(r,131072)};}
  const matches=(body:Uint8Array|null,expected:Uint8Array)=>body?.length===expected.length&&sha256(body)===sha256(expected);
  try{
    // Refuse known existing resources before testing a server whose create-only behavior is unproven.
    result.phase='preflight';
    for(const file of files){const r=await send('HEAD',file);await r.body?.cancel();result.steps!.push({phase:'preflight',statuses:[r.status]});if(r.status!==404){result.httpStatus=r.status;result.error='target_probe_existing_or_unknown';return result;}}
    const first=new TextEncoder().encode('IServ Zeitplaner: eigene harmlose Zieldateiprüfung.\n'),second=new TextEncoder().encode('IServ Zeitplaner: alternativer eigener Testinhalt.\n');
    result.phase='create';
    const created=await write(files[0],first);result.steps!.push({phase:'create',statuses:[created],verified:created===201});if(created!==201){result.httpStatus=created;result.error='target_probe_create_failed';return result;}
    result.phase='read_created';result.createVerified=await checkedRead(files[0],first);if(!result.createVerified)return result;
    result.phase='collision';const collision=await write(files[0],second);result.steps!.push({phase:'collision',statuses:[collision],verified:collision===412});
    if(collision!==412){result.httpStatus=collision;result.error='target_probe_collision_unconfirmed';return result;}
    result.phase='read_collision';result.collisionBlocked=await checkedRead(files[0],first);if(!result.collisionBlocked)return result;
    result.phase='concurrent';
    // Account for both dispatched writes even if one loses its response; never launch a replacement.
    const settled=await Promise.allSettled([write(files[1],first),write(files[1],second)]);
    const responses=settled.map(r=>r.status==='fulfilled'?r.value:0),winner=responses.indexOf(201);
    const safe=responses.filter(x=>x===201).length===1&&responses.filter(x=>x===412).length===1;
    result.steps!.push({phase:'concurrent',statuses:responses,verified:safe});
    if(!safe){result.error=responses.filter(s=>s>=200&&s<300).length>1?'target_probe_concurrent_multiple_success':'target_probe_concurrent_unconfirmed';return result;}
    result.phase='read_concurrent';result.concurrentCreateSafe=await checkedRead(files[1],winner===0?first:second);if(!result.concurrentCreateSafe)return result;
    result.phase='stream';
    const streamBody=new Uint8Array(131072);for(let i=0;i<streamBody.length;i++)streamBody[i]=65+i%26;
    let release=()=>{};
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(streamBody.slice(0,32768));release=()=>{try{controller.enqueue(streamBody.slice(32768));controller.close();}catch{/* A rejected request may have cancelled the stream. */}};}});
    let completed=false;
    const sending=send('PUT',files[2],stream as BodyInit).then(async r=>{completed=true;await r.body?.cancel();return r.status;},()=>{completed=true;return 0;});
    try{
      await pause(300);
      if(completed)result.visibility='inconclusive';
      else{
        try{const during=await read(files[2],AbortSignal.timeout(2000));
          const partial=during.body!==null&&during.body.length<streamBody.length&&during.body.every((byte,i)=>byte===streamBody[i]);
          result.visibility=during.status===200&&partial?'partial_observed':during.status===404?'not_observed':'inconclusive';
        }catch{result.visibility='inconclusive';}
      }
    }finally{release();}
    const status=await sending;
    result.steps!.push({phase:'stream',statuses:[status],verified:status===201});
    if(status!==201){result.httpStatus=status;result.error='target_probe_stream_unconfirmed';return result;}
    result.phase='read_stream';result.streamVerified=await checkedRead(files[2],streamBody);
  }catch{result.error='target_probe_interrupted';}
  return result;
}
