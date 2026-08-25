/* store.js — данные приложения (localStorage) */
const KEY = 'fithelper.v1';

const DEFAULTS = {
  profile: {
    name: '',
    sex: 'm',
    age: 24,
    height: 180,
    startWeight: 100,
    goalWeight: 80,
    startDate: null,          // ISO yyyy-mm-dd
    stepsWeekday: 4500,
    stepsWeekend: 1500,
    timeBudgetMin: 75,        // сколько минут в день готов тратить
    restrictions: '',
    onboarded: false
  },
  settings: {
    geminiKey: '',
    geminiModel: 'gemini-3.7-flash',
    strictMode: true,         // жёсткий режим: запрет добора после лимита
    eatWindowStart: '10:00',
    eatWindowEnd: '20:00',
    weekType: 'morning',      // morning | evening — текущая рабочая неделя
    weekAnchor: null          // ISO дата понедельника, с которой считается чередование
  },
  // Массивы записей
  food: [],     // {id, date, time, name, kcal, p, f, c, grams, src}
  weights: [],  // {date, kg}
  water: {},    // {date: ml}
  health: {},   // {date: {steps, active}} — из Apple Health через «Команды» или вручную
  done: {},     // {date: [slotId,...]}
  workouts: [], // {date, type, minutes, note}
  schedule: {}, // {date: [{id,time,title,desc,kind,minutes}]}
  notes: [],    // {date, text}
  log: []       // системный лог решений движка
};

function deepMerge(base, over){
  const out = Array.isArray(base) ? base.slice() : {...base};
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(over)){
    const b = base ? base[k] : undefined, o = over[k];
    if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)){
      out[k] = deepMerge(b, o);
    } else if (o !== undefined){
      out[k] = o;
    }
  }
  return out;
}

let state = load();

function load(){
  // Google выключает старые модели — молча переводим на актуальную.
  // Регулярка объявлена ВНУТРИ: load() вызывается при инициализации модуля,
  // до того как выполнятся const на уровне файла.
  const DEAD_MODELS = /^(gemini-1\.0|gemini-1\.5|gemini-2\.0|gemini-2\.5|gemini-pro)/;
  try{
    const raw = localStorage.getItem(KEY);
    if (!raw) return deepMerge(DEFAULTS, {});
    const st = deepMerge(DEFAULTS, JSON.parse(raw));
    if (st.settings && DEAD_MODELS.test(st.settings.geminiModel || '')){
      st.settings.geminiModel = DEFAULTS.settings.geminiModel;
    }
    return st;
  }catch(e){
    console.warn('store load failed', e);
    return deepMerge(DEFAULTS, {});
  }
}

function save(){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }
  catch(e){ console.error('store save failed', e); }
}

/* ---------- даты ---------- */
export function todayISO(d){
  const dt = d ? new Date(d) : new Date();
  const off = dt.getTimezoneOffset();
  return new Date(dt.getTime() - off*60000).toISOString().slice(0,10);
}
export function addDays(iso, n){
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return todayISO(d);
}
export function daysBetween(a, b){
  return Math.round((new Date(b+'T12:00:00') - new Date(a+'T12:00:00')) / 86400000);
}
export function dowRu(iso){
  return ['вс','пн','вт','ср','чт','пт','сб'][new Date(iso+'T12:00:00').getDay()];
}
export function isWeekend(iso){
  const d = new Date(iso+'T12:00:00').getDay();
  return d === 0 || d === 6;
}
export function fmtDate(iso){
  const d = new Date(iso+'T12:00:00');
  const m = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return d.getDate() + ' ' + m[d.getMonth()];
}
export function mondayOf(iso){
  const d = new Date(iso+'T12:00:00');
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return todayISO(d);
}

/* ---------- доступ ---------- */
export const S = {
  get all(){ return state; },
  get profile(){ return state.profile; },
  get settings(){ return state.settings; },

  setProfile(patch){ Object.assign(state.profile, patch); save(); },
  setSettings(patch){ Object.assign(state.settings, patch); save(); },

  /* еда */
  foodFor(date){ return state.food.filter(f => f.date === date); },
  addFood(item){
    const rec = { id: 'f'+Date.now()+Math.random().toString(36).slice(2,6), date: todayISO(), time: new Date().toTimeString().slice(0,5), ...item };
    rec.kcal = Math.round(rec.kcal||0); rec.p = +(rec.p||0).toFixed(1); rec.f = +(rec.f||0).toFixed(1); rec.c = +(rec.c||0).toFixed(1);
    state.food.push(rec); save(); return rec;
  },
  delFood(id){ state.food = state.food.filter(f => f.id !== id); save(); },

  /* вес */
  weightFor(date){ const w = state.weights.find(w => w.date === date); return w ? w.kg : null; },
  addWeight(kg, date){
    const d = date || todayISO();
    const i = state.weights.findIndex(w => w.date === d);
    if (i >= 0) state.weights[i].kg = kg; else state.weights.push({date:d, kg});
    state.weights.sort((a,b)=> a.date < b.date ? -1 : 1);
    save();
  },
  delWeight(date){ state.weights = state.weights.filter(w=>w.date!==date); save(); },
  get weights(){ return state.weights; },
  lastWeight(){ return state.weights.length ? state.weights[state.weights.length-1] : null; },

  /* вода */
  waterFor(date){ return state.water[date] || 0; },
  addWater(ml, date){
    const d = date || todayISO();
    state.water[d] = Math.max(0, (state.water[d]||0) + ml); save();
  },
  setWater(ml, date){ state.water[date||todayISO()] = Math.max(0, ml); save(); },

  /* шаги и активные калории с телефона */
  healthFor(date){ return state.health[date || todayISO()] || { steps:0, active:0 }; },
  setHealth(date, patch){
    const d = date || todayISO();
    const cur = state.health[d] || { steps:0, active:0 };
    if (patch.steps  != null) cur.steps  = Math.max(0, Math.round(patch.steps));
    if (patch.active != null) cur.active = Math.max(0, Math.round(patch.active));
    state.health[d] = cur; save(); return cur;
  },
  get health(){ return state.health; },

  /* выполнение заданий */
  doneFor(date){ return state.done[date] || []; },
  toggleDone(date, slotId){
    const arr = state.done[date] || (state.done[date] = []);
    const i = arr.indexOf(slotId);
    if (i >= 0) arr.splice(i,1); else arr.push(slotId);
    save();
  },

  /* расписание */
  scheduleFor(date){ return state.schedule[date] || null; },
  setSchedule(date, slots){ state.schedule[date] = slots; save(); },
  clearScheduleFrom(date){
    for (const k of Object.keys(state.schedule)) if (k >= date) delete state.schedule[k];
    save();
  },

  /* тренировки */
  addWorkout(w){ state.workouts.push({date: todayISO(), ...w}); save(); },
  get workouts(){ return state.workouts; },

  /* лог движка */
  pushLog(entry){
    state.log.unshift({ date: todayISO(), ts: Date.now(), ...entry });
    state.log = state.log.slice(0, 120); save();
  },
  get log(){ return state.log; },

  /* сервис */
  export(){ return JSON.stringify(state, null, 2); },
  import(json){
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    state = deepMerge(DEFAULTS, obj); save();
  },
  reset(){ state = deepMerge(DEFAULTS, {}); save(); },
  save
};
