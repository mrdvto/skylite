// Home HQ Worker: serves the built dashboard (assets) and a small pass-through API under /api/.
// Every request goes to Google / Todoist / Open-Meteo at request time; nothing is stored on
// Cloudflare (no KV, D1, R2 or Cache API). Writes change one item each.
//
// Secrets (wrangler secret put / .dev.vars): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_REFRESH_TOKEN, TODOIST_TOKEN, ACCESS_TEAM_DOMAIN, ACCESS_AUD.
// MOCK=1 (local only: `wrangler dev --var MOCK:1`) answers from mock.js instead; MOCK=calendar
// (local only, `npm run worker:todoist`) mocks only Google Calendar, with live Todoist and
// Open-Meteo, and needs only TODOIST_TOKEN. LOCAL=1 (local only, `npm run worker:live`) is fully
// live but skips Access on localhost, and needs only the Google and Todoist secrets.
import S from './settings.gen.json';
import { verifyAccess } from './access.js';
import { mockSource } from './mock.js';
import * as M from './model.js';
import { googleCalendar, openMeteo, todoist, Upstream } from './sources.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const DATA_SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'TODOIST_TOKEN'];
const LIVE_SECRETS = [...DATA_SECRETS, 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'];

const MOCKS = ['1', 'calendar'];

function source(env) {
  if (env.MOCK === '1') return mockSource(S);
  if (env.MOCK === 'calendar') return { calendar: mockSource(S).calendar, todoist: todoist(env), weather: openMeteo };
  return { calendar: googleCalendar(env), todoist: todoist(env), weather: openMeteo };
}

// Writes must come from the dashboard page itself: same origin, JSON body, small.
async function body(request, url) {
  if (request.headers.get('origin') !== url.origin) throw new M.BadRequest('origin');
  if (!/^application\/json\b/.test(request.headers.get('content-type') || '')) throw new M.BadRequest('type');
  if (+(request.headers.get('content-length') || 0) > 2048) throw new M.BadRequest('size');
  const text = await request.text();
  if (text.length > 2048) throw new M.BadRequest('size');
  try {
    const b = JSON.parse(text);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0;
    return b;
  } catch { throw new M.BadRequest('json'); }
}

function config(env) {
  return {
    mock: MOCKS.includes(env.MOCK),
    timezone: S.timezone,
    familyCalendar: S.familyCalendar,
    stores: S.stores.map(({ name, tab, color, ink }) => ({
      name, tab: !!tab,
      // tag colours go into a style attribute: only plain #RRGGBB passes
      color: HEX.test(color) ? color : null, ink: HEX.test(ink) ? ink : null,
    })),
    night: S.night,
    idleSeconds: S.idleSeconds,
  };
}

async function api(request, env, url) {
  const mock = MOCKS.includes(env.MOCK);
  // Access JWT check first (before saying anything about configuration). Live mode needs it; a
  // local mock run without the Access settings skips it, and the runs on real data (MOCK=calendar,
  // LOCAL=1) skip it only on localhost.
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const real = env.MOCK === 'calendar' ? 'calendar' : !mock && env.LOCAL === '1' ? 'live' : null;
  if (env.ACCESS_AUD || (!mock && !real) || (real && !local)) {
    if (!(await verifyAccess(request, env))) return json({ error: 'unauthorized' }, 401);
  }
  let needed = LIVE_SECRETS;
  if (real === 'calendar') needed = ['TODOIST_TOKEN'];
  else if (mock) needed = [];
  else if (real && local && !env.ACCESS_AUD) needed = DATA_SECRETS;
  if (needed.some((k) => !env[k])) return json({ error: 'not configured' }, 503);
  const src = source(env), path = url.pathname, method = request.method;
  let m;
  if (method === 'GET') {
    if (path === '/api/config') return json(config(env));
    if (path === '/api/calendar') return json(await M.calendar(src, S, url.searchParams.get('from'), url.searchParams.get('to')));
    if (path === '/api/chores') return json(await M.chores(src, S));
    if (path === '/api/shopping') return json(await M.shopping(src, S));
    if (path === '/api/weather') return json(await M.weather(src, S));
  } else if (method === 'POST') {
    if ((m = path.match(/^\/api\/chores\/([^/]+)$/))) {
      const b = await body(request, url);
      if (typeof b.done !== 'boolean') throw new M.BadRequest('done');
      await M.setChore(src, S, m[1], b.done);
      return json({ ok: true });
    }
    if ((m = path.match(/^\/api\/shopping\/([^/]+)$/))) {
      const b = await body(request, url);
      if (typeof b.done !== 'boolean') throw new M.BadRequest('done');
      await M.setItem(src, S, m[1], b.done);
      return json({ ok: true });
    }
    if (path === '/api/shopping') {
      const b = await body(request, url);
      if (typeof b.name !== 'string' || (b.store != null && typeof b.store !== 'string')) throw new M.BadRequest('fields');
      return json({ ok: true, item: await M.addItem(src, S, b.name, b.store || null) });
    }
  } else {
    return json({ error: 'method' }, 405);
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (e) {
      if (e instanceof M.BadRequest) return json({ error: 'bad request' }, 400);
      if (e instanceof M.NotFound) return json({ error: 'not found' }, 404);
      if (e instanceof Upstream) {
        console.log('upstream', e.service, e.status); // visible in `wrangler tail` only
        return json({ error: 'upstream', service: e.service }, 502);
      }
      console.log('error', e && e.message);
      return json({ error: 'server' }, 500);
    }
  },
};
