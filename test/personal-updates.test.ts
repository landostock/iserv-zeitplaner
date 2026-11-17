import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newerVersion,parseRelease,updateRepository,updateStatus,UPDATE_SOURCE} from '../src/personal-updates.ts';
test('release checks compare RCs and final versions without offering downgrades',()=>{
 assert.equal(newerVersion('1.0.0-rc3','1.0.0-rc2'),true);assert.equal(newerVersion('1.0.0','1.0.0-rc99'),true);assert.equal(newerVersion('1.0.0-rc3','1.0.0'),false);assert.equal(newerVersion('1.0.1-rc1','1.0.0'),true);assert.equal(newerVersion('1.0.0-rc2','1.0.0-rc2'),false);
 for(const v of ['1.0','01.0.0','1.0.0;curl evil','1.0.0-rc0'])assert.throws(()=>parseRelease({version:v,commit:'a'.repeat(40),updaterProtocol:1,notes:[]}));
});
test('project links are restricted to an own GitHub repository and cannot redirect through credentials or queries',()=>{
 assert.equal(updateRepository('https://github.com/teacher/mein-iserv-zeitplaner.git'),'teacher/mein-iserv-zeitplaner');
 for(const s of ['https://evil.org/teacher/repo','https://github.com@evil.org/teacher/repo','teacher/repo?token=secret','teacher/../repo','landostock/iserv-zeitplaner'])assert.throws(()=>updateRepository(s));
});
test('an unavailable release service never reports an installation failure or fabricates an update',async()=>{
 const r=await updateStatus((async(url,options)=>{assert.equal(url,UPDATE_SOURCE);assert.equal(options?.redirect,'manual');assert.equal(new Headers(options?.headers).has('Authorization'),false);return new Response('Unavailable',{status:503});})as typeof fetch);
 assert.equal(r.checked,false);assert.equal(r.available,false);assert.equal(r.latest,null);assert.ok(r.installed);
});
