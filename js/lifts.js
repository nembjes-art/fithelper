/* lifts.js — журнал силовых.
   Смысл не в том, чтобы записать тренировку, а в том, чтобы видеть прогрессию:
   на дефиците мышцы удерживает только растущая нагрузка. */
import { S, todayISO, addDays } from './store.js';

/* kind: 'weight' — вес × повторы; 'body' — только повторы; 'time' — секунды */
export const PROGRAMS = {
  A: {
    key: 'A', title: 'Силовая A — низ + спина',
    ex: [
      { id: 'squat',  name: 'Приседания',        sets: 4, reps: 12, kind: 'weight', step: 5,   note: 'Колени в стороны, спина ровная. Глубина — бедро параллельно полу.' },
      { id: 'rdl',    name: 'Румынская тяга',    sets: 4, reps: 12, kind: 'weight', step: 5,   note: 'Таз назад, спина прямая. Чувствуешь заднюю поверхность бедра — делаешь верно.' },
      { id: 'lunge',  name: 'Выпады',            sets: 3, reps: 12, kind: 'weight', step: 2.5, note: 'На каждую ногу. Колено передней ноги не уходит за носок.' },
      { id: 'row',    name: 'Тяга в наклоне',    sets: 4, reps: 12, kind: 'weight', step: 2.5, note: 'Тянешь локтями к поясу, лопатки сводишь в конце.' },
      { id: 'plank',  name: 'Планка',            sets: 3, reps: 45, kind: 'time',   step: 10,  note: 'Секунды. Таз не проваливается, ягодицы напряжены.' }
    ]
  },
  B: {
    key: 'B', title: 'Силовая B — верх + кор',
    ex: [
      { id: 'pushup', name: 'Отжимания',          sets: 4, reps: 12, kind: 'body',   step: 2,   note: 'До максимума. Тело прямой линией, локти под 45°.' },
      { id: 'press',  name: 'Жим над головой',    sets: 4, reps: 12, kind: 'weight', step: 2.5, note: 'Гантели или бутылки. Рёбра не выпячиваем.' },
      { id: 'pull',   name: 'Тяга к поясу',       sets: 4, reps: 12, kind: 'weight', step: 2.5, note: 'Одной рукой в упоре или двумя стоя в наклоне.' },
      { id: 'lat',    name: 'Подъёмы в стороны',  sets: 3, reps: 15, kind: 'weight', step: 1,   note: 'Вес маленький, техника чистая. Не раскачиваться.' },
      { id: 'crunch', name: 'Скручивания',        sets: 3, reps: 20, kind: 'body',   step: 2,   note: 'Поясница прижата к полу, тянемся рёбрами к тазу.' },
      { id: 'sideplank', name: 'Боковая планка',  sets: 3, reps: 30, kind: 'time',   step: 10,  note: 'Секунды на каждую сторону.' }
    ]
  }
};

export const BY_EX = (function(){
  const m = {};
  Object.keys(PROGRAMS).forEach(function(k){
    PROGRAMS[k].ex.forEach(function(e){ m[e.id] = Object.assign({ program: k }, e); });
  });
  return m;
})();

/* Какая программа стоит на этот день — та же логика, что в расписании */
export function programFor(date){
  const d = new Date(date + 'T12:00:00').getDay();   // 0 вс
  if (d === 1 || d === 6) return PROGRAMS.A;
  if (d === 4) return PROGRAMS.B;
  return null;                                        // интервалы или отдых
}

/* ---------- история ---------- */
export function sessionFor(date){
  return (S.lifts || {})[date] || null;
}

export function setsOf(date, exId){
  const s = sessionFor(date);
  return (s && s.sets && s.sets[exId]) || [];
}

/* Последняя тренировка, где это упражнение реально делали */
export function lastDone(exId, beforeDate){
  const all = S.lifts || {};
  const dates = Object.keys(all).filter(function(d){
    return (!beforeDate || d < beforeDate) && all[d].sets && (all[d].sets[exId] || []).length;
  }).sort();
  if (!dates.length) return null;
  const d = dates[dates.length - 1];
  return { date: d, sets: all[d].sets[exId] };
}

function best(sets){
  // «лучший подход»: сначала по весу, при равном — по повторам
  return (sets || []).reduce(function(a, s){
    if (!a) return s;
    if ((s.kg || 0) > (a.kg || 0)) return s;
    if ((s.kg || 0) === (a.kg || 0) && (s.reps || 0) > (a.reps || 0)) return s;
    return a;
  }, null);
}

/* «Рабочий вес» — минимум по ПЛАНОВЫМ подходам.
   Почему минимум, а не максимум: прогрессия должна опираться на вес, который
   человек удержал во всех подходах. Разминочно-тяжёлый первый подход
   (60×12, дальше 50×12×3) — это не рабочий вес; надбавка от него уводит
   в перегруз, после которого план уже не закрыть.
   Добивочные подходы сверх ex.sets в расчёт не берём — они всегда легче. */
