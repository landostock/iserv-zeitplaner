import { DavError, WebDav } from './dav.ts';
import { AppError, demoAllowed, origin, path, sha256, within } from './security.ts';
import type { Env, FileInfo } from './types.ts';
import type { TestFileCheck, TestFileProperties, TestFileCapabilities, WriteProbeDiagnostic } from './write-probe-feedback.ts';
export class LocalWriteProbeError extends AppError {
  constructor(code:string,public diagnostic:WriteProbeDiagnostic){super(code,502);}
}
function localDav(env:Env,input:any):WebDav {
  if(!demoAllowed(env)||!env.LOCAL_DAV_ORIGIN)throw new AppError('not_found',404);
  if(typeof input.username!=='string'||!input.username||input.username.length>200||input.username.includes(':')
    ||typeof input.password!=='string'||!input.password||input.password.length>1024)throw new AppError('invalid_request');
  return new WebDav(origin(env.LOCAL_DAV_ORIGIN),'Basic '+Buffer.from(input.username+':'+input.password).toString('base64'),'/Files/','/Files/',1024);
}
function version(etag:string):TestFileCheck['version']{
  return !etag?'missing':/^"[^"\r\n]+"$/.test(etag)?'strong':/^W\/"[^"\r\n]*"$/.test(etag)?'weak':'invalid';
}
function fileCheck(file:FileInfo|null):TestFileCheck {
  if(!file)return {exists:false,emptyVerified:false,version:'missing'};
  return {exists:true,size:file.size,emptyVerified:file.size===0&&file.sha256===sha256(new Uint8Array()),
    version:version(file.etag)};
}
function readFailure(error:unknown):NonNullable<WriteProbeDiagnostic['readFailure']> {
  if(error instanceof DavError)return error.httpStatus?'http':error.networkReason;
  if(error instanceof AppError&&error.code==='file_too_large')return 'too_large';
  if(error instanceof AppError&&error.code==='invalid_dav')return 'invalid_response';
  return 'unavailable';
}
/** Reads one test file; requested metadata/capability discovery remains strictly read-only. */
export async function localTestFileProbe(env:Env,input:any){
  const dav=localDav(env,input),testFile=path(input.testFile);
  if(!testFile.startsWith('/Files/')||!/^zeitplaner-test-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.txt$/.test(testFile.split('/').at(-1)!))throw new AppError('write_probe_test_path_required',400);
  if(input.includeProperties!==undefined&&typeof input.includeProperties!=='boolean')throw new AppError('invalid_request');
  if(input.includeCapabilities!==undefined&&typeof input.includeCapabilities!=='boolean')throw new AppError('invalid_request');
  try{
    const file=await dav.inspect(testFile);
    let properties:TestFileProperties|undefined;
    let capabilities:TestFileCapabilities|undefined;
    if((input.includeProperties||input.includeCapabilities)&&file){
      try{
        const metadata=await dav.readFileProperties(testFile,Boolean(input.includeCapabilities));
        properties={status:'read',version:version(metadata.etag),size:metadata.size,sizeMatches:metadata.size===null?null:metadata.size===file.size,
          ...(input.includeCapabilities?{exclusiveWriteLock:metadata.exclusiveWriteLock??null}:{})};
      }catch(error){properties={status:'failed',reason:readFailure(error),...(error instanceof DavError&&error.httpStatus?{httpStatus:error.httpStatus}:{})};}
    }
    if(input.includeCapabilities&&file){
      try{capabilities={status:'read',...await dav.readCapabilities(testFile)};}
      catch(error){capabilities={status:'failed',reason:readFailure(error),...(error instanceof DavError&&error.httpStatus?{httpStatus:error.httpStatus}:{})};}
    }
    return {testFile,...fileCheck(file),readOnlyProbe:true,...(properties?{properties}:{}),...(capabilities?{capabilities}:{})};
  }
  catch(error){throw new LocalWriteProbeError('write_probe_read_failed',{phase:'verify',testFile,createdConfirmed:false,leftoverPossible:true,
    readFailure:readFailure(error),...(error instanceof DavError&&error.httpStatus?{httpStatus:error.httpStatus}:{})});}
}
/** Local opt-in test, never called by the scheduler or the read-only test. */
export async function localWriteProbe(env:Env,input:any){
  const dav=localDav(env,input);
  if(input.consent!=='create-and-remove-empty-private-test-file')throw new AppError('write_probe_consent_required',400);
  const folder=path(input.path);
  // Classic personal Files only. In particular, no Groups, root, or arbitrary destination.
  if(!folder.startsWith('/Files/')||!folder.endsWith('/')||!within(folder,'/Files/'))throw new AppError('write_probe_private_only',400);
  if(typeof input.testId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.testId))throw new AppError('invalid_request');
  const testFile=folder+'zeitplaner-test-'+input.testId+'.txt';
  let phase:WriteProbeDiagnostic['phase']='create',created=false;
  let check:TestFileCheck|undefined;
  try{
    // Exactly one create-only PUT. An existing file is never inspected/deleted by this test.
    await dav.put(testFile,new Uint8Array());created=true;phase='verify';
    const verified=await dav.inspect(testFile);
    check=fileCheck(verified);
    if(!verified||!check.emptyVerified||check.version!=='strong')throw new AppError('write_probe_unverified');
    phase='cleanup';await dav.remove(testFile,verified.etag);
    if(await dav.stat(testFile))throw new AppError('write_probe_cleanup_pending');
    return {testFile,createVerified:true,readVerified:true,removedVerified:true,moveTested:false};
  }catch(error){
    const diagnostic:WriteProbeDiagnostic={phase,testFile,createdConfirmed:created,
      leftoverPossible:created||error instanceof DavError&&error.uncertain,
      ...(phase==='verify'?(check?{fileCheck:check}:{readFailure:readFailure(error)}):{}),
      ...(error instanceof DavError&&error.httpStatus?{httpStatus:error.httpStatus}:{})};
    throw new LocalWriteProbeError(phase==='cleanup'?'write_probe_cleanup_pending':created?'write_probe_unverified'
      :error instanceof DavError&&error.httpStatus===412?'write_probe_exists'
      :error instanceof DavError&&!error.uncertain?'write_probe_denied':'write_probe_uncertain',diagnostic);
  }
}
