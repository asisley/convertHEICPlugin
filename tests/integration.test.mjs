import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir, child, counter = 0, pending = new Map(), buffer = '';
const hash = data => createHash('sha256').update(data).digest('hex');
function rpc(method,params={}) {
  const id=++counter;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},30000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
const call=(name,args)=>rpc('tools/call',{name,arguments:args});
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'convertheic-test-'));
  await exec('/usr/bin/swift',['-module-cache-path',path.join(dir,'swift-cache'),path.join(root,'tests/make-fixture.swift'),dir]);
  child=spawn(process.execPath,[path.join(root,'src/server.mjs')],{env:{...process.env,CONVERTHEIC_OUTPUT_DIR:path.join(dir,'output')},stdio:['pipe','pipe','inherit']});
  child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{
    buffer+=data;let end;
    while((end=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}
  });
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'},capabilities:{}});
  assert.equal(init.serverInfo.name,'convertHEIC');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
});
after(async()=>{child?.stdin.end();await fs.rm(dir,{recursive:true,force:true});});
test('publishes the drop panel and keeps raw HEIC upload tools app-only',async()=>{
  const {tools}=await rpc('tools/list');
  assert.equal(tools.find(t=>t.name==='open_converter')._meta['openai/ui'].entrypoints[0].type,'thread');
  for(const name of ['begin_upload','append_upload','finish_upload','cancel_upload'])assert.deepEqual(tools.find(t=>t.name===name)._meta.ui.visibility,['app']);
  const resource=await rpc('resources/read',{uri:'ui://convertheic/drop-zone-v2.html'});
  assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
  assert.ok(resource.contents[0].text.includes('Drop HEIC photos here'));
});
test('converts a real HEIC without touching the original or a neighboring JPEG',async()=>{
  const name="Photo [1] ' & $.HEIC",input=path.join(dir,name);
  await fs.copyFile(path.join(dir,'sample.HEIC'),input);
  const neighbor=input.replace(/\.HEIC$/,'.jpg');await fs.writeFile(neighbor,'Keep me');
  const beforeHash=hash(await fs.readFile(input));
  const r=await call('convert_files',{paths:[input]});
  assert.ok(!r.isError,JSON.stringify(r));assert.equal(r.structuredContent.files.length,1);
  const f=r.structuredContent.files[0];assert.equal(f.width,400);assert.equal(f.height,240);
  assert.equal(f.originalName,name);assert.equal(r.content[1].mimeType,'image/jpeg');
  assert.equal((await fs.readFile(f.jpegPath))[0],255);
  assert.equal(hash(await fs.readFile(input)),beforeHash);assert.equal(await fs.readFile(neighbor,'utf8'),'Keep me');
  const second=await call('convert_files',{paths:[input]});
  assert.notEqual(second.structuredContent.files[0].jpegPath,f.jpegPath);
});
test('applies HEIC orientation to the JPEG pixels',async()=>{
  const r=await call('convert_files',{paths:[path.join(dir,'rotated.heic')]});
  assert.ok(!r.isError,JSON.stringify(r));
  assert.equal(r.structuredContent.files[0].width,240);assert.equal(r.structuredContent.files[0].height,400);
});
test('rejects corrupt images and returns a useful error without JPEG data',async()=>{
  const corrupt=path.join(dir,'broken.heic');await fs.writeFile(corrupt,'not an image');
  const r=await call('convert_files',{paths:[corrupt]});
  assert.equal(r.isError,true);assert.equal(r.structuredContent.files.length,0);assert.equal(r.content.some(c=>c.type==='image'),false);
  const q=await call('convert_files',{paths:[corrupt],quality:200});assert.equal(q.isError,true);
});
test('streams HEIC bytes through app tools and emits only JPEG image content',async()=>{
  const data=await fs.readFile(path.join(dir,'sample.HEIC'));
  const start=await call('begin_upload',{name:'from drop.HEIC',size:data.length});
  const id=start.structuredContent.upload_id;
  const bad=await call('append_upload',{upload_id:id,offset:1,data:data.toString('base64')});assert.equal(bad.isError,true);
  const half=Math.floor(data.length/2);
  for(const [offset,end] of [[0,half],[half,data.length]]){
    const r=await call('append_upload',{upload_id:id,offset,data:data.subarray(offset,end).toString('base64')});assert.ok(!r.isError);
  }
  const r=await call('finish_upload',{upload_id:id});assert.ok(!r.isError,JSON.stringify(r));
  assert.equal(r.content.filter(c=>c.type==='image').length,1);assert.equal(r.content[1].mimeType,'image/jpeg');
  assert.equal(Buffer.from(r.content[1].data,'base64').subarray(0,2).toString('hex'),'ffd8');
  const again=await call('finish_upload',{upload_id:id});assert.equal(again.isError,true);
});
test('handles cancellation and incomplete upload without publishing a JPEG',async()=>{
  const start=await call('begin_upload',{name:'cancel.heic',size:100});const id=start.structuredContent.upload_id;
  assert.equal((await call('finish_upload',{upload_id:id})).isError,true);
  assert.equal((await call('cancel_upload',{upload_id:id})).structuredContent.status,'cancelled');
  assert.equal((await call('append_upload',{upload_id:id,offset:0,data:'AAAA'})).isError,true);
});
test('accepts full-size 256 KB chunks for a realistically sized HEIC upload',async()=>{
  const image=await fs.readFile(path.join(dir,'sample.HEIC'));
  const free=Buffer.alloc(700000);free.writeUInt32BE(free.length);free.write('free',4,'ascii');
  const data=Buffer.concat([image,free]);
  const start=await call('begin_upload',{name:'large.heic',size:data.length});const id=start.structuredContent.upload_id;
  for(let offset=0;offset<data.length;offset+=256*1024){
    const r=await call('append_upload',{upload_id:id,offset,data:data.subarray(offset,offset+256*1024).toString('base64')});assert.ok(!r.isError,JSON.stringify(r));
  }
  const r=await call('finish_upload',{upload_id:id});assert.ok(!r.isError,JSON.stringify(r));assert.equal(r.content[1].mimeType,'image/jpeg');
});
