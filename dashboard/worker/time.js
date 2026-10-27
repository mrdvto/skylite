// Wall-clock helpers in the household's time zone (the Worker itself runs in UTC).

const partsFmt = {};
function parts(tz, date) {
  const f = partsFmt[tz] || (partsFmt[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// Local date "YYYY-MM-DD" of an instant.
export function ymd(tz, date = new Date()) {
  const p = parts(tz, date);
  return p.year + '-' + p.month + '-' + p.day;
}

// Milliseconds the zone is ahead of UTC at an instant.
function offset(tz, date) {
  const p = parts(tz, date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant of a local date + time ("YYYY-MM-DD", hours, minutes) in the zone.
export function zoned(tz, day, h = 0, m = 0) {
  const [y, mo, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, m);
  let t = wall - offset(tz, new Date(wall));
  t = wall - offset(tz, new Date(t)); // second pass settles DST edges
  return new Date(t);
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
}
