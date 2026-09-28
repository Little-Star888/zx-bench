import assert from 'node:assert/strict';
import { DockerToolWorld } from '../packages/core/dist/execution/toolWorld.js';
import { DockerSession } from '../packages/core/dist/execution/sessionRunner.js';
const image='python:3.12-alpine', imageId='sha256:d09d15e60962ca365d1cd544a48773bac9d33f2fb1b00f2aa0deec78ade7dc31';
const tools=[
  {name:'read',kind:'read',path:'memory/{key}',requiredArgs:{key:'string'}},
  {name:'save',kind:'set',path:'memory/{key}',requiredArgs:{key:'string',value:'string'},valueArg:'value',requirePriorCall:{tool:'read',sameArgs:['key']}},
  {name:'save_missing',kind:'set',path:'memory/{key}',requiredArgs:{key:'string',value:'string'},valueArg:'value',requirePriorCall:{tool:'read',sameArgs:['key'],allowedErrors:['NOT_FOUND']}},
  {name:'rollback_error',kind:'script',path:'business',script:"state['counter']=9\nraise ValueError('REJECTED')"},
  {name:'partial_timeout',kind:'script',path:'business',script:"state['counter']=1\ntool_error='TIMEOUT_AFTER_COMMIT'"},
];
const world=await DockerToolWorld.create({memory:{existing:'old'},counter:0},tools,image,imageId);
try {
  assert.equal((await world.call('read',{key:'missing'})).ok,false);
  assert.equal((await world.call('save',{key:'missing',value:'bad'})).ok,false);
  assert.equal(world.snapshot().memory.missing,undefined);
  assert.equal((await world.call('save_missing',{key:'missing',value:'good'})).ok,true);
  assert.equal((await world.call('read',{key:'existing'})).ok,true);
  assert.equal((await world.call('save',{key:'existing',value:'new'})).ok,true);
  assert.equal((await world.call('rollback_error',{})).ok,false);
  assert.equal(world.snapshot().counter,0);
  assert.equal((await world.call('partial_timeout',{})).ok,false);
  assert.equal(world.snapshot().counter,1);
} finally {await world.close();}
const files=[{path:'large.txt',content:'x'.repeat(2*1024*1024)},{path:'a space.txt',content:'same'}];
const session=await DockerSession.create({image,expectedImageId:imageId,files});
try {
  assert.deepEqual(session.matchesArtifacts(files),[true,true]);
  await session.exec("printf changed > 'a space.txt'");
  assert.deepEqual(session.matchesArtifacts(files),[true,false]);
  await session.exec("rm 'a space.txt'; ln -s /etc/passwd 'a space.txt'");
  assert.deepEqual(session.matchesArtifacts(files),[true,false]);
} finally {await session.close();}
console.log('Docker runtime regressions passed: prerequisites, explicit missing reads, rollback, partial commit, batched large-file hashes, escape rejection');
