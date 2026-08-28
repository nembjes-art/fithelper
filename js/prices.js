/* prices.js — цены в магазинах Нарвы.
   Источники: prices.json (обновляется автоматически) + листовки, снятые на камеру.
   Приоритет магазинов: Maxima → Lidl → Rimi. */
import { S, todayISO } from './store.js';

const PRIORITY = { maxima: 1, lidl: 2, rimi: 3 };

/* Ингредиент из рецепта → категория в базе цен.
   Ключи сравниваются по вхождению в нижнем регистре, первый подошедший выигрывает. */
const MATCH = [
  ['куриная грудка',            'курица_грудка'],
  ['фарш куриный',              'фарш_куриный'],
  ['фарш индейки',              'фарш_индейки'],
  ['филе индейки',              'индейка'],
  ['индейк',                    'индейка'],
  ['говядина',                  'говядина'],
  ['свинин',                    'свинина'],
  ['филе лосося',               'лосось'],
  ['лосос',                     'лосось'],
  ['филе трески',               'треска'],
  ['треск',                     'треска'],
  ['белки яичные',              'белки_яичные'],
  ['яйц',                       'яйца'],
  ['скир или творог',           'творог'],
  ['творог',                    'творог'],
  ['скир',                      'творог'],
  ['йогурт',                    'йогурт'],
  ['сыр',                       'сыр'],
  ['масло сливочное',           'масло_сливочное'],
  ['масло оливковое',           'масло_оливковое'],
  ['овсян',                     'овсянка'],
  ['овсяные хлопья',            'овсянка'],
  ['рис',                       'рис'],
  ['гречк',                     'гречка'],
  ['булгур',                    'булгур'],
  ['киноа',                     'киноа'],
  ['картоф',                    'картофель'],
  ['ягод',                      'ягоды'],
  ['брокколи',                  'брокколи'],
  ['овощная смесь',             'овощная_смесь'],
  ['овощи на гарнир',           'овощная_смесь'],
  ['овощи запеч',               'овощная_смесь'],
  ['морковь и лук',             'морковь_лук'],
  ['лук и морковь',             'морковь_лук'],
  ['лук и перец',               'морковь_лук'],
  ['перец и шпинат',            'перец_шпинат'],
  ['кабачок и перец',           'кабачок_перец'],
  ['огурцы и помидоры',         'огурцы_помидоры'],
  ['огурец',                    'огурцы_помидоры'],
  ['помидор',                   'огурцы_помидоры'],
  ['томаты в собственном',      'томаты_консерв'],
  ['фасоль',                    'фасоль'],
  ['миндаль',                   'орехи'],
  ['орех',                      'орехи'],
  ['яблоко',                    'фрукты'],
  ['банан',                     'фрукты'],
  ['груша',                     'фрукты'],
  ['протеин',                   'протеин']
];

export function keyFor(name){
  const n = String(name || '').toLowerCase();
  for (let i = 0; i < MATCH.length; i++){
    if (n.indexOf(MATCH[i][0]) >= 0) return MATCH[i][1];
  }
  return null;
}

/* ---------- загрузка базы ---------- */
let DB = null;          // {updated, stores, items}
let loading = null;

export function db(){ return DB; }

