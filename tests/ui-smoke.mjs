import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const testDir=await fs.mkdtemp(path.join(os.tmpdir(),'convertheic-ui-test-'));
const child=spawn(process.execPath,[path.join(root,'src/server.mjs')],{env:{...process.env,CONVERTHEIC_OUTPUT_DIR:path.join(testDir,'outputs')},stdio:['pipe','pipe','inherit']});
let buffer='',next=0;const pending=new Map(),captures=[],messages=[];
child.stdout.setEncoding('utf8');child.stdout.on('data',d=>{buffer+=d;let p;while((p=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,p));buffer=buffer.slice(p+1);pending.get(m.id)?.(m);pending.delete(m.id);}});
const rpc=(method,params)=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const fixture=path.join(testDir,'sample.HEIC');
const rotated=path.join(testDir,'rotated.heic');
let nativeResult;
const server=createServer(async(req,res)=>{
  try {
    if(req.url==='/ui'){res.setHeader('Content-Type','text/html');res.end(await fs.readFile(path.join(root,'ui/drop-zone.html')));return;}
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      const m=JSON.parse(body);let result;
      if(req.url==='/capture'){captures.push(m);result={};}
      else if(req.url==='/message'){messages.push(m);result={};}
      else if(m.method==='tools/call'&&m.params.name==='open_mac_drop_window')result={structuredContent:{session_id:'test-native'},content:[]};
      else if(m.method==='tools/call'&&m.params.name==='wait_for_drop')result=nativeResult;
      else if(m.method==='tools/call'&&m.params.name==='cancel_drop')result={structuredContent:{status:'cancelled'},content:[]};
      else {const answer=await rpc(m.method,m.params);if(answer.error)throw new Error(answer.error.message);result=answer.result;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    res.setHeader('Content-Type','text/html');res.end(`<html><body style="margin:0">
    <textarea id="composer">Keep my draft text.</textarea><button id="remove">Remove first attachment</button><button id="allow">Allow staging</button>
    <div id="attachments"></div><iframe src="/ui" style="border:0;width:100%;height:85vh"></iframe><script>
    const query=new URLSearchParams(location.search);let attached=[],reject=query.has('reject'),revision=0;
    const notify=()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{'openai/modelContext':{updateId:String(++revision),content:attached}}},'*');
    document.querySelector('#remove').onclick=()=>{attached.shift();notify();};
    document.querySelector('#allow').onclick=()=>reject=false;
    window.addEventListener('message',async event=>{const m=event.data;if(m?.jsonrpc!=='2.0'||m.id===undefined)return;let result,error;
    if(m.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostCapabilities:{message:{text:{},image:{}},...(query.has('unsupported')?{}:{updateModelContext:{image:{}},experimental:{'openai/modelContext':{}}})},hostContext:{theme:'light'}};
    else if(m.method==='ui/update-model-context'){
      if(reject)error={code:-32000,message:'Draft attachment rejected for test.'};
      else{attached=m.params.content;await fetch('/capture',{method:'POST',body:JSON.stringify(m.params)});document.querySelector('#attachments').textContent=attached.map(c=>c._meta?.['openai/title']).join(', ');notify();result={_meta:{'openai/modelContext':{updateId:String(revision)}}};}
    }
    else if(m.method==='ui/message'){await fetch('/message',{method:'POST',body:JSON.stringify(m.params)});error={code:-32000,message:'Sending a prompt is forbidden in this test.'};}
    else result=await (await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();
    event.source.postMessage({jsonrpc:'2.0',id:m.id,...(error?{error}:{result})},'*');});</script></body></html>`);
  }catch(e){res.statusCode=500;res.end(e.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  await promisify(execFile)('/usr/bin/swift',['-module-cache-path',path.join(testDir,'swift-cache'),path.join(root,'tests/make-fixture.swift'),testDir]);
  nativeResult=(await rpc('tools/call',{name:'convert_files',arguments:{paths:[rotated]}})).result;
  assert.equal(nativeResult.structuredContent.status,'converted');
  browser=await chromium.launch({headless:true,...(process.env.CONVERTHEIC_BROWSER_CHANNEL?{channel:process.env.CONVERTHEIC_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:720,height:820}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const frame=page.frameLocator('iframe');
  const ready=()=>frame.getByText('Ready for your HEIC photos.',{exact:true}).waitFor();
  const attached=()=>frame.getByText('JPEGs added to your chat bar. Type your message and press Send when ready.',{exact:true}).waitFor({timeout:30000});
  const validImages=expected=>{
    const content=captures.at(-1).content;assert.equal(content.length,expected);
    for(const image of content){assert.equal(image.type,'image');assert.equal(image.mimeType,'image/jpeg');assert.match(image._meta['openai/title'],/\.jpg$/);assert.equal(Buffer.from(image.data,'base64').subarray(0,2).toString('hex'),'ffd8');}
  };
  await page.goto(origin);await ready();
  assert.equal(await frame.locator('textarea').count(),0);
  await frame.locator('#files').setInputFiles(fixture);await attached();validImages(1);
  assert.equal(await page.locator('#composer').inputValue(),'Keep my draft text.');
  await frame.locator('#files').setInputFiles(rotated);
  await frame.getByRole('button',{name:'Choose photos',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#attachments').textContent.includes('rotated.jpg'));
  await attached();validImages(2);
  await page.locator('#remove').click();
  await frame.locator('#files').setInputFiles(fixture);
  await page.waitForFunction(()=>document.querySelector('#attachments').textContent==='rotated.jpg, sample.jpg');
  await attached();validImages(2);
  await page.screenshot({path:path.join(testDir,'draft-complete.png')});
  const count=captures.length;
  await page.goto(origin+'/?reject=1');await ready();
  await frame.locator('#files').setInputFiles(fixture);
  await frame.getByText('Draft attachment rejected for test.',{exact:true}).waitFor({timeout:30000});
  assert.equal(captures.length,count);
  await page.locator('#allow').click();await frame.getByRole('button',{name:'Add JPEGs to chat',exact:true}).click();await attached();validImages(1);
  await page.goto(origin+'/?unsupported=1');
  await frame.getByText('Ready to convert. This host does not support adding draft images.',{exact:true}).waitFor();
  const unsupportedCount=captures.length;
  await frame.locator('#files').setInputFiles(fixture);
  await frame.getByText('This Codex host cannot add draft attachments. Your JPEGs are saved in Pictures/convertHEIC.',{exact:true}).waitFor({timeout:30000});
  assert.equal(captures.length,unsupportedCount);
  await page.goto(origin);await ready();
  await frame.getByRole('button',{name:'Open Mac drop window',exact:true}).click();await attached();validImages(1);
  assert.equal(captures.at(-1).content[0]._meta['openai/title'],'rotated.jpg');
  assert.equal(await page.locator('#composer').inputValue(),'Keep my draft text.');
  assert.deepEqual(messages,[]);assert.deepEqual(errors,[]);
  console.log('PASS: real HEIC to JPEG-only draft attachments; draft text unchanged; multiple drops preserve staged images; removals respected; retry and unsupported-host paths send no prompt; native fallback stages images. Host bridge and native picker simulated.');
}finally {
  await browser?.close();server.close();
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve();
  child.stdin.end();await exited;
  await fs.rm(testDir,{recursive:true,force:true});
}
