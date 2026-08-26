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
export function estimatedTDEE(p, weightKg, stepsOverride){
  const w = weightKg || p.startWeight;
  const b = bmr(p, w);
  // 1.20 = термоэффект пищи (~10%) + бытовая активность сидячего человека
  const stepsAvg = (stepsOverride != null && stepsOverride > 0)
    ? stepsOverride
    : (p.stepsWeekday*5 + p.stepsWeekend*2) / 7;
  const stepKcal = stepsAvg * (w/100) * 0.045;   // ~0.045 ккал/шаг на 100 кг веса
  return Math.round(b*1.20 + stepKcal);
}

/* ---------- средние шаги за последние 14 дней, если телефон их отдаёт ---------- */
export function recentSteps(days = 14){
  const today = todayISO();
  const vals = [];
  for (let i = 1; i <= days; i++){
    const h = S.healthFor(addDays(today, -i));
    if (h.steps > 0) vals.push(h.steps);
  }
  if (vals.length < 3) return null;
  return Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
}

/* ---------- сколько сожжено сегодня сверх покоя (шаги + отмеченные тренировки) ---------- */
export function burnedToday(date){
  const d = date || todayISO();
  const w = currentTrendWeight();
  const h = S.healthFor(d);
  if (h.active > 0) return h.active;                      // телефон посчитал сам — верим ему
  let kcal = h.steps * (w/100) * 0.045;
  const done = S.doneFor(d);
  const slots = S.scheduleFor(d) || buildDay(d);
  for (const sl of slots){
    if (!done.includes(sl.id)) continue;
    if (sl.kind === 'walk'  && h.steps === 0) kcal += (sl.minutes||0) * 6.1 * (w/100);
    if (sl.kind === 'train') kcal += (sl.minutes||0) * 7.0 * (w/100);
  }
  return Math.round(kcal);
}

