import { DavError, WebDav } from './dav.ts';
import { AppError, demoAllowed, maxFile, origin, path } from './security.ts';
import type { Env } from './types.ts';
import type { ProbeDiagnostic } from './probe-feedback.ts';
export class LocalProbeError extends AppError {
  constructor(code:string,public diagnostic:ProbeDiagnostic){super(code,502);}
}

export async function localProbe(env:Env,input:any){
  // This diagnostic never creates a connection or persists an authorization header.
  // Fixed operator configuration; no user-supplied server or redirected credentials.
  if(!demoAllowed(env)||!env.LOCAL_DAV_ORIGIN)throw new AppError('not_found',404);
  const server=origin(env.LOCAL_DAV_ORIGIN);
  if(typeof input.username!=='string'||!input.username||input.username.length>200||input.username.includes(':')
    ||typeof input.password!=='string'||!input.password||input.password.length>1024)throw new AppError('invalid_request');
  const p=path(input.path||'/');
  const authorization='Basic '+Buffer.from(input.username+':'+input.password).toString('base64');
  const dav=new WebDav(server,authorization,'/','/',maxFile(env));
  try{
    // The same Depth:1 response contains the current collection and its children.
    // A second ACL request must not hide an already successful folder listing.
    const {folders,currentPermission}=await dav.readFolder(p);
    return {server,path:p,folders,currentWritable:currentPermission==='confirmed',currentPermission,readOnlyProbe:true,writeTested:false,moveTested:false};
  }catch(error){
    if(error instanceof DavError)throw new LocalProbeError(error.httpStatus?'probe_http_error':'probe_transport_failed',{
      method:'PROPFIND',...(error.httpStatus?{httpStatus:error.httpStatus}:{networkReason:error.networkReason})
    });
    throw error;
  }
}
