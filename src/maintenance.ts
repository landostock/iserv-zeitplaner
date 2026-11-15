import type {Env} from './types.ts';
/** Only expired metadata with a confirmed removed private source. Group files and independent receipts are untouched. */
export async function purgeHistory(env:Env,now:number){
  if(env.PUBLICATION_MODE!=='vault-put')return;
  const cutoff=now-90*86400000,statuses="('published','cancelled','failed','conflict','needs_auth','needs_review')";
  const {results}=await env.DB.prepare(`SELECT school_id,owner_id,id,revision FROM jobs WHERE school_id=? AND updated_at<? AND source_cleaned_at IS NOT NULL AND status IN ${statuses} AND (lease_until IS NULL OR lease_until<?) ORDER BY updated_at LIMIT 10`).bind(env.SCHOOL_ID,cutoff,now).all<{school_id:string;owner_id:string;id:string;revision:number}>();
  for(const job of results){
    const guard=`school_id=? AND owner_id=? AND id=? AND revision=? AND updated_at<? AND source_cleaned_at IS NOT NULL AND status IN ${statuses} AND (lease_until IS NULL OR lease_until<?)`;
    const args=[job.school_id,job.owner_id,job.id,job.revision,cutoff,now];
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM attempts WHERE school_id=? AND owner_id=? AND job_id=? AND EXISTS(SELECT 1 FROM jobs WHERE ${guard})`).bind(job.school_id,job.owner_id,job.id,...args),
      env.DB.prepare(`DELETE FROM notifications WHERE school_id=? AND owner_id=? AND job_id=? AND EXISTS(SELECT 1 FROM jobs WHERE ${guard})`).bind(job.school_id,job.owner_id,job.id,...args),
      env.DB.prepare(`DELETE FROM jobs WHERE ${guard}`).bind(...args)
    ]);
  }
}
