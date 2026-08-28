/* remind.js — напоминания.
   Safari не даёт веб-приложению слать пуши, поэтому расписание выгружается
   в календарь телефона: будильники будет ставить он, а не мы. */
import { S, todayISO, addDays } from './store.js';
import * as E from './engine.js';

/* Что выносим в календарь.
   level 1 — только главное, чтобы календарь не превратился в кашу.
   level 2 — весь день целиком. */
const KINDS = {
  meal:  { alarm: 5,  level: 1 },
  train: { alarm: 15, level: 1 },
  supp:  { alarm: 0,  level: 1 },
  cook:  { alarm: 30, level: 1 },
  sleep: { alarm: 20, level: 1 },
  weigh: { alarm: 0,  level: 2 },
  walk:  { alarm: 10, level: 2 },
  water: { alarm: 0,  level: 3 }        // воды 5–6 раз в день, календарь захлебнётся
};
// у подъёма kind тот же, что у отбоя, а напоминать за 20 минут до подъёма бессмысленно
const NO_ALARM = { wake: true, weigh: true, eatstop: true };

function pad(n){ return String(n).padStart(2, '0'); }

/* Локальное время в формате календаря, без часового пояса:
   так событие встанет ровно на то время, которое показано в приложении. */
function stamp(dateISO, hhmm){
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return dateISO.replace(/-/g, '') + 'T' + pad(h || 0) + pad(m || 0) + '00';
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/* Длинные описания в календаре читать невозможно — режем до сути. */
function shortDesc(t){
  const s = String(t || '').trim();
  const dot = s.indexOf('. ');
  const cut = dot > 30 ? s.slice(0, dot + 1) : s;
  return cut.length > 180 ? cut.slice(0, 177) + '…' : cut;
}

function fold(line){
  // по стандарту строка календаря не длиннее 75 байт
  const out = [];
  let s = line;
  while (Buffer_len(s) > 73){
    let cut = 73;
    while (cut > 1 && Buffer_len(s.slice(0, cut)) > 73) cut--;
    out.push(s.slice(0, cut));
    s = ' ' + s.slice(cut);
  }
  out.push(s);
  return out.join('\r\n');
}
function Buffer_len(s){ return new TextEncoder().encode(s).length; }

export function events(days, level){
  const n = Math.max(1, Math.min(31, days || 7));
  const lv = level || 1;
  const out = [];
  for (let i = 0; i < n; i++){
    const d = addDays(todayISO(), i);
    const slots = E.buildDay(d);
    slots.forEach(function(sl){
      const rule = KINDS[sl.kind];
      if (!rule || rule.level > lv) return;
      out.push({
        uid: 'fh-' + d + '-' + sl.id,
        date: d,
        time: sl.time,
        minutes: sl.minutes || (sl.kind === 'meal' ? 20 : 10),
        title: sl.title,
        desc: shortDesc(sl.desc),
        alarm: NO_ALARM[sl.id] ? 0 : rule.alarm
      });
    });
  }
  return out;
}

export function ics(days, level){
  const evs = events(days, level);
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fithelper//RU',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Похудение', 'X-WR-TIMEZONE:Europe/Tallinn'
  ];
  evs.forEach(function(e){
    const startM = E.toMin(e.time);
    const end = E.toHHMM(Math.min(startM + e.minutes, 23 * 60 + 59));
    L.push('BEGIN:VEVENT');
    L.push('UID:' + e.uid + '@fithelper');
    L.push('DTSTAMP:' + now);
    // без часового пояса: телефон поставит событие на местное время
    L.push('DTSTART:' + stamp(e.date, e.time));
    L.push('DTEND:' + stamp(e.date, end));
    L.push(fold('SUMMARY:' + esc(e.title)));
    if (e.desc) L.push(fold('DESCRIPTION:' + esc(e.desc)));
    if (e.alarm >= 0){
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        fold('DESCRIPTION:' + esc(e.title)),
        'TRIGGER:-PT' + (e.alarm || 0) + 'M', 'END:VALARM');
    }
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

export function download(days, level){
  const blob = new Blob([ics(days, level)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fithelper-' + todayISO() + '.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  return events(days, level).length;
}

/* Сколько напоминаний получится — чтобы показать до выгрузки */
export function summary(days, level){
  const evs = events(days, level);
  const names = [];
  evs.forEach(function(e){ if (names.indexOf(e.title) < 0) names.push(e.title); });
  return {
    count: evs.length, days: days,
    perDay: Math.round(evs.length / days),
    names: names.slice(0, 8)
  };
}
