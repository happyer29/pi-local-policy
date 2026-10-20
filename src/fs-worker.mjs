// Runs inside Seatbelt. No host filesystem operation is delegated to the parent.
import { readFile, writeFile, mkdir, access, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
let raw = '';
for await (const part of process.stdin) { raw += part; if (raw.length > 16 * 1024 * 1024) throw new Error('Request too large'); }
const { operation, path, data } = JSON.parse(raw);
let result;
switch (operation) {
  case 'read': result = { base64: (await readFile(path)).toString('base64') }; break;
  case 'write': await writeFile(path, data, 'utf8'); result = true; break;
  case 'mkdir': await mkdir(path, { recursive: true }); result = true; break;
  case 'access': await access(path, constants.R_OK); result = true; break;
  case 'editAccess': await access(path, constants.R_OK | constants.W_OK); result = true; break;
  case 'stat': { const s = await stat(path); result = { directory: s.isDirectory(), file: s.isFile() }; break; }
  case 'readdir': result = (await readdir(path, { withFileTypes: true })).map(e => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() })); break;
  default: throw new Error('Unknown filesystem operation');
}
process.stdout.write(JSON.stringify({ result }));
