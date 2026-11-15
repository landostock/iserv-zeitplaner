import { DurableObject } from 'cloudflare:workers';
import { FileVault } from './file-vault.ts';
import { bounded } from './bounded.ts';
import { sha256,readLimited } from './security.ts';
import type { Env } from './types.ts';
export { SqliteObjects } from './sqlite-object-store.ts';

interface BenchEnv extends Env {BENCH:DurableObjectNamespace;BENCHMARK_TOKEN:string;BENCHMARK_ONLY:string;}
/** Separate temporary app. It has no IServ endpoint and accepts no files or account credentials. */
export class BenchmarkRunner extends DurableObject<BenchEnv>{
  constructor(ctx:DurableObjectState,env:BenchEnv){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS measurements(at INTEGER,size INTEGER,elapsed_ms REAL,verified INTEGER)');}
  async alarm(){await this.ctx.storage.put('lastAlarm',Date.now());}
  async fetch(request:Request){
    const url=new URL(request.url);
    if(request.method==='GET')return Response.json({measurements:this.ctx.storage.sql.exec('SELECT * FROM measurements ORDER BY at DESC LIMIT 10').toArray(),alarmAt:await this.ctx.storage.get('lastAlarm')||null});
    return bounded(async()=>{
      const last=await this.ctx.storage.get<number>('lastRun');if(last&&Date.now()-last<60000)return Response.json({error:'wait_one_minute'},{status:429});
      const size=Number(url.searchParams.get('size')||10485760);
      if(![65536,1048576,10485760,37748736,52428800].includes(size))return Response.json({error:'invalid_size'},{status:400});
      await this.ctx.storage.put('lastRun',Date.now());
      const env={...this.env,MODE:'production' as const,MAX_FILE_BYTES:'52428800'};
      const vault=new FileVault(env,'synthetic-benchmark',this.ctx.id.toString()),key=vault.key(crypto.randomUUID());
      const started=performance.now(),body=new Uint8Array(size);
      for(let i=0;i<size;i++)body[i]=i%251;
      const expected={size,sha256:sha256(body)};
      try{
        const saved=await vault.put(key,body,expected),read=await vault.read(key,expected,saved.etag);
        const verified=sha256(read.body)===expected.sha256,elapsedMs=performance.now()-started;
        this.ctx.storage.sql.exec('INSERT INTO measurements(at,size,elapsed_ms,verified) VALUES(?,?,?,?)',Date.now(),size,elapsedMs,verified?1:0);
        await this.ctx.storage.setAlarm(Date.now()+5000);
        return Response.json({verified,size,elapsedMs,measurement:'wall time, not billed CPU',alarmScheduled:true});
      }finally{await vault.remove(key);}
    });
  }
}
export default {
  async fetch(request:Request,env:BenchEnv){
    if(env.BENCHMARK_ONLY!=='true'||!env.BENCHMARK_TOKEN||env.BENCHMARK_TOKEN.length<32||request.headers.get('Authorization')!=='Bearer '+env.BENCHMARK_TOKEN)return new Response(null,{status:404});
    try{await readLimited(request,0);}catch{return new Response(null,{status:415});}
    const url=new URL(request.url),actor=Number(url.searchParams.get('actor'));
    if(!Number.isInteger(actor)||actor<0||actor>4||!((url.pathname==='/run'&&request.method==='POST')||(url.pathname==='/report'&&request.method==='GET')))return new Response(null,{status:404});
    const stub=env.BENCH.get(env.BENCH.idFromName('synthetic-'+actor));
    return stub.fetch(new Request(request.url,{method:request.method,headers:request.headers}));
  }
}satisfies ExportedHandler<BenchEnv>;
