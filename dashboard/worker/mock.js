// Mock source for local runs (`wrangler dev --var MOCK:1`) until the frame's Google and Todoist
// accounts exist. It answers in the same raw shapes as the live APIs, so model.js is exercised
// unchanged. State lives in this isolate's memory and resets each day / restart.
import { Upstream } from './sources.js';
import { addDays, ymd, zoned } from './time.js';

const CALS = [
  { id: 'wes@example.com', summary: 'Wes', backgroundColor: '#2D5BFF', foregroundColor: '#FFFFFF', selected: true },
  { id: 'claudia@example.com', summary: 'Claudia', backgroundColor: '#E4007C', foregroundColor: '#FFFFFF', selected: true },
  { id: 'buzzsaw@example.com', summary: 'Buzzsaw', backgroundColor: '#00A36C', foregroundColor: '#FFFFFF', selected: true },
  { id: 'skidmark@example.com', summary: 'Skidmark', backgroundColor: '#FFB000', foregroundColor: '#111111', selected: true },
  // Like the real account: shared calendars keep the owner's name unless renamed in the frame
  // account (summaryOverride), and Google's palette colours come with black ink.
  { id: 'family@example.com', summary: 'Our crew', summaryOverride: 'Family', backgroundColor: '#C2C2C2', foregroundColor: '#000000', selected: true },
  { id: 'frame@example.com', summary: 'frame@example.com', backgroundColor: '#999999', foregroundColor: '#000000', selected: false, primary: true },
];
const W = 'wes@example.com', C = 'claudia@example.com', B = 'buzzsaw@example.com', K = 'skidmark@example.com', F = 'family@example.com';

// [day offset, start, end, title, calendar, location]; start null = all day, end = days
const EVENTS = [
  [0, null, 1, 'Pajama Day at school', K], [0, null, 1, 'Garbage + recycling night', F],
  [0, '07:00', '07:45', 'Gym', C, 'Iron Works'], [0, '08:15', '08:40', 'School drop-off', W, 'Parkdale Elementary'],
  [0, '09:30', '10:30', 'Design review', C, 'Office · Room 4B'], [0, '12:00', '12:45', 'Dentist', B, 'Bright Smiles Dental'],
  [0, '13:00', '14:00', 'Lunch with Sam', W, 'Café Rustica'], [0, '15:45', '16:30', 'Piano lesson', K, "Ms. Park's Studio"],
  [0, '16:05', '16:30', 'Drive Buzzsaw to soccer', C], [0, '16:30', '18:00', 'Soccer practice', B, 'Lakeshore Fields'],
  [0, '17:00', '17:30', 'Parent–teacher call', W, 'Zoom'], [0, '18:30', '19:30', "Dinner at Nonna's", F, "Nonna's"],
  [0, '20:00', '20:30', 'Bath + books', K],
  [1, null, 3, 'Wes in Montréal', W], [1, '07:00', '07:45', 'Gym', C], [1, '10:30', '11:15', 'Vet — Biscuit', C],
  [1, '15:30', '16:30', 'Art club', B], [1, '16:00', '18:00', 'Playdate with Leo', K], [1, '19:00', '21:00', 'Book club', C],
  [2, '09:00', '14:00', 'Science Centre trip', K], [2, '13:00', '13:45', 'Haircuts', B], [2, '18:00', '19:30', 'Pizza night', F],
  [3, '10:00', '10:45', 'Swim lessons', K], [3, '13:00', '15:30', "Zoe's birthday party", B], [3, '19:00', '21:00', 'Movie night', F],
  [4, '10:30', '12:00', 'Sunday brunch', F], [4, '17:05', '18:20', 'Flight home · AC 418', W],
  [5, '07:00', '07:45', 'Gym', C], [5, '19:00', '20:00', 'Yoga', C], [6, null, 2, 'Grandma visits', F],
  [12, null, 1, "Buzzsaw's birthday 🎂", F], [-8, null, 3, 'Cottage weekend', F],
];

