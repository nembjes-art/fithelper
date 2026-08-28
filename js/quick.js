/* quick.js — запись еды в один тап.
   Три источника: блюда сегодняшнего рациона, то что ты ешь чаще всего,
   и вчерашний день целиком. Плюс упаковка по штрихкоду. */
import { S, todayISO, addDays } from './store.js';
import * as E from './engine.js';

/* ---------- блюда из рациона на сегодня ---------- */
export function planToday(date){
  const d = date || todayISO();
  if (!S.mealPlan.enabled) return [];
  const day = (S.mealPlan.assign || {})[String(E.dowOf(d))] || {};
  const slots = ['breakfast','lunch','snack','dinner'];
  const ids = slots.map(function(sl){ return day[sl]; });
  const base = ids.reduce(function(a, id){ return a + ((E.BY_ID(id) || {}).kcal || 0); }, 0);
  const tg = E.targets();
  // Масштабируем порции под дневной лимит только когда назначены ВСЕ приёмы пищи.
  // Иначе при одном заполненном слоте коэффициент раздувал завтрак до 1800 ккал.
  const full = ids.every(Boolean);
  const k = (full && base) ? tg.kcal / base : 1;
  const eaten = S.foodFor(d).map(function(f){ return String(f.name).toLowerCase(); });

  return slots.map(function(sl, i){
    const r = E.BY_ID(ids[i]);
    if (!r) return null;
    return {
      key: 'plan:' + sl + ':' + r.id,   // слот в ключе: одно блюдо может стоять и на завтрак, и на ужин
      slot: sl,
      name: r.name,
      grams: Math.round((r.ing || []).reduce(function(a, x){ return a + (x[2] === 'г' ? x[1] : 0); }, 0) * k) || 0,
      kcal: Math.round(r.kcal * k),
      p: +(r.p * k).toFixed(1), f: +(r.f * k).toFixed(1), c: +(r.c * k).toFixed(1),
      done: eaten.indexOf(r.name.toLowerCase()) >= 0
    };
  }).filter(Boolean);
}

/* ---------- то, что ты ешь чаще всего ----------
   Ничего не храним отдельно: считаем прямо из дневника. */
export function recentFoods(limit){
  const byName = Object.create(null);   // без прототипа: блюдо с именем «constructor» иначе теряется
  const log = S.food || [];
  for (let i = log.length - 1; i >= 0; i--){
    const f = log[i];
    if (!f || !f.name || !(f.kcal > 0)) continue;
    const key = String(f.name).trim().toLowerCase();
    if (!byName[key]){
      byName[key] = {
        key: 'recent:' + key,
        name: f.name, grams: f.grams || 0, kcal: f.kcal,
        p: f.p || 0, f: f.f || 0, c: f.c || 0,
        uses: 0, last: f.date
      };
    }
    byName[key].uses++;
  }
  const fav = (S.favorites || []).reduce(function(a, n){ a[n] = 1; return a; }, Object.create(null));
  return Object.keys(byName).map(function(k){
    const it = byName[k];
    it.fav = !!fav[k];
    return it;
  }).sort(function(a, b){
    if (a.fav !== b.fav) return a.fav ? -1 : 1;
    if (a.uses !== b.uses) return b.uses - a.uses;
    return a.last < b.last ? 1 : -1;
  }).slice(0, limit || 12);
}

export function isFav(name){
  return (S.favorites || []).indexOf(String(name).trim().toLowerCase()) >= 0;
}

/* ---------- вчерашний день целиком ---------- */
export function yesterday(date){
  const y = addDays(date || todayISO(), -1);
  return S.foodFor(y);
}

/* ---------- запись ---------- */
export function log(item){
  return S.addFood({
    name: item.name, grams: item.grams || 0, kcal: item.kcal,
    p: item.p || 0, f: item.f || 0, c: item.c || 0,
    src: item.src || 'quick'
  });
}

export function logAll(items){
  return (items || []).map(function(i){ return log(i); });
}

/* ---------- штрихкод: Open Food Facts ----------
   Бесплатная открытая база, работает без ключа. Много балтийских товаров. */
export function lookupBarcode(code){
  const c = String(code || '').replace(/\D/g, '');
  if (c.length < 8) return Promise.resolve(null);
  const url = 'https://world.openfoodfacts.org/api/v2/product/' + c +
    '.json?fields=product_name,product_name_ru,brands,quantity,serving_size,nutriments';
  // Отдельно ловим «нет сети» — иначе офлайн неотличим от «товара нет в базе»,
  // и человек в подвале магазина зря тратит запросы к ИИ.
  if (typeof navigator !== 'undefined' && navigator.onLine === false){
    return Promise.reject(new Error('offline'));
  }
  const opts = { headers: { 'Accept': 'application/json' } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000);
  return fetch(url, opts)
    .then(function(r){
      if (!r.ok) return null;
      const ct = r.headers.get('content-type') || '';
      // сервис-воркер на неудачном кросс-доменном запросе может отдать index.html
      if (ct.indexOf('json') < 0) return null;
      return r.json();
    })
    .then(function(j){
      if (!j || j.status !== 1 || !j.product) return null;
      const p = j.product, n = p.nutriments || {};
      const per100 = {
        kcal: Math.round(n['energy-kcal_100g'] || (n.energy_100g ? n.energy_100g / 4.184 : 0)),
        p: +(Number(n.proteins_100g) || 0).toFixed(1),
        f: +(Number(n.fat_100g) || 0).toFixed(1),
        c: +(Number(n.carbohydrates_100g) || 0).toFixed(1),
        fiber: +(Number(n.fiber_100g) || 0).toFixed(1)
      };
      if (!(per100.kcal > 0)) return null;
      const name = [p.brands ? String(p.brands).split(',')[0].trim() : '', p.product_name_ru || p.product_name || '']
        .filter(Boolean).join(' ').trim();
      return {
        source: 'off', code: c,
        name: name || ('Товар ' + c),
        quantity: p.quantity || '',
        serving: p.serving_size || '',
        per100: per100
      };
    })
    .catch(function(e){
      if (e && e.message === 'offline') throw e;
      return null;
    });
}

/* Пересчёт «на 100 г» в порцию */
export function portion(per100, grams){
  const k = (Number(grams) || 0) / 100;
  return {
    grams: Math.round(Number(grams) || 0),
    kcal: Math.round((per100.kcal || 0) * k),
    p: +((per100.p || 0) * k).toFixed(1),
    f: +((per100.f || 0) * k).toFixed(1),
    c: +((per100.c || 0) * k).toFixed(1)
  };
}
