import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readVar, run, SCOPES, setVar } from './google-token.mjs';

test('setVar replaces or adds one line and keeps the rest', () => {
  assert.equal(setVar('A="1"\nB="2"\n', 'B', 'x'), 'A="1"\nB="x"\n');
  assert.equal(setVar('A="1"\r\nB="2"\r\n', 'B', 'x'), 'A="1"\r\nB="x"\r\n');
  assert.equal(setVar('A="1"\n', 'B', 'x'), 'A="1"\nB="x"\n');
  assert.equal(setVar('', 'B', 'x'), 'B="x"\n');
});

test('readVar handles quotes and spaces', () => {
  assert.equal(readVar('A = "1"\nB=\'2\'\nC=3\n', 'A'), '1');
  assert.equal(readVar('A = "1"\nB=\'2\'\nC=3\n', 'B'), '2');
  assert.equal(readVar('# A=1\n', 'A'), '');
});

// A fake Google: `browser` plays the consent page, `answer` the token endpoint.
async function flow({ answer, browser }) {
  const file = join(mkdtempSync(join(tmpdir(), 'gt-')), '.dev.vars');
  writeFileSync(file, 'GOOGLE_CLIENT_ID="id"\nGOOGLE_CLIENT_SECRET="shh"\nOTHER="keep"\n');
  const seen = {};
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.token = new URLSearchParams(b);
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const logs = [];
  try {
    const result = await run({
      file, log: (m) => logs.push(m), tokenUrl: 'http://127.0.0.1:' + srv.address().port + '/token', waitMs: 3000,
      open: (url) => { seen.auth = new URL(url); browser(seen.auth); },
    }).catch((e) => e);
    return { result, seen, logs: logs.join('\n'), text: readFileSync(file, 'utf8') };
  } finally { srv.closeAllConnections(); srv.close(); }
}
const hit = (auth, query) => fetch(auth.searchParams.get('redirect_uri') + query);
const good = (auth) => hit(auth, '?code=abc&state=' + auth.searchParams.get('state'));

test('saves the refresh token, keeps other lines, prints no secret', async () => {
  const { result, seen, logs, text } = await flow({ browser: good,
    answer: { refresh_token: 'r-secret', access_token: 'a-secret', scope: SCOPES.join(' ') } });
  assert.deepEqual(result, [...SCOPES].sort());
  assert.equal(readVar(text, 'GOOGLE_REFRESH_TOKEN'), 'r-secret');
  assert.equal(readVar(text, 'OTHER'), 'keep');
  assert.equal(seen.auth.searchParams.get('access_type'), 'offline');
  assert.equal(seen.auth.searchParams.get('prompt'), 'consent');
  assert.equal(seen.auth.searchParams.get('scope'), SCOPES.join(' '));
  assert.equal(seen.token.get('code'), 'abc');
  assert.ok(seen.token.get('code_verifier'));
  assert.ok(!/r-secret|a-secret|shh/.test(logs));
});

test('a wrong state is ignored and the real answer still works', async () => {
  const { result, text } = await flow({ answer: { refresh_token: 'r', scope: SCOPES.join(' ') },
    browser: async (auth) => {
      assert.equal((await hit(auth, '?code=evil&state=nope')).status, 400);
      await good(auth);
    } });
  assert.ok(Array.isArray(result));
  assert.equal(readVar(text, 'GOOGLE_REFRESH_TOKEN'), 'r');
});

test('a missing scope or refresh token fails and writes nothing', async () => {
  for (const answer of [{ refresh_token: 'r', scope: SCOPES[0] }, { scope: SCOPES.join(' ') }]) {
    const { result, text } = await flow({ browser: good, answer });
    assert.ok(result instanceof Error);
    assert.equal(readVar(text, 'GOOGLE_REFRESH_TOKEN'), '');
  }
});

test('a refusal on the consent page fails', async () => {
  const { result } = await flow({ answer: {}, browser: (auth) => hit(auth, '?error=access_denied&state=' + auth.searchParams.get('state')) });
  assert.match(result.message, /access_denied/);
});
