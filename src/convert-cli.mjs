import { convertFiles } from './converter.mjs';
const result = await convertFiles(process.argv.slice(2));
process.stdout.write(JSON.stringify(result.structuredContent) + '\n');
process.exitCode = result.isError || result.structuredContent.errors.length ? 1 : 0;
