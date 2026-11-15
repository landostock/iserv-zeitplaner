import {ProofDav} from './folder-proof.ts';
import {AppError,path,within} from './security.ts';
import {DavError} from './dav.ts';
import type {Env,Folder,Storage} from './types.ts';

/** A virtual, non-writable chooser. Each real area keeps its own DAV path fence. */
export class FileAreas implements Storage {
  private areas:{root:string;name:string;dav:ProofDav}[];
  constructor(env:Env,school:string,owner:string,authorization:string,binding:string,max:number,fetcher?:typeof fetch){
    if(env.GROUP_ROOT!=='/Files/'||env.ADDITIONAL_GROUP_ROOT!=='/Groups/'||env.PUBLICATION_MODE!=='vault-put'||env.TARGET_NAMING!=='unique-v1')throw new AppError('setup_required',503);
    this.areas=[{root:'/Files/',name:'Eigene Dateien'},{root:'/Groups/',name:'Gruppen'}].map(area=>({...area,dav:new ProofDav({...env,GROUP_ROOT:area.root},school,owner,authorization,binding,max,Date.now,fetcher)}));
  }
  private area(value:string){path(value);const area=this.areas.find(a=>within(value,a.root));if(!area)throw new AppError('invalid_path');return area;}
  private container(value:string){return value==='/'||value.replace(/\/$/,'')==='/Groups';}
  async folderAccess(folder:string){
    if(this.container(folder))return {writable:false,permission:'read_only' as const,canProbe:false,proofAt:null};
    return this.area(folder).dav.folderAccess(folder);
  }
  async canWrite(folder:string){return (await this.folderAccess(folder)).writable;}
  async list(folder:string):Promise<Folder[]>{
    if(folder!=='/')return this.area(folder).dav.list(folder);
    const folders:Folder[]=[];
    for(const area of this.areas){
      try{const access=await area.dav.folderAccess(area.root);folders.push({path:area.root,name:area.name,writable:false,permission:access.permission});}
      catch(error){if(!(error instanceof DavError)||![403,404].includes(error.httpStatus))throw error;}
    }
    return folders;
  }
  async verifyFolder(folder:string,consent:string){
    if(this.container(folder))throw new AppError('folder_read_only',403);
    return this.area(folder).dav.verifyFolder(folder,consent);
  }
  async testNumberedNames(folder:string,consent:string){if(this.container(folder))throw new AppError('folder_read_only',403);return this.area(folder).dav.testNumberedNames(folder,consent);}
  async testOriginalNames(folder:string,consent:string){return this.area(folder).dav.testOriginalNames(folder,consent);}
  async originalNameReady(folder:string){return !this.container(folder)&&this.area(folder).dav.originalNameReady(folder);}
  async renameNew(source:string,target:string){const area=this.area(source);if(this.area(target)!==area)throw new AppError('invalid_path');return area.dav.renameNew(source,target);}
  async stat(file:string){return this.area(file).dav.stat(file);}
  async inspect(file:string){return this.area(file).dav.inspect(file);}
  async targetInfo(file:string){return this.area(file).dav.targetInfo(file);}
  async namesInFolder(folder:string){if(this.container(folder))throw new AppError('folder_read_only',403);return this.area(folder).dav.namesInFolder(folder);}
  async renameNumbered(source:string,target:string){const area=this.area(source);if(this.area(target)!==area)throw new AppError('invalid_path');return area.dav.renameNumbered(source,target);}
  async renameReplacing(source:string,target:string){const area=this.area(source);if(this.area(target)!==area)throw new AppError('invalid_path');return area.dav.renameReplacing(source,target);}

  async publish(file:string,body:Uint8Array){
    if(this.container(file)||file.endsWith('/')||(within(file,'/Groups/')&&!file.slice('/Groups/'.length).includes('/')))throw new AppError('invalid_path');
    return this.area(file).dav.publish(file,body);
  }
  async put(_file:string,_body:Uint8Array):Promise<void>{throw new AppError('unsafe_source',503);}
  async move(_source:string,_target:string,_etag:string):Promise<void>{throw new AppError('unsafe_source',503);}
  async remove(_file:string,_etag:string):Promise<void>{throw new AppError('unsafe_source',503);}
}
