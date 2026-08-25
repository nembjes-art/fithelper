// мок localStorage для node
const mem = {};
globalThis.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k,v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
const { S, todayISO, addDays } = await import('./js/store.js');
const E = await import('./js/engine.js');

let fails = 0;
const eq = (name, got, want, tol=0) => {
  const ok = tol ? Math.abs(got-want) <= tol : got === want;
  if(!ok){ fails++; console.log('FAIL  ' + name + ': got ' + got + ', want ' + want); }
  else console.log('ok    ' + name + ' = ' + got);
};

// профиль пользователя
S.setProfile({ sex:'m', age:24, height:180, startWeight:100, goalWeight:80,
  startDate: addDays(todayISO(),-30), stepsWeekday:4500, stepsWeekend:1500, timeBudgetMin:75, onboarded:true });

// 1. BMR по Миффлину: 10*100 + 6.25*180 - 5*24 + 5 = 2010
eq('BMR при 100 кг', E.bmr(S.profile, 100), 2010);

// 2. оценочный TDEE
const est = E.estimatedTDEE(S.profile, 100);
console.log('      оценочный TDEE =', est);
eq('TDEE в разумных пределах', est > 2350 && est < 2800, true);

// 3. цели
const tg = E.targets();
console.log('      цели:', JSON.stringify({kcal:tg.kcal,protein:tg.protein,fat:tg.fat,carbs:tg.carbs,water:tg.water,deficit:tg.deficit,weeklyLoss:tg.weeklyLoss}));
eq('лимит не ниже 80% BMR и не ниже 1500', tg.kcal >= Math.max(1500, tg.bmr*0.8), true);
eq('дефицит от еды не больше 30% TDEE', tg.deficit <= Math.round(tg.tdee*0.30)+10, true);
eq('дефицит от еды не больше 1000 ккал', tg.deficit <= 1000, true);
eq('сумма БЖУ сходится с ккал', Math.abs(tg.protein*4+tg.fat*9+tg.carbs*4 - tg.kcal) < 10, true);
eq('темп в безопасном диапазоне', tg.weeklyLoss >= 0.9 && tg.weeklyLoss <= 1.5, true);
eq('тренировки дают заметный вклад', tg.activityKcal > 250 && tg.activityKcal < 800, true);
eq('темп не выше 1.5% массы', tg.weeklyLoss <= 100*0.015, true);
eq('белок ~170 г', tg.protein, 170, 2);
console.log('      разбивка: еда', tg.lossFood, 'кг/нед + активность', tg.lossAct, 'кг/нед; тренировки', tg.activityKcal, 'ккал/д');

// 4. симуляция 30 дней: ест ровно лимит, теряет ~1 кг/нед
let w = 100;
for (let i = 29; i >= 0; i--){
  const d = addDays(todayISO(), -i);
  w = +(w - 0.145).toFixed(2);                 // ~1.0 кг/нед
  S.addWeight(w, d);
  S.addFood({ name:'День', kcal:1900, p:170, f:60, c:150, grams:0, src:'test' });
  S.all.food[S.all.food.length-1].date = d;
}
S.save();

const m = E.measuredTDEE(14);
console.log('      измеренный TDEE:', JSON.stringify(m));
eq('измеренный TDEE посчитан', m !== null, true);
// приход 1900, теряет 0.145 кг/д → TDEE ≈ 1900 + 0.145*7700 ≈ 3016
eq('измеренный TDEE ≈ 3016', m.tdee, 3016, 60);

const t2 = E.workingTDEE();
eq('источник = measured', t2.source, 'measured');

const pr = E.progress();
console.log('      прогресс:', JSON.stringify({lost:pr.lost, togo:pr.togo, rate:pr.rate, eta:pr.eta}));
eq('сброшено ~4.3 кг', pr.lost, 4.2, 0.6);
eq('темп ~1.0 кг/нед', pr.rate, 1.0, 0.15);

// 5. итоги дня
const dt = E.dayTotals(todayISO());
eq('итог дня 1900 ккал', dt.kcal, 1900);

// 6. план дня генерится и укладывается в бюджет времени
const slots = E.buildDay(todayISO());
const mins = slots.reduce((a,s)=>a+(s.minutes||0),0);
console.log('      слотов:', slots.length, 'минут всего:', mins);
eq('план не пустой', slots.length > 4, true);
eq('время в пределах бюджета+30', mins <= S.profile.timeBudgetMin + 30, true);

// 7. чередование недель
S.setSettings({ weekType:'morning', weekAnchor: (await import('./js/store.js')).mondayOf(todayISO()) });
const wt1 = E.weekTypeFor(todayISO());
const wt2 = E.weekTypeFor(addDays(todayISO(), 7));
eq('недели чередуются', wt1 !== wt2, true);

// 8. предохранитель: экстремальная цель не роняет лимит ниже BMR
S.setProfile({ goalWeight: 60 });
const tg2 = E.targets();
eq('лимит всё ещё >= BMR', tg2.kcal >= tg2.bmr, true);

console.log(fails ? ('\n*** ПРОВАЛЕНО ТЕСТОВ: ' + fails) : '\n*** ВСЕ ТЕСТЫ ПРОШЛИ');
process.exit(fails ? 1 : 0);
