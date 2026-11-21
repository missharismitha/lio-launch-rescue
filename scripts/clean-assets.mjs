// Deletes only app/static/assets/ so stale hashed bundles never linger. Never touches login files or vendor/.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '..', 'app', 'static', 'assets');
await rm(target, { recursive: true, force: true });
console.log('cleaned', path.relative(path.resolve(here, '..'), target));
