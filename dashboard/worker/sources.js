// Live sources: Google Calendar (frame account, read-only), Todoist API v1 (frame account),
// Open-Meteo. Each call goes straight to the service; nothing is cached beyond short-lived
// tokens and ids in this isolate's memory.

export class Upstream extends Error {
  constructor(service, status) {
    super(service + ' ' + status);
    this.service = service;
    this.status = status;
  }
}

// ------------------------------------------------------------------ Google Calendar
// Scopes for the refresh token: calendar.calendarlist.readonly + calendar.events.readonly.
let gToken = null;
let gTokenExp = 0;

async function googleToken(env) {
  if (gToken && Date.now() < gTokenExp - 60e3) return gToken;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Upstream('google-auth', r.status);
  const j = await r.json();
  gToken = j.access_token;
  gTokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return gToken;
}

async function gget(env, path, query) {
  const url = new URL('https://www.googleapis.com/calendar/v3' + path);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + (await googleToken(env)) } });
  if (r.status === 401) gToken = null;
  if (!r.ok) throw new Upstream('google', r.status);
  return r.json();
}

async function gall(env, path, query) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 10; i++) {
    const j = await gget(env, path, { ...query, pageToken });
    out.push(...(j.items || []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export function googleCalendar(env) {
  return {
    calendars: () => gall(env, '/users/me/calendarList', {
      minAccessRole: 'reader',
      fields: 'items(id,summary,summaryOverride,backgroundColor,foregroundColor,selected,primary),nextPageToken',
    }),
    events: (calId, timeMin, timeMax, tz) => gall(env, '/calendars/' + encodeURIComponent(calId) + '/events', {
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), timeZone: tz,
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
      fields: 'items(id,status,summary,location,start,end),nextPageToken',
    }),
  };
}

// ------------------------------------------------------------------ Todoist (API v1)
const TODOIST = 'https://api.todoist.com/api/v1';

async function tcall(env, method, path, opts = {}) {
  const url = new URL(TODOIST + path);
  for (const [k, v] of Object.entries(opts.query || {})) if (v != null) url.searchParams.set(k, v);
  const headers = { authorization: 'Bearer ' + env.TODOIST_TOKEN };
  let body;
  if (opts.json) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
  if (opts.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(opts.form); }
  const r = await fetch(url, { method, headers, body });
  if (!r.ok) throw new Upstream('todoist', r.status);
  return r.status === 204 ? null : r.json();
}

async function tall(env, path, query, key = 'results') {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const j = await tcall(env, 'GET', path, { query: { ...query, limit: 200, cursor } });
    out.push(...(j[key] || []));
    cursor = j.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export function todoist(env) {
  return {
    projects: () => tall(env, '/projects', {}),
    sections: (projectId) => tall(env, '/sections', { project_id: projectId }),
    tasks: (projectId) => tall(env, '/tasks', { project_id: projectId }),
    // One-off tasks only: Todoist leaves recurring completions out of this list.
    completed: (projectId, since, until) => tall(env, '/tasks/completed/by_completion_date', {
      project_id: projectId, since: since.toISOString(), until: until.toISOString(),
    }, 'items'),
    // Every completion, recurring ones too (`object_id`, `event_date`,
    // `extra_data.completed_due_date_local`). Lags a few seconds behind a close.
    completions: (projectId, since) => tall(env, '/activities', {
      object_type: 'item', event_type: 'completed', parent_project_id: projectId, date_from: since.toISOString(),
    }),
    // Open or completed; an unknown id answers 400 or 404.
    task: (id) => tcall(env, 'GET', '/tasks/' + id),
    close: (id) => tcall(env, 'POST', '/tasks/' + id + '/close'),
    reopen: (id) => tcall(env, 'POST', '/tasks/' + id + '/reopen'),
    create: (fields) => tcall(env, 'POST', '/tasks', { json: fields }),
    // Undo the completion of a recurring task (Sync `is_forward: 0`): sets the due date back and
    // takes one off `completed_count`. Close on a recurring task only advances the due date, and
    // reopen does not move it back. `due` is required: without it Todoist moves the date forward.
    uncompleteRecurring: async (id, due) => {
      const uuid = crypto.randomUUID();
      const j = await tcall(env, 'POST', '/sync', {
        form: { commands: JSON.stringify([{ type: 'item_update_date_complete', uuid, args: { id, due, is_forward: 0 } }]) },
      });
      if (!j || !j.sync_status || j.sync_status[uuid] !== 'ok') throw new Upstream('todoist-sync', 422);
    },
  };
}

// ------------------------------------------------------------------ Open-Meteo
export async function openMeteo(w, tz) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(w.latitude), longitude: String(w.longitude), timezone: tz,
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '2', wind_speed_unit: 'kmh', temperature_unit: 'celsius',
  });
  const r = await fetch(url);
  if (!r.ok) throw new Upstream('open-meteo', r.status);
  return r.json();
}