/* ---------- сколько сжигают запланированные тренировки, в среднем за день ---------- */
export function plannedActivityKcal(){
  const w = currentTrendWeight();
  const today = todayISO();
  let total = 0;
  for (let i = 0; i < 7; i++){
    const a = activityPlan(addDays(today, i));
    total += a.walkMin  * 6.1 * (w/100);   // быстрый шаг, сверх покоя
    total += a.trainMins * 7.0 * (w/100);  // силовая/интервалы, сверх покоя
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
  const est = estimatedTDEE(S.profile, currentTrendWeight(), recentSteps());
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

/* ---------- из чего складывается сожжённое за день ---------- */
export function burnBreakdown(date){
  const d = date || todayISO();
  const w = currentTrendWeight();
  const h = S.healthFor(d);
  const done = S.doneFor(d);
  const slots = S.scheduleFor(d) || buildDay(d);

  const stepsKcal = Math.round(h.steps * (w/100) * 0.045);
  let trainKcal = 0, walkKcal = 0;
  for (const sl of slots){
    if (!done.includes(sl.id)) continue;
    if (sl.kind === 'train') trainKcal += Math.round((sl.minutes||0) * 7.0 * (w/100));
    if (sl.kind === 'walk' && h.steps === 0) walkKcal += Math.round((sl.minutes||0) * 6.1 * (w/100));
  }
  // Если телефон отдал активные калории — они уже включают и шаги, и тренировку
  const total = h.active > 0 ? h.active : (stepsKcal + trainKcal + walkKcal);
  const goal = targets().activityKcal;
  return {
    steps: h.steps, stepsKcal, trainKcal, walkKcal, total, goal,
    fromPhone: h.active > 0,
    pct: goal ? Math.round(total/goal*100) : 0,
    left: Math.max(0, goal - total)
  };
}

/* ---------- сколько всего потрачено за день, прозрачно ---------- */
/* покой + движение + переваривание пищи (~10% от съеденного) */
export function spentToday(date){
  const d = date || todayISO();
  const b = bmr(S.profile, currentTrendWeight());
  const move = burnedToday(d);
  const tef = Math.round(dayTotals(d).kcal * 0.10);
  return { rest: b, move, tef, total: b + move + tef };
}

/* ---------- приговор еде: можно / половину / нельзя ---------- */
export function ruleFood(addKcal, addProtein){
  const tg = targets();
  const d  = todayISO();
  const dt = dayTotals(d);
  const burned = burnedToday(d);
  const st = S.settings;

  // реальный остаток: лимит + то, что реально сожжено движением сверх плана
  const planned = tg.activityKcal;
  const bonus = Math.max(0, burned - planned);          // перевыполнил план — заработал еду
  const budget = tg.kcal + bonus;
  const left = budget - dt.kcal;
  const after = left - addKcal;

  // окно питания
  const now = new Date().toTimeString().slice(0,5);
  const outsideWindow = st.eatWindowEnd && now > st.eatWindowEnd;

  if (outsideWindow){
    return { level:'no', kind:'bad', title:'НЕЛЬЗЯ — кухня закрыта',
      text:'Сейчас ' + now + ', окно питания закрылось в ' + st.eatWindowEnd + '. Вода, чай без сахара. Вечерний голод — это привычка, и она ломается за 5–7 дней, если не кормить её ни разу.' };
  }
  if (after < -300){
    return { level:'no', kind:'bad', title:'НЕЛЬЗЯ',
      text:'Это выведет тебя за лимит на ' + Math.round(-after) + ' ккал. Такой перебор съедает почти весь дневной дефицит. Найди что-то на ' + Math.max(0,Math.round(left)) + ' ккал или иди на 40 минут быстрым шагом и возвращайся.' };
  }
  if (after < 0){
    return { level:'half', kind:'warn', title:'ПОЛОВИНУ',
      text:'Целиком — перебор на ' + Math.round(-after) + ' ккал. Половина порции укладывается. Остаток дня: ' + Math.max(0,Math.round(left)) + ' ккал.' };
  }
  if (addProtein != null && addKcal > 250 && addProtein < addKcal/100*4){
    return { level:'ok', kind:'warn', title:'МОЖНО, но пусто',
      text:'По калориям проходит (останется ' + Math.round(after) + '), но белка тут почти нет. Ты недоберёшь до ' + tg.protein + ' г и будешь голодный через час. Добавь к этому творог, яйца или мясо.' };
  }
  return { level:'ok', kind:'ok', title:'МОЖНО',
    text:'Проходит. После этого останется ' + Math.round(after) + ' ккал' + (bonus > 50 ? ' (включая ' + Math.round(bonus) + ' ккал, которые ты сегодня отходил сверх плана)' : '') + '.' };
}

/* ---------- контекст для AI: что известно про сегодняшний день ---------- */
export function todayContext(){
  const d = todayISO();
  const tg = targets();
  const dt = dayTotals(d);
  const burned = burnedToday(d);
  const h = S.healthFor(d);
  const bonus = Math.max(0, burned - tg.activityKcal);
  return {
    время: new Date().toTimeString().slice(0,5),
    окно_питания_до: S.settings.eatWindowEnd,
    лимит_ккал: tg.kcal + bonus,
    съедено_ккал: Math.round(dt.kcal),
    осталось_ккал: Math.round(tg.kcal + bonus - dt.kcal),
    белок_цель_г: tg.protein,
    белок_съедено_г: Math.round(dt.p),
    белок_осталось_г: Math.max(0, tg.protein - Math.round(dt.p)),
    шагов_сегодня: h.steps,
    сожжено_движением_ккал: burned,
    вес_кг: tg.weight,
    съедено_сегодня: S.foodFor(d).map(f => f.name + ' ' + f.kcal + ' ккал'),
    ограничения: S.profile.restrictions || 'нет'
  };
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

/* ---------- работа со временем ---------- */
export function toMin(t){ const [h,m] = String(t||'0:0').split(':').map(Number); return (h||0)*60 + (m||0); }
export function toHHMM(m){
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}

/* Какое окно для тренировки в этот день */
export function windowFor(date){
  const w = (S.settings.windows) || {};
  const kind = isWeekend(date) ? 'weekend' : (weekTypeFor(date) === 'morning' ? 'morning' : 'evening');
  const def = { morning:{from:'17:30',to:'19:00'}, evening:{from:'10:00',to:'12:00'}, weekend:{from:'11:00',to:'13:00'} }[kind];
  const win = w[kind] || def;
  const from = win.from || def.from, to = win.to || def.to;
  let len = toMin(to) - toMin(from);
  if (len <= 0) len += 1440;                 // окно через полночь
  return { kind, from, to, minutes: Math.max(0, len) };
}

/* ---------- сколько движения запланировано на день ----------
   Считается БЕЗ обращения к targets(), иначе получается круг:
   targets → plannedActivityKcal → buildDay → menu → targets. */
export function activityPlan(date){
  const p = S.profile;
  const budget = p.timeBudgetMin || 75;
  const weekend = isWeekend(date);
  const dow = new Date(date+'T12:00:00').getDay();
  const win = windowFor(date);
  const avail = Math.min(win.minutes, budget);
  const isTrain = [1,2,4,5,6].includes(dow);

  let block = null, want = 0, trainMins = 0, used = 0;
  if (isTrain && avail >= 25){
    if (dow === 1)      { block = STRENGTH_A; want = 60; }
    else if (dow === 4) { block = STRENGTH_B; want = 60; }
    else if (dow === 6) { block = STRENGTH_A; want = 60; }
    else                { block = INTERVALS;  want = 40; }
    const reserve = avail >= 55 ? 20 : 0;
    trainMins = Math.max(25, Math.min(want, avail - reserve));
    used = trainMins + 5;
  }

  let walkMin, walkTime;
  if (weekend){ walkMin = Math.min(90, Math.max(45, budget)); walkTime = toHHMM(toMin(win.from) + used); }
  else if (used > 0){ walkMin = Math.max(0, Math.min(avail - used, 30)); walkTime = toHHMM(toMin(win.from) + used); }
  else { walkMin = Math.min(Math.max(25, avail), budget); walkTime = win.from; }

  return { win, weekend, block, want, trainMins, trainTime: trainMins ? win.from : null, walkMin, walkTime, avail };
}

/* ---------- каркас суток под каждый тип дня ---------- */
export function dayShape(date){
  const kind = isWeekend(date) ? 'weekend' : (weekTypeFor(date) === 'morning' ? 'morning' : 'evening');
  const DEF = {
    morning: { wake:'06:00', bed:'22:30' },
    evening: { wake:'08:30', bed:'00:30' },
    weekend: { wake:'08:30', bed:'23:00' }
  }[kind];
  const cfg = ((S.settings.sleep || {})[kind]) || DEF;
  const wake = cfg.wake || DEF.wake;
  const bed  = cfg.bed  || DEF.bed;

  const wakeM = toMin(wake);
  let bedM = toMin(bed);
  if (bedM <= wakeM) bedM += 1440;              // отбой после полуночи
  const sleepMinutes = (wakeM + 1440) - bedM;   // сколько реально спит

  // Всё пляшет от сна:
  //  первый приём пищи — через 30 мин после подъёма
  //  последний — за 2.5 часа до отбоя (чтобы не ложиться с полным желудком)
  // Окно питания: если задано руками — берём его, иначе считаем от сна.
  const eatCfg = ((S.settings.eat || {})[kind]) || {};
  const okT = t => /^\d{1,2}:\d{2}$/.test(String(t||''));
  const manualEat = okT(eatCfg.from) && okT(eatCfg.to);

  let first, last;
  if (manualEat){
    first = toMin(eatCfg.from);
    last  = toMin(eatCfg.to);
    if (last <= first) last += 1440;            // ужин после полуночи
    if (first < wakeM) first = wakeM + 30;      // не раньше подъёма
    if (last > bedM - 60) last = bedM - 60;     // не впритык к отбою
    if (last - first < 180) last = first + 180;
  } else {
    first = wakeM + 30;
    //  окно питания не длиннее 12 часов: и промежутки между едой человеческие,
    //  и вечером остаётся чистый разрыв до сна
    last = Math.min(bedM - 150, first + 720);
    if (last - first < 180) last = first + 180; // страховка на очень короткий день
  }

  const A = activityPlan(date);
  const tStart = A.trainTime ? toMin(A.trainTime) : null;
  const tEnd   = tStart !== null ? tStart + A.trainMins : null;

  const round5 = m => Math.round(m/5)*5;
  const span = last - first;
  const raw = [first, first + span/3, first + span*2/3, last];

  // Приём пищи не должен попадать в тренировку — сдвигаем за неё
  const times = raw.map(m => {
    let v = m;
    if (tStart !== null && v > tStart - 20 && v < tEnd + 10) v = tEnd + 15;
    return round5(v);
  });
  // не даём слипнуться после сдвига
  for (let i = 1; i < times.length; i++) if (times[i] <= times[i-1] + 30) times[i] = times[i-1] + 45;

  const order = kind === 'evening'
    ? ['breakfast','lunch','snack','dinner']    // на вечерней смене обед раньше, перекус на работе
    : ['breakfast','snack','lunch','dinner'];

  return {
    kind, wake, sleep: toHHMM(bedM), bedM, wakeM, sleepMinutes, eatManual: manualEat,
    eatFrom: toHHMM(times[0]), eatTo: toHHMM(times[3]),
    hours: Math.round(sleepMinutes/60*10)/10,
    eatEnd: toHHMM(times[3] + 30),
    meals: order.map((key, i) => [key, toHHMM(times[i])])
  };
}

/* Во сколько закрывается кухня в этот день */
export function eatEndFor(date){
  const manual = S.settings.eatWindowEnd;
  const shape = dayShape(date);
  // если человек сам менял окно в настройках — уважаем его выбор
  return (manual && manual !== '20:00') ? manual : shape.eatEnd;
}

/* ---------- меню: разложено под 1840 ккал и 177 г белка при 104 кг ---------- */
/* Порции считаются от текущих целей, поэтому меню едет вместе с весом. */
function menu(){
  const tg = targets();
  const k = tg.kcal / 1840;          // масштаб под текущий лимит
  const g = n => Math.round(n * k / 5) * 5;
  return {
    breakfast: {
      title: 'Завтрак',
      text: 'Скир или творог 0–5% ' + g(250) + ' г · овсянка ' + g(50) + ' г сухой · ягоды ' + g(100) + ' г. ' +
            '≈ ' + Math.round(375*k) + ' ккал, ' + Math.round(33*k) + ' г белка.'
    },
    snack: {
      title: 'Перекус — протеин',
      text: 'Мерная ложка протеина на воде + яблоко или груша. ' +
            '≈ ' + Math.round(200*k) + ' ккал, ' + Math.round(31*k) + ' г белка. ' +
            'Это самый дешёвый способ добрать белок, не съев лишнего.'
    },
    lunch: {
      title: 'Обед',
      text: 'Куриная грудка или индейка ' + g(200) + ' г · рис/гречка ' + g(60) + ' г сухой · овощи ' + g(200) + ' г · чайная ложка масла. ' +
            '≈ ' + Math.round(645*k) + ' ккал, ' + Math.round(65*k) + ' г белка.'
    },
    dinner: {
      title: 'Ужин',
      text: 'Рыба, индейка или творог ' + g(200) + ' г · овощи ' + g(300) + ' г · гречка ' + g(40) + ' г сухой. ' +
            '≈ ' + Math.round(530*k) + ' ккал, ' + Math.round(48*k) + ' г белка. ' +
            'Последняя еда за день — делай её белковой, тогда ночью не потянет к холодильнику.'
    }
  };
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
  const wt = weekTypeFor(date);
  const weekend = isWeekend(date);
  const budget = p.timeBudgetMin || 75;
  const dow = new Date(date+'T12:00:00').getDay(); // 0 вс
  const shape = dayShape(date);
  const M = menu();
  const wtr = waterTarget();
  const bodyW = currentTrendWeight();
  const slots = [];
  const push = (id, time, title, desc, kind, minutes) => slots.push({id,time,title,desc,kind,minutes:minutes||0});

  const sleepM = shape.bedM;
  const hours = shape.hours;

  /* ---------- подъём ---------- */
  push('wake', shape.wake, 'Подъём',
    'Сразу свет и движение, телефон в руки не берём. Встаёшь в одно и то же время — в этом весь смысл, организм перестаёт торговаться.', 'sleep');
  push('weigh', shape.wake, 'Взвешивание',
    'Натощак, после туалета, без одежды. Одна цифра в приложение — и забыл. Смотрим не на неё, а на тренд.', 'weigh', 2);
  push('water1', shape.wake, 'Вода 500 мл',
    'До кофе и до еды. Запускает обмен и гасит ложный голод, который на самом деле жажда.', 'water', 2);

  /* ---------- окно тренировки ---------- */
  const A = activityPlan(date);
  const win = A.win;
  const trainTime = A.trainTime, trainMins = A.trainMins;

  if (trainMins){
    const block = A.block, want = A.want;
    let desc = block.desc;
    desc += trainMins < want
      ? ' Окно у тебя ' + win.minutes + ' мин, поэтому сокращаем до ' + trainMins + ': убери по одному подходу в каждом упражнении и режь отдых до 45 сек. Короткая тренировка целиком лучше длинной, которую ты пропустишь.'
      : ' Всего ~' + trainMins + ' мин.';
    push('train', trainTime, block.title, desc, 'train', trainMins);
  }

  /* ---------- кофеин: только если до сна больше 7 часов ---------- */
  if (trainTime){
    const pre = toMin(trainTime) - 40;
    let gap = sleepM - toMin(trainTime);
    if (gap < 0) gap += 1440;
    if (gap >= 420 && pre > toMin(shape.wake)){
      push('caffeine', toHHMM(pre), 'Кофеин 200 мг',
        'Одна таблетка FITS за 40 минут до тренировки. До сна ещё ' + Math.round(gap/60) + ' ч — не помешает.', 'supp', 1);
    } else if (gap < 420){
      push('nocaffeine', toHHMM(Math.max(toMin(shape.wake)+30, pre)), 'Кофеин сегодня не пей',
        'Тренировка слишком близко к отбою: 200 мг в это время съедят половину глубокого сна, а недосып завтра заставит тебя переесть. Оставь кофеин на выходные и вечерние недели.', 'rule');
    }
  }

  /* ---------- ходьба ---------- */
  const walkMin = A.walkMin, walkTime = A.walkTime;
  if (walkMin >= 10){
    push('walk', walkTime, 'Ходьба ' + walkMin + ' мин',
      weekend
        ? 'Выходные — твоя главная дыра: в будни 4–5 тысяч шагов, в выходные почти ноль. Длинная спокойная ходьба закрывает её и не мешает восстановлению.'
        : 'Быстрым шагом, не прогулочным. Это ~' + Math.round(walkMin*6.1*(bodyW/100)) + ' ккал и лучший способ гасить перебор по еде.',
      'walk', walkMin);
  }

  /* ---------- еда и добавки ---------- */
  const mealAt = {};
  shape.meals.forEach(([key, time]) => {
    mealAt[key] = time;
    let text = M[key].text;
    // на вечерней смене часть приёмов пищи выпадает на работу
    if (shape.kind === 'evening' && toMin(time) >= toMin('15:00')){
      text += ' Это уже на смене — собери контейнер с утра. Работа без еды с собой всегда заканчивается автоматом или заправкой.';
    }
    if (shape.kind === 'morning' && toMin(time) >= toMin('07:00') && toMin(time) < toMin('16:00')){
      text += ' Это на смене — бери с собой из дома.';
    }
    // еда почти впритык к тренировке
    if (trainTime){
      const gap = toMin(trainTime) - toMin(time);
      if (gap > 0 && gap < 60){
        text += ' До тренировки всего ' + gap + ' мин — ешь половину порции, вторую доешь после. С полным желудком приседать плохо.';
      }
    }
    push('meal_'+key, time, M[key].title, text, 'meal', 0);
  });

  push('supp_am', toHHMM(toMin(mealAt.breakfast) + 5), 'Креатин + D3',
    'Креатин 5 г (одна чайная ложка без горки) размешать в воде · витамин D3 2000 МЕ одна капсула. ' +
    'Креатин пьётся КАЖДЫЙ день, включая дни отдыха — он работает от накопления, а не от разового приёма.', 'supp', 2);

  push('supp_omega', toHHMM(toMin(mealAt.lunch) + 5), 'Омега-3',
    'Одна капсула OstroVit Omega 3 Extreme с едой — на голодный желудок будет отрыжка рыбой.', 'supp', 1);

  push('predinner', toHHMM(toMin(mealAt.dinner) - 20), 'Стакан воды перед ужином',
    'Большой стакан за 20 минут до еды. Забирает часть объёма желудка — ужин уходит меньшей порцией без насилия над собой.', 'water', 2);

  const midDay = toHHMM(Math.round((toMin(mealAt.breakfast) + toMin(shape.eatEnd)) / 2 / 5) * 5);
  push('water2', midDay, 'Вода: половина нормы',
    'К середине дня должно быть выпито ~' + Math.round(wtr/2/50)*50 + ' мл из ' + wtr + '.', 'water', 1);

  /* ---------- вечер ---------- */
  push('eatstop', shape.eatEnd, 'Кухня закрыта',
    'После ' + shape.eatEnd + ' еды нет. Голод вечером — это привычка, а не потребность; она ломается за 5–7 дней. Вода, чай без сахара.', 'rule');

  push('supp_mg', toHHMM(sleepM - 60), 'Магний 300 мг',
    'Одна таблетка OstroVit MgZB за час до отбоя. На дефиците и большом объёме ходьбы иначе ловишь судороги в икрах, плюс магний заметно улучшает глубокий сон.', 'supp', 1);

  push('sleep', shape.sleep, 'Отбой',
    'Спать ' + hours + ' ч. Недосып поднимает грелин и роняет лептин — на следующий день ты съешь больше и даже не заметишь. ' +
    'Это не «полезная привычка», а половина твоего результата.', 'sleep');

  // сортировка: ночные часы (00:00–04:00) считаем концом суток
  const key = t => { const [h,m] = t.split(':').map(Number); return (h < 4 ? h + 24 : h)*60 + m; };
  slots.sort((a,b) => key(a.time) - key(b.time));
  return slots;
}

export function ensureSchedule(date){
  let s = S.scheduleFor(date);
  if (!s){ s = buildDay(date); S.setSchedule(date, s); }
  return s;
}

/* ---------- сводка по периоду: сутки / неделя / месяц ---------- */
export function periodStats(days){
  const today = todayISO();
  const tg = targets();
  const rows = [];
  for (let i = days - 1; i >= 0; i--){
    const d = addDays(today, -i);
    const t = dayTotals(d);
    const h = S.healthFor(d);
    const burned = burnedToday(d);
    const sp = spentToday(d);
    rows.push({
      date: d,
      spent: sp.total,
      kcal: Math.round(t.kcal),
      protein: Math.round(t.p),
      logged: t.n > 0,
      steps: h.steps,
      burnPlan: tg.activityKcal,
      burnReal: burned,
      water: S.waterFor(d),
      weight: S.weightFor(d),
      done: S.doneFor(d).length
    });
  }

  const eaten   = rows.filter(r => r.logged);
  const stepped = rows.filter(r => r.steps > 0);
  const avg = (arr, k) => arr.length ? Math.round(arr.reduce((a,r)=>a+r[k],0)/arr.length) : 0;

  const avgKcal   = avg(eaten, 'kcal');
  const avgProt   = avg(eaten, 'protein');
  const avgSteps  = avg(stepped, 'steps');
  const avgBurn   = avg(stepped.length ? stepped : rows, 'burnReal');
  const planBurn  = tg.activityKcal;

  // изменение веса за период — по тренду
  const tr = weightTrend();
  const from = addDays(today, -(days-1));
  const inRange = tr.filter(x => x.date >= from);
  const weightDelta = inRange.length >= 2
    ? +(inRange[inRange.length-1].trend - inRange[0].trend).toFixed(2) : null;

  const avgSpent = avg(rows, 'spent');
  const totalBurnPlan = planBurn * days;
  const totalBurnReal = rows.reduce((a,r)=>a+r.burnReal,0);

  return {
    days, rows,
    avgKcal, avgProt, avgSteps, avgBurn, planBurn, avgSpent,
    limit: tg.kcal,
    loggedDays: eaten.length,
    steppedDays: stepped.length,
    adherence: Math.round(eaten.length/days*100),
    weightDelta,
    totalBurnPlan, totalBurnReal,
    burnPct: totalBurnPlan ? Math.round(totalBurnReal/totalBurnPlan*100) : 0,
    avgDeficit: eaten.length ? Math.round(avgSpent - avgKcal) : 0
  };
}

/* ---------- серии: сколько дней подряд не сорвался ---------- */
export function streaks(){
  const today = todayISO();
  const count = (test) => {
    let n = 0;
    for (let i = 0; i < 120; i++){
      const d = addDays(today, -i);
      if (i === 0 && !test(d)) continue;   // сегодня ещё не закончилось — не рвём серию
      if (test(d)) n++; else break;
    }
    return n;
  };
  const tg = targets();
  return {
    logged:  count(d => dayTotals(d).n > 0),
    weighed: count(d => S.weightFor(d) !== null),
    inLimit: count(d => { const t = dayTotals(d); return t.n > 0 && t.kcal <= tg.kcal + Math.max(0, burnedToday(d) - tg.activityKcal); }),
    steps:   count(d => S.healthFor(d).steps >= 8000),
    protein: count(d => { const t = dayTotals(d); return t.n > 0 && t.p >= tg.protein * 0.9; })
  };
}

/* ---------- за что похвалить прямо сейчас ---------- */
export function praise(){
  const tg = targets();
  const pr = progress();
  const st = streaks();
  const d  = todayISO();
  const dt = dayTotals(d);
  const h  = S.healthFor(d);
  const burned = burnedToday(d);
  const out = [];

  if (pr.lost >= 1)
    out.push({ big: num1(pr.lost) + ' кг', text: 'уже нет. Это не мотивация и не планы — это факт, который ты сделал.' });
  if (st.logged >= 3)
    out.push({ big: st.logged + ' ' + plural(st.logged,'день','дня','дней'), text: 'подряд ведёшь дневник. Именно на этом ломается 90% людей, а ты держишь.' });
  if (st.inLimit >= 3)
    out.push({ big: st.inLimit + ' ' + plural(st.inLimit,'день','дня','дней'), text: 'подряд в лимите. Так и выглядит результат до того, как его видно в зеркале.' });
  if (st.weighed >= 5)
    out.push({ big: st.weighed + ' ' + plural(st.weighed,'день','дня','дней'), text: 'подряд встаёшь на весы. Смотреть на цифру, когда она не радует, — отдельная смелость.' });
  if (h.steps >= 10000)
    out.push({ big: num(h.steps) + ' шагов', text: 'сегодня. Десятка взята — это ' + num(Math.round(burned)) + ' ккал, которые ты можешь съесть и не переживать.' });
  else if (h.steps >= 8000)
    out.push({ big: num(h.steps) + ' шагов', text: 'сегодня. До десятки осталось ' + num(10000-h.steps) + ' — это 15 минут ходьбы.' });
  if (dt.p >= tg.protein)
    out.push({ big: 'Белок закрыт', text: num(Math.round(dt.p)) + ' г. Это то, что решает, уйдёт у тебя жир или мышцы.' });
  if (st.protein >= 3)
    out.push({ big: st.protein + ' ' + plural(st.protein,'день','дня','дней'), text: 'подряд добираешь белок. Через месяц ты это увидишь не на весах, а в плечах.' });
  if (pr.rate !== null && pr.rate > 0.5)
    out.push({ big: num1(pr.rate) + ' кг/нед', text: 'реальный темп. Ты идёшь ровно туда, куда собирался.' });

  if (!out.length){
    if (dt.n > 0) out.push({ big: 'Начало есть', text: 'Ты записал сегодняшнюю еду. Звучит мелко — но это единственное, что отличает тех, кто дошёл, от тех, кто нет.' });
    else out.push({ big: 'День ещё пустой', text: 'Запиши первый приём еды или вбей шаги — дальше приложению будет чем тебя хвалить.' });
  }
  return out;
}

function num(n){ return String(Math.round(Number(n)||0)); }
function num1(n){ return (Math.round(Number(n)*10)/10).toFixed(1).replace('.', ','); }
function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
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
      d:'Посчитано по факту: средний приход ' + m.avgIntake + ' ккал и изменение тренда ' + m.deltaKg + ' кг за ' + m.days + ' дн. Формула давала ' + estimatedTDEE(S.profile, pr.cur, recentSteps()) + '.' });
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
