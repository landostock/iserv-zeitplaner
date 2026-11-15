import { DavError, WebDav, parseProbeLock, safeLockToken } from './dav.ts';
import { AppError, demoAllowed, origin, path, readLimited, sha256 } from './security.ts';
import type { Env } from './types.ts';
import type { LockProbeReport, LockProbePhase } from './lock-probe-feedback.ts';

const TEXT=new TextEncoder().encode('IServ Zeitplaner: isolierter Sperrtest.\n');
const LOCK_BODY='<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>';
/** The only unconditioned updates target a new, create-only, isolated test file from this call. */
export class LocalLockProbeDav extends WebDav {
  async probe(file:string,base:string):Promise<LockProbeReport>{
    path(file);
    if(!/^\/Files\/(?:[^/]+\/)*zeitplaner-test-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.txt$/.test(file))throw new AppError('write_probe_private_only');
    const result:LockProbeReport={testFile:file,phase:'create',passed:false,created:false,possibleFile:false,lockAcquired:false,possibleLock:false,
      unlockConfirmed:false,releaseVerified:false,noTokenRejected:false,wrongTokenRejected:false,withTokenAccepted:false};
    let token='',deadline=0;
    const stage=(phase:LockProbePhase)=>{result.phase=phase;};
    const checkTime=()=>{if(Date.now()>=deadline)throw new AppError('lock_probe_expired',502);};
    const verify=async()=>{
      const fileInfo=await this.inspect(file);
      if(!fileInfo||fileInfo.size!==TEXT.length||fileInfo.sha256!==sha256(TEXT))throw new AppError('lock_probe_content_changed',502);
      result.fileVersion=!fileInfo.etag?'missing':/^"[^"\r\n]+"$/.test(fileInfo.etag)?'strong':fileInfo.etag.startsWith('W/')?'weak':'invalid';
    };
    const update=async(ifHeader?:string)=>{
      const response=await this.request('PUT',file,{headers:{'Content-Type':'application/octet-stream',...(ifHeader?{If:ifHeader}:{})},body:TEXT as BodyInit});
      await response.body?.cancel();return response.status;
    };
    const record=(error:unknown)=>{
      result.failure=error instanceof AppError?error.code:'lock_probe_unexpected';
      if(error instanceof DavError&&error.httpStatus)result.httpStatus=error.httpStatus;
    };
    try{
      try{await this.put(file,TEXT);result.created=true;result.possibleFile=true;}
      catch(error){result.possibleFile=error instanceof DavError&&error.uncertain;throw error;}
      stage('lock');result.possibleLock=true;
      const started=Date.now();
      const response=await this.request('LOCK',file,{headers:{Depth:'0',Timeout:'Second-60','Content-Type':'application/xml; charset=utf-8'},body:LOCK_BODY});
      const returnedToken=response.headers.get('Lock-Token')||'';
      if(response.status>=200&&response.status<300&&safeLockToken(returnedToken))token=returnedToken;
      if(response.status!==200){
        if([401,403,404,405,409,412,423,429,501,507].includes(response.status))result.possibleLock=false;
        await response.body?.cancel();throw new DavError(response.status,result.possibleLock);
      }
      try{
        const xml=new TextDecoder('utf-8',{fatal:true}).decode(await readLimited(response,65536));
        result.timeoutSeconds=parseProbeLock(xml,token,base,file);
      }finally{await response.body?.cancel().catch(()=>{});}
      result.lockAcquired=true;deadline=started+result.timeoutSeconds*1000-5000;
      stage('verify');checkTime();await verify();
      stage('without_token');checkTime();result.noTokenStatus=await update();
      if(result.noTokenStatus!==423){result.httpStatus=result.noTokenStatus;throw new AppError('lock_probe_without_token_allowed',502);}
      result.noTokenRejected=true;
      stage('wrong_token');checkTime();result.wrongTokenStatus=await update('(<urn:uuid:'+crypto.randomUUID()+'>)');
      if(![412,423].includes(result.wrongTokenStatus)){result.httpStatus=result.wrongTokenStatus;throw new AppError('lock_probe_wrong_token_allowed',502);}
      result.wrongTokenRejected=true;
      stage('with_token');checkTime();result.withTokenStatus=await update('('+token+')');
      if(result.withTokenStatus!==204)throw new DavError(result.withTokenStatus,true);
      result.withTokenAccepted=true;await verify();
    }catch(error){record(error);}
    finally{
      if(token){
        if(!result.failure)stage('unlock');
        try{
          const response=await this.request('UNLOCK',file,{headers:{'Lock-Token':token}});await response.body?.cancel();
          if(response.status!==204)throw new DavError(response.status,true);
          result.unlockConfirmed=true;result.possibleLock=false;
        }catch(error){result.unlockFailed=true;result.possibleLock=true;if(error instanceof DavError&&error.httpStatus)result.unlockHttpStatus=error.httpStatus;}
      }
    }
    if(!result.failure&&result.unlockConfirmed){
      stage('after_unlock');
      try{
        result.afterUnlockStatus=await update();
        if(result.afterUnlockStatus!==204){if(result.afterUnlockStatus===423)result.possibleLock=true;throw new DavError(result.afterUnlockStatus,true);}
        await verify();result.releaseVerified=true;result.passed=true;stage('done');
      }catch(error){record(error);}
    }
    return result;
  }
}

export async function localLockProbe(env:Env,input:any){
  if(!demoAllowed(env)||!env.LOCAL_DAV_ORIGIN)throw new AppError('not_found',404);
  if(input.consent!=='create-private-text-file-and-test-lock')throw new AppError('lock_probe_consent_required',400);
  const folder=path(input.path);
  if(!folder.startsWith('/Files/')||!folder.endsWith('/'))throw new AppError('write_probe_private_only',400);
  if(typeof input.testId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.testId))throw new AppError('invalid_request');
  if(typeof input.username!=='string'||!input.username||input.username.length>200||input.username.includes(':')||typeof input.password!=='string'||!input.password||input.password.length>1024)throw new AppError('invalid_request');
  const base=origin(env.LOCAL_DAV_ORIGIN),authorization='Basic '+Buffer.from(input.username+':'+input.password).toString('base64');
  const dav=new LocalLockProbeDav(base,authorization,'/Files/','/Files/',1024);
  return dav.probe(folder+'zeitplaner-test-'+input.testId+'.txt',base);
}
