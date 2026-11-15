import {copyNameProbe} from './copy-name-probe.ts';
import {WebDav,DavError} from './dav.ts';
import {AppError,path,within,sha256,seal,unseal} from './security.ts';
import {publicationName,publicationNonce} from './publication-name.ts';
import type {Env} from './types.ts';
import {originalNameProbe} from './original-name-probe.ts';
import {encodedPath,origin} from './security.ts';

interface Proof {at:number;expiresAt:number;}
/** Proof is account-connection bound, never inferred from group membership or advertised methods. */
export class ProofDav extends WebDav {
  constructor(private env:Env,private school:string,private owner:string,authorization:string,private binding:string,max:number,private clock=Date.now,fetcher?:typeof fetch){
    super(env.DAV_ORIGIN!,authorization,env.GROUP_ROOT!,env.PRIVATE_ROOT!,max,fetcher);
  }
  private folder(folder:string){path(folder);if(!folder.endsWith('/')||!within(folder,this.env.GROUP_ROOT!))throw new AppError('invalid_path');}
  private proofKey(folder:string){return 'folder-proof:'+sha256(JSON.stringify([this.school,this.owner,this.binding,folder]));}
  private async proof(folder:string){
    const key=this.proofKey(folder),row=await this.env.DB.prepare('SELECT proof FROM folder_proofs WHERE school_id=? AND owner_id=? AND connection_binding=? AND folder_hash=?').bind(this.school,this.owner,this.binding,sha256(folder)).first<{proof:string}>();
    if(!row)return null;
    const proof=await unseal<Proof>(this.env,key,row.proof);
    if(!Number.isSafeInteger(proof.at)||!Number.isSafeInteger(proof.expiresAt)||proof.at>this.clock()||proof.expiresAt<=this.clock())return null;
    return proof;
  }
  async folderAccess(folder:string){
    this.folder(folder);const permission=await this.permission(folder);
    if(permission==='confirmed')return {writable:true,permission,canProbe:false,proofAt:null};
    if(permission==='read_only')return {writable:false,permission,canProbe:false,proofAt:null};
    const proof=await this.proof(folder);
    return {writable:Boolean(proof),permission,canProbe:!proof,proofAt:proof?.at||null};
  }
  override async canWrite(folder:string){return (await this.folderAccess(folder)).writable;}
  async originalNameReady(folder:string){
    this.folder(folder);if(this.env.ORIGINAL_MOVE_APPROVED!=='true')return false;
    if(this.env.GROUP_MOVE_REJECTED==='true')return false;
    // Explicitly reviewed private pilot capability. Group folders need their own probe.
    if(within(folder,'/Files/'))return true;
    const row=await this.env.DB.prepare('SELECT proof FROM original_name_proofs WHERE school_id=? AND owner_id=? AND connection_binding=? AND folder_hash=? AND expires_at>?').bind(this.school,this.owner,this.binding,sha256(folder),this.clock()).first<{proof:string}>();
    if(!row)return false;
    const proof=await unseal<Proof>(this.env,'original-name:'+this.proofKey(folder),row.proof);
    return proof.at<=this.clock()&&proof.expiresAt>this.clock();
  }
  async renameNew(source:string,target:string){
    const parent=source.slice(0,source.lastIndexOf('/')+1);this.folder(parent);
    if(this.env.GROUP_MOVE_REJECTED==='true')throw new AppError(within(parent,'/Groups/')?'original_group_move_rejected':'original_move_suspended',409);
    if(this.env.ORIGINAL_MOVE_APPROVED!=='true'||!/^zeitplaner-vorbereitung-[a-f0-9]{32}\.tmp$/.test(source.slice(parent.length))||target.slice(0,target.lastIndexOf('/')+1)!==parent||source===target)throw new AppError('unsafe_source',503);
    const r=await this.request('MOVE',source,{headers:{Destination:origin(this.env.DAV_ORIGIN!)+encodedPath(target),Overwrite:'F'}});await r.body?.cancel();
    if(r.status!==201)throw new DavError(r.status,![401,403,404,412,423,429].includes(r.status));
  }
  async namesInFolder(folder:string){this.folder(folder);const rows=await this.properties(folder,'1');return rows.filter(r=>r.path.startsWith(folder)&&r.path!==folder&&!r.path.slice(folder.length).replace(/\/$/,'').includes('/')).map(r=>r.path.slice(folder.length).replace(/\/$/,''));}
  async renameNumbered(source:string,target:string){
    const parent=source.slice(0,source.lastIndexOf('/')+1);this.folder(parent);
    if(this.env.NUMBERED_NAMING_ENABLED!=='true'||!/^zeitplaner-vorbereitung-[a-f0-9]{32}\.tmp$/.test(source.slice(parent.length))||target.slice(0,target.lastIndexOf('/')+1)!==parent||source===target)throw new AppError('numbering_unavailable',409);
    // Explicitly accepted best-effort numbering; not a repaired no-overwrite contract.
    const r=await this.request('MOVE',source,{headers:{Destination:origin(this.env.DAV_ORIGIN!)+encodedPath(target),Overwrite:'F'}});await r.body?.cancel();
    if(![201,204].includes(r.status))throw new DavError(r.status,![401,403,404,412,423,429].includes(r.status));
  }
  async renameReplacing(source:string,target:string){
    const parent=source.slice(0,source.lastIndexOf('/')+1);this.folder(parent);
    if(this.env.CONFIRMED_REPLACE_ENABLED!=='true'||!/^zeitplaner-vorbereitung-[a-f0-9]{32}\.tmp$/.test(source.slice(parent.length))||target.slice(0,target.lastIndexOf('/')+1)!==parent||source===target)throw new AppError('replacement_consent_required',409);
    const r=await this.request('MOVE',source,{headers:{Destination:origin(this.env.DAV_ORIGIN!)+encodedPath(target),Overwrite:'T'}});await r.body?.cancel();
    if(![201,204].includes(r.status))throw new DavError(r.status,![401,403,404,412,423,429].includes(r.status));
  }
  async testOriginalNames(folder:string,consent:string){
    this.folder(folder);
    if(this.env.GROUP_MOVE_REJECTED==='true')throw new AppError(within(folder,'/Groups/')?'original_group_move_rejected':'original_move_suspended',409);
    if(consent!=='create-and-move-harmless-private-test-files')throw new AppError('name_probe_consent_required',409);
    // Starting a new probe invalidates an earlier positive result immediately.
    // A later negative or interrupted test must never leave that grant in place.
    await this.env.DB.prepare('DELETE FROM original_name_proofs WHERE school_id=? AND owner_id=? AND connection_binding=? AND folder_hash=?').bind(this.school,this.owner,this.binding,sha256(folder)).run();
    const result=await originalNameProbe(this.env,this.school,this.owner,folder,consent,{
      stat:this.stat.bind(this),inspect:this.inspect.bind(this),publish:this.publish.bind(this),
      rename:async(source,target)=>{
        // This callback is reachable only for the freshly generated private probe paths.
        const r=await this.request('MOVE',source,{headers:{Destination:origin(this.env.DAV_ORIGIN!)+encodedPath(target),Overwrite:'F'}});
        await r.body?.cancel();return r.status;
      }
    });
    if(result.passed){const at=this.clock(),expiresAt=at+30*86400000;await this.env.DB.prepare('INSERT OR REPLACE INTO original_name_proofs(school_id,owner_id,connection_binding,folder_hash,verified_at,expires_at,proof) VALUES(?,?,?,?,?,?,?)').bind(this.school,this.owner,this.binding,sha256(folder),at,expiresAt,await seal(this.env,'original-name:'+this.proofKey(folder),{at,expiresAt})).run();}
    return result;
  }
  async testNumberedNames(folder:string,consent:string){
    this.folder(folder);
    const result=await copyNameProbe(this.env,this.school,this.owner,folder,consent,{
      stat:this.stat.bind(this),inspect:this.inspect.bind(this),publish:this.publish.bind(this),
      copy:async(source,target)=>{const r=await this.request('COPY',source,{headers:{Destination:origin(this.env.DAV_ORIGIN!)+encodedPath(target),Overwrite:'F',Depth:'0'}});await r.body?.cancel();return r.status;}
    });
    if(result.passed){const at=this.clock(),expiresAt=at+30*86400000;await this.env.DB.prepare('INSERT OR REPLACE INTO folder_proofs(school_id,owner_id,connection_binding,folder_hash,verified_at,expires_at,proof) VALUES(?,?,?,?,?,?,?)').bind(this.school,this.owner,this.binding,sha256(folder),at,expiresAt,await seal(this.env,this.proofKey(folder),{at,expiresAt})).run();}
    return result;
  }
  async verifyFolder(folder:string,consent:string){
    this.folder(folder);
    const cleanup=consent==='create-and-remove-harmless-folder-proof-even-if-changed';
    if(!['create-harmless-folder-proof','create-and-remove-harmless-folder-proof-even-if-changed'].includes(consent)||this.env.TARGET_NAMING!=='unique-v1')throw new AppError('folder_probe_consent_required',409);
    const access=await this.folderAccess(folder);
    if(access.writable)return {verified:true,file:null,proofAt:access.proofAt};
    if(!access.canProbe)throw new AppError('folder_read_only',403);
    const day=Math.floor(this.clock()/86400000),counter='folder-probe-budget:'+sha256(JSON.stringify([this.school,this.owner]))+':'+day;
    await this.env.DB.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES(?,'0')").bind(counter).run();
    const claimed=await this.env.DB.prepare('UPDATE system_state SET value=CAST(value AS INTEGER)+1 WHERE key=? AND CAST(value AS INTEGER)<10 RETURNING value').bind(counter).first();
    if(!claimed)throw new AppError('folder_probe_limit',429);
    const file=folder+publicationName('zeitplaner-schreibpruefung.txt',publicationNonce());
    const body=new TextEncoder().encode('IServ Zeitplaner: harmlose Schreibpruefung. Kein Unterrichtsmaterial. Diese Testdatei kann von Ihnen selbst entfernt werden.\n');
    try{
      if(await this.stat(file))return {verified:false,file,error:'conflict'};
      // Exactly one fresh write. Cleanup is a separate explicit permission, never a retry.
      await this.publish(file,body);
      const check=await this.inspect(file);
      if(!check||check.size!==body.length||check.sha256!==sha256(body))return {verified:false,file,error:'folder_probe_unverified'};
      const at=this.clock(),key=this.proofKey(folder);
      const expiresAt=at+30*86400000;
      await this.env.DB.prepare('INSERT OR REPLACE INTO folder_proofs(school_id,owner_id,connection_binding,folder_hash,verified_at,expires_at,proof) VALUES(?,?,?,?,?,?,?)').bind(this.school,this.owner,this.binding,sha256(folder),at,expiresAt,await seal(this.env,key,{at,expiresAt})).run();
      if(cleanup){
        // Permission covers this exact fresh random test path even if another writer
        // changes its contents. This is not claimed to be a content-conditional DELETE.
        let cleanupHttpStatus:number|undefined;
        try{
          const headers=new Headers();if(/^"[^"\r\n]+"$/.test(check.etag))headers.set('If-Match',check.etag);
          const removed=await this.request('DELETE',file,{headers});cleanupHttpStatus=removed.status;await removed.body?.cancel();
          if([401,403,412,423,429,507].includes(removed.status))return {verified:true,file,proofAt:at,cleanup:'retained' as const,cleanupHttpStatus};
        }catch{/* An uncertain DELETE is never repeated; read this one exact path only. */}
        try{return {verified:true,file,proofAt:at,cleanup:await this.stat(file)===null?'removed' as const:'uncertain' as const,...(cleanupHttpStatus!==undefined?{cleanupHttpStatus}:{})};}
        catch{return {verified:true,file,proofAt:at,cleanup:'uncertain' as const,...(cleanupHttpStatus!==undefined?{cleanupHttpStatus}:{})};}
      }
      return {verified:true,file,proofAt:at,cleanup:'retained' as const};
    }catch(error){return {verified:false,file,error:error instanceof AppError?error.code:'folder_probe_unverified',...(error instanceof DavError?{httpStatus:error.httpStatus}:{})};}
  }
}
export async function purgeFolderProofs(env:Env,now:number){
  await env.DB.prepare('DELETE FROM folder_proofs WHERE school_id=? AND expires_at<=?').bind(env.SCHOOL_ID,now).run();
  await env.DB.prepare('DELETE FROM original_name_proofs WHERE school_id=? AND expires_at<=?').bind(env.SCHOOL_ID,now).run();
}
