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
// The due a completion (activity log entry) was for, local: "YYYY-MM-DD" + "THH:MM:SS".
const wasDueAt = (a) => String((a.extra_data || {}).completed_due_date_local || '');
const wasDue = (a) => wasDueAt(a).slice(0, 10) || null;

// The completion that moved a recurring chore past today: its latest one for a due date up to
// today (one ticked early doesn't count), unless the task changed after it. An untick or a
// reschedule sets updated_at; the close itself sets it within milliseconds of the log entry.
function todaysCompletion(log, t, today) {
  const last = log
    .filter((a) => String(a.object_id) === String(t.id) && wasDue(a) && wasDue(a) <= today)
    .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))[0];
  return last && Date.parse(t.updated_at) - Date.parse(last.event_date) < 5e3 ? last : null;
}
const firstLine = (s) => String(s || '').split('\n')[0].slice(0, 120);

// ------------------------------------------------------------------ chores
export async function chores(src, S) {
  const tz = S.timezone, today = ymd(tz);
  const pid = await projectId(src, S.todoist.choresProject);
  const start = zoned(tz, today);
  const [sections, active, done, log] = await Promise.all([
    sectionList(src, pid), src.todoist.tasks(pid), src.todoist.completed(pid, start, new Date()),
    // Without the log, recurring chores done today drop out; the rest still shows.
    src.todoist.completions(pid, start).catch((e) => { console.log('activity log', e && e.message); return []; }),
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
  // A recurring chore done today is active again with a later due date; only the activity log
  // says it was done. If it is still due today (an overdue daily, or unticked again), it is open.
  for (const t of active) {
    const d = dueDay(t);
    if (!d) continue;
    if (d <= today) out.push(shape(t, false));
    else if (t.due.is_recurring && todaysCompletion(log, t, today)) out.push(shape(t, true));
    else continue;
    seen.add(String(t.id));
  }
  for (const t of done) {
    if (seen.has(String(t.id))) continue;
    seen.add(String(t.id));
    out.push(shape(t, true));
  }
  out.sort((a, b) => (b.overdue - a.overdue) || (a.order - b.order));
  return { chores: out };
}

// ------------------------------------------------------------------ shopping
// A store is a section of the Shopping project or a label on the item; the section wins. Items
// in an "Other" section, or in none, can still carry a store label (Longo's in Other).
const isStore = (x, name) => norm(x.name) === norm(name) || (x.label && norm(x.label) === norm(name));
function storeOf(S, sectionName, labels) {
  for (const n of [sectionName, ...(labels || [])]) {
    const s = n && S.stores.find((x) => isStore(x, n));
    if (s) return s.name;
  }
  return 'Other';
}
async function sectionNames(src, pid) {
  const o = {};
  for (const s of await sectionList(src, pid)) o[s.id] = s.name;
  return o;
}

export async function shopping(src, S) {
  const pid = await projectId(src, S.todoist.shoppingProject);
  const now = new Date();
  const [secName, active, got] = await Promise.all([
    sectionNames(src, pid), src.todoist.tasks(pid), src.todoist.completed(pid, new Date(now - 864e5), now),
  ]);
  const store = (t) => storeOf(S, secName[t.section_id], t.labels);
  const open = new Set(active.map((t) => String(t.id)));
  const listed = new Set(); // a task ticked, put back and ticked again has two completion records
  return {
    items: active
      .slice().sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)) || ((a.child_order || 0) - (b.child_order || 0)))
      .map((t) => ({ id: String(t.id), name: String(t.content || '').slice(0, 200), note: firstLine(t.description), store: store(t) })),
    got: got
      .map((t) => ({ ...t, id: String(t.id) }))
      .filter((t) => !open.has(t.id))
      .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
      .filter((t) => !listed.has(t.id) && listed.add(t.id))
      .map((t) => ({ id: t.id, name: String(t.content || '').slice(0, 200), store: store(t), at: t.completed_at })),
  };
}

// ------------------------------------------------------------------ writes (one item each)
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// The task (open or completed), but only if it is in the given project.
async function ownTask(src, id, pid) {
  if (!ID.test(id)) throw new BadRequest('id');
  let t;
  try { t = await src.todoist.task(id); } catch (e) {
    if (e instanceof Upstream && (e.status === 404 || e.status === 400)) throw new NotFound('task');
    throw e;
  }
  if (!t || t.is_deleted || String(t.project_id) !== String(pid)) throw new NotFound('task');
  return t;
}

export async function setChore(src, S, id, done) {
  const tz = S.timezone, today = ymd(tz);
  const pid = await projectId(src, S.todoist.choresProject);
  const t = await ownTask(src, id, pid);
  const recurring = !!(t.due && t.due.is_recurring);
  if (done) {
    if (!t.checked && (!dueDay(t) || dueDay(t) <= today)) await src.todoist.close(id);
  } else if (recurring) {
    // Only undo when a completion today moved the due date past today: back to the due that
    // completion was for (overdue stays overdue; a timed chore keeps its local time).
    if (dueDay(t) <= today) return;
    const timed = t.due.date.length > 10;
    const last = todaysCompletion(await src.todoist.completions(pid, zoned(tz, today)), t, today);
    if (last) {
      await src.todoist.uncompleteRecurring(id, { date: timed ? wasDueAt(last) : wasDue(last), string: t.due.string });
    } else if (t.completed_count > 0 && Date.now() - Date.parse(t.updated_at) < 120e3) {
      // The log lags up to ~20 s behind a close: an untick right after a tick (the close set
      // updated_at) goes back to today, overdue or not.
      await src.todoist.uncompleteRecurring(id, { date: today + (timed && !t.due.timezone ? t.due.date.slice(10) : ''), string: t.due.string });
    }
  } else if (t.checked) {
    await src.todoist.reopen(id);
  }
}

export async function setItem(src, S, id, done) {
  const pid = await projectId(src, S.todoist.shoppingProject);
  const t = await ownTask(src, id, pid);
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
  // Into the store's section if the project has one (an "Other" section for no store), else
  // tagged with the store's label.
  const sec = (await sectionList(src, pid)).find((x) => (s ? isStore(s, x.name) : norm(x.name) === 'other'));
  const t = await src.todoist.create({
    content: name, project_id: pid,
    ...(sec ? { section_id: sec.id } : {}), labels: s && !sec ? [s.label || s.name] : [],
  });
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
