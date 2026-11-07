// Mints GOOGLE_REFRESH_TOKEN for the Worker: `npm run google-token` from dashboard/.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Desktop app client) in .dev.vars. Opens
// Google's consent page, catches the answer on a one-shot localhost port and writes the token
// to .dev.vars. Never prints the token or the client secret.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WAIT_MS = 5 * 60e3;
const VARS = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars');

export function readVar(text, key) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return '';
}

/** Replaces KEY's line, or adds one, leaving every other line and the file's line endings as they are. */
export function setVar(text, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = key + '="' + value + '"';
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp('^\\s*' + key + '\\s*=').test(l));
  if (at >= 0) lines[at] = line;
  else {
    if (lines[lines.length - 1] === '') lines.pop();
    lines.push(line, '');
  }
  return lines.join(eol);
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const b64url = (b) => b.toString('base64url');
const page = (res, status, text) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
  res.end(text);
};

export async function run({ file = VARS, open = openBrowser, log = console.log, tokenUrl = TOKEN_URL, waitMs = WAIT_MS } = {}) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const clientId = readVar(text, 'GOOGLE_CLIENT_ID'), clientSecret = readVar(text, 'GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in ' + file + ' first');

  const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  let finish, fail;
  const answered = new Promise((ok, no) => { finish = ok; fail = no; });
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') return page(res, 404, 'Not found');
    if (u.searchParams.get('state') !== state) return page(res, 400, 'Wrong state, ignored');
    const code = u.searchParams.get('code');
    page(res, code ? 200 : 400, code ? 'Done. You can close this tab.' : 'Google refused. See the terminal.');
    if (code) finish(code);
    else fail(new Error('Google answered: ' + (u.searchParams.get('error') || 'no code')));
  });
  await new Promise((ok, no) => server.once('error', no).listen(0, '127.0.0.1', ok));
  const redirect = 'http://127.0.0.1:' + server.address().port + '/callback';
  const timer = setTimeout(() => fail(new Error('No answer from Google in time')), waitMs);
  try {
    const url = AUTH_URL + '?' + new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', state,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    log('Sign in and allow access. If no browser opens, use this link:\n' + url);
    open(url);
    const code = await answered;
    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier,
        grant_type: 'authorization_code', redirect_uri: redirect,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Token request failed: ' + r.status + ' ' + (j.error || ''));
    if (!j.refresh_token) throw new Error('Google sent no refresh token');
    const granted = String(j.scope || '').split(' ').filter(Boolean).sort();
    const missing = SCOPES.filter((s) => !granted.includes(s));
    if (missing.length) throw new Error('Consent left out: ' + missing.join(' ') + '. Run again and tick both boxes');
    writeFileSync(file, setVar(readFileSync(file, 'utf8'), 'GOOGLE_REFRESH_TOKEN', j.refresh_token));
    log('GOOGLE_REFRESH_TOKEN saved to .dev.vars. Scopes granted:\n  ' + granted.join('\n  '));
    return granted;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => { console.error(e.message); process.exit(1); });
}
