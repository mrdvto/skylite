import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendar } from './model.js';

const ALL = [
  { id: 'me@example.com', summary: 'me@example.com', primary: true, selected: true, backgroundColor: '#112233', foregroundColor: '#000000' },
  { id: 'kids@group.example', summary: 'Kids', selected: false, backgroundColor: '#445566', foregroundColor: '#FFFFFF' },
  { id: 'hol@group.example', summary: 'Holidays', selected: true },
  { id: 'fam@group.example', summary: 'Our crew', summaryOverride: 'Family', selected: true },
];
const src = { calendar: { calendars: async () => ALL, events: async (id) => [
  { id: 'e', summary: id, start: { date: '2026-11-09' }, end: { date: '2026-11-10' } },
] } };
const run = (S) => calendar(src, { timezone: 'America/Toronto', familyCalendar: 'Family', ...S }, '2026-11-09', '2026-11-10');
const names = (r) => r.calendars.map((c) => c.name);

test('no allow-list: every ticked calendar, under its Google name', async () => {
  assert.deepEqual(names(await run({})), ['Family', 'Holidays', 'me@example.com']);
  assert.deepEqual(names(await run({ calendars: [] })), ['Family', 'Holidays', 'me@example.com']);
});

test('allow-list: only listed calendars, ticked or not, renamed, in list order', async () => {
  const r = await run({ calendars: [{ match: 'Kids' }, { match: 'ME@example.com', name: 'Sam' }] });
  assert.deepEqual(names(r), ['Kids', 'Sam']);
  assert.equal(r.calendars[1].color, '#112233');
  assert.deepEqual(r.events.map((e) => e.title).sort(), ['kids@group.example', 'me@example.com']);
});

test('allow-list: matches a frame-side rename, and that calendar can be the family one', async () => {
  const r = await run({ calendars: [{ match: 'family' }] });
  assert.deepEqual(names(r), ['family']);
  assert.equal(r.calendars[0].family, true);
});

test('columns order wins over list order, using shown names', async () => {
  const r = await run({ columns: ['Sam', 'Kids'], calendars: [{ match: 'Kids' }, { match: 'me@example.com', name: 'Sam' }] });
  assert.deepEqual(names(r), ['Sam', 'Kids']);
});

test('names with no Latin letters match exactly, not each other', async () => {
  const cjk = { calendar: { ...src.calendar, calendars: async () => [
    { id: 'a', summary: '妈妈', selected: true }, { id: 'b', summary: '爸爸', selected: true },
  ] } };
  const r = await calendar(cjk, { timezone: 'America/Toronto', calendars: [{ match: '爸爸' }, {}] }, '2026-11-09', '2026-11-10');
  assert.deepEqual(names(r), ['爸爸']);
});

test('a listed calendar that does not exist is skipped, and one calendar never shows twice', async () => {
  const r = await run({ calendars: [{ match: 'Nope' }, { match: 'Kids' }, { match: 'kids@group.example', name: 'Again' }] });
  assert.deepEqual(names(r), ['Kids']);
});
