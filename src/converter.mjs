import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_FILES = 4;
export const OUTPUT_ROOT = process.env.CONVERTHEIC_OUTPUT_DIR || path.join(os.homedir(), 'Pictures', 'convertHEIC');
const cli = path.join(ROOT, 'bin', 'heic-jpg');

export function qualityValue(q = 92) {
  if (!Number.isInteger(q) || q < 1 || q > 100) throw new Error('JPEG quality must be an integer from 1 to 100.');
  return q;
}
export function validateName(name) {
  if (typeof name !== 'string' || !/\.(heic|heif)$/i.test(name)) throw new Error('Choose a .heic or .heif photo.');
  return path.basename(name).replace(/[\x00-\x1f\x7f]/g, '_').slice(-220);
}
export function jpegSize(data) {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('Converter did not produce a JPEG.');
  let p = 2;
  while (p + 4 <= data.length) {
    if (data[p++] !== 0xff) break;
    while (data[p] === 0xff) p++;
    const marker = data[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = data.readUInt16BE(p);
    if (length < 2 || p + length > data.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      const height = data.readUInt16BE(p + 3), width = data.readUInt16BE(p + 5);
      if (!width || !height || width * height > 150_000_000) throw new Error('Image dimensions are unsupported.');
      return { width, height };
    }
    p += length;
  }
  throw new Error('JPEG dimensions could not be verified.');
}
async function run(command, args, signal) {
  return exec(command, args, { timeout: 90_000, maxBuffer: 512 * 1024, signal });
}

export async function convertFile(input, { quality = 92, name, signal } = {}) {
  qualityValue(quality);
  if (!path.isAbsolute(input)) throw new Error('Provide an absolute local file path.');
  const sourceName = validateName(name || input);
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) throw new Error('Choose a nonempty HEIC file no larger than 64 MB.');
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'convertheic-stage-'));
  let destination;
  try {
    const staged = path.join(staging, 'source.heic');
    await fs.copyFile(input, staged);
    if ((await fs.stat(staged)).size > MAX_BYTES) throw new Error('File exceeds 64 MB.');
    const jpg = path.join(staging, 'source.jpg');
    let engine = 'wilsonweightlifting/heic-jpg';
    try { await run(cli, ['-quality', String(quality), staged], signal); }
    catch (e) {
      if (signal?.aborted) throw e;
      // ImageIO supports HEIC variants not yet decoded by the bundled Go library.
      engine = 'macOS ImageIO (sips fallback)';
      await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), staged, '--out', jpg], signal);
    }
    const originalJpeg = await fs.readFile(jpg);
    const dimensions = jpegSize(originalJpeg);
    // Ask macOS to decode it too, before publishing any output.
    await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', jpg], signal);
    await fs.mkdir(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
    const folder = path.join(OUTPUT_ROOT, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0,8));
    await fs.mkdir(folder, { mode: 0o700 });
    destination = path.join(folder, sourceName.replace(/\.(heic|heif)$/i, '.jpg'));
    await fs.copyFile(jpg, destination, constants.COPYFILE_EXCL);
    await fs.chmod(destination, 0o600);
    let modelJpeg = originalJpeg, modelDimensions = dimensions;
    if (modelJpeg.length > 4 * 1024 * 1024) {
      const preview = path.join(staging, 'preview.jpg');
      await run('/usr/bin/sips', ['-Z', '4096', '-s', 'formatOptions', '85', jpg, '--out', preview], signal);
      modelJpeg = await fs.readFile(preview);
      if (modelJpeg.length > 4 * 1024 * 1024) {
        await run('/usr/bin/sips', ['-Z', '2048', '-s', 'formatOptions', '80', preview], signal);
        modelJpeg = await fs.readFile(preview);
      }
      modelDimensions = jpegSize(modelJpeg);
    }
    if (modelJpeg.length > 5 * 1024 * 1024) throw new Error('JPEG is too large to pass inline.');
    return {
      file: { originalName: sourceName, jpegPath: destination, mimeType: 'image/jpeg', bytes: originalJpeg.length,
        ...dimensions, modelWidth: modelDimensions.width, modelHeight: modelDimensions.height, engine },
      image: { type: 'image', mimeType: 'image/jpeg', data: modelJpeg.toString('base64') }
    };
  } catch (e) {
    if (destination) await fs.rm(path.dirname(destination), { recursive: true, force: true });
    throw new Error(`Could not convert ${sourceName}: ${e.message}`, { cause: e });
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

export async function convertFiles(paths, options = {}) {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_FILES) throw new Error('Select one to four photos at a time.');
  const results = [], errors = [];
  for (const input of paths) {
    if (options.signal?.aborted) throw new Error('Conversion cancelled.');
    try { results.push(await convertFile(input, options)); }
    catch (e) { errors.push({ input, error: e.message }); }
  }
  return conversionResult(results, errors);
}
export function conversionResult(results, errors = []) {
  const files = results.map(r => r.file);
  return {
    ...(results.length ? {} : { isError: true }),
    content: [{ type: 'text', text: JSON.stringify({ files, errors, note: 'Use the JPEG images for the original user request. HEIC sources are unchanged. Full resolution JPEGs are saved at jpegPath; large inline images may be resized as recorded by modelWidth/modelHeight.' }) }, ...results.map(r => r.image)],
    structuredContent: { status: results.length ? 'converted' : 'failed', files, errors }
  };
}
