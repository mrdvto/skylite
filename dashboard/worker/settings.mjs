// Picks the Worker's settings before `wrangler dev` / `wrangler deploy`: the private copy in
// dashboard/private/settings.json when it is linked in, else the public example. The result,
// worker/settings.gen.json, is git-ignored so private names never land in this repo.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const priv = join(here, '..', 'private', 'settings.json');
const src = existsSync(priv) ? priv : join(here, 'settings.example.json');
const text = readFileSync(src, 'utf8');
JSON.parse(text); // fail the build on bad JSON, not the Worker at runtime
writeFileSync(join(here, 'settings.gen.json'), text);
console.log('worker settings: ' + (src === priv ? 'private/settings.json' : 'settings.example.json'));
