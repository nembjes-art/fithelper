/* engine.js — вся математика: калории, TDEE, тренд веса, адаптация стратегии */
import { S, todayISO, addDays, daysBetween, isWeekend, mondayOf } from './store.js';

export const KCAL_PER_KG_FAT = 7700;

/* ---------- базовый обмен, Миффлин — Сан Жеор ---------- */
export function bmr(p, weightKg){
  const w = weightKg || p.startWeight;
  const base = 10*w + 6.25*p.height - 5*p.age;
  return Math.round(base + (p.sex === 'm' ? 5 : -161));
}

/* ---------- оценочный TDEE (пока нет своих данных) ---------- */
export function estimatedTDEE(p, weightKg){
  const w = weightKg || p.startWeight;
  const b = bmr(p, w);
  // 1.20 = термоэффект пищи (~10%) + бытовая активность сидячего человека
  const stepsAvg = (p.stepsWeekday*5 + p.stepsWeekend*2) / 7;
  const stepKcal = stepsAvg * (w/100) * 0.045;   // ~0.045 ккал/шаг на 100 кг веса
  return Math.round(b*1.20 + stepKcal);
}

/* ---------- сколько сжигают запланированные тренировки, в среднем за день ---------- */
export function plannedActivityKcal(){
  const w = currentTrendWeight();
  const today = todayISO();
  let total = 0;
  for (let i = 0; i < 7; i++){
    const d = addDays(today, i);
    const slots = S.scheduleFor(d) || buildDay(d);
    for (const s of slots){
      if (s.kind === 'walk')  total += (s.minutes||0) * 6.1 * (w/100);   // быстрый шаг, сверх покоя: ~6.1 ккал/мин при 100 кг
      if (s.kind === 'train') total += (s.minutes||0) * 7.0 * (w/100);   // силовая/интервалы, сверх покоя: ~7.0 ккал/мин
    }
  }
  return Math.round(total / 7);
}

/* ---------- скользящая средняя веса (тренд) ---------- */
export function weightTrend(win = 7){
  const w = S.weights;
  if (!w.length) return [];
  const out = [];
  for (let i = 0; i < w.length; i++){
    const from = Math.max(0, i - win + 1);
    let sum = 0, n = 0;
    for (let j = from; j <= i; j++){
      if (daysBetween(w[j].date, w[i].date) <= win) { sum += w[j].kg; n++; }
    }
    out.push({ date: w[i].date, kg: w[i].kg, trend: +(sum/n).toFixed(2) });
  }
  return out;
}
export function currentTrendWeight(){
  const t = weightTrend();
  if (!t.length) return S.profile.startWeight;
  return t[t.length-1].trend;
}
export function currentWeight(){
  const last = S.lastWeight();
  return last ? last.kg : S.profile.startWeight;
}

/* ---------- реальный TDEE из фактических данных ---------- */
/* Баланс энергии: съедено - TDEE = Δвес * 7700 / дней  →  TDEE = съедено - Δ*7700/дней */
export function measuredTDEE(windowDays = 14){
  const today = todayISO();
  const from = addDays(today, -windowDays);
  const t = weightTrend().filter(x => x.date >= from);
  if (t.length < 2) return null;

  const first = t[0], last = t[t.length-1];
  const span = daysBetween(first.date, last.date);
  if (span < 7) return null;                       // меньше недели — шум, не считаем

  // средний приход за тот же период, только по дням, где еда вообще записана
  const days = [];
  for (let d = first.date; d <= last.date; d = addDays(d,1)) days.push(d);
  const logged = days.map(d => {
    const items = S.foodFor(d);
    return items.length ? items.reduce((s,f)=>s+f.kcal,0) : null;
  }).filter(v => v !== null);

  if (logged.length < Math.max(5, Math.floor(span*0.6))) return null;  // мало записей — недостоверно

  const avgIntake = logged.reduce((a,b)=>a+b,0) / logged.length;
  const deltaKg = last.trend - first.trend;
  const tdee = avgIntake - (deltaKg * KCAL_PER_KG_FAT) / span;

  const sane = Math.max(1400, Math.min(4500, Math.round(tdee)));
  return { tdee: sane, avgIntake: Math.round(avgIntake), deltaKg: +deltaKg.toFixed(2), days: span, coverage: logged.length };
}

/* ---------- рабочий TDEE: измеренный, если есть; иначе оценка ---------- */
export function workingTDEE(){
  const m = measuredTDEE(14);
  const est = estimatedTDEE(S.profile, currentTrendWeight());
  if (m){
    // сглаживаем: 70% факта + 30% оценки, чтобы одна плохая неделя не швыряла план
    return { value: Math.round(m.tdee*0.7 + est*0.3), source: 'measured', detail: m, estimate: est };
  }
  return { value: est, source: 'estimated', detail: null, estimate: est };
}

