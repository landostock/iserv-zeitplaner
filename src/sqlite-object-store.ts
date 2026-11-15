import { DurableObject } from 'cloudflare:workers';
import { AppError, demoAllowed, sha256 } from './security.ts';
import type { Env } from './types.ts';
export type ObjectData={key:string;etag:string;size:number;created_at:number;};
interface ObjectRpc {getObject(key:string,etag?:string):Promise<{meta:ObjectData;data:Uint8Array|null}|null>;putObject(key:string,data:Uint8Array,createOnly:boolean):Promise<ObjectData|null>;deleteObject(key:string):Promise<void>;listObjects(prefix:string,limit:number):Promise<ObjectData[]>;}
/** Separate from the publisher's database. Ciphertext is split below SQLite's 2 MB row limit. */
export class SqliteObjects extends DurableObject<Env>{
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS objects(key TEXT PRIMARY KEY,etag TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS chunks(key TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(key,part))');
  }
  private key(key:string){if(typeof key!=='string'||key.length>300||!/^((receipts\/|parts\/)?v1\/[a-f0-9]{64}\/[a-f0-9-]{36})(\/(((rename|numbered)-)?(intent|rejected)-)?\d{6})?$/.test(key))throw new AppError('invalid_path');}
  async putObject(key:string,data:Uint8Array,createOnly:boolean){
    this.key(key);if(!(data instanceof Uint8Array)||data.length>10485760+29||createOnly!==true)throw new AppError('invalid_request');
    const meta={key,etag:sha256(data),size:data.length,created_at:Date.now()};
    const created=this.ctx.storage.transactionSync(()=>{
      if(this.ctx.storage.sql.exec('SELECT key FROM objects WHERE key=?',key).toArray().length)return false;
      const total=this.ctx.storage.sql.exec<{n:number}>('SELECT COALESCE(SUM(size),0) AS n FROM objects').one().n;
      if(total+data.length>600*1024*1024)throw new AppError('storage_budget_exceeded',429);
      this.ctx.storage.sql.exec('INSERT INTO objects(key,etag,size,created_at) VALUES(?,?,?,?)',key,meta.etag,meta.size,meta.created_at);
      for(let start=0,part=0;start<data.length;start+=262144,part++)this.ctx.storage.sql.exec('INSERT INTO chunks(key,part,data) VALUES(?,?,?)',key,part,data.slice(start,start+262144).buffer);
      return true;
    });
    if(!created)return null;
    const next=meta.created_at+400*86400000,current=await this.ctx.storage.getAlarm();if(current===null||current>next)await this.ctx.storage.setAlarm(next);
    return meta;
  }
  async getObject(key:string,etag?:string){
    this.key(key);const meta=this.ctx.storage.sql.exec<ObjectData>('SELECT * FROM objects WHERE key=?',key).toArray()[0];if(!meta)return null;
    if(etag!==undefined&&etag!==meta.etag)return {meta,data:null};
    const data=new Uint8Array(meta.size);let offset=0;
    for(const row of this.ctx.storage.sql.exec<{data:ArrayBuffer}>('SELECT data FROM chunks WHERE key=? ORDER BY part',key)){
      const chunk=new Uint8Array(row.data);if(offset+chunk.length>data.length)throw new AppError('source_changed',409);data.set(chunk,offset);offset+=chunk.length;
    }
    if(offset!==meta.size||sha256(data)!==meta.etag)throw new AppError('source_changed',409);
    return {meta,data};
  }
  async deleteObject(key:string){this.key(key);this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('DELETE FROM chunks WHERE key=?',key);this.ctx.storage.sql.exec('DELETE FROM objects WHERE key=?',key);});}
  async listObjects(prefix:string,limit:number){
    if(typeof prefix!=='string'||prefix.length>300||!Number.isInteger(limit)||limit<1||limit>101)throw new AppError('invalid_request');
    return this.ctx.storage.sql.exec<ObjectData>('SELECT * FROM objects WHERE key>=? AND key<? ORDER BY key LIMIT ?',prefix,prefix+'\uffff',limit).toArray();
  }
  async alarm(){
    const expired=this.ctx.storage.sql.exec<{key:string}>('SELECT key FROM objects WHERE created_at<=? LIMIT 100',Date.now()-400*86400000).toArray();
    for(const row of expired)await this.deleteObject(row.key);
    const next=this.ctx.storage.sql.exec<{at:number|null}>('SELECT MIN(created_at)+? AS at FROM objects',400*86400000).one().at;
    if(next!==null)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,next));else await this.ctx.storage.deleteAlarm();
  }
}

