// Checks the Cloudflare Access token on each API request (defence in depth: Access already sits in
// front of the hostname, this makes the Worker refuse anything that did not come through it).
// The signing keys are kept in this isolate's memory only, never in a Cloudflare store.

let certs = null;
let certsAt = 0;
let refetchAt = 0;

export function teamUrl(v) {
  const name = String(v || '').trim().replace(/^https:\/\//, '').replace(/\.cloudflareaccess\.com\/?$/, '');
  return /^[a-z0-9-]{1,63}$/.test(name) ? 'https://' + name + '.cloudflareaccess.com' : null;
}

async function keys(team, fresh) {
  if (!fresh && certs && Date.now() - certsAt < 3600e3) return certs;
  const r = await fetch(team + '/cdn-cgi/access/certs');
  if (!r.ok) throw new Error('access certs ' + r.status);
  const j = await r.json();
  certs = Array.isArray(j.keys) ? j.keys : [];
  certsAt = Date.now();
  return certs;
}

function b64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
const json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

export async function verifyAccess(request, env) {
  const team = teamUrl(env.ACCESS_TEAM_DOMAIN);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!team || !env.ACCESS_AUD || !token) return false;
  const seg = token.split('.');
  if (seg.length !== 3) return false;
  let head, claims;
  try { head = json(seg[0]); claims = json(seg[1]); } catch { return false; }
  if (head.alg !== 'RS256' || typeof head.kid !== 'string') return false;

  let jwk = (await keys(team)).find((k) => k.kid === head.kid);
  // Keys rotated? Refetch, but at most once a minute so unknown kids can't drive a fetch per request.
  if (!jwk && Date.now() - refetchAt > 60e3) {
    refetchAt = Date.now();
    jwk = (await keys(team, true)).find((k) => k.kid === head.kid);
  }
  if (!jwk || jwk.kty !== 'RSA') return false;
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(seg[2]),
    new TextEncoder().encode(seg[0] + '.' + seg[1]));
  if (!ok) return false;

  const now = Date.now() / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return aud.includes(env.ACCESS_AUD) && claims.iss === team &&
    typeof claims.exp === 'number' && claims.exp > now &&
    (claims.nbf == null || claims.nbf <= now + 60);
}