/* ---------- норма воды (отдельно: buildDay не должен звать targets) ---------- */
export function waterTarget(){
  return Math.min(3500, Math.round(currentTrendWeight() * 35 / 250) * 250);
}

/* ---------- целевые калории ---------- */
export function targets(){
  const p = S.profile;
  const w = currentTrendWeight();
  const t = workingTDEE();
  const b = bmr(p, w);

  // Дефицит от ЕДЫ: агрессивный, но с предохранителями.
  // Тренировки в TDEE не заложены намеренно — они дают дефицит сверху,
  // поэтому реальный результат обгоняет план, а не отстаёт от него.
  let kcal = t.value - Math.min(Math.round(t.value * 0.30), 1000);

  // Нижний пол: не ниже 1500 (муж) / 1200 (жен) и не ниже 80% базового обмена.
  // Опускаться ниже базового обмена при большом запасе жира допустимо,
  // проваливаться под него глубоко — уже потеря мышц.
  const floor = Math.max(p.sex === 'm' ? 1500 : 1200, Math.round(b * 0.80));
  let capped = false;
  if (kcal < floor){ kcal = floor; capped = true; }
  kcal = Math.round(kcal/10)*10;

  const deficit = t.value - kcal;
  const actKcal = plannedActivityKcal();
  const lossFood = deficit*7 / KCAL_PER_KG_FAT;
  const lossAct  = actKcal*7 / KCAL_PER_KG_FAT;
  let weeklyLoss = +(lossFood + lossAct).toFixed(2);

  // Потолок безопасности: не больше 1.5% массы тела в неделю
  const maxWeekly = +(w * 0.015).toFixed(2);
  const tooFast = weeklyLoss > maxWeekly;
  if (tooFast) weeklyLoss = maxWeekly;

  // Белок: 1.7 г на кг текущего веса, но не меньше 2 г на кг целевого — защита мышц
  const protein = Math.round(Math.max(w * 1.7, p.goalWeight * 2.0));
  // Жиры: не меньше 0.6 г/кг текущего и 0.8 г/кг целевого — гормоны
  const fat = Math.round(Math.max(w * 0.6, p.goalWeight * 0.8));
  const carbs = Math.max(0, Math.round((kcal - protein*4 - fat*9) / 4));

  // Вода: 35 мл/кг текущего веса, потолок 3500 мл
  const water = waterTarget();

  return { kcal, protein, fat, carbs, water, tdee: t.value, tdeeSource: t.source, tdeeDetail: t.detail,
           bmr: b, deficit, activityKcal: actKcal, weeklyLoss,
           lossFood: +lossFood.toFixed(2), lossAct: +lossAct.toFixed(2),
           capped, tooFast, weight: w };
}

/* ---------- итоги дня ---------- */
export function dayTotals(date){
  const items = S.foodFor(date || todayISO());
  return items.reduce((a,f)=>({
    kcal: a.kcal + (f.kcal||0), p: a.p + (f.p||0), f: a.f + (f.f||0), c: a.c + (f.c||0), n: a.n+1
  }), {kcal:0,p:0,f:0,c:0,n:0});
}

/* ---------- прогресс и прогноз ---------- */
export function progress(){
  const p = S.profile;
  const t = weightTrend();
  const cur = currentTrendWeight();
  const lost = +(p.startWeight - cur).toFixed(1);
  const togo = +(cur - p.goalWeight).toFixed(1);
  const total = p.startWeight - p.goalWeight;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round(lost/total*100))) : 0;

  // фактический темп за последние 14 дней тренда
  let rate = null;
  const from = addDays(todayISO(), -14);
  const recent = t.filter(x => x.date >= from);
  if (recent.length >= 2){
    const span = daysBetween(recent[0].date, recent[recent.length-1].date);
    if (span >= 5){
      rate = +(((recent[0].trend - recent[recent.length-1].trend) / span) * 7).toFixed(2); // кг/нед
    }
  }
  const tg = targets();
  const planRate = tg.weeklyLoss;
  const useRate = (rate !== null && rate > 0.05) ? rate : planRate;
  const weeksLeft = togo > 0 && useRate > 0 ? togo / useRate : 0;
  const eta = togo <= 0 ? todayISO() : addDays(todayISO(), Math.round(weeksLeft*7));

  const daysIn = p.startDate ? daysBetween(p.startDate, todayISO()) : 0;

  return { lost, togo, pct, rate, planRate, eta, weeksLeft: +weeksLeft.toFixed(1), daysIn, cur, total };
}