// [section, person label or '', title, recurring, done, overdue]
const CHORES = [
  ['Morning', 'Buzzsaw', '🛏️ Make bed', 1, 1], ['Morning', 'Buzzsaw', '🪥 Brush teeth', 1, 1], ['Morning', 'Buzzsaw', '🎒 Pack backpack', 1, 0],
  ['Morning', 'Skidmark', '🛏️ Make bed', 1, 1], ['Morning', 'Skidmark', '👕 Get dressed', 1, 0], ['Morning', 'Wes', '🚗 School drop-off', 1, 1],
  ['Morning', 'Claudia', '🥪 Pack lunches', 1, 1], ['Morning', '', '🐶 Feed Biscuit', 1, 1],
  ['After school', 'Buzzsaw', '🥪 Unpack lunchbox', 1, 1], ['After school', 'Buzzsaw', '📚 Homework', 1, 0], ['After school', 'Buzzsaw', '⚽ Pack soccer bag', 0, 0],
  ['After school', 'Skidmark', '📖 Read for 20 min', 1, 0], ['After school', 'Skidmark', '🎹 Practice piano', 1, 0], ['After school', 'Skidmark', '🧱 Tidy the Lego', 0, 0],
  ['After school', 'Wes', '♻️ Take out recycling', 0, 0, 1], ['After school', 'Wes', '☎️ Call the plumber', 0, 1],
  ['After school', 'Claudia', '🧺 Fold laundry', 0, 0], ['After school', '', '🪴 Water the plants', 1, 0], ['After school', '', '🍽️ Empty dishwasher', 1, 0],
  ['Evening', 'Buzzsaw', '🍴 Set the table', 1, 0], ['Evening', 'Buzzsaw', '🚿 Shower', 1, 0], ['Evening', 'Skidmark', '🛁 Bath', 1, 0],
  ['Evening', 'Wes', '🔐 Lock up', 1, 0], ['Evening', 'Claudia', '🫧 Run dishwasher', 1, 0], ['Evening', '', '🗑️ Garbage to curb', 0, 0],
];
// Chores sections, as in the frame account: they only order the list, nothing groups by them.
const CHORE_SECTIONS = ['Morning', 'After school', 'Evening'];
// Shopping sections, as in the frame account; stores without one are labels.
const SHOP_SECTIONS = ['No Frills', 'T&T', 'Costco', 'Other'];
// [name, section or '', store label or '', done (got it)]
const SHOPPING = [
  ['Bananas', 'No Frills'], ['Baby spinach', 'No Frills'], ['Avocados', 'No Frills'], ['Bok choy', 'T&T'], ['Dumplings', 'T&T'],
  ['Milk 2%', 'Costco'], ['Eggs', 'Costco'], ['Paper towels', 'Costco'], ['Sourdough loaf', 'Other', "Longo's"], ['Toothpaste', '', 'Shoppers'],
  ['Coffee beans', 'Other'], ['Dish soap', ''], ['Lemons', 'No Frills', '', 1], ['Butter', 'Costco', '', 1],
];

let state = null;

function build(tz) {
  const today = ymd(tz), now = Date.now();
  // completions: the completed list (one-off tasks only); log: activity log "completed" events.
  const st = { day: today, n: 0, events: [], tasks: [], completions: [], log: [] };
  const id = () => String(1000 + ++st.n);
  for (const [d, s, e, title, cal, loc] of EVENTS) {
    const day = addDays(today, d);
    st.events.push(s
      ? { cal, id: 'm' + id(), status: 'confirmed', summary: title, location: loc, start: { dateTime: zoned(tz, day, ...s.split(':').map(Number)).toISOString() }, end: { dateTime: zoned(tz, day, ...e.split(':').map(Number)).toISOString() } }
      : { cal, id: 'm' + id(), status: 'confirmed', summary: title, location: loc, start: { date: day }, end: { date: addDays(day, e) } });
  }
  // Background recurring events so Month has texture.
  for (let d = -40; d <= 45; d++) {
    if (d >= 0 && d <= 6) continue;
    const day = addDays(today, d), dow = new Date(day + 'T12:00:00Z').getUTCDay();
    const add = (s, e, title, cal) => st.events.push({ cal, id: 'm' + id(), status: 'confirmed', summary: title, start: { dateTime: zoned(tz, day, ...s).toISOString() }, end: { dateTime: zoned(tz, day, ...e).toISOString() } });
    if (dow === 1) add([15, 45], [16, 30], 'Piano lesson', K);
    if (dow === 2 || dow === 4) add([16, 30], [18, 0], 'Soccer practice', B);
    if (dow === 3) add([19, 0], [20, 0], 'Yoga', C);
    if (dow === 0) add([17, 30], [19, 30], "Dinner at Nonna's", F);
    if (d % 9 === 0) add([12, 0], [13, 0], 'Lunch meeting', W);
  }
  CHORES.forEach(([sec, who, title, rec, done, overdue], i) => {
    const t = {
      id: id(), project_id: 'p-chores', section_id: 's-' + sec, content: title, description: '',
      labels: who ? [who] : [], child_order: i, checked: false, added_at: new Date(now - 864e5 * 30).toISOString(),
      due: { date: overdue ? addDays(today, -1) : today, is_recurring: !!rec, string: rec ? 'every day' : '' },
    };
    st.tasks.push(t);
    if (done) close(st, t, tz, now - 3600e3);
  });
  SHOPPING.forEach(([name, sec, label, done], i) => {
    const t = {
      id: id(), project_id: 'p-shop', section_id: sec ? 's-' + sec : null, content: name, description: '', labels: label ? [label] : [],
      child_order: i, checked: false, added_at: new Date(now - 864e5 * 3 + i * 60e3).toISOString(), due: null,
    };
    st.tasks.push(t);
    if (done) close(st, t, tz, now - 7200e3);
  });
  return st;
}

