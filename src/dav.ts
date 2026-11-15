import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AppError, encodedPath, origin, path, within } from './security.ts';
import type { FileInfo, Folder, Storage } from './types.ts';

export class DavError extends AppError {
  constructor(public httpStatus:number, public uncertain=false,public networkReason:'timeout'|'tls'|'dns'|'connection'='connection') {
    super(httpStatus===401?'needs_auth':httpStatus===403?'permission_denied':httpStatus===412?'conflict':httpStatus===507?'quota':'connection_failed',502);
  }
}
interface Element { name:string; ns:string; text:string; children:Element[]; }
const children=(e:Element,name:string):Element[]=>e.children.filter(x=>x.ns==='DAV:'&&x.name===name);
const child=(e:Element,name:string)=>children(e,name)[0];
function xml(text:string,expectedRoot='multistatus'):Element {
  if(text.length>1024*1024||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)||text.includes('\0')||XMLValidator.validate(text)!==true)throw new AppError('invalid_dav',502);
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:true}).parse(text);
  function expand(name:string,value:any,inherited:Record<string,string>):Element {
    const attrs=typeof value==='object'&&value!==null?value:{}; const namespaces={...inherited};
    for(const [key,v]of Object.entries(attrs)) {if(key==='@_xmlns')namespaces['']=String(v);else if(key.startsWith('@_xmlns:'))namespaces[key.slice(8)]=String(v);}
    const [prefix,local]=name.includes(':')?name.split(':',2):['',name];
    const result:Element={name:local,ns:namespaces[prefix]||'',text:typeof value==='object'?String(value?.['#text']||''):String(value),children:[]};
    for(const [key,v]of Object.entries(attrs))if(!key.startsWith('@_')&&!key.startsWith('#')&&!key.startsWith('?'))
      for(const item of Array.isArray(v)?v:[v])result.children.push(expand(key,item,namespaces));
    return result;
  }
  const entry=Object.entries(parsed).find(([k])=>!k.startsWith('?'));
  if(!entry)throw new AppError('invalid_dav',502);
  const root=expand(entry[0],entry[1],{});
  if(root.ns!=='DAV:'||root.name!==expectedRoot)throw new AppError('invalid_dav',502); return root;
}
/** Tokens are never followed as URLs. Restrict syntax before putting them in DAV headers. */
export function safeLockToken(value:string):boolean {
  return value.length<=1024&&/^<[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._~:/?#@!$&'*+,;=%-]+>$/.test(value);
}
export function parseProbeLock(text:string,token:string,base:string,file:string):number {
  if(!safeLockToken(token))throw new AppError('lock_probe_invalid_response',502);
  const single=(element:Element,name:string)=>{const matches=children(element,name);if(matches.length!==1)throw new AppError('lock_probe_invalid_response',502);return matches[0];};
  const prop=xml(text,'prop'),discovery=single(prop,'lockdiscovery'),active=single(discovery,'activelock');
  const scope=single(active,'lockscope'),type=single(active,'locktype');
  if(scope.children.length!==1||scope.children[0].ns!=='DAV:'||scope.children[0].name!=='exclusive'
    ||type.children.length!==1||type.children[0].ns!=='DAV:'||type.children[0].name!=='write'
    ||single(active,'depth').text!=='0'||single(single(active,'locktoken'),'href').text!==token.slice(1,-1))throw new AppError('lock_probe_invalid_response',502);
  // lockroot is a SHOULD in RFC 4918 and can be hidden for Office compatibility.
  // The later write probes bind the returned token to this exact newly created file.
  const roots=children(active,'lockroot');
  if(roots.length>1)throw new AppError('lock_probe_invalid_response',502);
  if(roots.length&&new URL(single(roots[0],'href').text,base).href!==origin(base)+encodedPath(file))throw new AppError('lock_probe_invalid_response',502);
  const timeouts=children(active,'timeout');
  if(timeouts.length!==1)throw new AppError('lock_probe_unsafe_timeout',502);
  const timeout=timeouts[0].text;
  if(!/^Second-\d+$/.test(timeout))throw new AppError('lock_probe_unsafe_timeout',502);
  const seconds=Number(timeout.slice(7));
  if(!Number.isSafeInteger(seconds)||seconds<30||seconds>120)throw new AppError('lock_probe_unsafe_timeout',502);
  return seconds;
}
/** Read only this probe's lock state; never return other clients' tokens or owner data. */
export function parseOwnProbeLock(text:string,token:string,base:string,file:string):boolean {
  if(!safeLockToken(token))throw new AppError('lock_probe_invalid_response',502);
  const root=xml(text),responses=children(root,'response');
  if(responses.length!==1||new URL(child(responses[0],'href')?.text||'',base).href!==origin(base)+encodedPath(file))throw new AppError('invalid_dav',502);
  const properties:Element[]=[];
  for(const block of children(responses[0],'propstat'))if(/^HTTP\/\d(?:\.\d)? 200(?: |$)/.test(child(block,'status')?.text||''))properties.push(...(child(block,'prop')?.children||[]));
  const discoveries=properties.filter(p=>p.ns==='DAV:'&&p.name==='lockdiscovery');
  if(discoveries.length!==1)throw new AppError('lock_probe_state_unknown',502);
  const active=children(discoveries[0],'activelock');let own=0;
  for(const lock of active){
    const tokens=children(lock,'locktoken');
    if(tokens.length!==1||children(tokens[0],'href').length!==1)throw new AppError('lock_probe_state_unknown',502);
    if(child(tokens[0],'href')!.text!==token.slice(1,-1))continue;
    const scope=child(lock,'lockscope'),type=child(lock,'locktype');
    if(!scope||scope.children.length!==1||!child(scope,'exclusive')||!type||type.children.length!==1||!child(type,'write')||children(lock,'depth').length!==1||child(lock,'depth')?.text!=='0')throw new AppError('lock_probe_state_unknown',502);
    const roots=children(lock,'lockroot');
    if(roots.length>1||roots.length&&(children(roots[0],'href').length!==1||new URL(child(roots[0],'href')!.text,base).href!==origin(base)+encodedPath(file)))throw new AppError('lock_probe_state_unknown',502);
    own++;
  }
  if(own>1)throw new AppError('lock_probe_state_unknown',502);
  return own===1;
}
export function parseDav(text:string,base:string):Array<{path:string;collection:boolean;writable:boolean;permission:Folder['permission'];etag:string;size:number|null;exclusiveWriteLock:boolean|null}> {
  const root=xml(text);const result:Array<{path:string;collection:boolean;writable:boolean;permission:Folder['permission'];etag:string;size:number|null;exclusiveWriteLock:boolean|null}>=[];
  for(const response of children(root,'response')){
    const href=child(response,'href')?.text;if(!href)throw new AppError('invalid_dav',502);
    const url=new URL(href,base);
    if(url.origin!==base||url.username||url.password||url.search||url.hash)throw new AppError('invalid_dav',502);
    let decoded:string;
    try { decoded=url.pathname.split('/').map(p=>{const d=decodeURIComponent(p);if(d.includes('/')||d.includes('\\'))throw new Error();return d;}).join('/');path(decoded); }
    catch {throw new AppError('invalid_dav',502);}
    const props:Element[]=[];
    for(const block of children(response,'propstat'))if(/^HTTP\/\d(?:\.\d)? 200(?: |$)/.test(child(block,'status')?.text||''))props.push(...(child(block,'prop')?.children||[]));
    const property=(name:string)=>props.find(p=>p.ns==='DAV:'&&p.name===name);
    if(!property('resourcetype'))continue;
    const privileges=property('current-user-privilege-set');
    const writable=Boolean(privileges&&children(privileges,'privilege').some(p=>child(p,'bind')));
    const length=property('getcontentlength')?.text;
    const size=length!==undefined&&/^\d+$/.test(length)&&Number.isSafeInteger(Number(length))?Number(length):null;
    const supportedLock=property('supportedlock');
    const exclusiveWriteLock=supportedLock?children(supportedLock,'lockentry').some(entry=>{
      const scope=child(entry,'lockscope'),type=child(entry,'locktype');
      return Boolean(scope&&child(scope,'exclusive')&&type&&child(type,'write'));
    }):null;
    result.push({path:decoded,collection:Boolean(child(property('resourcetype')!,'collection')),writable,
      permission:privileges?(writable?'confirmed':'read_only'):'unknown',etag:property('getetag')?.text||'',size,exclusiveWriteLock});
  }
  return result;
}
const PROPS='<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:current-user-privilege-set/></d:prop></d:propfind>';
const FILE_PROPS='<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/></d:prop></d:propfind>';
const FILE_LOCK_PROPS=FILE_PROPS.replace('</d:prop>','<d:supportedlock/></d:prop>');
export class WebDav implements Storage {
  private base:string;
  constructor(base:string,private authorization:string,private groupRoot:string,private privateRoot:string,private maxBytes:number,private fetcher:typeof fetch=globalThis.fetch.bind(globalThis)){
    this.base=origin(base);path(groupRoot);path(privateRoot);
    if(!/^(Bearer [A-Za-z0-9._~+/=-]+|Basic [A-Za-z0-9+/=]+)$/.test(authorization))throw new AppError('invalid_credential',503);
  }
  private validate(p:string):void{path(p);if(!within(p,this.groupRoot)&&!within(p,this.privateRoot))throw new AppError('invalid_path');}
  protected async request(method:string,p:string,options:RequestInit={}):Promise<Response>{
    this.validate(p);const headers=new Headers(options.headers);headers.set('Authorization',this.authorization);
    let response:Response;
    try{response=await this.fetcher(this.base+encodedPath(p),{...options,method,headers,redirect:'manual',signal:AbortSignal.timeout(method==='PUT'||method==='GET'?120000:15000)});}
    catch(error){
      // Classify without retaining or reflecting arbitrary exception messages/headers.
      const e=error as {name?:string;message?:string;cause?:{code?:string}};
      const hint=String(e?.cause?.code||'')+' '+String(e?.message||'');
      const reason=e?.name==='TimeoutError'||e?.name==='AbortError'||/TIMEDOUT|TIMEOUT/i.test(hint)?'timeout'
        :/CERT|TLS|SSL|certificate/i.test(hint)?'tls':/ENOTFOUND|EAI_AGAIN|DNS/i.test(hint)?'dns':'connection';
      throw new DavError(0,['MOVE','COPY','PUT','DELETE','LOCK','UNLOCK'].includes(method),reason);
    }
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new DavError(response.status,['MOVE','COPY','PUT','DELETE','LOCK','UNLOCK'].includes(method));}
    return response;
  }
  protected async properties(p:string,depth:'0'|'1',body=PROPS){
    const r=await this.request('PROPFIND',p,{headers:{Depth:depth,'Content-Type':'application/xml; charset=utf-8'},body});
    if(r.status!==207){await r.body?.cancel();throw new DavError(r.status);}
    const reader=r.body?.getReader();if(!reader)throw new AppError('invalid_dav',502);
    let n=0;const decoder=new TextDecoder('utf-8',{fatal:true});let text='';
    try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>1024*1024){await reader.cancel();throw new AppError('folder_too_large',502);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    catch(error){if(error instanceof AppError)throw error;throw new AppError('invalid_dav',502);}finally{reader.releaseLock();}
    return parseDav(text,this.base);
  }
  async readFolder(p:string):Promise<{folders:Folder[];currentPermission:Folder['permission']}>{
    if(!within(p,this.groupRoot))throw new AppError('invalid_path');
    const root=path(p).replace(/\/$/,'')+'/';
    const entries=await this.properties(p,'1');
    const current=entries.find(r=>r.collection&&r.path.replace(/\/$/,'')===root.slice(0,-1));
    const folders=entries.filter(r=>r.collection&&r.path.replace(/\/$/,'')!==root.slice(0,-1)).map(r=>{
      const candidate=r.path.replace(/\/$/,'');
      if(!candidate.startsWith(root)||candidate.slice(root.length).includes('/')||!within(candidate,this.groupRoot))throw new AppError('invalid_dav',502);
      return {path:candidate+'/',name:candidate.split('/').at(-1)!,writable:r.writable,permission:r.permission};
    });
    return {folders,currentPermission:current?.permission||'unknown'};
  }
  async list(p:string):Promise<Folder[]>{return (await this.readFolder(p)).folders;}
  /** Metadata only, never a substitute for verifying downloaded bytes or conditional operations. */
  async readFileProperties(p:string,includeLock=false):Promise<{etag:string;size:number|null;exclusiveWriteLock?:boolean|null}>{
    const entries=await this.properties(p,'0',includeLock?FILE_LOCK_PROPS:FILE_PROPS);
    if(entries.length!==1||entries[0].path!==p||entries[0].collection)throw new AppError('invalid_dav',502);
    return {etag:entries[0].etag,size:entries[0].size,...(includeLock?{exclusiveWriteLock:entries[0].exclusiveWriteLock}:{})};
  }
  /** Discovery only: Allow/DAV headers are neither permissions nor proof that locks work. */
  async readCapabilities(p:string){
    const response=await this.request('OPTIONS',p);await response.body?.cancel();
    if(![200,204].includes(response.status))throw new DavError(response.status);
    const allow=response.headers.get('Allow'),dav=response.headers.get('DAV');
    if((allow?.length||0)>2048||(dav?.length||0)>2048)throw new AppError('invalid_dav',502);
    const methods=allow===null?null:new Set(allow.split(',').map(method=>method.trim()));
    return {davClass2:dav===null?null:dav.split(',').some(value=>value.trim()==='2'),
      lockMethod:methods?.has('LOCK')??null,unlockMethod:methods?.has('UNLOCK')??null,
      moveMethod:methods?.has('MOVE')??null,copyMethod:methods?.has('COPY')??null};
  }
  async permission(p:string):Promise<Folder['permission']>{
    const current=(await this.properties(p,'0')).find(r=>r.path.replace(/\/$/,'')===p.replace(/\/$/,'')&&r.collection);
    if(!current)throw new AppError('invalid_dav',502);return current.permission;
  }
  async canWrite(p:string):Promise<boolean>{return (await this.permission(p))==='confirmed';}
  async stat(p:string){
    const r=await this.request('HEAD',p);await r.body?.cancel();
    if(r.status===404)return null;if(!r.ok)throw new DavError(r.status);
    const size=Number(r.headers.get('content-length'));const etag=r.headers.get('etag')||'';
    if(!Number.isSafeInteger(size)||size<0)throw new AppError('invalid_dav',502);return {size,etag};
  }
  async targetInfo(p:string){
    if(!within(p,this.groupRoot))throw new AppError('invalid_path');
    const r=await this.request('HEAD',p);await r.body?.cancel();if(r.status===404)return null;if(r.status!==200)throw new DavError(r.status);
    const raw=r.headers.get('content-length'),encoding=r.headers.get('content-encoding'),n=(!encoding||encoding==='identity')&&raw!==null&&/^\d+$/.test(raw)?Number(raw):null;
    return {size:n!==null&&Number.isSafeInteger(n)?n:null,etag:r.headers.get('etag')||''};
  }

  async inspect(p:string):Promise<FileInfo|null>{
    const r=await this.request('GET',p);if(r.status===404){await r.body?.cancel();return null;}if(r.status!==200){await r.body?.cancel();throw new DavError(r.status);}
    const reader=r.body?.getReader();
    const hash=createHash('sha256');let size=0;
    if(!reader){if(r.headers.get('content-length')!=='0')throw new AppError('invalid_dav',502);return {size:0,sha256:hash.digest('hex'),etag:r.headers.get('etag')||''};}
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>this.maxBytes){await reader.cancel();throw new AppError('file_too_large',413);}hash.update(value);}}
    catch(error){if(error instanceof AppError)throw error;throw new DavError(0);}finally{reader.releaseLock();}
    return {size,sha256:hash.digest('hex'),etag:r.headers.get('etag')||''};
  }
  async put(p:string,body:Uint8Array){
    if(!within(p,this.privateRoot))throw new AppError('invalid_path');
    const r=await this.request('PUT',p,{headers:{'If-None-Match':'*','Content-Type':'application/octet-stream'},body:body as BodyInit});
    await r.body?.cancel();if(r.status!==201)throw new DavError(r.status,![401,403,404,412,423,429,507].includes(r.status));
  }
  async move(source:string,target:string,etag:string){
    if(!within(source,this.privateRoot)||!within(target,this.groupRoot)||!/^"[^"\r\n]+"$/.test(etag))throw new AppError('unsafe_source',503);
    const r=await this.request('MOVE',source,{headers:{Destination:this.base+encodedPath(target),Overwrite:'F','If-Match':etag}});
    await r.body?.cancel();if(r.status!==201)throw new DavError(r.status,![401,403,404,412,423,429,507].includes(r.status));
  }
  async publish(target:string,body:Uint8Array){
    if(!within(target,this.groupRoot))throw new AppError('invalid_path');
    const r=await this.request('PUT',target,{headers:{'If-None-Match':'*','Content-Type':'application/octet-stream'},body:body as BodyInit});
    await r.body?.cancel();
    if(r.status!==201)throw new DavError(r.status,![401,403,404,412,423,429].includes(r.status));
  }
  async remove(p:string,etag:string){
    if(!within(p,this.privateRoot)||!/^"[^"\r\n]+"$/.test(etag))throw new AppError('unsafe_source',503);
    const r=await this.request('DELETE',p,{headers:{'If-Match':etag}});await r.body?.cancel();
    if(![204,404].includes(r.status))throw new DavError(r.status,r.status>=500);
  }
}