/* ---------- вердикт: что движок думает прямо сейчас ---------- */
export function verdict(){
  const tg = targets();
  const pr = progress();
  const today = todayISO();
  const dt = dayTotals(today);
  const left = tg.kcal - dt.kcal;
  const hasWeightToday = S.weightFor(today) !== null;

  if (!hasWeightToday){
    return { kind:'blue', title:'Взвесься', text:'Утром, натощак, после туалета, без одежды. Без этой цифры движок не может считать стратегию.' };
  }
  if (dt.n === 0){
    return { kind:'blue', title:'Дневник пустой', text:'Сфоткай еду перед тем, как начнёшь есть. Записанная еда — половина результата.' };
  }
  if (left < -300){
    return { kind:'bad', title:'Перебор на ' + Math.abs(left) + ' ккал', text:'Сегодня всё. Еды больше нет. Завтра не режь лимит вдвое — просто вернись в норму, движок сам добавит нагрузки.' };
  }
  if (left < 0){
    return { kind:'warn', title:'Лимит выбран', text:'Осталось ' + left + ' ккал. Дальше только вода. Небольшой перебор гасится ходьбой — 30 минут это ~150 ккал.' };
  }
  if (pr.rate !== null && pr.rate < 0.2 && pr.daysIn > 14){
    return { kind:'warn', title:'Вес встал', text:'Тренд почти не двигается. Либо в дневник попадает не всё, либо расход упал. Движок урезал калории и добавил движения.' };
  }
  if (pr.rate !== null && pr.rate > 1.6){
    return { kind:'warn', title:'Слишком быстро', text:'Больше 1,6 кг/нед — на такой скорости горят мышцы. Держи белок ' + tg.protein + ' г и не опускайся ниже лимита.' };
  }
  if (left < tg.kcal*0.25){
    return { kind:'ok', title:'Осталось ' + left + ' ккал', text:'Почти на месте. Добери белком, а не углеводами — дольше будешь сытым.' };
  }
  return { kind:'ok', title:'В графике', text:'Осталось ' + left + ' ккал и ' + Math.max(0, tg.protein - Math.round(dt.p)) + ' г белка. Держи темп.' };
}

/* ---------- какая рабочая неделя: утро или вечер ---------- */
export function weekTypeFor(date){
  const st = S.settings;
  if (!st.weekAnchor) return st.weekType;
  const m = mondayOf(date);
  const diffWeeks = Math.round(daysBetween(st.weekAnchor, m) / 7);
  const flip = ((diffWeeks % 2) + 2) % 2;
  return flip === 0 ? st.weekType : (st.weekType === 'morning' ? 'evening' : 'morning');
}

/* ---------- генератор плана дня ---------- */
const STRENGTH_A = {
  title: 'Силовая A — низ + спина',
  desc: 'Приседания 4×12 · Румынская тяга 4×12 · Выпады 3×12 на ногу · Тяга в наклоне 4×12 · Планка 3×45 сек. Отдых 60–75 сек.'
};
const STRENGTH_B = {
  title: 'Силовая B — верх + кор',
  desc: 'Отжимания 4×макс · Жим гантелей/бутылок 4×12 · Тяга к поясу 4×12 · Подъёмы рук в стороны 3×15 · Скручивания 3×20 · Планка боковая 3×30 сек.'
};
const INTERVALS = {
  title: 'Интервалы',
  desc: '10 мин разминка ходьбой · затем 8 циклов: 1 мин быстрый шаг в горку / бег, 2 мин спокойный шаг · 5 мин заминка.'
};

