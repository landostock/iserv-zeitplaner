import { DavError } from './dav.ts';
import { AppError, demoAllowed, path, sha256, within } from './security.ts';
import type { Env, Folder, Storage } from './types.ts';
export const DEMO_GROUP='/Gruppen/'; export const DEMO_PRIVATE='/Eigene/Zeitplaner/';
interface Row {path:string;kind:string;writable:number;content:string|null;etag:string|null;}
export class DemoStorage implements Storage {
  constructor(private env:Env,private school:string,private owner:string){if(!demoAllowed(env))throw new AppError('setup_required',503);}
  async namesInFolder(folder:string){const {results}=await this.env.DB.prepare('SELECT path FROM demo_files WHERE school_id=? AND owner_id=?').bind(this.school,this.owner).all<{path:string}>();return results.filter(r=>r.path.startsWith(folder)&&r.path!==folder&&!r.path.slice(folder.length).replace(/\/$/,'').includes('/')).map(r=>r.path.slice(folder.length).replace(/\/$/,''));}
  async renameNumbered(source:string,target:string){const info=await this.stat(source);if(!info)throw new AppError('source_missing',409);await this.move(source,target,info.etag);}
  async seed(){
    for(const [p,w]of [[DEMO_GROUP,0],['/Gruppen/Klasse 6a/',1],['/Gruppen/Klasse 6a/Arbeitsblätter/',1],['/Gruppen/Kollegium/',1],['/Gruppen/Nur lesen/',0],[DEMO_PRIVATE,1]]as const)
      await this.env.DB.prepare('INSERT OR IGNORE INTO demo_files(school_id,owner_id,path,kind,writable) VALUES(?,?,?,?,?)').bind(this.school,this.owner,p,'folder',w).run();
  }
  private row(p:string){path(p);return this.env.DB.prepare('SELECT * FROM demo_files WHERE school_id=? AND owner_id=? AND path=?').bind(this.school,this.owner,p).first<Row>();}
  async list(p:string):Promise<Folder[]>{
    if(!within(p,DEMO_GROUP))throw new AppError('invalid_path');
    if(!(await this.row(p)))throw new DavError(404);
    const {results}=await this.env.DB.prepare('SELECT * FROM demo_files WHERE school_id=? AND owner_id=? AND kind=?').bind(this.school,this.owner,'folder').all<Row>();
    return results.filter(r=>r.path.startsWith(p)&&r.path!==p&&!r.path.slice(p.length).replace(/\/$/,'').includes('/')).map(r=>({path:r.path,name:r.path.replace(/\/$/,'').split('/').at(-1)!,writable:!!r.writable,permission:r.writable?'confirmed':'read_only'}));
  }
  async canWrite(p:string){return Boolean((await this.row(p))?.writable);}
  async stat(p:string){const r=await this.row(p);if(!r||r.kind!=='file')return null;return {size:Buffer.from(r.content!,'base64').length,etag:r.etag!};}
  async inspect(p:string){const r=await this.row(p);if(!r||r.kind!=='file')return null;const body=Buffer.from(r.content!,'base64');return {size:body.length,etag:r.etag!,sha256:sha256(body)};}
  async put(p:string,body:Uint8Array){
    if(!within(p,DEMO_PRIVATE))throw new DavError(403);
    const r=await this.env.DB.prepare('INSERT OR IGNORE INTO demo_files(school_id,owner_id,path,kind,content,etag) VALUES(?,?,?,?,?,?)')
      .bind(this.school,this.owner,p,'file',Buffer.from(body).toString('base64'),'"'+sha256(body)+'"').run();
    if(!r.meta.changes)throw new DavError(412);
  }
  async move(source:string,target:string,etag:string){
    const folder=target.slice(0,target.lastIndexOf('/')+1);if(!await this.canWrite(folder))throw new DavError(403);
    if(await this.row(target))throw new DavError(412);const r=await this.row(source);if(!r)throw new DavError(404);if(r.etag!==etag)throw new DavError(412);
    const result=await this.env.DB.prepare('UPDATE OR IGNORE demo_files SET path=? WHERE school_id=? AND owner_id=? AND path=? AND etag=?').bind(target,this.school,this.owner,source,etag).run();
    if(!result.meta.changes)throw new DavError(412);
  }
  async remove(p:string,etag:string){
    if(!within(p,DEMO_PRIVATE))throw new DavError(403);
    await this.env.DB.prepare('DELETE FROM demo_files WHERE school_id=? AND owner_id=? AND path=? AND etag=?').bind(this.school,this.owner,p,etag).run();
  }
  async publish(p:string,body:Uint8Array){
    if(!within(p,DEMO_GROUP)||!await this.canWrite(p.slice(0,p.lastIndexOf('/')+1)))throw new DavError(403);
    const r=await this.env.DB.prepare('INSERT OR IGNORE INTO demo_files(school_id,owner_id,path,kind,content,etag) VALUES(?,?,?,?,?,?)')
      .bind(this.school,this.owner,p,'file',Buffer.from(body).toString('base64'),'"'+sha256(body)+'"').run();
    if(!r.meta.changes)throw new DavError(412);
  }
}