function working(sets, ex){
  const all = sets || [];
  const planned = (ex && ex.sets) ? all.slice(0, ex.sets) : all;
  return planned.reduce(function(a, s){
    if (!a) return s;
    if ((s.kg || 0) < (a.kg || 0)) return s;
    if ((s.kg || 0) === (a.kg || 0) && (s.reps || 0) < (a.reps || 0)) return s;
    return a;
  }, null);
}

/* Что ставить сегодня. Правило простое и рабочее:
   выполнил все подходы с целевыми повторами — добавляй шаг, иначе повторяй тот же вес. */
export function suggest(exId, date){
  const ex = BY_EX[exId];
  if (!ex) return null;
  const prev = lastDone(exId, date || todayISO());
  if (!prev) {
    return { kg: 0, reps: ex.reps, first: true,
      why: 'Первый раз. Возьми вес, с которым сделаешь ' + ex.reps + ' повторов и останется 2 в запасе — это и будет точка отсчёта.' };
  }
  const w = working(prev.sets, ex);
  const baseKg = (w && w.kg) || 0;
  const step = Number(ex.step) || 0;
  // засчитываем только ПЛАНОВЫЕ подходы: лёгкая добивка пятым подходом
  // не должна навсегда блокировать прибавку
  const planned = (prev.sets || []).slice(0, ex.sets);
  const full = planned.length >= ex.sets && planned.every(function(s){ return (s.reps || 0) >= ex.reps; });
  if (full){
    const kg = ex.kind === 'weight' ? Math.round((baseKg + step) * 2) / 2 : baseKg;
    // повторы растут от ЦЕЛИ, а не от лучшего подхода: иначе один рекордный
    // подход (25 отжиманий при цели 12) задирает план до недостижимого
    const reps = ex.kind === 'weight' ? ex.reps : ex.reps + step;
    return { kg: kg, reps: reps, up: true, prev: prev,
      why: ex.kind === 'weight'
        ? 'В прошлый раз закрыл все ' + ex.sets + '×' + ex.reps + ' с ' + fmtKg(baseKg) + '. Добавляй ' + fmtKg(step) + '.'
        : 'В прошлый раз закрыл все ' + ex.sets + '×' + ex.reps + '. Ставь ' + reps +
          (ex.kind === 'time' ? ' сек.' : ' повторов.') };
  }
  return { kg: baseKg, reps: ex.reps, up: false, prev: prev,
    why: 'В прошлый раз не добрал повторы. Тот же вес, добей ' + ex.sets + '×' + ex.reps + ' — потом добавим.' };
}

export function fmtKg(v){
  const n = Number(v) || 0;
  return (Math.round(n * 2) / 2).toString().replace('.', ',') + ' кг';
}

/* ---------- запись ---------- */
export function addSet(date, exId, kg, reps){
  const d = date || todayISO();
  // программу берём по плану дня, а если её нет — по самому упражнению
  const prog = programFor(d);
  const key = prog ? prog.key : ((BY_EX[exId] && BY_EX[exId].program) || 'free');
  // отрицательный вес/повторы ломают тоннаж и прогрессию — режем на входе
  S.pushLift(d, exId, { kg: Math.max(0, Number(kg) || 0), reps: Math.max(0, Number(reps) || 0) }, key);
  return setsOf(d, exId);
}

export function removeSet(date, exId, index){
  S.popLift(date || todayISO(), exId, index);
}

/* ---------- сводка ---------- */
export function volume(date){
  const s = sessionFor(date);
  if (!s || !s.sets) return 0;
  let v = 0;
  Object.keys(s.sets).forEach(function(id){
    const ex = BY_EX[id];
    (s.sets[id] || []).forEach(function(x){
      // для «планок» и отжиманий тоннаж считать нечестно — берём только вес×повторы
      if (ex && ex.kind === 'weight') v += (x.kg || 0) * (x.reps || 0);
    });
  });
  return Math.round(v);
}

export function doneCount(date){
  const s = sessionFor(date);
  if (!s || !s.sets) return { sets: 0, ex: 0 };
  const ids = Object.keys(s.sets).filter(function(id){ return (s.sets[id] || []).length; });
  return { sets: ids.reduce(function(a, id){ return a + s.sets[id].length; }, 0), ex: ids.length };
}

/* Прогресс по упражнению: лучший подход по датам, для графика и мотивации */
export function history(exId, limit){
  const all = S.lifts || {};
  const n = Math.max(1, Math.round(Number(limit) || 10));
  return Object.keys(all).filter(function(d){
    return all[d].sets && (all[d].sets[exId] || []).length;
  }).sort().slice(-n).map(function(d){
    const b = best(all[d].sets[exId]) || {};   // здесь лучший подход уместен: это график рекордов
    return { date: d, kg: b.kg || 0, reps: b.reps || 0 };
  });
}

/* Сколько силовых сделано за последние N дней — для раздела «Итоги» */
export function recentSessions(days){
  const n = Math.max(1, Math.round(Number(days) || 28));
  const from = addDays(todayISO(), -n);
  const all = S.lifts || {};
  return Object.keys(all).filter(function(d){
    return d >= from && all[d].sets && Object.keys(all[d].sets).some(function(k){ return (all[d].sets[k] || []).length; });
  }).sort();
}