// Like Todoist: a recurring task moves to its next date and shows up only in the activity log; a
// one-off task is checked and listed as completed (same id) until reopened.
function close(st, t, tz, at) {
  const when = new Date(at).toISOString();
  t.updated_at = when;
  t.completed_count = (t.completed_count || 0) + 1;
  st.log.push({ event_type: 'completed', object_type: 'item', object_id: t.id, parent_project_id: t.project_id, event_date: when,
    extra_data: { content: t.content, completed_due_date_local: (t.due ? t.due.date.slice(0, 10) : ymd(tz)) + 'T23:59:59', is_recurring: !!(t.due && t.due.is_recurring) } });
  if (t.due && t.due.is_recurring) { t.due = { ...t.due, date: addDays(t.due.date > ymd(tz) ? t.due.date : ymd(tz), 1) }; return; }
  t.checked = true;
  t.completed_at = when;
  st.completions.push({ ...t });
}

function weatherJson(tz) {
  const T = [9, 9, 8, 8, 8, 8, 9, 10, 11, 12, 13, 15, 16, 17, 16, 15, 14, 13, 12, 12, 11, 10, 10, 9];
  const C = [0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 2, 2, 3, 3, 3, 61, 63, 61, 61, 3, 3, 0, 0];
  const P = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 10, 20, 25, 40, 80, 90, 70, 55, 20, 10, 0, 0];
  const today = ymd(tz), tomorrow = addDays(today, 1);
  const h = +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const time = [], t = [], c = [], p = [], day = [];
  for (const d of [today, tomorrow]) for (let i = 0; i < 24; i++) {
    time.push(d + 'T' + String(i).padStart(2, '0') + ':00'); t.push(T[i] + 0.3); c.push(C[i]); p.push(P[i]); day.push(i >= 7 && i < 18 ? 1 : 0);
  }
  return {
    current: { time: today + 'T' + String(h).padStart(2, '0') + ':15', temperature_2m: T[h], apparent_temperature: T[h] - 3, weather_code: C[h], is_day: day[h], wind_speed_10m: 18 },
    hourly: { time, temperature_2m: t, weather_code: c, precipitation_probability: p, is_day: day },
    daily: { temperature_2m_max: [17, 15], temperature_2m_min: [8, 6] },
  };
}

export function mockSource(S) {
  const tz = S.timezone;
  const st = () => (state && state.day === ymd(tz) ? state : (state = build(tz)));
  const find = (id) => st().tasks.find((t) => t.id === id);
  return {
    calendar: {
      calendars: async () => CALS.map(({ ...c }) => c),
      events: async (cal, tMin, tMax) => st().events
        .filter((e) => e.cal === cal)
        .filter((e) => {
          const s = e.start.dateTime ? Date.parse(e.start.dateTime) : +zoned(tz, e.start.date);
          const en = e.end.dateTime ? Date.parse(e.end.dateTime) : +zoned(tz, e.end.date);
          return s < +tMax && en > +tMin;
        }),
    },
    todoist: {
      projects: async () => [{ id: 'p-chores', name: S.todoist.choresProject }, { id: 'p-shop', name: S.todoist.shoppingProject }],
      sections: async (pid) => (pid === 'p-chores' ? CHORE_SECTIONS : SHOP_SECTIONS).map((n, i) => ({ id: 's-' + n, name: n, section_order: i + 1 })),
      tasks: async (pid) => st().tasks.filter((t) => t.project_id === pid && !t.checked),
      completed: async (pid, since, until) => st().completions.filter((c) => c.project_id === pid && Date.parse(c.completed_at) >= +since && Date.parse(c.completed_at) <= +until).map((c) => ({ ...c })),
      completions: async (pid, since) => st().log.filter((a) => a.parent_project_id === pid && Date.parse(a.event_date) >= +since).reverse(),
      task: async (id) => { const t = find(id); if (!t) throw new Upstream('todoist', 404); return { ...t }; },
      close: async (id) => { const t = find(id); if (!t) throw new Upstream('todoist', 404); close(st(), t, tz, Date.now()); return null; },
      reopen: async (id) => {
        const t = find(id);
        if (!t) throw new Upstream('todoist', 404);
        t.checked = false;
        t.completed_at = null;
        st().completions = st().completions.filter((c) => c.id !== id);
        return null;
      },
      create: async (f) => {
        const t = { id: String(1000 + ++st().n), project_id: f.project_id, section_id: f.section_id || null, content: f.content, description: '', labels: f.labels || [], child_order: 999, checked: false, added_at: new Date().toISOString(), due: null };
        st().tasks.push(t);
        return t;
      },
      // Todoist keeps the "completed" log entry and logs an "updated" one; only the date moves back.
      uncompleteRecurring: async (id, due) => {
        const t = find(id);
        if (!t) throw new Upstream('todoist', 404);
        if (!due || !due.date) throw new Upstream('todoist-sync', 422);
        t.due = { ...t.due, date: due.date };
        t.completed_count = Math.max(0, (t.completed_count || 1) - 1);
        t.updated_at = new Date().toISOString();
      },
    },
    weather: async () => weatherJson(tz),
  };
}