export function loadPrices(){
  if (DB) return Promise.resolve(DB);
  if (loading) return loading;
  loading = fetch('./prices.json', { cache: 'no-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){ DB = j || { updated: null, stores: {}, items: [] }; return DB; })
    .catch(function(){ DB = { updated: null, stores: {}, items: [] }; return DB; });
  return loading;
}

/* Позиции из листовок пользователя — они свежее автоматической базы. */
function flyerItems(){
  const out = [];
  (S.flyers || []).forEach(function(f){
    (f.items || []).forEach(function(it){
      if (!it || !it.key || !(it.per > 0)) return;
      out.push({
        key: it.key, store: f.store || 'lidl',
        product: it.product || '', price: it.price, pack: it.pack || '',
        per: it.per, base: it.base || 'кг',
        old: it.old || null, until: f.until || null,
        note: it.note || '', fromFlyer: true, flyerDate: f.added
      });
    });
  });
  return out;
}

function expired(it){
  if (!it.until) return false;
  return it.until < todayISO();
}

export function allItems(){
  const base = (DB && DB.items) ? DB.items : [];
  return flyerItems().concat(base).filter(function(it){ return !expired(it); });
}

export function storeName(id){
  const st = (DB && DB.stores && DB.stores[id]) || null;
  return st ? st.name : (id ? id[0].toUpperCase() + id.slice(1) : '—');
}

/* Все варианты по категории, от дешёвого к дорогому.
   При равной цене выигрывает магазин с более высоким приоритетом. */
export function optionsFor(key){
  if (!key) return [];
  return allItems()
    .filter(function(it){ return it.key === key; })
    .sort(function(a, b){
      if (a.per !== b.per) return a.per - b.per;
      return (PRIORITY[a.store] || 9) - (PRIORITY[b.store] || 9);
    });
}

export function bestFor(key){
  const o = optionsFor(key);
  return o.length ? o[0] : null;
}

/* ---------- корзина ---------- */

/* Сколько базовых единиц нужно: г/кг → кг, шт → шт. */
function toBase(qty, unit, base){
  const u = String(unit || '').toLowerCase();
  if (base === 'шт') return u === 'шт' ? qty : qty / 60;   // 60 г ≈ 1 яйцо
  if (u === 'кг') return qty;
  if (u === 'г')  return qty / 1000;
  if (u === 'мл') return qty / 1000;
  if (u === 'л')  return qty;
  if (u === 'шт') return qty * 0.15;                        // штука ≈ 150 г
  return qty;
}

/* list — результат engine.shoppingList(): [{name, qty, unit}] */
export function basket(list){
  const rows = (list || []).map(function(row){
    const key = keyFor(row.name);
    const opts = optionsFor(key);
    const best = opts.length ? opts[0] : null;
    const need = best ? toBase(row.qty, row.unit, best.base) : 0;
    const cost = best ? Math.round(need * best.per * 100) / 100 : null;
    // экономия против самого дорогого варианта той же категории
    let save = null;
    if (best && opts.length > 1){
      const worst = opts[opts.length - 1];
      save = Math.round(need * (worst.per - best.per) * 100) / 100;
      if (save < 0.05) save = null;
    }
    return {
      name: row.name, qty: row.qty, unit: row.unit,
      key: key, best: best, alts: opts.slice(1, 3), cost: cost, save: save,
      found: !!best
    };
  });

  const byStore = {};
  let total = 0, missing = 0;
  rows.forEach(function(r){
    if (!r.found || r.cost == null){ missing++; return; }
    const st = r.best.store;
    if (!byStore[st]) byStore[st] = { store: st, name: storeName(st), sum: 0, items: [] };
    byStore[st].sum = Math.round((byStore[st].sum + r.cost) * 100) / 100;
    byStore[st].items.push(r);
    total = Math.round((total + r.cost) * 100) / 100;
  });

  const stores = Object.keys(byStore)
    .map(function(k){ return byStore[k]; })
    .sort(function(a, b){ return (PRIORITY[a.store] || 9) - (PRIORITY[b.store] || 9); });

  const totalSave = Math.round(rows.reduce(function(a, r){ return a + (r.save || 0); }, 0) * 100) / 100;

  return { rows: rows, stores: stores, total: total, missing: missing, save: totalSave };
}

/* Акции, которые скоро кончатся — чтобы успеть закупиться. */
export function endingSoon(days){
  const d = days == null ? 4 : days;
  const today = todayISO();
  const limit = new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);
  return allItems()
    .filter(function(it){ return it.old && it.until && it.until >= today && it.until <= limit; })
    .sort(function(a, b){ return a.until < b.until ? -1 : 1; });
}

/* Где сильнее всего скидка прямо сейчас. */
export function topDeals(n){
  return allItems()
    .filter(function(it){ return it.old && it.old > it.price; })
    .map(function(it){
      return Object.assign({}, it, { off: Math.round((1 - it.price / it.old) * 100) });
    })
    .sort(function(a, b){ return b.off - a.off; })
    .slice(0, n || 6);
}

/* Дорогой продукт, который можно заменить дешёвым из этой же категории или родственной. */
const SWAPS = [
  ['индейка',      'курица_грудка',   'То же по белку, вдвое дешевле'],
  ['фарш_индейки', 'фарш_куриный',    'Разница по белку почти нулевая'],
  ['курица_грудка','курица_окорочка', 'Снять кожу — белка почти столько же, цена втрое ниже'],
  ['киноа',        'рис',             'Углеводы те же, цена в разы ниже'],
  ['булгур',       'гречка',          'Гречка дешевле и белка больше'],
  ['лосось',       'сельдь',          'Омега-3 та же, цена ниже'],
  ['масло_оливковое', 'масло_оливковое', '']
];

export function swapHints(list){
  const out = [];
  (list || []).forEach(function(row){
    const key = keyFor(row.name);
    if (!key) return;
    const rule = SWAPS.find(function(s){ return s[0] === key && s[1] !== key; });
    if (!rule) return;
    const from = bestFor(key), to = bestFor(rule[1]);
    if (!from || !to || to.per >= from.per) return;
    const need = toBase(row.qty, row.unit, from.base);
    const save = Math.round(need * (from.per - to.per) * 100) / 100;
    if (save < 0.5) return;
    out.push({ name: row.name, from: from, to: to, save: save, why: rule[2] });
  });
  return out.sort(function(a, b){ return b.save - a.save; });
}
