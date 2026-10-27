// Turns raw Google / Todoist / Open-Meteo data into what the panel draws, and applies the panel's
// per-item writes. Works the same over the live sources and the mock (see mock.js).
import { Upstream } from './sources.js';
import { addDays, isDay, ymd, zoned } from './time.js';

// "No Frills" ~ "NoFrills" ~ "no_frills"; "T&T" ~ "TT"; "Longo's" ~ "Longos"
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_DAYS = 100;

export class BadRequest extends Error {}
export class NotFound extends Error {}

// ------------------------------------------------------------------ calendar
export async function calendar(src, S, from, to) {
  if (!isDay(from) || !isDay(to) || to <= from || to > addDays(from, MAX_DAYS)) throw new BadRequest('range');
  const tz = S.timezone;
  const order = (S.columns || []).map(norm);
  const list = (await src.calendar.calendars())
    .filter((c) => c.selected)
    .map((c) => ({ raw: c, name: c.summaryOverride || c.summary || 'Calendar' }))
    .sort((a, b) => {
      const ia = order.indexOf(norm(a.name)), ib = order.indexOf(norm(b.name));
      return (ia < 0 ? 1e3 : ia) - (ib < 0 ? 1e3 : ib) || a.name.localeCompare(b.name);
    });
  // Short keys instead of calendar ids, which are email addresses.
  const calendars = list.map((c, i) => ({
    key: 'c' + i,
    name: c.name,
    color: HEX.test(c.raw.backgroundColor) ? c.raw.backgroundColor : '#555555',
    ink: HEX.test(c.raw.foregroundColor) ? c.raw.foregroundColor : '#FFFFFF',
    family: norm(c.name) === norm(S.familyCalendar),
  }));
  const tMin = zoned(tz, from), tMax = zoned(tz, to);
  const lists = await Promise.all(list.map((c) => src.calendar.events(c.raw.id, tMin, tMax, tz)));
  const events = [];
  lists.forEach((items, i) => {
    for (const e of items) {
      if (e.status === 'cancelled' || !e.start || !e.end) continue;
      const allDay = !!e.start.date;
      events.push({
        id: calendars[i].key + ':' + e.id,
        cal: calendars[i].key,
        title: String(e.summary || '(No title)').slice(0, 200),
        loc: e.location ? String(e.location).slice(0, 200) : '',
        allDay,
        start: allDay ? e.start.date : e.start.dateTime,
        end: allDay ? e.end.date : e.end.dateTime,
      });
    }
  });
  return { calendars, events };
}

// ------------------------------------------------------------------ Todoist projects
const ids = {};
const secs = {};
// Section names change rarely; keep them with the project ids for a few minutes.
async function sectionList(src, pid) {
  const hit = secs[pid];
  if (hit && Date.now() - hit.at < 600e3) return hit.list;
  const list = await src.todoist.sections(pid);
  secs[pid] = { list, at: Date.now() };
  return list;
}
async function projectId(src, name) {
  const hit = ids[name];
  if (hit && Date.now() - hit.at < 600e3) return hit.id;
  const p = (await src.todoist.projects()).find((x) => norm(x.name) === norm(name));
  if (!p) throw new Upstream('todoist-project', 404);
  ids[name] = { id: p.id, at: Date.now() };
  return p.id;
}

const dueDay = (t) => (t.due && t.due.date ? t.due.date.slice(0, 10) : null);
const firstLine = (s) => String(s || '').split('\n')[0].slice(0, 120);

// ------------------------------------------------------------------ chores
export async function chores(src, S) {
  const tz = S.timezone, today = ymd(tz);
  const pid = await projectId(src, S.todoist.choresProject);
  const [sections, active, done] = await Promise.all([
    sectionList(src, pid), src.todoist.tasks(pid), src.todoist.completed(pid, zoned(tz, today), new Date()),
  ]);
  const routineOf = {};
  for (const s of sections) {
    const r = S.routines.find((x) => norm(x.section || x.name) === norm(s.name));
    if (r) routineOf[s.id] = r.id;
  }
  const seen = new Set(), out = [];
  const shape = (t, isDone) => ({
    id: String(t.id),
    title: String(t.content || '').slice(0, 200),
    routine: routineOf[t.section_id] || null,
    labels: (t.labels || []).slice(0, 10),
    done: isDone,
    overdue: !isDone && dueDay(t) < today,
    order: t.child_order || 0,
  });
  for (const t of active) {
    const d = dueDay(t);
    if (!d || d > today) continue;
    seen.add(String(t.id));
    out.push(shape(t, false));
  }
  // A recurring chore done today is active again with a later due date, and also in the
  // completed list. If it is due again today (an overdue daily), the open copy above wins.
  for (const t of done) {
    const id = String(t.task_id || t.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(shape({ ...t, id }, true));
  }
  out.sort((a, b) => (b.overdue - a.overdue) || (a.order - b.order));
  return { chores: out };
}

// ------------------------------------------------------------------ shopping
function storeOf(S, labels) {
  for (const l of labels || []) {
    const s = S.stores.find((x) => norm(x.name) === norm(l) || (x.label && norm(x.label) === norm(l)));
    if (s) return s.name;
  }
  return 'Other';
}

export async function shopping(src, S) {
  const pid = await projectId(src, S.todoist.shoppingProject);
  const now = new Date();
  const [active, got] = await Promise.all([
    src.todoist.tasks(pid), src.todoist.completed(pid, new Date(now - 864e5), now),
  ]);
  const open = new Set(active.map((t) => String(t.id)));
  const listed = new Set(); // a task ticked, put back and ticked again has two completion records
  return {
    items: active
      .slice().sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)) || ((a.child_order || 0) - (b.child_order || 0)))
      .map((t) => ({ id: String(t.id), name: String(t.content || '').slice(0, 200), note: firstLine(t.description), store: storeOf(S, t.labels) })),
    got: got
      .map((t) => ({ ...t, id: String(t.task_id || t.id) }))
      .filter((t) => !open.has(t.id))
      .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
      .filter((t) => !listed.has(t.id) && listed.add(t.id))
      .map((t) => ({ id: t.id, name: String(t.content || '').slice(0, 200), store: storeOf(S, t.labels), at: t.completed_at })),
  };
}

