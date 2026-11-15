import initial from '../migrations/0001_initial.sql';
import retention from '../migrations/0002_connection_retention.sql';
import cleanup from '../migrations/0003_source_cleanup.sql';
import folderProofs from '../migrations/0004_folder_proofs.sql';
import passkeys from '../migrations/0005_passkeys.sql';
import maintenance from '../migrations/0006_job_maintenance.sql';
import push from '../migrations/0007_push.sql';
import originalMove from '../migrations/0008_original_move_push_diagnostics.sql';
import replacement from '../migrations/0009_confirmed_replacement.sql';
import accountManagement from '../migrations/0010_account_management.sql';
import passkeyDomains from '../migrations/0011_passkey_domains.sql';

/** Small D1-compatible adapter so validated job SQL stays identical on native DO SQLite. */
export function durableDatabase(storage:DurableObjectStorage):D1Database {
  const sql=storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS _schema(version INTEGER PRIMARY KEY)');
  const version=sql.exec<{version:number}>('SELECT COALESCE(MAX(version),0) AS version FROM _schema').one().version;
  const migrations=[initial,retention,cleanup,folderProofs,passkeys,maintenance,push,originalMove,replacement,accountManagement,passkeyDomains];
  for(let i=version;i<migrations.length;i++)storage.transactionSync(()=>{
    // Our checked-in migrations contain no SQL strings with semicolons or triggers.
    const statements=migrations[i].replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(x=>x&&!/^PRAGMA /i.test(x));
    for(const statement of statements)sql.exec(statement);
    sql.exec('INSERT INTO _schema(version) VALUES(?)',i+1);
  });
  class Statement {
    constructor(private query:string,private args:(string|number|null|ArrayBuffer)[]=[]){ }
    bind(...args:(string|number|null|ArrayBuffer)[]){return new Statement(this.query,args);}
    execute(){
      const results=sql.exec(this.query,...this.args).toArray();
      const changes=sql.exec<{n:number}>('SELECT changes() AS n').one().n;
      return {success:true,results,meta:{changes}};
    }
    async first(column?:string){const row=this.execute().results[0];return row?(column?row[column]:row):null;}
    async all(){return this.execute();}
    async run(){return this.execute();}
  }
  return {prepare:(query:string)=>new Statement(query),batch:async(statements:Statement[])=>storage.transactionSync(()=>statements.map(s=>s.execute()))}as unknown as D1Database;
}
