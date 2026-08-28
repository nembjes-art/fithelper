/* body.js — замеры сантиметром и фото прогресса.
   Вес врёт неделями: вода, соль, гликоген. Талия не врёт. */
import { S, todayISO, addDays, daysBetween } from './store.js';

export const FIELDS = [
  { id: 'waist', name: 'Талия',  hint: 'На уровне пупка, не втягивая живот. Главная цифра — по ней видно жир на животе.', main: true },
  { id: 'belly', name: 'Живот',  hint: 'Самая широкая точка. Обычно на 3–5 см ниже талии.' },
  { id: 'chest', name: 'Грудь',  hint: 'По самой широкой части, руки опущены.' },
  { id: 'hips',  name: 'Бёдра',  hint: 'По самым выступающим точкам ягодиц.' },
  { id: 'neck',  name: 'Шея',    hint: 'Под кадыком. Нужна для оценки процента жира.' },
  { id: 'thigh', name: 'Бедро',  hint: 'Одно бедро, в верхней трети. Мерь всегда одну и ту же ногу.' },
  { id: 'arm',   name: 'Рука',   hint: 'Бицепс в напряжении, всегда одна и та же рука.' }
];

export function latest(){
  const m = S.measures || [];
  return m.length ? m[m.length - 1] : null;
}

export function previous(){
  const m = S.measures || [];
  return m.length > 1 ? m[m.length - 2] : null;
}

export function first(){
  const m = S.measures || [];
  return m.length ? m[0] : null;
}

/* Насколько изменился замер: от прошлого раза и от самого начала */
export function delta(field){
  const l = latest(), p = previous(), f = first();
  if (!l || l[field] == null) return null;
  return {
    now: l[field],
    fromPrev: (p && p[field] != null) ? +(l[field] - p[field]).toFixed(1) : null,
    fromStart: (f && f !== l && f[field] != null) ? +(l[field] - f[field]).toFixed(1) : null,
    days: (f && f !== l) ? daysBetween(f.date, l.date) : 0
  };
}

/* Процент жира по формуле ВМФ США: талия, шея и рост.
   Точность ±3–4%, но динамика ловится верно — а нужна именно динамика. */
export function bodyFat(m, heightCm){
  const rec = m || latest();
  const h = heightCm || S.profile.height;
  if (!rec || !h) return null;
  const waist = Number(rec.waist), neck = Number(rec.neck);
  if (!(waist > 0) || !(neck > 0) || waist <= neck) return null;
  const male = S.profile.sex !== 'f';
  let pct;
  if (male){
    pct = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
  } else {
    const hips = Number(rec.hips);
    if (!(hips > 0)) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.22100 * Math.log10(h)) - 450;
  }
  if (!isFinite(pct) || pct < 3 || pct > 70) return null;
  return Math.round(pct * 10) / 10;
}

/* Сухая масса — то, что нельзя терять. */
export function leanMass(weightKg, m){
  const bf = bodyFat(m);
  if (bf == null || !(weightKg > 0)) return null;
  return Math.round(weightKg * (1 - bf / 100) * 10) / 10;
}

/* Давно ли мерился */
export function daysSince(){
  const l = latest();
  return l ? daysBetween(l.date, todayISO()) : null;
}

/* Пора ли мериться: раз в две недели достаточно, чаще — шум */
export function isDue(){
  const d = daysSince();
  return d == null || d >= 14;
}

/* История одного замера для графика */
export function history(field, limit){
  return (S.measures || [])
    .filter(function(m){ return m[field] != null; })
    .slice(-(limit || 12))
    .map(function(m){ return { date: m.date, v: m[field] }; });
}

/* ---------- фото ---------- */
export function photos(){ return S.photos || []; }

export function photoPair(){
  const p = photos();
  if (p.length < 2) return null;
  return { now: p[0], then: p[p.length - 1] };
}

export function photoDue(){
  const p = photos();
  if (!p.length) return true;
  return daysBetween(p[0].date, todayISO()) >= 14;
}