// ------------------------------------------------------------------ writes (one item each)
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// The task, but only if it is in the given project (open, or completed since `since`).
async function ownTask(src, id, pid, since) {
  if (!ID.test(id)) throw new BadRequest('id');
  let t = null;
  try { t = await src.todoist.task(id); } catch (e) { if (!(e instanceof Upstream && e.status === 404)) throw e; }
  if (!t) {
    const c = (await src.todoist.completed(pid, since, new Date())).find((x) => String(x.task_id || x.id) === id);
    if (c) t = { ...c, id, checked: true };
  }
  if (!t || String(t.project_id) !== String(pid)) throw new NotFound('task');
  return t;
}

export async function setChore(src, S, id, done) {
  const tz = S.timezone, today = ymd(tz);
  const pid = await projectId(src, S.todoist.choresProject);
  const t = await ownTask(src, id, pid, zoned(tz, today));
  const recurring = !!(t.due && t.due.is_recurring);
  if (done) {
    if (!t.checked && (!dueDay(t) || dueDay(t) <= today)) await src.todoist.close(id);
  } else if (recurring) {
    // Only undo when the due date was moved past today by a completion.
    if (dueDay(t) > today) await src.todoist.uncompleteRecurring(id, { date: today, string: t.due.string });
  } else if (t.checked) {
    await src.todoist.reopen(id);
  }
}

export async function setItem(src, S, id, done) {
  const pid = await projectId(src, S.todoist.shoppingProject);
  const t = await ownTask(src, id, pid, new Date(Date.now() - 864e5));
  if (done && !t.checked) await src.todoist.close(id);
  if (!done && t.checked) await src.todoist.reopen(id);
}

export async function addItem(src, S, name, store) {
  // eslint-disable-next-line no-control-regex
  name = String(name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 120) throw new BadRequest('name');
  const s = store ? S.stores.find((x) => x.name === store) : null;
  if (store && !s) throw new BadRequest('store');
  const pid = await projectId(src, S.todoist.shoppingProject);
  const t = await src.todoist.create({ content: name, project_id: pid, labels: s ? [s.label || s.name] : [] });
  return { id: String(t.id), name, note: '', store: s ? s.name : 'Other' };
}

// ------------------------------------------------------------------ weather
const WX = [
  [[0], 'clear', 'Clear'], [[1, 2], 'partly', 'Partly cloudy'], [[3], 'cloud', 'Overcast'],
  [[45, 48], 'cloud', 'Fog'], [[51, 53, 55, 56, 57], 'rain', 'Drizzle'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'rain', 'Rain'], [[71, 73, 75, 77, 85, 86], 'snow', 'Snow'],
  [[95, 96, 99], 'rain', 'Thunderstorm'],
];
function cond(code, day) {
  const w = WX.find((x) => x[0].includes(code)) || WX[2];
  if (w[1] === 'clear') return { c: day ? 'sun' : 'moon', label: day ? 'Sunny' : 'Clear' };
  return { c: w[1], label: w[2] };
}
const round = (x) => (typeof x === 'number' ? Math.round(x) : null);

export async function weather(src, S) {
  const j = await src.weather(S.weather, S.timezone);
  const cur = j.current || {}, H = j.hourly || {}, D = j.daily || {};
  const hourNow = String(cur.time || '').slice(0, 13);
  let i0 = (H.time || []).findIndex((t) => t.slice(0, 13) === hourNow);
  if (i0 < 0) i0 = 0;
  const hours = [];
  for (let i = i0; i < Math.min(i0 + 24, (H.time || []).length); i++) {
    const c = cond(H.weather_code[i], H.is_day[i]);
    hours.push({ time: H.time[i], t: round(H.temperature_2m[i]), c: c.c, p: round(H.precipitation_probability[i]) || 0 });
  }
  const now = cond(cur.weather_code, cur.is_day);
  return {
    place: S.weather.name,
    now: { t: round(cur.temperature_2m), feels: round(cur.apparent_temperature), wind: round(cur.wind_speed_10m), c: now.c, label: now.label },
    hi: round((D.temperature_2m_max || [])[0]), lo: round((D.temperature_2m_min || [])[0]),
    hours,
  };
}