export function buildDay(date){
  const p = S.profile;
  const st = S.settings;
  const wt = weekTypeFor(date);
  const weekend = isWeekend(date);
  const budget = p.timeBudgetMin || 75;
  const dow = new Date(date+'T12:00:00').getDay(); // 0 вс
  const wtr = waterTarget();
  const slots = [];

  const push = (id, time, title, desc, kind, minutes) => slots.push({id,time,title,desc,kind,minutes});

  // — утро —
  const wake = weekend ? '09:00' : (wt === 'morning' ? '06:10' : '09:00');
  push('weigh', wake, 'Взвешивание', 'Натощак, после туалета, без одежды. Одна цифра в приложение — и забыл.', 'weigh', 2);
  push('water1', wake, 'Стакан воды 500 мл', 'До кофе и до еды. Это запускает обмен и гасит ложный голод.', 'water', 2);

  // — тренировочный блок —
  const trainDays = [1,2,4,5,6]; // пн вт чт пт сб — 3 силовых + 2 кардио
  const isTrain = trainDays.includes(dow);

  if (isTrain){
    let block, mins;
    if (dow === 1) { block = STRENGTH_A; mins = Math.min(60, budget); }
    else if (dow === 4) { block = STRENGTH_B; mins = Math.min(60, budget); }
    else if (dow === 6) { block = STRENGTH_A; mins = Math.min(60, budget); }
    else if (dow === 2) { block = INTERVALS; mins = Math.min(40, budget); }
    else { block = INTERVALS; mins = Math.min(40, budget); }

    let time;
    if (weekend) time = '11:00';
    else if (wt === 'morning') time = '17:30';   // смена 7–16
    else time = '10:00';                          // смена 15–00
    push('train', time, block.title, block.desc + ' Всего ~' + mins + ' мин.', 'train', mins);
  }

  // — ходьба —
  const walkMin = weekend ? Math.min(90, Math.max(60, budget)) : (isTrain ? 25 : Math.min(50, budget));
  const walkTime = weekend ? '15:00' : (wt === 'morning' ? '16:15' : '13:30');
  push('walk', walkTime,
    'Ходьба ' + walkMin + ' мин',
    weekend
      ? 'Выходные — твоя главная дыра: в будни 4–5 тысяч шагов, в выходные почти ноль. Длинная спокойная ходьба закрывает её и не мешает восстановлению.'
      : 'Быстрым шагом, не прогулочным. Это ~' + Math.round(walkMin*5.5) + ' ккал и лучший способ гасить перебор по еде.',
    'walk', walkMin);

  // — вода в течение дня —
  push('water2', '13:00', 'Вода: половина нормы', 'К середине дня должно быть выпито ~' + Math.round(wtr/2/50)*50 + ' мл.', 'water', 1);

  // — окно питания —
  push('eatstop', st.eatWindowEnd, 'Кухня закрыта', 'После ' + st.eatWindowEnd + ' еды нет. Голод вечером — это привычка, а не потребность; она ломается за 5–7 дней.', 'rule', 0);

  // — добавки —
  push('supp', weekend ? '09:30' : (wt === 'morning' ? '06:30' : '09:30'),
    'Добавки',
    'Креатин моногидрат 5 г (каждый день, включая дни отдыха) · витамин D3 2000 МЕ · омега-3 1–2 г · магний 300 мг вечером. Всё запивать водой.',
    'supp', 1);

  // — вечер —
  const sleepTime = (!weekend && wt === 'evening') ? '01:00' : '22:45';
  push('sleep', sleepTime, 'Отбой', 'Недосып поднимает грелин и роняет лептин — на следующий день ты съешь больше, даже не заметив. 7–8 часов не обсуждается.', 'sleep', 0);

  // сортируем по времени; ночные часы (00:00-04:00) считаем концом дня
  const key = t => { const [h,m] = t.split(':').map(Number); return (h < 4 ? h + 24 : h)*60 + m; };
  slots.sort((a,b) => key(a.time) - key(b.time));
  return slots;
}

export function ensureSchedule(date){
  let s = S.scheduleFor(date);
  if (!s){ s = buildDay(date); S.setSchedule(date, s); }
  return s;
}

/* ---------- еженедельная ревизия стратегии ---------- */
export function weeklyReview(){
  const pr = progress();
  const tg = targets();
  const m = measuredTDEE(14);
  const out = [];

  if (!m){
    out.push({ kind:'blue', t:'Данных пока мало',
      d:'Нужно 2 недели взвешиваний и записанной еды — тогда движок посчитает твой РЕАЛЬНЫЙ расход вместо формулы и перестанет гадать.' });
  } else {
    const diff = m.tdee - tg.tdee;
    out.push({ kind:'ok', t:'Твой реальный расход: ' + m.tdee + ' ккал',
      d:'Посчитано по факту: средний приход ' + m.avgIntake + ' ккал и изменение тренда ' + m.deltaKg + ' кг за ' + m.days + ' дн. Формула давала ' + estimatedTDEE(S.profile, pr.cur) + '.' });
    if (Math.abs(diff) > 200){
      out.push({ kind:'warn', t: diff < 0 ? 'Расход ниже ожидаемого' : 'Расход выше ожидаемого',
        d: diff < 0
          ? 'Организм подкрутил траты вниз — это нормальная адаптация. Лечится не голоданием, а движением: движок добавит ходьбы.'
          : 'Ты тратишь больше, чем считала формула. Лимит калорий подняли — недоедание тут работает против тебя.' });
    }
  }

  if (pr.rate !== null){
    const gap = pr.rate - pr.planRate;
    if (gap < -0.35) out.push({ kind:'warn', t:'Отстаёшь от плана',
      d:'Факт ' + pr.rate + ' кг/нед против плана ' + pr.planRate + '. Первое подозрение всегда одно: в дневник попадает не вся еда. Масло, соусы и «кусочек» — это 300–500 ккал в день.' });
    else if (gap > 0.35) out.push({ kind:'ok', t:'Идёшь быстрее плана',
      d:'Факт ' + pr.rate + ' кг/нед. Не ускоряйся дальше — на этой скорости уже важнее удержать белок и силовые, иначе уйдут мышцы.' });
    else out.push({ kind:'ok', t:'Темп ровно в плане', d:'Факт ' + pr.rate + ' кг/нед. Ничего не меняем — работает.' });
  }

  return out;
}
