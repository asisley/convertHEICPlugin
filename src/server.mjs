import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ROOT, MAX_BYTES, convertFile, convertFiles, conversionResult, qualityValue, validateName } from './converter.mjs';

const URI = 'ui://convertheic/drop-zone-v2.html';
const uploads = new Map(), sessions = new Map(), requests = new Map();
const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const quality = { type: 'integer', minimum: 1, maximum: 100, default: 92 };
const tool = (name, description, inputSchema, extra = {}) => ({ name, description, inputSchema, annotations, _meta: { 'openai/widgetAccessible': true }, ...extra });
const appOnly = { _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } };
const tools = [
  tool('open_converter', 'Immediately open the HEIC Drop Zone inside Codex when @convertHEIC is invoked, including a bare plugin mention. Call with {} when no image request was given; do not ask questions before opening. If provided, pass the original image request unchanged. The panel converts uploads and adds JPEGs to the unsent composer using model context. It never sends a prompt or starts another turn. This does not intercept the normal composer.', schema({ original_request: str }), {
    title: 'HEIC Drop Zone',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: URI }, 'openai/outputTemplate': URI, 'openai/widgetAccessible': true,
      'openai/ui': { entrypoints: [{ type: 'thread' }] } }
  }),
  tool('convert_files', 'Convert one to four existing local HEIC/HEIF paths to JPEG and return the JPEG images. Preserve the original user request and complete it using these images. Sources stay unchanged.', schema({ paths: { type: 'array', items: str, minItems: 1, maxItems: 4 }, quality }, ['paths'])),
  tool('open_mac_drop_window', 'Fallback when the in-Codex panel cannot render. Open a native Mac HEIC drop window, then call wait_for_drop with the returned session_id until files arrive, cancellation, or timeout.', schema({ original_request: str, quality })),
  tool('wait_for_drop', 'Wait up to 45 seconds for the native drop window. On conversion, returns JPEG images for the original request. If waiting, call again; stop on cancelled or expired.', schema({ session_id: str, wait_seconds: { type: 'integer', minimum: 1, maximum: 45, default: 30 } }, ['session_id'])),
  tool('cancel_drop', 'Close this plugin drop session when the user cancels.', schema({ session_id: str }, ['session_id'])),
  tool('begin_upload', 'Begin a local HEIC upload from the plugin UI. Original bytes stay outside model context.', schema({ name: str, size: { type: 'integer', minimum: 1, maximum: MAX_BYTES }, quality }, ['name','size']), appOnly),
  tool('append_upload', 'Append one base64 chunk from the plugin UI.', schema({ upload_id: str, offset: { type: 'integer', minimum: 0 }, data: str }, ['upload_id','offset','data']), appOnly),
  tool('finish_upload', 'Convert a completed local upload to JPEG.', schema({ upload_id: str }, ['upload_id']), appOnly),
  tool('cancel_upload', 'Remove an incomplete local upload.', schema({ upload_id: str }, ['upload_id']), appOnly)
];
const info = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
async function removeUpload(id) {
  const u = uploads.get(id);
  if (u) { uploads.delete(id); await fs.rm(u.dir, { recursive: true, force: true }); }
}
function upload(id) {
  const u = uploads.get(id);
  if (!u || Date.now() - u.created > 15 * 60_000) throw new Error('Upload expired; choose the photo again.');
  return u;
}
async function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  s.child.kill();
  await fs.rm(s.dir, { recursive: true, force: true });
}
async function invoke(name, a, signal) {
  switch (name) {
    case 'open_converter': return info({ status: 'ready', originalRequest: String(a.original_request || '').slice(0,16000), maxFiles: 4, maxMB: 64, note: 'Drop HEIC photos into HEIC Drop Zone. Converted JPEGs are added to the chat bar without sending a message. The normal composer does not gain HEIC support.' });
    case 'convert_files': return convertFiles(a.paths, { quality: qualityValue(a.quality), signal });
    case 'begin_upload': {
      if (uploads.size >= 8) throw new Error('Too many active uploads. Cancel an upload first.');
      const name = validateName(a.name), quality = qualityValue(a.quality);
      if (!Number.isInteger(a.size) || a.size <= 0 || a.size > MAX_BYTES) throw new Error('Photo must be between 1 byte and 64 MB.');
      const id = randomUUID(), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convertheic-upload-'));
      const file = path.join(dir, 'source.heic');
      await fs.writeFile(file, '', { flag: 'wx', mode: 0o600 });
      uploads.set(id, { dir, file, name, size: a.size, received: 0, quality, created: Date.now(), busy: false });
      return info({ upload_id: id, chunkBytes: 256 * 1024 });
    }
    case 'append_upload': {
      const u = upload(a.upload_id);
      if (u.busy) throw new Error('An upload operation is already in progress.');
      if (a.offset !== u.received) throw new Error('Upload offset mismatch; choose the photo again.');
      if (typeof a.data !== 'string' || a.data.length > 350_000 || a.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(a.data)) throw new Error('Invalid upload chunk.');
      const chunk = Buffer.from(a.data, 'base64');
      if (chunk.toString('base64') !== a.data) throw new Error('Invalid base64 encoding.');
      if (!chunk.length || chunk.length > 256 * 1024 || u.received + chunk.length > u.size) throw new Error('Upload exceeds declared size.');
      u.busy = true;
      try { await fs.appendFile(u.file, chunk); u.received += chunk.length; }
      finally { u.busy = false; }
      return info({ received: u.received });
    }
    case 'finish_upload': {
      const u = upload(a.upload_id);
      if (u.busy || u.received !== u.size) throw new Error('The upload is incomplete.');
      u.busy = true;
      try { return conversionResult([await convertFile(u.file, { name: u.name, quality: u.quality, signal })]); }
      finally { await removeUpload(a.upload_id); }
    }
    case 'cancel_upload': await removeUpload(a.upload_id); return info({ status: 'cancelled' });
    case 'open_mac_drop_window': {
      if (sessions.size >= 4) throw new Error('Close an existing drop window first.');
      const q = qualityValue(a.quality), id = randomUUID();
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convertheic-drop-'));
      const response = path.join(dir, 'selection.json');
      const app = path.join(ROOT, 'native', 'convertHEIC.app', 'Contents', 'MacOS', 'convertHEIC');
      await fs.access(app);
      const child = spawn(app, ['--response', response], { stdio: ['ignore','ignore','pipe'] });
      const session = { child, dir, response, quality: q, originalRequest: String(a.original_request || ''), created: Date.now(), error: null, exited: false, waiting: false };
      child.on('error', e => { session.error = e.message; });
      child.on('exit', () => { session.exited = true; });
      child.stderr.on('data', () => {});
      sessions.set(id, session);
      return info({ status: 'waiting', session_id: id, originalRequest: session.originalRequest, note: 'Drop one to four HEIC files into the convertHEIC window. Call wait_for_drop to receive JPEGs automatically.' });
    }
    case 'wait_for_drop': {
      const s = sessions.get(a.session_id);
      if (!s) throw new Error('Drop window session not found. Open a new drop window.');
      if (s.waiting) throw new Error('A wait is already active for this window.');
      const seconds = a.wait_seconds ?? 30;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 45) throw new Error('Wait must be between 1 and 45 seconds.');
      s.waiting = true;
      try {
        const until = Date.now() + seconds * 1000;
        do {
          if (signal.aborted) { await closeSession(a.session_id); return info({ status: 'cancelled' }); }
          let selection;
          try { selection = JSON.parse(await fs.readFile(s.response, 'utf8')); }
          catch (e) { if (e.code !== 'ENOENT') throw e; }
          if (selection) {
            if (selection.cancelled) { await closeSession(a.session_id); return info({ status: 'cancelled' }); }
            const result = await convertFiles(selection.paths, { quality: s.quality, signal });
            result.structuredContent.originalRequest = s.originalRequest;
            await closeSession(a.session_id);
            return result;
          }
          if (s.error) throw new Error(s.error);
          if (s.exited) { await closeSession(a.session_id); return info({ status: 'cancelled' }); }
          if (Date.now() - s.created > 15 * 60_000) { await closeSession(a.session_id); return info({ status: 'expired' }); }
          await new Promise(resolve => setTimeout(resolve, 250));
        } while (Date.now() < until);
        return info({ status: 'waiting', session_id: a.session_id });
      } finally { s.waiting = false; }
    }
    case 'cancel_drop': await closeSession(a.session_id); return info({ status: 'cancelled' });
    default: throw new Error('Unknown convertHEIC tool.');
  }
}

function send(value) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n'); }
async function dispatch(m) {
  if (m.method === 'notifications/cancelled') { requests.get(m.params?.requestId)?.abort(); return; }
  if (m.id === undefined) return;
  try {
    let result;
    switch (m.method) {
      case 'initialize': result = { protocolVersion: ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(m.params?.protocolVersion) ? m.params.protocolVersion : '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'convertHEIC', version: '1.0.2' }, instructions: 'When @convertHEIC is invoked, immediately call open_converter without preliminary questions, even if no image task or files were given. This opens the in-chat drop zone. The panel adds JPEGs to the unsent composer. Do not send a follow-up prompt or ask for an image task after a panel conversion; the user will type and send their own message. Use open_mac_drop_window only when the panel cannot render or the user requests the Mac window.' }; break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools }; break;
      case 'resources/list': result = { resources: [{ uri: URI, name: 'HEIC Drop Zone', mimeType: 'text/html;profile=mcp-app' }] }; break;
      case 'resources/templates/list': result = { resourceTemplates: [] }; break;
      case 'resources/read': {
        if (m.params?.uri !== URI) throw new Error('Unknown resource.');
        result = { contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: await fs.readFile(path.join(ROOT, 'ui', 'drop-zone.html'), 'utf8'), _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/widgetDescription': 'Local HEIC drop zone. Converts photos and stages JPEG attachments in the chat bar without sending a prompt.' } }] }; break;
      }
      case 'tools/call': {
        const controller = new AbortController(); requests.set(m.id, controller);
        try { result = await invoke(m.params?.name, m.params?.arguments || {}, controller.signal); }
        catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; }
        finally { requests.delete(m.id); }
        break;
      }
      default: send({ id: m.id, error: { code: -32601, message: 'Method not found' } }); return;
    }
    send({ id: m.id, result });
  } catch (e) { send({ id: m.id, error: { code: -32603, message: e.message } }); }
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  buffer += data;
  if (buffer.length > 2 * 1024 * 1024) { process.stderr.write('MCP request exceeds 2 MB.\n'); process.stdin.destroy(); shutdown(); return; }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0,end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    try { void dispatch(JSON.parse(line)); }
    catch { send({ id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
  }
});
const reaper = setInterval(() => {
  for (const [id,u] of uploads) if (!u.busy && Date.now() - u.created > 15 * 60_000) void removeUpload(id);
  for (const [id,s] of sessions) if (!s.waiting && Date.now() - s.created > 15 * 60_000) void closeSession(id);
}, 60_000);
reaper.unref();
async function shutdown() {
  for (const c of requests.values()) c.abort();
  await Promise.allSettled([...uploads.keys()].map(removeUpload).concat([...sessions.keys()].map(closeSession)));
  process.exit(0);
}
process.stdin.on('end', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
