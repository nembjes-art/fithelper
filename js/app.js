/* app.js — сборка приложения, роутер и все экраны */
import { S, todayISO, addDays, daysBetween, fmtDate, dowRu, isWeekend, mondayOf } from './store.js';
import * as E from './engine.js';
import * as G from './gemini.js';
import * as P from './prices.js';
import * as Q from './quick.js';
import * as R from './remind.js';
import * as L from './lifts.js';
import * as B from './body.js';

import { $, $$, h, esc, num, toast, sheet, confirmSheet, ring, meter } from './ui.js';

const main = $('#main');
function previewMeals(kind){
  // ближайший день нужного типа — чтобы показать, что получится
  const today = todayISO();
  for (let i = 0; i < 14; i++){
    const d = addDays(today, i);
    const sh = E.dayShape(d);
    if (sh.kind === kind) return sh.meals.map(([,t]) => t).join(' · ');
  }
  return '';
}

function sleepHours(wake, bed){
  if (!wake || !bed) return 0;
  let w = E.toMin(wake), b = E.toMin(bed);
  if (b <= w) b += 1440;
  return Math.round(((w + 1440 - b) / 60) * 10) / 10;
}

const MODEL_FALLBACK = ['gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.1-pro-preview'];
const FOOD_TAGS = ['Без рыбы','Без творога и молочки','Без свинины','Без говядины','Без грибов','Без бобовых','Без глютена','Без острого'];
const RECIPE_COUNT = 15;
const DOW_RU = ['','пн','вт','ср','чт','пт','сб','вс'];
const DOW_FULL = ['','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const SLOT_RU = { breakfast:'Завтрак', lunch:'Обед', snack:'Перекус', dinner:'Ужин' };
function plural(n, a1, a2, a5){ const x=Math.abs(n)%100, y=x%10; if(x>10&&x<20)return a5; if(y>1&&y<5)return a2; if(y===1)return a1; return a5; }

const TITLES = { today:'Сегодня', food:'Дневник еды', weight:'Вес', plan:'План', stats:'Итоги', settings:'Настройки', ration:'Рацион', lift:'Тренировка', body:'Замеры и фото' };
let view = 'today';

/* ================= РОУТЕР ================= */
function go(v){
  view = v;
  $('#viewTitle').textContent = TITLES[v] || '';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  render();
  window.scrollTo(0,0);
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (b) go(b.dataset.v);
});

function render(){
  if (!S.profile.onboarded) return viewOnboard();
  // Молчаливая потеря данных — худшее, что может случиться. Если хранилище
  // отказалось писать, человек должен узнать об этом сразу, а не на перезагрузке.
  if (S.saveError){ const m = S.saveError; S.clearSaveError(); setTimeout(function(){ toast(m, 6000); }, 60); }
  const sub = $('#viewSub');
  const w = E.currentWeight();
  sub.textContent = view === 'settings' ? '' : num(w,1) + ' кг → ' + S.profile.goalWeight + ' кг';
  ({ today:viewToday, food:viewFood, weight:viewWeight, plan:viewPlan, stats:viewStats, settings:viewSettings, ration:viewRation, lift:viewLift, body:viewBody }[view] || viewToday)();
}

/* ================= ОНБОРДИНГ ================= */
function viewOnboard(){
  const p = S.profile;
  $('#viewTitle').textContent = 'Настройка';
  $('#viewSub').textContent = '';
  main.innerHTML =
  '<div class="view">' +
    '<div class="verdict blue"><div class="t">Один раз заполни — дальше приложение считает само</div>' +
    '<div class="d">Эти цифры нужны, чтобы посчитать твой расход и дефицит. Потом их можно поменять в настройках.</div></div>' +
    '<div class="card">' +
      '<div class="grid2">' +
        '<label class="f"><span>Рост, см</span><input type="number" id="ob-h" value="'+p.height+'" inputmode="numeric"></label>' +
        '<label class="f"><span>Возраст</span><input type="number" id="ob-a" value="'+p.age+'" inputmode="numeric"></label>' +
      '</div>' +
      '<label class="f"><span>Пол</span><div class="chips" id="ob-sex">' +
        '<button class="chip'+(p.sex==='m'?' on':'')+'" data-s="m">Мужской</button>' +
        '<button class="chip'+(p.sex==='f'?' on':'')+'" data-s="f">Женский</button>' +
      '</div></label>' +
      '<div class="grid2">' +
        '<label class="f"><span>Вес сейчас, кг</span><input type="number" step="0.1" id="ob-w" value="'+p.startWeight+'" inputmode="decimal"></label>' +
        '<label class="f"><span>Цель, кг</span><input type="number" step="0.1" id="ob-g" value="'+p.goalWeight+'" inputmode="decimal"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="f"><span>Шагов в будни</span><input type="number" id="ob-sw" value="'+p.stepsWeekday+'" inputmode="numeric"></label>' +
        '<label class="f"><span>Шагов в выходные</span><input type="number" id="ob-se" value="'+p.stepsWeekend+'" inputmode="numeric"></label>' +
      '</div>' +
      '<label class="f"><span>Сколько минут в день готов тратить на движение</span>' +
        '<input type="number" id="ob-t" value="'+p.timeBudgetMin+'" inputmode="numeric"></label>' +
      '<label class="f"><span>Эта рабочая неделя</span><div class="chips" id="ob-wt">' +
        '<button class="chip on" data-w="morning">Утренняя 7–16</button>' +
        '<button class="chip" data-w="evening">Вечерняя 15–00</button>' +
      '</div></label>' +
      '<label class="f"><span>Ограничения: травмы, что не ешь (можно пусто)</span>' +
        '<textarea id="ob-r" placeholder="нет">'+esc(p.restrictions)+'</textarea></label>' +
      '<button class="btn primary block mt" id="ob-go">Начать</button>' +
    '</div>' +
  '</div>';

  let sex = p.sex, wt = 'morning';
  $('#ob-sex').onclick = e => { const b = e.target.closest('.chip'); if(!b) return;
    sex = b.dataset.s; $$('#ob-sex .chip').forEach(x=>x.classList.toggle('on', x===b)); };
  $('#ob-wt').onclick = e => { const b = e.target.closest('.chip'); if(!b) return;
    wt = b.dataset.w; $$('#ob-wt .chip').forEach(x=>x.classList.toggle('on', x===b)); };

  $('#ob-go').onclick = () => {
    const v = id => Number($('#'+id).value);
    const sw = v('ob-w'), gw = v('ob-g');
    if (!(v('ob-h')>100) || !(v('ob-a')>10) || !(sw>30) || !(gw>30)) return toast('Проверь цифры — что-то не заполнено');
    if (gw >= sw) return toast('Цель должна быть меньше текущего веса');
    S.setProfile({
      height:v('ob-h'), age:v('ob-a'), sex, startWeight:sw, goalWeight:gw,
      stepsWeekday:v('ob-sw'), stepsWeekend:v('ob-se'), timeBudgetMin:v('ob-t'),
      restrictions: $('#ob-r').value.trim(), startDate: todayISO(), onboarded:true
    });
    S.setSettings({ weekType: wt, weekAnchor: mondayOf(todayISO()) });
    S.addWeight(sw, todayISO());
    S.pushLog({ kind:'start', text:'Старт: '+sw+' кг, цель '+gw+' кг' });
    go('today');
  };
}

/* ================= СЕГОДНЯ ================= */
function viewToday(){
  const d = todayISO();
  const tg = E.targets();
  const dt = E.dayTotals(d);
  const v = E.verdict();
  const pr = E.progress();
  const left = tg.kcal - dt.kcal;
  const water = S.waterFor(d);
  const health = S.healthFor(d);
  const burned = E.burnedToday(d);
  const bd = E.burnBreakdown(d);
  const sp = E.spentToday(d);
  const bonus = Math.max(0, burned - tg.activityKcal);
  const balance = Math.round(dt.kcal - sp.total);
  const slots = E.ensureSchedule(d);
  const pz = E.praise();
  const done = S.doneFor(d);
  const wToday = S.weightFor(d);

  const pctEaten = tg.kcal ? Math.min(100, dt.kcal/tg.kcal*100) : 0;
  const ringColor = left < 0 ? 'var(--bad)' : (pctEaten > 80 ? 'var(--warn)' : 'var(--accent)');

  main.innerHTML =
  '<div class="view">' +
    '<div class="verdict '+v.kind+'"><div class="t">'+esc(v.title)+'</div><div class="d">'+esc(v.text)+'</div></div>' +

    (pz.length ? '<div class="verdict ok"><div class="t">'+esc(pz[0].big)+'</div><div class="d">'+esc(pz[0].text)+
      (pz[1] ? '<br><b style="color:var(--ok)">'+esc(pz[1].big)+'</b> — '+esc(pz[1].text) : '')+'</div></div>' : '') +

    '<div class="card"><div class="budget">' +
      ring(pctEaten, (left<0?'+':'') + num(Math.abs(left)), left<0?'перебор':'осталось', ringColor) +
      '<div class="budget-side">' +
        meter('Калории', dt.kcal, tg.kcal, 'ккал', left<0?'bad':'accent') +
        meter('Белок', Math.round(dt.p), tg.protein, 'г', dt.p >= tg.protein ? 'ok' : 'warn') +
        meter('Вода', water, tg.water, 'мл', 'blue') +
      '</div>' +
    '</div>' +
    '<div class="btn-row mt">' +
      '<button class="btn primary" id="t-photo">Фото еды</button>' +
      '<button class="btn" id="t-manual">Вручную</button>' +
    '</div>' +
    (L.programFor(todayISO()) ? '<button class="btn primary block mt" id="t-lift">' +
      esc(L.programFor(todayISO()).title) + ' — записать подходы</button>' : '') +

    '<div class="btn-row mt">' +
      '<button class="btn ok" id="t-what">Что съесть?</button>' +
      '<button class="btn" id="t-can">Можно ли?</button>' +
    '</div></div>' +

    '<div class="card">' +
      '<div class="row between mb"><h2 style="margin:0">Сжигание — цель дня</h2>' +
        '<span class="badge '+(bd.pct>=100?'ok':(bd.pct>=60?'warn':'bad'))+'">'+bd.pct+'%</span></div>' +
      '<div class="budget">' +
        ring(bd.pct, num(bd.total), 'из '+num(bd.goal), bd.pct>=100?'var(--ok)':'var(--accent)') +
        '<div class="budget-side">' +
          meter('Шаги', bd.steps, 10000, 'шагов', bd.steps>=10000?'ok':'accent') +
          '<div class="row between small"><span class="muted">Ходьба и шаги</span><b>'+num(bd.stepsKcal + bd.walkKcal)+' ккал</b></div>' +
          '<div class="row between small"><span class="muted">Тренировки</span><b>'+num(bd.trainKcal)+' ккал</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="tiny dim mt">'+(bd.pct >= 100
        ? 'Цель дня взята. Всё сверх неё движок отдаёт тебе обратно едой.'
        : 'До цели ещё '+num(bd.left)+' ккал — это примерно '+num(Math.round(bd.left/(6.1*(tg.weight/100))))+' минут быстрым шагом.')+'</div>' +
      '<div class="row mt"><input type="number" id="t-steps" class="grow" placeholder="шаги вручную" inputmode="numeric">' +
        '<button class="btn sm" id="t-steps-save">ОК</button></div>' +
    '</div>' +

    '<div class="card"><div class="row between mb"><h2 style="margin:0">Баланс дня</h2>' +
      '<span class="badge '+(balance <= 0 ? 'ok':'bad')+'">'+(balance<=0?'−':'+')+num(Math.abs(balance))+' ккал</span></div>' +
      '<div class="grid3 mb">' +
        '<div class="stat"><b>'+num(dt.kcal)+'</b><span>съедено</span></div>' +
        '<div class="stat"><b>'+num(sp.total)+'</b><span>потрачено</span></div>' +
        '<div class="stat" style="background:'+(balance<=0?'var(--ok-soft)':'var(--bad-soft)')+'"><b>'+num(Math.abs(balance))+'</b><span>'+(balance<=0?'дефицит':'профицит')+'</span></div>' +
      '</div>' +
      '<div class="tiny dim">Потрачено = покой '+num(sp.rest)+' + движение '+num(sp.move)+' + переваривание '+num(sp.tef)+'.<br>' +
        (balance<=0
        ? 'Дефицит держится. Таким темпом — '+num(Math.abs(balance)*7/7700, 2)+' кг жира в неделю.'
        : 'Сегодня ты в плюсе. Один такой день ничего не ломает — два подряд ломают неделю.')+'</div>' +
    '</div>' +

    '<div class="card"><div class="row between"><h2 style="margin:0">Вода</h2>' +
      '<span class="small muted">'+num(water)+' / '+num(tg.water)+' мл</span></div>' +
      '<div class="water-grid" id="t-water">' +
        Array.from({length: Math.ceil(tg.water/250)}, (_,i) =>
          '<div class="glass'+(water >= (i+1)*250 ? ' on':'')+'" data-i="'+i+'"></div>').join('') +
      '</div>' +
      '<div class="tiny dim mt">Один стакан = 250 мл. Жми, чтобы отметить.</div>' +
    '</div>' +

    '<div class="card"><div class="row between mb"><h2 style="margin:0">Взвешивание</h2>' +
      (wToday ? '<span class="badge ok">'+num(wToday,1)+' кг</span>' : '<span class="badge warn">нет данных</span>') + '</div>' +
      (wToday
        ? '<div class="row"><div class="grow small muted">Тренд: <b style="color:var(--text)">'+num(E.currentTrendWeight(),1)+' кг</b> · сброшено '+num(pr.lost,1)+' кг</div>' +
          '<button class="btn sm ghost" id="t-wedit">Изменить</button></div>'
        : '<div class="row"><input type="number" step="0.1" id="t-wval" placeholder="'+num(E.currentWeight(),1)+'" inputmode="decimal" class="grow">' +
          '<button class="btn primary" id="t-wsave">Записать</button></div>') +
    '</div>' +

    '<div class="card pad0"><div style="padding:14px 14px 4px"><h2 style="margin:0">Задания на день</h2></div>' +
      '<div style="padding:0 14px 6px" id="t-slots">' +
        slots.map(s => slotHtml(s, done.includes(s.id))).join('') +
      '</div>' +
    '</div>' +

    (dt.n ? '<div class="card pad0"><div style="padding:14px 14px 8px"><h2 style="margin:0">Съедено сегодня</h2></div>' +
      '<ul class="list">' + S.foodFor(d).map(foodLi).join('') + '</ul></div>' : '') +
  '</div>';

  $('#t-photo').onclick = openPhoto;
  $('#t-manual').onclick = openManual;
  if ($('#t-lift')) $('#t-lift').onclick = () => go('lift');
  $('#t-what').onclick = openSuggest;
  $('#t-can').onclick = openJudge;
  $('#t-steps-save').onclick = () => {
    const v = parseInt($('#t-steps').value, 10);
    if (!(v >= 0 && v < 200000)) return toast('Введи количество шагов');
    S.setHealth(d, { steps: v }); toast('Записано'); render();
  };
  $('#t-water').onclick = e => {
    const g = e.target.closest('.glass'); if(!g) return;
    const i = Number(g.dataset.i);
    const cur = S.waterFor(d);
    S.setWater(cur >= (i+1)*250 ? i*250 : (i+1)*250, d);
    render();
  };
  const ws = $('#t-wsave');
  if (ws) ws.onclick = () => {
    const val = Number($('#t-wval').value);
    if (!(val > 30 && val < 400)) return toast('Введи вес в килограммах');
    S.addWeight(val, d); toast('Записано'); render();
  };
  const we = $('#t-wedit');
  if (we) we.onclick = () => { S.delWeight(d); render(); };
  bindSlots(d);
  bindFoodDelete();
}

function slotHtml(s, isDone){
  return '<div class="slot" data-id="'+s.id+'">' +
    '<div class="tm">'+esc(s.time)+'</div>' +
    '<div class="bd"><b>'+esc(s.title)+'</b><p>'+esc(s.desc)+'</p></div>' +
    '<div class="chk"><div class="chk-box'+(isDone?' on':'')+'">✓</div></div>' +
  '</div>';
}
function bindSlots(date){
  const box = $('#t-slots'); if (!box) return;
  box.onclick = e => {
    const s = e.target.closest('.slot'); if(!s) return;
    S.toggleDone(date, s.dataset.id);
    const b = $('.chk-box', s); b.classList.toggle('on');
    if (b.classList.contains('on')) toast('Отмечено');
  };
}
function foodLi(f){
  return '<li data-fid="'+f.id+'"><div class="grow"><div class="nm">'+esc(f.name)+'</div>' +
    '<div class="mt2">'+esc(f.time)+' · '+num(f.grams)+' г · Б '+num(f.p,1)+' Ж '+num(f.f,1)+' У '+num(f.c,1)+'</div></div>' +
    '<div class="kcal">'+num(f.kcal)+'</div><button class="del" data-del>×</button></li>';
}
function bindFoodDelete(){
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = e => {
    const id = e.target.closest('li').dataset.fid;
    S.delFood(id); render();
  });
}

/* ================= ДОБАВЛЕНИЕ ЕДЫ ================= */
function openPhoto(){
  const { el, close } = sheet('Фото еды',
    '<input type="file" accept="image/*" capture="environment" id="p-file" style="display:none">' +
    '<div id="p-stage">' +
      '<button class="btn primary block" id="p-pick">Сделать фото / выбрать</button>' +
      '<div class="tiny dim center mt">Снимай тарелку сверху под углом, чтобы было видно объём. Клади рядом вилку — по ней модель поймёт масштаб.</div>' +
    '</div>');

  const stage = $('#p-stage', el);
  const file = $('#p-file', el);
  $('#p-pick', el).onclick = () => file.click();

  file.onchange = async () => {
    const f = file.files[0]; if(!f) return;
    let img;
    try { img = await G.fileToBase64(f); }
    catch(e){ return toast(e.message); }

    stage.innerHTML =
      '<img class="thumb" src="'+img.dataUrl+'">' +
      '<label class="f"><span>Подсказка модели (не обязательно)</span>' +
      '<input type="text" id="p-hint" placeholder="куриная грудка, рис, без масла"></label>' +
      '<button class="btn primary block" id="p-run"><span class="spin"></span> Считаю…</button>';

    const run = async () => {
      const btn = $('#p-run', el);
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Считаю…';
      try{
        const r = await G.analyzePhoto(img.base64, img.mime, $('#p-hint', el).value.trim());
        if (!r.ok || !r.items.length){
          btn.disabled = false; btn.textContent = 'Попробовать снова';
          return toast(r.note || 'Еду на фото распознать не удалось');
        }
        showConfirm(r.items, r.note, close, img.dataUrl);
      }catch(e){
        btn.disabled = false; btn.textContent = 'Повторить';
        toast(e.message);
      }
    };
    $('#p-run', el).onclick = run;
    run();
  };
}

function openManual(){
  const { el, close } = sheet('Добавить еду',
    '<label class="f"><span>Опиши словами — модель посчитает</span>' +
      '<textarea id="m-text" placeholder="тарелка борща со сметаной, два куска хлеба и котлета"></textarea></label>' +
    '<button class="btn primary block" id="m-ai">Посчитать через AI</button>' +
    '<hr class="sep">' +
    '<div class="tiny muted mb">Или введи цифры сам, если знаешь:</div>' +
    '<label class="f"><span>Название</span><input type="text" id="m-n" placeholder="Творог 5%"></label>' +
    '<div class="grid2">' +
      '<label class="f"><span>Граммы</span><input type="number" id="m-g" inputmode="numeric"></label>' +
      '<label class="f"><span>Ккал</span><input type="number" id="m-k" inputmode="numeric"></label>' +
    '</div>' +
    '<div class="grid3">' +
      '<label class="f"><span>Белок</span><input type="number" step="0.1" id="m-p" inputmode="decimal"></label>' +
      '<label class="f"><span>Жир</span><input type="number" step="0.1" id="m-f" inputmode="decimal"></label>' +
      '<label class="f"><span>Углев.</span><input type="number" step="0.1" id="m-c" inputmode="decimal"></label>' +
    '</div>' +
    '<button class="btn block" id="m-save">Записать</button>');

  $('#m-ai', el).onclick = async () => {
    const t = $('#m-text', el).value.trim();
    if (!t) return toast('Опиши, что съел');
    const btn = $('#m-ai', el);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Считаю…';
    try{
      const r = await G.analyzeText(t);
      if (!r.items.length){ btn.disabled=false; btn.textContent='Повторить'; return toast(r.note || 'Не понял, что это'); }
      showConfirm(r.items, r.note, close, null);
    }catch(e){ btn.disabled=false; btn.textContent='Повторить'; toast(e.message); }
  };

  $('#m-save', el).onclick = () => {
    const g = id => Number($('#'+id, el).value) || 0;
    const name = $('#m-n', el).value.trim();
    if (!name) return toast('Введи название');
    let kcal = g('m-k');
    if (!kcal) kcal = g('m-p')*4 + g('m-f')*9 + g('m-c')*4;
    if (!kcal) return toast('Нужны калории или БЖУ');
    S.addFood({ name, grams:g('m-g'), kcal, p:g('m-p'), f:g('m-f'), c:g('m-c'), src:'manual' });
    close(); toast('Записано'); render();
  };
}

function showConfirm(items, note, closeParent, dataUrl){
  closeParent();
  const total = items.reduce((a,i)=>({k:a.k+i.kcal,p:a.p+i.p,f:a.f+i.f,c:a.c+i.c}),{k:0,p:0,f:0,c:0});
  const tg = E.targets();
  const after = E.dayTotals(todayISO()).kcal + total.k;
  const over = after > tg.kcal;

  const { el, close } = sheet('Проверь и подтверди',
    (dataUrl ? '<img class="thumb" src="'+dataUrl+'">' : '') +
    (note ? '<div class="verdict blue" style="margin-bottom:12px"><div class="d">'+esc(note)+'</div></div>' : '') +
    '<div id="c-items">' + items.map((i,ix) =>
      '<div class="card" style="margin-bottom:8px" data-ix="'+ix+'">' +
        '<div class="row between mb"><input type="text" class="grow" data-n value="'+esc(i.name)+'" style="border:none;background:none;padding:0;font-weight:600">' +
        '<button class="del" data-rm>×</button></div>' +
        '<div class="grid2">' +
          '<label class="f" style="margin:0"><span>Граммы</span><input type="number" data-g value="'+i.grams+'" inputmode="numeric"></label>' +
          '<label class="f" style="margin:0"><span>Ккал</span><input type="number" data-k value="'+i.kcal+'" inputmode="numeric"></label>' +
        '</div>' +
        '<div class="grid3 mt">' +
          '<label class="f" style="margin:0"><span>Б</span><input type="number" step="0.1" data-p value="'+i.p+'" inputmode="decimal"></label>' +
          '<label class="f" style="margin:0"><span>Ж</span><input type="number" step="0.1" data-f value="'+i.f+'" inputmode="decimal"></label>' +
          '<label class="f" style="margin:0"><span>У</span><input type="number" step="0.1" data-c value="'+i.c+'" inputmode="decimal"></label>' +
        '</div>' +
        '<div class="tiny dim mt">Уверенность модели: '+esc(i.confidence||'средняя')+'</div>' +
      '</div>').join('') + '</div>' +
    '<div class="verdict '+(over?'bad':'ok')+'"><div class="t">Итого ' + num(total.k) + ' ккал</div>' +
    '<div class="d">' + (over
      ? 'После этого приёма ты выйдешь за лимит на ' + num(after - tg.kcal) + ' ккал. Съешь половину порции или сначала отработай ходьбой.'
      : 'После этого останется ' + num(tg.kcal - after) + ' ккал на день.') + '</div></div>' +
    '<div class="btn-row"><button class="btn ghost" data-x>Отмена</button>' +
    '<button class="btn primary" data-ok>Записать</button></div>',
    (m, cl) => {
      $('[data-x]', m).onclick = cl;
      $('#c-items', m).onclick = e => {
        const rm = e.target.closest('[data-rm]'); if(!rm) return;
        rm.closest('.card').remove();
      };
      $('[data-ok]', m).onclick = () => {
        const cards = $$('#c-items .card', m);
        if (!cards.length) { cl(); return; }
        cards.forEach(c => {
          const g = a => Number($('[data-'+a+']', c).value) || 0;
          S.addFood({
            name: $('[data-n]', c).value.trim() || 'Блюдо',
            grams:g('g'), kcal:g('k'), p:g('p'), f:g('f'), c:g('c'), src:'ai'
          });
        });
        cl(); toast('Записано в дневник'); render();
      };
    });
}

/* ================= ЧТО СЪЕСТЬ ================= */
function openSuggest(){
  const { el, close } = sheet('Что съесть',
    '<label class="f"><span>Чего хочется? (не обязательно)</span>' +
      '<input type="text" id="sg-wish" placeholder="сладкого / мяса / что-то быстрое"></label>' +
    '<button class="btn primary block" id="sg-go">Спросить</button>' +
    '<div id="sg-out" class="mt"></div>');

  const run = async () => {
    const btn = $('#sg-go', el);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Думаю…';
    try{
      const r = await G.suggestMeal(E.todayContext(), $('#sg-wish', el).value.trim());
      $('#sg-out', el).innerHTML =
        (r.verdict ? '<div class="verdict blue"><div class="d">'+esc(r.verdict)+'</div></div>' : '') +
        (r.options||[]).map((o,i) =>
          '<div class="card" style="margin-bottom:8px">' +
            '<div class="row between mb"><b>'+esc(o.name)+'</b><span class="badge accent">'+num(o.kcal)+' ккал</span></div>' +
            '<div class="tiny dim mb">Б '+num(o.p,1)+' · Ж '+num(o.f,1)+' · У '+num(o.c,1)+'</div>' +
            '<div class="small muted">'+esc(o.why||'')+'</div>' +
            (o.how ? '<div class="tiny dim mt">'+esc(o.how)+'</div>' : '') +
            '<button class="btn sm block mt" data-eat="'+i+'">Съел это — записать</button>' +
          '</div>').join('');
      const opts = r.options || [];
      $$('[data-eat]', el).forEach(b => b.onclick = () => {
        const o = opts[Number(b.dataset.eat)];
        S.addFood({ name:o.name, grams:0, kcal:o.kcal, p:o.p, f:o.f, c:o.c, src:'ai-suggest' });
        close(); toast('Записано'); render();
      });
      btn.disabled = false; btn.textContent = 'Спросить ещё раз';
    }catch(e){ btn.disabled = false; btn.textContent = 'Повторить'; toast(e.message); }
  };
  $('#sg-go', el).onclick = run;
  run();
}

/* ================= МОЖНО ЛИ ================= */
function openJudge(){
  const { el, close } = sheet('Можно ли это съесть',
    '<label class="f"><span>Что хочешь съесть</span>' +
      '<input type="text" id="jd-t" placeholder="шаурма / два куска пиццы / банан"></label>' +
    '<button class="btn primary block" id="jd-go">Спросить</button>' +
    '<div id="jd-out" class="mt"></div>');

  const inp = $('#jd-t', el);
  setTimeout(()=>inp.focus(), 100);
  inp.onkeydown = e => { if (e.key === 'Enter') $('#jd-go', el).click(); };

  $('#jd-go', el).onclick = async () => {
    const t = inp.value.trim();
    if (!t) return toast('Напиши, что хочешь съесть');
    const btn = $('#jd-go', el);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Считаю…';

    // локальный приговор считаем сами — он не врёт и работает без сети
    try{
      const r = await G.judgeFood(t, E.todayContext());
      const local = E.ruleFood(r.kcal || 0, r.p);
      const v = String(r.verdict||'').toLowerCase();
      const kind = local.level === 'no' ? 'bad' : (local.level === 'half' ? 'warn' : 'ok');
      const title = local.level === 'no' ? 'НЕЛЬЗЯ' : (local.level === 'half' ? 'ПОЛОВИНУ' : 'МОЖНО');

      $('#jd-out', el).innerHTML =
        '<div class="verdict '+kind+'"><div class="t">'+title+' — '+esc(r.name||t)+' ≈ '+num(r.kcal)+' ккал</div>' +
        '<div class="d">'+esc(local.text)+'</div></div>' +
        (r.reason ? '<div class="card"><div class="small muted">'+esc(r.reason)+'</div>' +
          (r.alternative ? '<div class="small mt" style="color:var(--ok)">Вместо этого: '+esc(r.alternative)+'</div>' : '') + '</div>' : '') +
        (local.level !== 'no'
          ? '<button class="btn block" id="jd-eat">' + (local.level==='half' ? 'Съел половину — записать' : 'Съел — записать') + '</button>'
          : '<div class="tiny dim center">Записать это нельзя — сначала отработай или дождись завтра.</div>');

      const eat = $('#jd-eat', el);
      if (eat) eat.onclick = () => {
        const k = local.level === 'half' ? 0.5 : 1;
        S.addFood({ name:(r.name||t) + (k<1?' (половина)':''), grams:0,
          kcal:(r.kcal||0)*k, p:(r.p||0)*k, f:(r.f||0)*k, c:(r.c||0)*k, src:'ai-judge' });
        close(); toast('Записано'); render();
      };
      btn.disabled = false; btn.textContent = 'Спросить про другое';
    }catch(e){ btn.disabled = false; btn.textContent = 'Повторить'; toast(e.message); }
  };
}

/* ================= ДНЕВНИК ЕДЫ ================= */
function viewFood(){
  const days = [];
  for (let i = 0; i < 14; i++) days.push(addDays(todayISO(), -i));
  const tg = E.targets();

  main.innerHTML =
  '<div class="view">' +
    '<button class="btn ok block mb" id="f-ration">Рацион на неделю и список покупок</button>' +
    '<div class="btn-row mb">' +
      '<button class="btn primary" id="f-photo">Фото еды</button>' +
      '<button class="btn" id="f-pack">Упаковка</button>' +
      '<button class="btn" id="f-manual">Вручную</button>' +
    '</div>' +
    quickCard() +
    days.map(d => {
      const items = S.foodFor(d);
      const t = E.dayTotals(d);
      if (!items.length && d !== todayISO()) return '';
      const over = t.kcal > tg.kcal;
      return '<div class="card pad0">' +
        '<div style="padding:12px 14px" class="row between">' +
          '<div><b>'+(d===todayISO()?'Сегодня':(d===addDays(todayISO(),-1)?'Вчера':fmtDate(d)))+'</b>' +
          '<div class="tiny dim">'+dowRu(d)+' · Б '+num(t.p)+' Ж '+num(t.f)+' У '+num(t.c)+'</div></div>' +
          '<span class="badge '+(items.length ? (over?'bad':'ok') : 'warn')+'">'+num(t.kcal)+' / '+num(tg.kcal)+'</span>' +
        '</div>' +
        (items.length ? '<ul class="list">'+items.map(foodLi).join('')+'</ul>'
                      : '<div class="empty">Пусто. Записанная еда — половина результата.</div>') +
      '</div>';
    }).join('') +
  '</div>';

  $('#f-ration').onclick = () => go('ration');
  $('#f-photo').onclick = openPhoto;
  $('#f-pack').onclick = openPack;
  $('#f-manual').onclick = openManual;
  bindQuick();
  bindFoodDelete();
}

/* ================= РАЦИОН ================= */
function viewRation(){
  const mp = S.mealPlan;
  const tg = E.targets();
  const sessions = E.cookingSessions();
  const shop = E.shoppingList();
  const todayDow = E.dowOf(todayISO());

  const dayCard = dow => {
    const day = (mp.assign || {})[String(dow)] || {};
    const ids = ['breakfast','lunch','snack','dinner'].map(sl => day[sl]);
    const base = ids.reduce((s,id)=>s + ((E.BY_ID(id)||{}).kcal || 0), 0);
    const k = base ? tg.kcal / base : 1;
    const prot = Math.round(ids.reduce((s,id)=>s + ((E.BY_ID(id)||{}).p || 0), 0) * k);
    const isToday = dow === todayDow;
    return '<div class="card"'+(isToday?' style="border-color:var(--accent)"':'')+'>' +
      '<div class="row between mb"><b>'+esc(DOW_FULL[dow])+(isToday?' <span class="badge accent">сегодня</span>':'')+'</b>' +
        '<span class="badge '+(prot >= tg.protein*0.95 ? 'ok':'warn')+'">'+num(prot)+' г белка</span></div>' +
      ['breakfast','lunch','snack','dinner'].map(sl => {
        const r = E.BY_ID(day[sl]);
        return '<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)" data-pick="'+dow+'|'+sl+'">' +
          '<div class="grow"><div class="tiny dim">'+esc(SLOT_RU[sl])+'</div>' +
          '<div class="small">'+esc(r ? r.name : 'не выбрано')+'</div></div>' +
          '<span class="small muted" style="white-space:nowrap">'+(r?num(Math.round(r.kcal*k))+' ккал':'')+' ›</span>' +
        '</div>';
      }).join('') +
    '</div>';
  };

  main.innerHTML =
  '<div class="view">' +
    '<div class="card">' +
      '<div class="row between mb"><h2 style="margin:0">Рацион недели</h2>' +
        '<span class="badge '+(mp.enabled?'ok':'warn')+'">'+(mp.enabled?'включён':'выключен')+'</span></div>' +
      '<div class="tiny muted mb">Готовишь два раза в неделю и раскладываешь по контейнерам. Приложение подставит эти блюда в расписание дня и пересчитает граммовку под твой лимит — сейчас '+num(tg.kcal)+' ккал.</div>' +
      '<div class="btn-row">' +
        '<button class="btn '+(mp.enabled?'':'primary')+'" id="r-toggle">'+(mp.enabled?'Выключить рацион':'Включить рацион')+'</button>' +
        '<button class="btn" id="r-regen">Пересобрать</button>' +
      '</div>' +
    '</div>' +

    '<div class="card"><h2>Что ты ешь</h2>' +
      '<div class="tiny muted mb">AI соберёт рацион под это. Запреты соблюдаются строго — продукт из списка «не ем» не появится ни в одном блюде.</div>' +
      '<div class="chips mb" id="r-tags">' +
        FOOD_TAGS.map(t => '<button class="chip'+(((S.settings.food||{}).tags||[]).includes(t)?' on':'')+'" data-tag="'+esc(t)+'">'+esc(t)+'</button>').join('') +
      '</div>' +
      '<label class="f"><span>Не ем совсем</span>' +
        '<input type="text" id="r-avoid" value="'+esc((S.settings.food||{}).avoid||'')+'" placeholder="печень, кинза, грибы"></label>' +
      '<label class="f"><span>Люблю, ставь почаще</span>' +
        '<input type="text" id="r-like" value="'+esc((S.settings.food||{}).like||'')+'" placeholder="курица, паста, острое"></label>' +
      '<button class="btn primary block" id="r-ai">Собрать рацион под меня через AI</button>' +
      (S.customRecipes.length ? '<div class="tiny mt" style="color:var(--ok)">Твоих блюд в библиотеке: '+S.customRecipes.length+'. Кнопка «Пересобрать» тасует именно их.</div>'
                              : '<div class="tiny dim mt">Пока используется встроенная библиотека из '+RECIPE_COUNT+' блюд.</div>') +
      '<div id="r-ai-out" class="mt"></div>' +
    '</div>' +

    '<div class="card"><h2>Дни готовки</h2>' +
      '<div class="chips" id="r-cook">' +
        [1,2,3,4,5,6,7].map(d => '<button class="chip'+((mp.cookDays||[]).includes(d)?' on':'')+'" data-cd="'+d+'">'+esc(DOW_RU[d])+'</button>').join('') +
      '</div>' +
      '<div class="tiny dim mt">Отметь дни, когда тебе удобно встать к плите. Неделя разобьётся на блоки, и каждый блок ты готовишь один раз. Два дня — оптимум: мясо в холодильнике живёт 3–4 дня.</div>' +
    '</div>' +

    sessions.map(s =>
      '<div class="card"><div class="row between mb">' +
        '<h2 style="margin:0">Готовка: '+esc(DOW_FULL[s.cookDow])+'</h2>' +
        '<span class="badge blue">~'+num(s.totalMin)+' мин</span></div>' +
      '<div class="tiny muted mb">Закрывает дни: '+s.days.map(d=>esc(DOW_RU[d])).join(', ')+'</div>' +
      (s.dishes.length ? s.dishes.map(d =>
        '<div style="padding:9px 0;border-bottom:1px solid var(--line)">' +
          '<div class="row between"><b class="small">'+esc(d.recipe.name)+'</b>' +
          '<span class="badge '+(d.tooLong?'warn':'ok')+'">'+d.portions+' '+plural(d.portions,'порция','порции','порций')+'</span></div>' +
          '<div class="tiny dim mt">'+esc(d.recipe.how)+'</div>' +
          (d.tooLong ? '<div class="tiny mt" style="color:var(--warn)">Хранится '+d.recipe.keeps+' '+plural(d.recipe.keeps,'день','дня','дней')+', а порций '+d.portions+'. Последние убери в морозилку сразу, а не когда запахнет.</div>' : '') +
        '</div>').join('') : '<div class="empty">В этом блоке нечего готовить впрок</div>') +
      '</div>').join('') +

    '<div class="card"><div class="row between mb"><h2 style="margin:0">Список покупок</h2>' +
      '<button class="btn sm ghost" id="r-copy">Скопировать</button></div>' +
      '<div id="r-shop"><div class="tiny dim center">Считаю цены…</div></div>' +
    '</div>' +

    '<div class="card"><h2>Неделя по дням</h2>' +
      '<div class="tiny muted">Нажми на любой приём пищи, чтобы поменять блюдо.</div></div>' +
    [1,2,3,4,5,6,7].map(dayCard).join('') +
  '</div>';

  const saveFood = () => S.setSettings({ food: {
    avoid: $('#r-avoid').value.trim(),
    like:  $('#r-like').value.trim(),
    tags:  ((S.settings.food||{}).tags)||[]
  }});

  $('#r-tags').onclick = e => {
    const b = e.target.closest('.chip'); if(!b) return;
    const t = b.dataset.tag;
    const f = S.settings.food || { avoid:'', like:'', tags:[] };
    const tags = (f.tags||[]).includes(t) ? f.tags.filter(x=>x!==t) : (f.tags||[]).concat([t]);
    S.setSettings({ food: { avoid: $('#r-avoid').value.trim(), like: $('#r-like').value.trim(), tags } });
    render();
  };

  $('#r-ai').onclick = async () => {
    saveFood();
    const btn = $('#r-ai');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Собираю рацион…';
    const tg = E.targets();
    const f = S.settings.food || {};
    try{
      const r = await G.buildMealPlan({
        лимит_ккал_в_день: tg.kcal,
        белок_в_день_г: tg.protein,
        вес_кг: tg.weight,
        не_ем: [f.avoid, (f.tags||[]).join(', ')].filter(Boolean).join('; ') || 'нет',
        люблю: f.like || 'нет особых пожеланий',
        ограничения_здоровья: S.profile.restrictions || 'нет',
        дней_готовки_в_неделю: (S.mealPlan.cookDays||[]).length
      });
      const dishes = E.adoptAiDishes(r.dishes);
      const need = ['breakfast','lunch','snack','dinner'].filter(sl => !dishes.some(d => d.slot === sl));
      if (need.length){
        btn.disabled = false; btn.textContent = 'Попробовать ещё раз';
        $('#r-ai-out').innerHTML = '<div class="verdict warn"><div class="t">Набор неполный</div>' +
          '<div class="d">Модель не дала блюда для: '+need.map(x=>esc(SLOT_RU[x])).join(', ')+'. Нажми ещё раз.</div></div>';
        return;
      }
      S.setCustomRecipes(dishes);
      S.setMealPlan({ enabled: true, assign: E.autoPlanWeek(0, true) });
      S.clearScheduleFrom(mondayOf(todayISO()));
      render();
      toast('Собрал ' + dishes.length + ' ' + plural(dishes.length,'блюдо','блюда','блюд') + ' под тебя');
    }catch(e){
      btn.disabled = false; btn.textContent = 'Повторить';
      $('#r-ai-out').innerHTML = '<div class="verdict bad"><div class="t">Не вышло</div><div class="d">'+esc(e.message)+'</div></div>';
    }
  };

  $('#r-toggle').onclick = () => {
    if (!mp.enabled && !Object.keys(mp.assign || {}).length) S.setMealPlan({ assign: E.autoPlanWeek(0, S.customRecipes.length > 0) });
    S.setMealPlan({ enabled: !mp.enabled });
    S.clearScheduleFrom(mondayOf(todayISO()));
    render();
    toast(!mp.enabled ? 'Рацион подставлен в расписание' : 'Вернул обычное меню');
  };
  $('#r-regen').onclick = () => {
    const seed = Math.floor((Date.now()/1000) % 97);
    S.setMealPlan({ assign: E.autoPlanWeek(seed, S.customRecipes.length > 0) });
    S.clearScheduleFrom(mondayOf(todayISO()));
    render(); toast('Собрал другой набор блюд');
  };
  $('#r-cook').onclick = e => {
    const b = e.target.closest('.chip'); if(!b) return;
    const d = Number(b.dataset.cd);
    let cd = (S.mealPlan.cookDays || []).slice();
    cd = cd.includes(d) ? cd.filter(x=>x!==d) : cd.concat([d]);
    if (!cd.length) return toast('Хотя бы один день готовки нужен');
    if (cd.length > 3) return toast('Больше трёх дней готовки — это уже каждый день у плиты');
    S.setMealPlan({ cookDays: cd.sort((x,y)=>x-y), assign: E.autoPlanWeek(0, S.customRecipes.length > 0) });
    S.clearScheduleFrom(mondayOf(todayISO()));
    render();
  };
  $('#r-copy').onclick = async () => {
    await P.loadPrices();
    const list = E.shoppingList();
    const b = P.basket(list);
    const line = r => r.name + ' — ' + (r.unit==='кг'?num(r.qty,1):num(r.qty)) + ' ' + r.unit +
      (r.found ? '  (' + r.best.product + ', ' + MONEY(r.cost) + ')' : '');
    const text = b.stores.map(st => st.name.toUpperCase() + ' — ' + MONEY(st.sum) + '\n' +
        st.items.map(line).join('\n')).join('\n\n') +
      (b.missing ? '\n\nБЕЗ ЦЕНЫ\n' + b.rows.filter(r=>!r.found).map(line).join('\n') : '') +
      '\n\nИТОГО ' + MONEY(b.total);
    try { await navigator.clipboard.writeText(text); toast('Список в буфере'); }
    catch(_){ sheet('Список покупок', '<textarea readonly style="min-height:280px">'+esc(text)+'</textarea>'); }
  };
  $$('[data-pick]').forEach(el => el.onclick = () => {
    const [dow, slot] = el.dataset.pick.split('|');
    pickDish(Number(dow), slot);
  });

  renderShopping(shop);
}

/* ---------- список покупок с ценами ---------- */
const MONEY = v => (Math.round(v*100)/100).toFixed(2).replace('.', ',') + ' €';
const DMY = iso => { const p = String(iso||'').split('-'); return p.length===3 ? (p[2]+'.'+p[1]) : ''; };
let shopMode = 'best';

function itemRow(r, withStore){
  const it = r.best;
  if (!it){
    return '<div class="shop-item gone"><div class="body">' +
      '<div class="ttl">' + esc(r.name) + ' <span class="qty">' + num(r.qty, r.unit==='кг'?1:0) + ' ' + esc(r.unit) + '</span></div>' +
      '<div class="sub">цены пока нет</div>' +
      '</div></div>';
  }
  const sale = it.old && it.old > it.price;
  return '<div class="shop-item"><div class="body">' +
    '<div class="ttl">' + esc(r.name) + ' <span class="qty">' + num(r.qty, r.unit==='кг'?1:0) + ' ' + esc(r.unit) + '</span></div>' +
    '<div class="sub">' +
      (withStore ? esc(P.storeName(it.store)) + ' · ' : '') + esc(it.product) + ' · ' + MONEY(it.per) + '/' + esc(it.base) +
      (r.away ? ' <span class="pill flyer">только в ' + esc(P.storeName(it.store)) + '</span>' : '') +
      (sale ? ' <span class="pill sale">−' + Math.round((1 - it.price/it.old)*100) + '%</span>' : '') +
      (it.until ? ' <span class="pill till">до ' + DMY(it.until) + '</span>' : '') +
      (it.fromFlyer ? ' <span class="pill flyer">с листовки</span>' : '') +
    '</div></div>' +
    '<div class="pr">' + MONEY(r.cost) + '</div>' +
  '</div>';
}

function pickDish(dow, slot){
  const cur = S.mealFor(dow, slot);
  const list = E.BY_SLOT(slot);
  sheet(SLOT_RU[slot] + ' — ' + DOW_FULL[dow],
    list.map(r =>
      '<div class="card" style="margin-bottom:8px;'+(r.id===cur?'border-color:var(--accent)':'')+'" data-rid="'+r.id+'">' +
        '<div class="row between mb"><b>'+esc(r.name)+'</b>' +
        '<span class="badge '+(r.id===cur?'accent':'blue')+'">'+r.kcal+' ккал</span></div>' +
        '<div class="tiny dim">Б '+r.p+' · Ж '+r.f+' · У '+r.c+' · готовка '+r.cookMin+' мин' +
        (r.batch ? ' · впрок, хранится '+r.keeps+' '+plural(r.keeps,'день','дня','дней') : ' · готовится на месте') + '</div>' +
        '<div class="small muted mt">'+esc(r.how)+'</div>' +
      '</div>').join('') +
    '<div class="tiny dim center">Калорийность подгонится под твой дневной лимит автоматически.</div>',
    (m, close) => {
      $$('[data-rid]', m).forEach(c => c.onclick = () => {
        S.setMeal(dow, slot, c.dataset.rid);
        S.clearScheduleFrom(mondayOf(todayISO()));
        close(); render(); toast('Поставил');
      });
    });
}

/* ================= ВЕС ================= */
function viewWeight(){
  const p = S.profile;
  const t = E.weightTrend();
  const pr = E.progress();
  const d = todayISO();
  const wToday = S.weightFor(d);

  main.innerHTML =
  '<div class="view">' +
    '<div class="card">' +
      (wToday
        ? '<div class="row between"><div><b style="font-size:22px">'+num(wToday,1)+' кг</b>' +
          '<div class="tiny dim">записано сегодня · тренд '+num(E.currentTrendWeight(),1)+' кг</div></div>' +
          '<button class="btn sm ghost" id="w-edit">Изменить</button></div>'
        : '<label class="f"><span>Вес сегодня, кг</span><div class="row">' +
          '<input type="number" step="0.1" id="w-val" class="grow" placeholder="'+num(E.currentWeight(),1)+'" inputmode="decimal">' +
          '<button class="btn primary" id="w-save">Записать</button></div></label>') +
    '</div>' +

    '<button class="btn ok block mb" id="w-body">Замеры сантиметром и фото прогресса' +
      (B.isDue() ? ' — пора' : '') + '</button>' +

    '<div class="card">' +
      '<div class="grid3 mb">' +
        '<div class="stat"><b>'+num(pr.lost,1)+'</b><span>сброшено, кг</span></div>' +
        '<div class="stat"><b>'+num(pr.togo,1)+'</b><span>осталось, кг</span></div>' +
        '<div class="stat"><b>'+(pr.rate!==null?num(pr.rate,2):'—')+'</b><span>кг/нед факт</span></div>' +
      '</div>' +
      '<div class="meter"><div class="lab"><span class="muted">Путь к цели</span><b>'+pr.pct+'%</b></div>' +
      '<div class="bar"><i class="ok" style="width:'+pr.pct+'%"></i></div></div>' +
      '<div class="tiny dim mt">Прогноз достижения '+p.goalWeight+' кг: <b style="color:var(--text)">'+fmtDate(pr.eta)+'</b>' +
      (pr.weeksLeft ? ' (~'+num(pr.weeksLeft,1)+' нед)' : '') + '</div>' +
    '</div>' +

    '<div class="card"><h2>График</h2>' +
      (t.length >= 2 ? '<div class="chart-wrap">'+chartSVG(t)+'</div>'
        : '<div class="empty">Нужно минимум 2 взвешивания. Взвешивайся каждое утро — важна не отдельная цифра, а линия.</div>') +
      '<div class="tiny dim mt">Оранжевая линия — тренд (среднее за 7 дней). Точки — дневной вес: он скачет на 1–2 кг от воды и соли, на него смотреть бесполезно.</div>' +
    '</div>' +

    '<div class="card pad0"><div style="padding:14px 14px 8px"><h2 style="margin:0">История</h2></div>' +
      (S.weights.length ? '<ul class="list">' + S.weights.slice().reverse().slice(0,30).map(w => {
        const tr = t.find(x=>x.date===w.date);
        return '<li><div class="grow"><div class="nm">'+num(w.kg,1)+' кг</div>' +
          '<div class="mt2">'+fmtDate(w.date)+' · '+dowRu(w.date)+(tr?' · тренд '+num(tr.trend,1):'')+'</div></div>' +
          '<button class="del" data-wdel="'+w.date+'">×</button></li>';
      }).join('') + '</ul>' : '<div class="empty">Пока пусто</div>') +
    '</div>' +
  '</div>';

  $('#w-body').onclick = () => go('body');
  const ws = $('#w-save');
  if (ws) ws.onclick = () => {
    const val = Number($('#w-val').value);
    if (!(val > 30 && val < 400)) return toast('Введи вес в килограммах');
    S.addWeight(val, d); toast('Записано'); render();
  };
  const we = $('#w-edit');
  if (we) we.onclick = () => { S.delWeight(d); render(); };
  $$('[data-wdel]').forEach(b => b.onclick = () => { S.delWeight(b.dataset.wdel); render(); });
}

function chartSVG(t){
  const W = 520, H = 190, L = 34, R = 10, T = 14, B = 24;
  const p = S.profile;
  const all = t.map(x=>x.kg).concat(t.map(x=>x.trend)).concat([p.goalWeight]);
  let min = Math.min(...all) - 0.8, max = Math.max(...all) + 0.8;
  if (max - min < 3){ const c=(max+min)/2; min=c-1.5; max=c+1.5; }
  const x = i => L + (t.length<2?0:i*(W-L-R)/(t.length-1));
  const y = v => T + (max - v)/(max - min) * (H-T-B);

  const grid = [0,0.25,0.5,0.75,1].map(f => {
    const v = max - f*(max-min), yy = y(v);
    return '<line class="grid-l" x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'"/>' +
           '<text x="2" y="'+(yy+3).toFixed(1)+'">'+v.toFixed(1)+'</text>';
  }).join('');

  const goalY = y(p.goalWeight);
  const goalLine = (p.goalWeight >= min && p.goalWeight <= max)
    ? '<line class="goal-l" x1="'+L+'" y1="'+goalY.toFixed(1)+'" x2="'+(W-R)+'" y2="'+goalY.toFixed(1)+'"/>' +
      '<text x="'+(W-R-26)+'" y="'+(goalY-5).toFixed(1)+'" style="fill:var(--ok)">цель</text>' : '';

  const pts = t.map((d,i)=>'<circle class="pt" cx="'+x(i).toFixed(1)+'" cy="'+y(d.kg).toFixed(1)+'" r="2.2" opacity=".55"/>').join('');
  const line = 'M' + t.map((d,i)=> x(i).toFixed(1)+','+y(d.trend).toFixed(1)).join(' L');

  const labels = [0, Math.floor((t.length-1)/2), t.length-1].filter((v,i,a)=>a.indexOf(v)===i)
    .map(i => '<text x="'+x(i).toFixed(1)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':(i===t.length-1?'end':'middle'))+'">'+fmtDate(t[i].date)+'</text>').join('');

  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">' +
    grid + goalLine + pts + '<path class="trend-l" d="'+line+'"/>' + labels + '</svg>';
}

/* ================= ПЛАН ================= */
function viewPlan(){
  const today = todayISO();
  const mon = mondayOf(today);
  const days = Array.from({length:7}, (_,i)=> addDays(mon, i));
  const wt = E.weekTypeFor(today);

  main.innerHTML =
  '<div class="view">' +
'<button class="btn primary block mb" id="p-lift">Журнал силовых</button>' +

    remindCard() +

    '<div class="card">' +
      '<h2>Рабочая неделя</h2>' +
      '<div class="chips" id="p-wt">' +
        '<button class="chip'+(wt==='morning'?' on':'')+'" data-w="morning">Утро 7–16</button>' +
        '<button class="chip'+(wt==='evening'?' on':'')+'" data-w="evening">Вечер 15–00</button>' +
      '</div>' +
      '<div class="tiny dim mt">Недели чередуются автоматически. Если сбилось — переключи здесь, план пересоберётся.</div>' +
    '</div>' +

    '<div class="card"><h2>Сон — от него считается весь день</h2>' +
      '<div class="tiny muted mb">Поставь подъём и отбой. Приёмы пищи, окно питания, вода и добавки пересчитаются сами: завтрак через 30 мин после подъёма, ужин за 2,5 часа до сна, магний за час до отбоя.</div>' +
      [['morning','Неделя 7–16'],['evening','Неделя 15–00'],['weekend','Выходные']].map(([k,t]) => {
        const sl = (S.settings.sleep && S.settings.sleep[k]) || {wake:'',bed:''};
        const sh = sleepHours(sl.wake, sl.bed);
        return '<div class="row mb" style="gap:8px">' +
          '<span class="small muted" style="flex:0 0 96px">'+esc(t)+'</span>' +
          '<input type="time" data-sl="'+k+'" data-side="wake" value="'+esc(sl.wake)+'" class="grow">' +
          '<span class="dim">—</span>' +
          '<input type="time" data-sl="'+k+'" data-side="bed" value="'+esc(sl.bed)+'" class="grow">' +
          '<span class="badge '+(sh>=7?'ok':(sh>=6?'warn':'bad'))+'" style="flex:0 0 auto">'+num(sh,1)+' ч</span>' +
        '</div>';
      }).join('') +
      '<button class="btn primary block mt" id="p-sleep-save">Сохранить сон</button>' +
    '</div>' +

    '<div class="card"><h2>Окно питания</h2>' +
      '<div class="tiny muted mb">Первый и последний приём пищи. Четыре приёма разложатся внутри равномерно, а кухня закроется через полчаса после последнего. Оставь пусто — приложение посчитает от сна само.</div>' +
      [['morning','Неделя 7–16'],['evening','Неделя 15–00'],['weekend','Выходные']].map(([k,t]) => {
        const ec = (S.settings.eat && S.settings.eat[k]) || {from:'',to:''};
        const prev = previewMeals(k);
        return '<div class="mb">' +
          '<div class="row" style="gap:8px">' +
            '<span class="small muted" style="flex:0 0 96px">'+esc(t)+'</span>' +
            '<input type="time" data-eat="'+k+'" data-side="from" value="'+esc(ec.from||'')+'" class="grow">' +
            '<span class="dim">—</span>' +
            '<input type="time" data-eat="'+k+'" data-side="to" value="'+esc(ec.to||'')+'" class="grow">' +
          '</div>' +
          '<div class="tiny dim" style="padding-left:104px;margin-top:3px">' +
            (ec.from && ec.to ? '' : 'авто · ') + esc(prev) + '</div>' +
        '</div>';
      }).join('') +
      '<div class="btn-row mt">' +
        '<button class="btn primary" id="p-eat-save">Сохранить окна еды</button>' +
        '<button class="btn ghost" id="p-eat-auto">Считать от сна</button>' +
      '</div>' +
    '</div>' +

    '<div class="card"><h2>Когда ты можешь заниматься</h2>' +
      '<div class="tiny muted mb">План строится строго внутри этих окон. Если окно короткое — приложение само урежет тренировку, а не предложит невозможное.</div>' +
      [['morning','Неделя 7–16'],['evening','Неделя 15–00'],['weekend','Выходные']].map(([k,t]) => {
        const w = (S.settings.windows && S.settings.windows[k]) || {from:'',to:''};
        return '<div class="row mb" style="gap:8px">' +
          '<span class="small muted" style="flex:0 0 96px">'+esc(t)+'</span>' +
          '<input type="time" data-win="'+k+'" data-side="from" value="'+esc(w.from)+'" class="grow">' +
          '<span class="dim">—</span>' +
          '<input type="time" data-win="'+k+'" data-side="to" value="'+esc(w.to)+'" class="grow">' +
        '</div>';
      }).join('') +
      '<div class="btn-row mt">' +
        '<button class="btn primary" id="p-win-save">Сохранить окна</button>' +
        '<button class="btn" id="p-voice">Сказать голосом</button>' +
      '</div>' +
    '</div>' +

    days.map(d => {
      const slots = E.ensureSchedule(d);
      const done = S.doneFor(d);
      const isToday = d === today;
      const train = slots.filter(s => s.kind==='train' || s.kind==='walk');
      const mins = train.reduce((a,s)=>a+(s.minutes||0),0);
      return '<div class="card'+(isToday?'':'')+'" style="'+(isToday?'border-color:var(--accent)':'')+'">' +
        '<div class="row between mb">' +
          '<div><b>'+dowRu(d).toUpperCase()+', '+fmtDate(d)+'</b>' + (isToday?' <span class="badge accent">сегодня</span>':'') +
          '<div class="tiny dim">'+(isWeekend(d) ? 'выходной' : (E.weekTypeFor(d)==='morning' ? 'смена 7–16' : 'смена 15–00'))+'</div></div>' +
          '<span class="badge blue">'+mins+' мин</span>' +
        '</div>' +
        '<div data-day="'+d+'">' +
          (train.length ? train.map(s => slotHtml(s, done.includes(s.id))).join('')
                        : '<div class="tiny dim" style="padding:4px 0 8px">День отдыха. Мышцы растут не в зале, а в дни, когда ты их не трогаешь.</div>') +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';

  $('#p-lift').onclick = () => go('lift');
  bindRemind();
  $('#p-wt').onclick = e => {
    const b = e.target.closest('.chip'); if(!b) return;
    S.setSettings({ weekType: b.dataset.w, weekAnchor: mondayOf(today) });
    S.clearScheduleFrom(today);
    toast('План пересобран'); render();
  };
  $('#p-voice').onclick = openVoice;
  $('#p-sleep-save').onclick = () => {
    let n = 0, warn = null;
    for (const k of ['morning','evening','weekend']){
      const w = $('[data-sl="'+k+'"][data-side="wake"]').value;
      const b = $('[data-sl="'+k+'"][data-side="bed"]').value;
      if (!w || !b) continue;
      const h = sleepHours(w, b);
      if (h < 4) { toast('Проверь время: получается всего ' + num(h,1) + ' ч сна'); return; }
      if (h < 7 && !warn) warn = h;
      S.setSleep(k, w, b); n++;
    }
    if (!n) return toast('Заполни хотя бы одну строку');
    S.clearScheduleFrom(mondayOf(todayISO()));
    render();
    toast(warn
      ? 'Сохранил, но ' + num(warn,1) + ' ч мало: на недосыпе ты завтра съешь больше'
      : 'День пересобран под твой сон');
  };

  $('#p-eat-save').onclick = () => {
    let n = 0;
    for (const k of ['morning','evening','weekend']){
      const f = $('[data-eat="'+k+'"][data-side="from"]').value;
      const t = $('[data-eat="'+k+'"][data-side="to"]').value;
      if (!f && !t){ S.setEat(k, '', ''); continue; }
      if (!f || !t) { toast('Заполни обе половины окна или очисти обе'); return; }
      let span = E.toMin(t) - E.toMin(f);
      if (span <= 0) span += 1440;
      if (span < 180) { toast('Окно еды меньше 3 часов — четыре приёма туда не влезут'); return; }
      S.setEat(k, f, t); n++;
    }
    S.clearScheduleFrom(mondayOf(todayISO()));
    render();
    toast(n ? 'Приёмы пищи пересобраны' : 'Окна очищены — считаю от сна');
  };

  $('#p-eat-auto').onclick = () => {
    for (const k of ['morning','evening','weekend']) S.setEat(k, '', '');
    S.clearScheduleFrom(mondayOf(todayISO()));
    render(); toast('Считаю окно питания от сна');
  };

  $('#p-win-save').onclick = () => {
    let n = 0;
    for (const k of ['morning','evening','weekend']){
      const f = $('[data-win="'+k+'"][data-side="from"]').value;
      const t = $('[data-win="'+k+'"][data-side="to"]').value;
      if (!f || !t) continue;
      if (E.toMin(t) === E.toMin(f)) { toast('У окна «'+k+'» начало и конец совпадают'); return; }
      S.setWindow(k, f, t); n++;
    }
    if (!n) return toast('Заполни хотя бы одно окно');
    S.clearScheduleFrom(mondayOf(todayISO()));   // пересобираем всю текущую неделю
    toast('План пересобран под твои окна'); render();
  };

  $$('[data-day]').forEach(box => {
    box.onclick = e => {
      const s = e.target.closest('.slot'); if(!s) return;
      S.toggleDone(box.dataset.day, s.dataset.id);
      $('.chk-box', s).classList.toggle('on');
    };
  });
}

/* ---------- голосовой ввод графика ---------- */
function openVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const { el, close } = sheet('График голосом',
    '<div class="tiny muted mb">Скажи, <b>когда ты свободен для тренировки</b>. Например: «в вечерние смены могу только с двух до трёх», «в утренние недели свободен после шести», «в выходные с одиннадцати до часу».</div>' +
    (SR ? '<button class="btn block mb" id="v-rec">Начать запись</button>' : '<div class="tiny dim mb">Голосовой ввод в этом браузере недоступен — используй диктовку клавиатуры iPhone (значок микрофона).</div>') +
    '<label class="f"><span>Текст</span><textarea id="v-text" placeholder="работаю с 7 до 16, в выходные свободен"></textarea></label>' +
    '<button class="btn primary block" id="v-go">Разобрать и перестроить план</button>' +
    '<div id="v-out" class="mt"></div>');

  if (SR){
    const rec = new SR();
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = true;
    let on = false, base = '';
    $('#v-rec', el).onclick = () => {
      if (on){ rec.stop(); return; }
      base = $('#v-text', el).value;
      try { rec.start(); } catch(_){}
    };
    rec.onstart = () => { on = true; $('#v-rec', el).textContent = 'Идёт запись… нажми, чтобы остановить'; $('#v-rec', el).classList.add('primary'); };
    rec.onend = () => { on = false; $('#v-rec', el).textContent = 'Начать запись'; $('#v-rec', el).classList.remove('primary'); };
    rec.onerror = () => toast('Микрофон недоступен — введи текстом');
    rec.onresult = ev => {
      let s = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) s += ev.results[i][0].transcript;
      $('#v-text', el).value = (base + ' ' + s).trim();
    };
  }

  $('#v-go', el).onclick = async () => {
    const t = $('#v-text', el).value.trim();
    if (!t) return toast('Скажи или напиши график');
    const btn = $('#v-go', el);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Разбираю…';
    try{
      const r = await G.parseSchedule(t);
      const changed = applySchedule(r);
      if (!changed.length){
        btn.disabled = false; btn.textContent = 'Сказать иначе';
        $('#v-out', el).innerHTML = '<div class="verdict warn"><div class="t">Не понял, что менять</div>' +
          '<div class="d">'+esc(r.summary || 'Скажи конкретнее: «в вечерние смены могу заниматься с 14 до 15».')+'</div></div>';
        return;
      }
      close();
      toast('Готово: ' + changed.join('; '));
      render();
    }catch(e){ btn.disabled=false; btn.textContent='Повторить'; toast(e.message); }
  };
}

function applySchedule(r){
  const W = r.windows || {};
  const ok = t => /^\d{1,2}:\d{2}$/.test(String(t||''));
  let changed = [];
  const label = { morning:'смена 7–16', evening:'смена 15–00', weekend:'выходные' };

  for (const k of ['morning','evening','weekend']){
    const w = W[k];
    if (w && ok(w.from) && ok(w.to)){
      const from = w.from.length === 4 ? '0'+w.from : w.from;
      const to   = w.to.length   === 4 ? '0'+w.to   : w.to;
      S.setWindow(k, from, to);
      changed.push(label[k] + ' → ' + from + '–' + to);
    }
  }
  if (r.weekType === 'morning' || r.weekType === 'evening'){
    S.setSettings({ weekType: r.weekType, weekAnchor: mondayOf(todayISO()) });
    changed.push('текущая неделя: ' + label[r.weekType]);
  }
  if (changed.length){
    S.clearScheduleFrom(mondayOf(todayISO()));
    S.pushLog({ kind:'schedule', text:'Окна изменены: ' + changed.join('; ') });
  }
  return changed;
}

/* ================= ИТОГИ ================= */
let statsPeriod = 7;

function viewStats(){
  const tg = E.targets();
  const pr = E.progress();
  const rev = E.weeklyReview();
  const ps  = E.periodStats(statsPeriod);
  const pz  = E.praise();
  const st  = E.streaks();
  const p   = S.profile;
  const label = statsPeriod === 1 ? 'сегодня' : (statsPeriod === 7 ? 'за неделю' : 'за месяц');

  main.innerHTML =
  '<div class="view">' +

    '<div class="card" style="border-color:var(--ok)">' +
      '<h2 style="color:var(--ok)">Тебе есть чем гордиться</h2>' +
      pz.map(x => '<div class="row mb" style="align-items:flex-start;gap:10px">' +
        '<span class="badge ok" style="white-space:nowrap;margin-top:1px">'+esc(x.big)+'</span>' +
        '<span class="small muted grow">'+esc(x.text)+'</span></div>').join('') +
    '</div>' +

    '<div class="chips mb" id="s-per">' +
      [[1,'Сутки'],[7,'Неделя'],[30,'Месяц']].map(([v,t]) =>
        '<button class="chip'+(statsPeriod===v?' on':'')+'" data-p="'+v+'">'+t+'</button>').join('') +
    '</div>' +

    '<div class="card"><h2>Сводка '+esc(label)+'</h2>' +
      '<div class="grid2 mb">' +
        '<div class="stat"><b>'+num(ps.avgKcal)+'</b><span>съедено, ккал/день</span></div>' +
        '<div class="stat"><b>'+num(ps.avgSpent)+'</b><span>потрачено, ккал/день</span></div>' +
        '<div class="stat" style="background:'+(ps.avgDeficit>0?'var(--ok-soft)':'var(--bad-soft)')+'"><b>'+num(Math.abs(ps.avgDeficit))+'</b><span>'+(ps.avgDeficit>0?'дефицит':'профицит')+', ккал/день</span></div>' +
        '<div class="stat"><b>'+(ps.weightDelta!==null?(ps.weightDelta>0?'+':'')+num(ps.weightDelta,2):'—')+'</b><span>вес, кг '+esc(label)+'</span></div>' +
      '</div>' +
      '<div class="grid3">' +
        '<div class="stat"><b>'+num(ps.avgSteps)+'</b><span>шагов/день</span></div>' +
        '<div class="stat"><b>'+num(ps.avgProt)+'</b><span>белка, г/день</span></div>' +
        '<div class="stat"><b>'+ps.adherence+'%</b><span>дней записано</span></div>' +
      '</div>' +
    '</div>' +

    '<div class="card"><h2>Сжигание: цель против факта</h2>' +
      '<div class="row between mb"><span class="small muted">Цель ' + num(ps.planBurn) + ' ккал/день ' + esc(label) + '</span>' +
        '<span class="badge '+(ps.burnPct>=100?'ok':(ps.burnPct>=70?'warn':'bad'))+'">'+ps.burnPct+'% от плана</span></div>' +
      (ps.rows.length >= 2 ? '<div class="chart-wrap">'+burnChart(ps)+'</div>'
                           : '<div class="empty">Данных пока нет</div>') +
      '<div class="tiny dim mt">Серая пунктирная — сколько ты должен был сжечь по плану ('+num(ps.planBurn)+' ккал/день). ' +
        'Оранжевая — сколько сжёг на самом деле. ' +
        (ps.burnPct >= 100
          ? 'Ты перевыполняешь план — эти калории движок отдаёт тебе обратно в виде еды.'
          : 'Каждый день ниже пунктира — это дефицит, который не случился.') + '</div>' +
    '</div>' +

    '<div class="card"><h2>Еда против лимита</h2>' +
      (ps.rows.length >= 2 ? '<div class="chart-wrap">'+intakeChart(ps)+'</div>'
                           : '<div class="empty">Данных пока нет</div>') +
      '<div class="tiny dim mt">Зелёный столбик — уложился в лимит, красный — перебор, пустой — день не записан.</div>' +
    '</div>' +

    '<div class="card"><h2>Серии</h2>' +
      '<div class="grid2">' +
        '<div class="stat"><b>'+st.logged+'</b><span>дней подряд ведёшь дневник</span></div>' +
        '<div class="stat"><b>'+st.inLimit+'</b><span>дней подряд в лимите</span></div>' +
        '<div class="stat"><b>'+st.weighed+'</b><span>дней подряд взвешиваешься</span></div>' +
        '<div class="stat"><b>'+st.steps+'</b><span>дней подряд 8000+ шагов</span></div>' +
      '</div>' +
      '<div class="tiny dim mt">Серия — единственная метрика, которую нельзя нагнать потом. Порвал — начинай с единицы.</div>' +
    '</div>' +

    rev.map(r => '<div class="verdict '+r.kind+'"><div class="t">'+esc(r.t)+'</div><div class="d">'+esc(r.d)+'</div></div>').join('') +

    '<div class="card"><h2>Твоя стратегия сейчас</h2>' +
      '<div class="grid2 mb">' +
        '<div class="stat"><b>'+num(tg.kcal)+'</b><span>лимит, ккал/день</span></div>' +
        '<div class="stat"><b>'+num(tg.tdee)+'</b><span>расход, ккал/день</span></div>' +
        '<div class="stat"><b>'+num(tg.protein)+'</b><span>белок, г/день</span></div>' +
        '<div class="stat"><b>'+num(tg.weeklyLoss,2)+'</b><span>план, кг/нед</span></div>' +
      '</div>' +
      '<div class="tiny dim" style="line-height:1.55">Расход посчитан ' +
        (tg.tdeeSource === 'measured' ? '<b style="color:var(--ok)">по твоим реальным данным</b>' : '<b style="color:var(--warn)">по формуле</b> — накопится 2 недели записей, и движок пересчитает по факту') +
        ', без учёта тренировок. Тренировки дают ещё ~' + num(tg.activityKcal) + ' ккал в день сверху — поэтому план складывается так: ' +
        '<b style="color:var(--text)">' + num(tg.lossFood,2) + ' кг/нед от еды + ' + num(tg.lossAct,2) + ' кг/нед от движения = ' + num(tg.weeklyLoss,2) + ' кг/нед</b>.' +
        '<br>Базовый обмен ' + num(tg.bmr) + ' ккал. Ниже ' + num(Math.max(1500, Math.round(tg.bmr*0.8))) + ' ккал приложение лимит не опустит — дальше начинают гореть мышцы, а не жир.' +
        (tg.capped ? ' <b style="color:var(--warn)">Лимит упёрся в этот пол.</b>' : '') +
        (tg.tooFast ? ' <b style="color:var(--warn)">Темп подрезан до 1,5% массы в неделю — это потолок безопасности.</b>' : '') +
      '</div>' +
    '</div>' +

    '<div class="card"><h2>Прогноз</h2>' +
      '<div class="grid2">' +
        '<div class="stat"><b>'+fmtDate(pr.eta)+'</b><span>дата '+p.goalWeight+' кг</span></div>' +
        '<div class="stat"><b>'+pr.daysIn+'</b><span>дней в процессе</span></div>' +
      '</div>' +
      '<div class="tiny dim mt">Прогноз считается по твоему фактическому темпу, а не по желаемому. Он будет меняться каждую неделю — это нормально.</div>' +
    '</div>' +

    '<div class="card"><h2>Что дальше</h2>' +
      '<div class="tiny muted" style="line-height:1.55">Ты уже проходил это: сбросил, потом бросил и вернул 30 кг за два года. Разница между «сбросить» и «удержать» — не в диете, а в том, останется ли хоть что-то, когда мотивация кончится. ' +
      'Когда дойдёшь до цели, приложение не выключится: лимит поднимется до расхода, силовые останутся, взвешивание раз в неделю. Именно этот режим ты в прошлый раз и не включил.</div>' +
    '</div>' +

    '<button class="btn block" id="s-settings">Настройки</button>' +
  '</div>';

  $('#s-per').onclick = e => {
    const b = e.target.closest('.chip'); if(!b) return;
    statsPeriod = Number(b.dataset.p); render();
  };
  $('#s-settings').onclick = () => go('settings');
}

/* ---------- график: план vs факт сожжённых калорий ---------- */
function burnChart(ps){
  const rows = ps.rows, W = 520, H = 170, L = 36, R = 10, T = 12, B = 22;
  const max = Math.max(ps.planBurn * 1.4, ...rows.map(r=>r.burnReal), 100);
  const x = i => L + (rows.length<2?0:i*(W-L-R)/(rows.length-1));
  const y = v => T + (1 - v/max) * (H-T-B);

  const grid = [0,0.5,1].map(f => {
    const v = max*(1-f), yy = y(v);
    return '<line class="grid-l" x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'"/>' +
           '<text x="2" y="'+(yy+3).toFixed(1)+'">'+Math.round(v)+'</text>';
  }).join('');

  const planY = y(ps.planBurn);
  const plan = '<line class="plan-l" x1="'+L+'" y1="'+planY.toFixed(1)+'" x2="'+(W-R)+'" y2="'+planY.toFixed(1)+'"/>';

  const bw = Math.max(3, Math.min(22, (W-L-R)/rows.length - 3));
  const bars = rows.map((r,i) => {
    const yy = y(r.burnReal), hh = Math.max(0, H-B-yy);
    const over = r.burnReal >= ps.planBurn;
    return '<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hh.toFixed(1)+
      '" rx="2" fill="'+(over?'var(--ok)':'var(--accent)')+'" opacity="'+(r.burnReal?0.9:0.15)+'"/>';
  }).join('');

  const labels = [0, Math.floor((rows.length-1)/2), rows.length-1].filter((v,i,a)=>a.indexOf(v)===i)
    .map(i => '<text x="'+x(i).toFixed(1)+'" y="'+(H-5)+'" text-anchor="'+(i===0?'start':(i===rows.length-1?'end':'middle'))+'">'+fmtDate(rows[i].date)+'</text>').join('');

  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="height:170px">' +
    grid + bars + plan + labels + '</svg>';
}

/* ---------- график: съедено vs лимит ---------- */
function intakeChart(ps){
  const rows = ps.rows, W = 520, H = 170, L = 40, R = 10, T = 12, B = 22;
  const max = Math.max(ps.limit * 1.5, ...rows.map(r=>r.kcal), 100);
  const x = i => L + (rows.length<2?0:i*(W-L-R)/(rows.length-1));
  const y = v => T + (1 - v/max) * (H-T-B);

  const grid = [0,0.5,1].map(f => {
    const v = max*(1-f), yy = y(v);
    return '<line class="grid-l" x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'"/>' +
           '<text x="2" y="'+(yy+3).toFixed(1)+'">'+Math.round(v)+'</text>';
  }).join('');

  const limY = y(ps.limit);
  const lim = '<line class="goal-l" x1="'+L+'" y1="'+limY.toFixed(1)+'" x2="'+(W-R)+'" y2="'+limY.toFixed(1)+'"/>' +
              '<text x="'+(W-R-32)+'" y="'+(limY-5).toFixed(1)+'" style="fill:var(--ok)">лимит</text>';

  const bw = Math.max(3, Math.min(22, (W-L-R)/rows.length - 3));
  const bars = rows.map((r,i) => {
    if (!r.logged) return '<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+(H-B-6)+'" width="'+bw.toFixed(1)+'" height="6" rx="2" fill="var(--line)"/>';
    const yy = y(r.kcal), hh = Math.max(0, H-B-yy);
    return '<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hh.toFixed(1)+
      '" rx="2" fill="'+(r.kcal > ps.limit ? 'var(--bad)' : 'var(--ok)')+'" opacity=".9"/>';
  }).join('');

  const labels = [0, Math.floor((rows.length-1)/2), rows.length-1].filter((v,i,a)=>a.indexOf(v)===i)
    .map(i => '<text x="'+x(i).toFixed(1)+'" y="'+(H-5)+'" text-anchor="'+(i===0?'start':(i===rows.length-1?'end':'middle'))+'">'+fmtDate(rows[i].date)+'</text>').join('');

  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="height:170px">' +
    grid + bars + lim + labels + '</svg>';
}

/* ================= НАСТРОЙКИ ================= */
function viewSettings(){
  const p = S.profile, st = S.settings;
  main.innerHTML =
  '<div class="view">' +
    '<div class="card"><h2>Ключ Gemini</h2>' +
      '<label class="f"><span>API-ключ (хранится только на этом телефоне)</span>' +
        '<input type="password" id="st-key" value="'+esc(st.geminiKey)+'" placeholder="AIza…"></label>' +
      '<label class="f"><span>Модель</span><select id="st-model">' +
        MODEL_FALLBACK.concat(MODEL_FALLBACK.includes(st.geminiModel)?[]:[st.geminiModel]).filter(Boolean).map(m =>
          '<option value="'+esc(m)+'"'+(st.geminiModel===m?' selected':'')+'>'+esc(m)+'</option>').join('') +
      '</select></label>' +
      '<button class="btn block mb" id="st-models">Обновить список моделей</button>' +
      '<div class="btn-row"><button class="btn" id="st-test">Проверить</button>' +
      '<button class="btn primary" id="st-savekey">Сохранить</button></div>' +
      '<div class="tiny dim mt">Ключ берётся на aistudio.google.com. Он не уходит никуда, кроме Google — приложение работает целиком у тебя в браузере.<br>' +
      'Google периодически снимает старые модели. Если распознавание перестало работать — жми «Обновить список» и бери верхнюю.</div>' +
    '</div>' +

    '<div class="card"><h2>Шаги с iPhone</h2>' +
      '<div class="small muted mb">Apple не пускает браузер в «Здоровье». Проще всего просто отмечать ходьбу галочкой в заданиях — калории посчитаются сами. Или вбивать шаги руками на экране «Сегодня», это 10 секунд.</div>' +
      '<button class="btn block" id="st-shortcut">Хочу автоматом — показать инструкцию</button>' +
      '<div id="st-sc" class="hidden mt">' +
        '<div class="tiny muted" style="line-height:1.6">' +
        '<b>1.</b> Приложение <b>Команды</b> → <b>+</b> → <b>Добавить действие</b><br>' +
        '<b>2.</b> <b>«Получить образцы Здоровья»</b>: тип <b>Шаги</b>, период <b>Сегодня</b>, объединить <b>Сумма</b><br>' +
        '<b>3.</b> Ещё раз то же, но тип <b>Активная энергия</b><br>' +
        '<b>4.</b> Действие <b>«Текст»</b> → вставить ссылку (кнопка ниже) и подставить в неё результаты пп. 2–3<br>' +
        '<b>5.</b> Действие <b>«Открыть URL»</b><br>' +
        '<b>6.</b> Назвать «Шаги», вынести на экран «Домой»</div>' +
        '<button class="btn block mt" id="st-copyurl">Скопировать ссылку для ярлыка</button>' +
      '</div>' +
    '</div>' +

    '<div class="card"><h2>Параметры</h2>' +
      '<div class="grid2">' +
        '<label class="f"><span>Рост, см</span><input type="number" id="st-h" value="'+p.height+'"></label>' +
        '<label class="f"><span>Возраст</span><input type="number" id="st-a" value="'+p.age+'"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="f"><span>Цель, кг</span><input type="number" step="0.1" id="st-g" value="'+p.goalWeight+'"></label>' +
        '<label class="f"><span>Минут в день на движение</span><input type="number" id="st-t" value="'+p.timeBudgetMin+'"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="f"><span>Шагов в будни</span><input type="number" id="st-sw" value="'+p.stepsWeekday+'"></label>' +
        '<label class="f"><span>Шагов в выходные</span><input type="number" id="st-se" value="'+p.stepsWeekend+'"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="f"><span>Окно еды с</span><input type="time" id="st-ws" value="'+st.eatWindowStart+'"></label>' +
        '<label class="f"><span>по</span><input type="time" id="st-we" value="'+st.eatWindowEnd+'"></label>' +
      '</div>' +
      '<label class="f"><span>Ограничения</span><textarea id="st-r">'+esc(p.restrictions)+'</textarea></label>' +
      '<button class="btn primary block" id="st-save">Сохранить</button>' +
    '</div>' +

    '<div class="card"><h2>Данные</h2>' +
      '<div class="btn-row mb"><button class="btn" id="st-exp">Выгрузить</button>' +
      '<button class="btn" id="st-imp">Загрузить</button></div>' +
      '<input type="file" accept="application/json" id="st-file" style="display:none">' +
      '<button class="btn ghost block" id="st-reset" style="color:var(--bad)">Стереть всё</button>' +
      '<div class="tiny dim mt">Всё хранится в памяти браузера. Раз в неделю выгружай файл — иначе очистка данных Safari сотрёт историю.</div>' +
    '</div>' +

    '<button class="btn ghost block" id="st-back">Назад к итогам</button>' +
  '</div>';

  $('#st-shortcut').onclick = () => {
    const box = $('#st-sc');
    box.classList.toggle('hidden');
    $('#st-shortcut').textContent = box.classList.contains('hidden')
      ? 'Хочу автоматом — показать инструкцию' : 'Свернуть инструкцию';
  };

  $('#st-copyurl').onclick = async () => {
    const url = location.origin + location.pathname + '#steps=[Шаги]&active=[Энергия]';
    try { await navigator.clipboard.writeText(url); toast('Скопировано'); }
    catch(_){ sheet('Ссылка для ярлыка', '<textarea readonly style="min-height:110px">'+esc(url)+'</textarea>' +
      '<div class="tiny dim mt">Выдели и скопируй вручную.</div>'); }
  };

  $('#st-models').onclick = async () => {
    S.setSettings({ geminiKey: $('#st-key').value.trim() });
    const b = $('#st-models'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Спрашиваю Google…';
    try{
      const list = await G.listModels();
      if (!list.length) throw new Error('Google не вернул ни одной подходящей модели');
      const sel = $('#st-model');
      sel.innerHTML = list.map(m => '<option value="'+esc(m)+'">'+esc(m)+'</option>').join('');
      sel.value = list.includes(S.settings.geminiModel) ? S.settings.geminiModel : list[0];
      S.setSettings({ geminiModel: sel.value });
      toast('Доступно моделей: ' + list.length + '. Выбрана ' + sel.value);
    }catch(e){ toast(e.message); }
    b.disabled = false; b.textContent = 'Обновить список моделей';
  };

  $('#st-savekey').onclick = () => {
    S.setSettings({ geminiKey: $('#st-key').value.trim(), geminiModel: $('#st-model').value });
    toast('Ключ сохранён');
  };
  $('#st-test').onclick = async () => {
    S.setSettings({ geminiKey: $('#st-key').value.trim(), geminiModel: $('#st-model').value });
    const b = $('#st-test'); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try { await G.testKey(); toast('Ключ работает'); }
    catch(e){ toast(e.message); }
    b.disabled = false; b.textContent = 'Проверить';
  };
  $('#st-save').onclick = () => {
    const v = id => Number($('#'+id).value);
    S.setProfile({ height:v('st-h'), age:v('st-a'), goalWeight:v('st-g'), timeBudgetMin:v('st-t'),
      stepsWeekday:v('st-sw'), stepsWeekend:v('st-se'), restrictions: $('#st-r').value.trim() });
    S.setSettings({ eatWindowStart: $('#st-ws').value, eatWindowEnd: $('#st-we').value });
    S.clearScheduleFrom(todayISO());
    toast('Сохранено'); render();
  };
  $('#st-exp').onclick = () => {
    const blob = new Blob([S.export()], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fithelper-' + todayISO() + '.json';
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  };
  $('#st-imp').onclick = () => $('#st-file').click();
  $('#st-file').onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    try { S.import(await f.text()); toast('Загружено'); render(); }
    catch(err){ toast('Файл не читается'); }
  };
  $('#st-reset').onclick = () => confirmSheet('Стереть всё?',
    'Удалится вся история веса, еды и настройки. Отменить будет нельзя.', 'Стереть',
    () => { S.reset(); location.reload(); });
  $('#st-back').onclick = () => go('stats');
}

/* ================= ПРИЁМ ДАННЫХ ИЗ «КОМАНД» iOS ================= */
/* Ярлык открывает ссылку вида .../#steps=8432&active=520&date=2026-08-25 */
function ingestHash(){
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return false;
  const q = new URLSearchParams(raw);
  const steps = q.get('steps'), active = q.get('active');
  if (steps == null && active == null) return false;

  // Ссылка могла открыться во вкладке, чьё состояние в памяти устарело —
  // тогда перезагружаем страницу, хеш сохранится и данные запишутся правильно.
  if (!S.profile.onboarded && S.storedIsOnboarded()){ location.reload(); return false; }

  const date = q.get('date') || todayISO();
  const patch = {};
  if (steps  != null && steps  !== '') patch.steps  = parseInt(String(steps).replace(/[^\d]/g,''), 10) || 0;
  if (active != null && active !== '') patch.active = parseInt(String(active).replace(/[^\d]/g,''), 10) || 0;
  S.setHealth(date, patch);

  history.replaceState(null, '', location.pathname + location.search);
  toast('С телефона получено: ' + (patch.steps ? patch.steps + ' шагов' : '') +
        (patch.steps && patch.active ? ', ' : '') + (patch.active ? patch.active + ' ккал' : ''));
  return true;
}

/* ================= СТАРТ ================= */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
// каждый новый день — свежий план и перерисовка
let lastDay = todayISO();
setInterval(() => { if (todayISO() !== lastDay){ lastDay = todayISO(); render(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden){ ingestHash(); render(); } });
window.addEventListener('hashchange', () => { if (ingestHash()) render(); });

ingestHash();
go('today');

async function renderShopping(shop){
  const box = $('#r-shop');
  if (!box) return;
  await P.loadPrices();

  const cmp = P.compareStores(shop);
  const modes = [{ id:'best', name:'Где дешевле', total: cmp.split.total, away: 0 }]
    .concat(cmp.single.map(x => ({ id:x.store, name:'Всё в ' + x.name, total:x.total, away:x.away })));
  if (!modes.some(m => m.id === shopMode)) shopMode = 'best';

  const cheapest = modes.slice().sort((a,b) => a.total - b.total)[0] || modes[0];
  const b = shopMode === 'best' ? cmp.split : P.basket(shop, shopMode);
  const soon = P.endingSoon(5);
  const swaps = P.swapHints(shop);
  const upd = (P.db() || {}).updated;
  const lidlOnline = (((P.db()||{}).stores||{}).lidl||{}).online;

  let cap;
  if (shopMode === 'best'){
    cap = (cmp.gain > 0.5 && cmp.single.length)
      ? 'На ' + MONEY(cmp.gain) + ' дешевле, чем брать всё в одном магазине'
      : 'Самое дешёвое по всем магазинам';
  } else {
    const d = Math.round((b.total - cmp.split.total) * 100) / 100;
    cap = d > 0.5 ? 'На ' + MONEY(d) + ' дороже, зато один магазин'
                  : 'Один магазин, и переплаты почти нет';
  }
  const duel = cmp.single.length >= 2
    ? (Math.abs(cmp.single[0].total - cmp.single[1].total) < 1
        ? 'Вся неделя выходит почти одинаково: ' + cmp.single.map(x => x.name + ' ' + MONEY(x.total)).join(' и ') +
          '. Разница набегает на отдельных продуктах, поэтому «где дешевле» и раскидывает корзину.'
        : cmp.single[0].name + ' дешевле: ' + MONEY(cmp.single[0].total) + ' против ' +
          MONEY(cmp.single[1].total) + ' в ' + cmp.single[1].name + '.')
    : '';

  box.innerHTML =
    '<div class="shop-tabs" id="r-modes">' +
      modes.map(m => '<button class="shop-tab' + (m.id===shopMode?' on':'') + (m.id===cheapest.id?' best':'') + '" data-mode="' + esc(m.id) + '">' +
        '<b>' + MONEY(m.total) + '</b><span>' + esc(m.name) + '</span></button>').join('') +
    '</div>' +

    '<div class="shop-hero"><div class="sum">' + MONEY(b.total) + '</div>' +
      '<div class="cap">' + esc(cap) + '</div></div>' +

    (duel ? '<div class="note-box"><div class="t">Maxima или Rimi</div><div class="d">' + esc(duel) + '</div></div>' : '') +

    (b.away ? '<div class="tiny dim center mb">' + b.away + ' ' + plural(b.away,'позицию','позиции','позиций') +
      ' в этом магазине не продают — посчитал по цене соседнего, чтобы суммы можно было сравнивать.</div>' : '') +

    (soon.length ?
      '<div class="note-box warn"><div class="t">Успей до ' + DMY(soon[0].until) + '</div><div class="d">' +
        soon.slice(0,4).map(d => esc(d.product) + ' — ' + MONEY(d.price) + ' в ' + esc(P.storeName(d.store))).join('<br>') +
      '</div></div>' : '') +

    (shopMode === 'best'
      ? b.stores.map((st, i) =>
          '<div class="shop-store"><span class="step">' + (i+1) + '</span>' +
          '<span class="n">' + esc(st.name) + '</span>' +
          '<span class="dim small">' + st.items.length + ' ' + plural(st.items.length,'позиция','позиции','позиций') + '</span>' +
          '<span class="sum">' + MONEY(st.sum) + '</span></div>' +
          st.items.map(r => itemRow(r, false)).join('')).join('') +
        (b.rows.filter(r=>!r.found).length
          ? '<div class="shop-store"><span class="n dim">Без цены</span></div>' +
            b.rows.filter(r=>!r.found).map(r => itemRow(r, false)).join('')
          : '')
      : '<div class="shop-store"><span class="step">✓</span><span class="n">' + esc(P.storeName(shopMode)) + '</span>' +
        '<span class="sum">' + MONEY(b.total) + '</span></div>' +
        b.rows.map(r => itemRow(r, false)).join('')) +

    (swaps.length ?
      '<div class="note-box ok"><div class="t">Замени — станет дешевле</div><div class="d">' +
        swaps.slice(0,3).map(s => esc(s.name) + ' → ' + esc(s.to.product) + ', минус ' + MONEY(s.save) +
          (s.why ? '. ' + esc(s.why) : '')).join('<br><br>') +
      '</div></div>' : '') +

    '<button class="btn block mt" id="r-flyer">Сфотографировать листовку</button>' +
    (lidlOnline === false && !S.flyers.some(f => f.store === 'lidl')
      ? '<div class="note-box"><div class="t">Lidl пока не в сравнении</div><div class="d">Lidl единственный из трёх не выкладывает цены в интернет — только бумажные листовки. Сними листовку на камеру, ИИ впишет цены, и Lidl встанет в сравнение наравне с Maxima и Rimi.</div></div>'
      : '') +
    '<div class="tiny dim center mt">Maxima и Rimi обновляются сами' + (upd ? ', последний раз ' + DMY(upd) : '') + '.' +
      (S.flyers.length ? ' Твоих листовок: ' + S.flyers.length + '.' : '') + '</div>' +
    (S.flyers.length ? '<div class="chips mt">' + S.flyers.map(f =>
      '<button class="chip" data-flyer="' + esc(f.id) + '">' + esc(P.storeName(f.store)) + ' ' + DMY(f.added) + ' ✕</button>').join('') + '</div>' : '');

  $('#r-modes').onclick = e => {
    const t = e.target.closest('.shop-tab'); if (!t) return;
    shopMode = t.dataset.mode;
    renderShopping(shop);
  };
  $('#r-flyer').onclick = openFlyer;
  $$('[data-flyer]', box).forEach(el => el.onclick = () => {
    S.removeFlyer(el.dataset.flyer);
    renderShopping(shop);
    toast('Листовка убрана');
  });
}

function openFlyer(){
  const { el, close } = sheet('Листовка магазина',
    '<input type="file" accept="image/*" capture="environment" id="fl-file" style="display:none">' +
    '<div id="fl-stage">' +
      '<button class="btn primary block" id="fl-pick">Сделать фото / выбрать</button>' +
      '<div class="tiny dim center mt">Снимай страницу целиком, ровно, при свете. Цены должны читаться. ИИ возьмёт только те продукты, которые есть в твоих рецептах.</div>' +
    '</div>');

  const stage = $('#fl-stage', el);
  const file = $('#fl-file', el);
  $('#fl-pick', el).onclick = () => file.click();

  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    let img;
    try { img = await G.fileToBase64(f); }
    catch(e){ return toast(e.message); }

    stage.innerHTML =
      '<img class="thumb" src="' + img.dataUrl + '">' +
      '<label class="f"><span>Какой магазин</span><select id="fl-store">' +
        '<option value="lidl">Lidl</option><option value="maxima">Maxima</option>' +
        '<option value="rimi">Rimi</option><option value="other">другой</option>' +
      '</select></label>' +
      '<button class="btn primary block" id="fl-run"><span class="spin"></span> Читаю…</button>';

    const run = async () => {
      const btn = $('#fl-run', el);
      const store = $('#fl-store', el).value;
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Читаю цены…';
      try{
        const r = await G.readFlyer(img.base64, img.mime, store);
        if (!r.ok || !r.items.length){
          btn.disabled = false; btn.textContent = 'Попробовать снова';
          return toast(r.note || 'Цены на фото разобрать не вышло');
        }
        showFlyerConfirm(r, store, close);
      }catch(e){
        btn.disabled = false; btn.textContent = 'Повторить';
        toast(e.message);
      }
    };
    $('#fl-run', el).onclick = run;
    run();
  };
}

function showFlyerConfirm(r, storeFallback, closePrev){
  const store = (r.store && r.store !== 'other') ? r.store : storeFallback;
  const rows = r.items.map((it, i) =>
    '<label class="row" style="padding:8px 0;border-bottom:1px solid var(--line);gap:10px">' +
      '<input type="checkbox" checked data-fi="' + i + '">' +
      '<span class="grow"><span class="small">' + esc(it.product) + '</span>' +
      '<div class="tiny dim">' + esc(it.key.replace(/_/g, ' ')) + ' · ' + MONEY(it.price) + (it.pack ? ' / ' + esc(it.pack) : '') +
      ' · ' + MONEY(it.per) + '/' + esc(it.base) + (it.old ? ' <span style="color:var(--ok)">было ' + MONEY(it.old) + '</span>' : '') + '</div></span>' +
    '</label>').join('');

  sheet('Нашёл ' + r.items.length + ' ' + plural(r.items.length, 'цену', 'цены', 'цен'),
    '<div class="tiny muted mb">Сверь с листовкой и сними галочки там, где ИИ ошибся. Отмеченные лягут в базу и будут перебивать автоматические цены, пока акция не кончится' + (r.until ? ' (до ' + DMY(r.until) + ')' : '') + '.</div>' +
    rows +
    '<button class="btn primary block mt" id="fl-save">Сохранить</button>',
    (m, close) => {
      $('#fl-save', m).onclick = () => {
        const keep = r.items.filter((_, i) => { const c = $('[data-fi="' + i + '"]', m); return c && c.checked; });
        if (!keep.length) return toast('Ничего не отмечено');
        S.addFlyer({ store: store, until: r.until, items: keep });
        close(); if (closePrev) closePrev();
        render();
        toast('Добавил ' + keep.length + ' ' + plural(keep.length, 'цену', 'цены', 'цен') + ' из листовки');
      };
    });
}

/* ---------- запись еды в один тап ---------- */
function quickRow(it, sub, star){
  return '<div class="quick-wrap' + (it.done ? ' done' : '') + '">' +
    '<button class="quick-row" data-q="' + esc(it.key) + '">' +
      '<div class="body"><div class="ttl">' + esc(it.name) + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div>' +
      '<div class="kc">' + num(it.kcal) + '</div>' +
    '</button>' +
    (star ? '<button class="quick-star' + (it.fav ? ' on' : '') + '" data-fav="' + esc(it.name) + '">' +
      (it.fav ? '★' : '☆') + '</button>' : '') +
  '</div>';
}

let QUICK = {};   // key -> позиция, чтобы клик знал, что писать

function quickCard(){
  QUICK = {};
  const plan = Q.planToday();
  const recent = Q.recentFoods(8);
  const yest = Q.yesterday();
  plan.concat(recent).forEach(it => { QUICK[it.key] = it; });

  if (!plan.length && !recent.length && !yest.length){
    return '<div class="card"><h2>Записать в один тап</h2>' +
      '<div class="tiny muted">Здесь появятся блюда твоего рациона и то, что ты ешь чаще всего — чтобы записывать одним нажатием, без фото и без ожидания. Включи рацион или запиши пару приёмов вручную.</div></div>';
  }

  return '<div class="card"><h2>Записать в один тап</h2>' +
    (plan.length ? '<div class="quick-sec">Рацион на сегодня</div>' +
      plan.map(it => quickRow(it, SLOT_RU[it.slot] + (it.grams ? ' · ' + num(it.grams) + ' г' : '') +
        (it.done ? ' · уже записано' : ''))).join('') : '') +

    (recent.length ? '<div class="quick-sec">Ты это ешь чаще всего</div>' +
      recent.map(it => quickRow(it,
        (it.grams ? num(it.grams) + ' г · ' : '') + 'Б ' + num(it.p) + ' Ж ' + num(it.f) + ' У ' + num(it.c),
        true
      )).join('') : '') +

    (yest.length ? '<button class="btn block mt" id="q-yest">Повторить вчерашний день — ' +
      num(yest.reduce((a,f) => a + f.kcal, 0)) + ' ккал, ' + yest.length + ' ' +
      plural(yest.length,'запись','записи','записей') + '</button>' : '') +
  '</div>';
}

function bindQuick(){
  $$('[data-q]').forEach(el => el.onclick = () => {
    const it = QUICK[el.dataset.q];
    if (!it) return;
    Q.log(it);
    toast('Записано: ' + it.name + ' — ' + num(it.kcal) + ' ккал');
    render();
  });
  $$('[data-fav]').forEach(el => el.onclick = () => {
    const on = S.toggleFav(el.dataset.fav);
    toast(on ? 'Закрепил вверху' : 'Убрал из закреплённых');
    render();
  });
  const y = $('#q-yest');
  if (y) y.onclick = () => {
    const items = Q.yesterday();
    if (!items.length) return;
    confirmSheet('Повторить вчера',
      'Запишу все ' + items.length + ' ' + plural(items.length,'запись','записи','записей') +
      ' вчерашнего дня в сегодняшний, с теми же граммами.',
      'Записать', () => {
        Q.logAll(items);
        toast('Перенёс вчерашний день');
        render();
      });
  };
}

/* ---------- упаковка: штрихкод + состав ---------- */
function openPack(){
  const { el, close } = sheet('Упаковка',
    '<input type="file" accept="image/*" capture="environment" id="pk-file" style="display:none">' +
    '<div id="pk-stage">' +
      '<button class="btn primary block" id="pk-pick">Сфотографировать</button>' +
      '<div class="tiny dim center mt">Сними штрихкод и таблицу состава — можно на одном кадре. Сначала поищу товар в открытой базе Open Food Facts, там цифры точные. Не найду — прочитаю таблицу с фото.</div>' +
      '<hr class="sep">' +
      '<label class="f"><span>Или введи цифры штрихкода руками</span>' +
        '<input type="number" id="pk-code" inputmode="numeric" placeholder="4740012345678"></label>' +
      '<button class="btn block" id="pk-find">Найти по штрихкоду</button>' +
    '</div>');

  const stage = $('#pk-stage', el);
  const file = $('#pk-file', el);
  $('#pk-pick', el).onclick = () => file.click();

  $('#pk-find', el).onclick = async () => {
    const code = $('#pk-code', el).value.trim();
    if (code.length < 8) return toast('Штрихкод — 8 или 13 цифр');
    const btn = $('#pk-find', el);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Ищу…';
    let found = null;
    try { found = await Q.lookupBarcode(code); }
    catch(e){
      btn.disabled = false; btn.textContent = 'Найти по штрихкоду';
      return toast('Нет связи с базой. В магазине бывает — сфотографируй таблицу состава.');
    }
    btn.disabled = false; btn.textContent = 'Найти по штрихкоду';
    if (!found) return toast('В базе такого нет. Сфотографируй таблицу состава.');
    packPortion(found.name, found.per100, null, close);
  };

  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    let img;
    try { img = await G.fileToBase64(f); }
    catch(e){ return toast(e.message); }

    stage.innerHTML = '<img class="thumb" src="' + img.dataUrl + '">' +
      '<button class="btn primary block" id="pk-run"><span class="spin"></span> Читаю…</button>';

    const run = async () => {
      const btn = $('#pk-run', el);
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Читаю упаковку…';
      try{
        const r = await G.readPack(img.base64, img.mime);
        if (!r.ok) { btn.disabled = false; btn.textContent = 'Попробовать снова'; return toast(r.note || 'Не разобрал упаковку'); }

        // сначала открытая база — там цифры от производителя
        let name = r.name, per100 = r.per100, src = 'фото';
        if (r.barcode){
          btn.innerHTML = '<span class="spin"></span> Ищу в базе…';
          try{
            const off = await Q.lookupBarcode(r.barcode);
            if (off){ name = off.name || name; per100 = off.per100; src = 'Open Food Facts'; }
          }catch(_){ /* нет сети — цифры уже прочитаны с фото */ }
        }
        if (!(per100.kcal > 0)){
          btn.disabled = false; btn.textContent = 'Снять ещё раз';
          return toast('Таблицу состава не видно. Сними её крупнее.');
        }
        packPortion(name || 'Продукт', per100, { src: src, packGrams: r.packGrams }, close);
      }catch(e){ btn.disabled = false; btn.textContent = 'Повторить'; toast(e.message); }
    };
    $('#pk-run', el).onclick = run;
    run();
  };
}

function packPortion(name, per100, meta, closePrev){
  const pg = meta && meta.packGrams ? meta.packGrams : 0;
  sheet('Сколько съел',
    '<div class="card mb"><b>' + esc(name) + '</b>' +
      '<div class="tiny dim mt">На 100 г: ' + num(per100.kcal) + ' ккал · Б ' + num(per100.p) +
      ' · Ж ' + num(per100.f) + ' · У ' + num(per100.c) +
      (per100.fiber ? ' · клетчатка ' + num(per100.fiber) : '') + '</div>' +
      (meta && meta.src ? '<div class="tiny dim">Источник: ' + esc(meta.src) + '</div>' : '') +
    '</div>' +
    '<label class="f"><span>Граммы</span><input type="number" id="pp-g" inputmode="numeric" value="100"></label>' +
    '<div class="chips mb">' +
      [50,100,150,200,250,300].concat(pg ? [pg] : []).map(g =>
        '<button class="chip" data-g="' + g + '">' + g + ' г' + (g === pg ? ' (пачка)' : '') + '</button>').join('') +
    '</div>' +
    '<div id="pp-out" class="verdict blue"><div class="d">—</div></div>' +
    '<button class="btn primary block mt" id="pp-save">Записать</button>',
    (m, close) => {
      const inp = $('#pp-g', m);
      const upd = () => {
        const pr = Q.portion(per100, inp.value);
        const tg = E.targets();
        const after = E.dayTotals(todayISO()).kcal + pr.kcal;
        $('#pp-out', m).innerHTML = '<div class="t">' + num(pr.kcal) + ' ккал</div>' +
          '<div class="d">Б ' + num(pr.p) + ' · Ж ' + num(pr.f) + ' · У ' + num(pr.c) + '. ' +
          (after > tg.kcal ? 'Выйдешь за лимит на ' + num(after - tg.kcal) + ' ккал.'
                           : 'Останется ' + num(tg.kcal - after) + ' ккал на день.') + '</div>';
      };
      inp.oninput = upd; upd();
      m.querySelector('.chips').onclick = e => {
        const b = e.target.closest('[data-g]'); if (!b) return;
        inp.value = b.dataset.g; upd();
      };
      $('#pp-save', m).onclick = () => {
        const pr = Q.portion(per100, inp.value);
        if (!(pr.kcal > 0)) return toast('Укажи граммы');
        Q.log({ name: name, grams: pr.grams, kcal: pr.kcal, p: pr.p, f: pr.f, c: pr.c, src: 'pack' });
        close(); if (closePrev) closePrev();
        toast('Записано: ' + name); render();
      };
    });
}

/* ---------- напоминания через календарь телефона ---------- */
function remindCard(){
  const s = R.summary(14, 1);
  return '<div class="card">' +
    '<h2>Чтобы приложение тебя пинало</h2>' +
    '<div class="tiny muted mb">Safari не умеет слать уведомления с сайта — это ограничение айфона, не приложения. Обходим: выгружаем расписание в твой Календарь, и напоминания ставит уже он. Работает даже когда приложение закрыто.</div>' +
    '<div class="btn-row">' +
      '<button class="btn primary" id="rm-main">Главное, 2 недели</button>' +
      '<button class="btn" id="rm-all">Весь день</button>' +
    '</div>' +
    '<div class="tiny dim mt">Получится ' + s.count + ' ' + plural(s.count,'напоминание','напоминания','напоминаний') +
      ' — примерно ' + s.perDay + ' в день: еда, добавки, тренировки, отбой. Файл откроется в Календаре, там нажми «Добавить все».</div>' +
    '<hr class="sep">' +
    '<button class="btn block" id="rm-how">Как это работает и как убрать</button>' +
  '</div>';
}

function bindRemind(){
  const go = (days, level, label) => {
    const n = R.download(days, level);
    toast('Готово: ' + n + ' ' + plural(n,'напоминание','напоминания','напоминаний') + ' · ' + label);
  };
  $('#rm-main').onclick = () => go(14, 1, 'открой файл в Календаре');
  $('#rm-all').onclick  = () => go(14, 2, 'открой файл в Календаре');
  $('#rm-how').onclick = () => sheet('Напоминания: как это работает',
    '<div class="card mb"><b>Что делать</b>' +
      '<div class="small muted mt">1. Нажми «Главное, 2 недели» — скачается файл расписания.<br>' +
      '2. Открой его — айфон предложит Календарь.<br>' +
      '3. Выбери «Добавить все» и укажи календарь. Лучше завести отдельный, назвать «Похудение» — так его потом можно скрыть или удалить одной кнопкой.<br>' +
      '4. Проверь, что у событий включены оповещения: Настройки → Календарь → Оповещения по умолчанию.</div>' +
    '</div>' +
    '<div class="card mb"><b>Почему на две недели</b>' +
      '<div class="small muted mt">Твои смены чередуются, и расписание под каждую своё. Две недели — это полный цикл: утренняя и вечерняя. Как закончится, зайди сюда и выгрузи снова. Если поменяешь сон или окна тренировок — тоже перевыгрузи, старые события останутся, их лучше сначала удалить.</div>' +
    '</div>' +
    '<div class="card mb"><b>Как убрать</b>' +
      '<div class="small muted mt">Календарь → Календари → нажми на «Похудение» → Удалить календарь. Уйдут все события разом. Поэтому и советую отдельный календарь, а не общий.</div>' +
    '</div>' +
    '<div class="card"><b>Если хочешь жёстче</b>' +
      '<div class="small muted mt">В «Командах» можно сделать автоматизацию по времени: например в 22:30 каждый день открывать это приложение. Тогда телефон не просто напомнит, а откроет экран с планом. Команды → Автоматизация → Время суток → Открыть приложение → Safari с адресом приложения.</div>' +
    '</div>');
}

/* ---------- журнал силовых ---------- */
let LIFT_FORCE = null;
function viewLift(){
  const d = todayISO();
  const sess0 = L.sessionFor(d);
  // если сегодня по плану силовой нет, но человек уже начал писать подходы
  // или сам выбрал программу — показываем её, а не заглушку
  const prog = L.programFor(d)
    || (LIFT_FORCE ? L.PROGRAMS[LIFT_FORCE] : null)
    || (sess0 && L.PROGRAMS[sess0.program] ? L.PROGRAMS[sess0.program] : null);
  const done = L.doneCount(d);
  const vol = L.volume(d);
  const sess = L.recentSessions(28);

  if (!prog){
    main.innerHTML = '<div class="view"><div class="card">' +
      '<h2>Сегодня силовой нет</h2>' +
      '<div class="tiny muted mb">По плану сегодня интервалы или отдых. Силовые стоят в понедельник, четверг и субботу — так мышцы успевают восстановиться между сессиями.</div>' +
      '<div class="btn-row"><button class="btn" data-prog="A">Всё равно сделать A</button>' +
      '<button class="btn" data-prog="B">Сделать B</button></div>' +
      '</div>' + liftHistoryCard(sess) + '</div>';
    $$('[data-prog]').forEach(el => el.onclick = () => { LIFT_FORCE = el.dataset.prog; render(); });
    return;
  }

  main.innerHTML = '<div class="view">' +
    '<div class="card">' +
      '<div class="row between mb"><h2 style="margin:0">' + esc(prog.title) + '</h2>' +
      '<span class="badge ' + (done.sets ? 'ok' : 'warn') + '">' + done.sets + ' ' + plural(done.sets,'подход','подхода','подходов') + '</span></div>' +
      '<div class="tiny muted">' + (done.sets
        ? 'Тоннаж сегодня ' + num(vol) + ' кг. Это вес × повторы по всем подходам — единственная цифра, которая честно показывает, растёшь ты или топчешься.'
        : 'Записывай каждый подход сразу после него, а не в конце. Приложение подскажет вес по прошлой тренировке — в этом весь смысл журнала.') +
      '</div>' +
    '</div>' +
    prog.ex.map(exCard).join('') +
    '<div class="card"><h2>Как это работает</h2>' +
      '<div class="tiny muted">Закрыл все подходы с целевыми повторами — в следующий раз приложение само поднимет вес. Не добрал — оставит тот же. На дефиците калорий это единственное, что удерживает мышцы: тело сохраняет то, что регулярно нагружают.</div>' +
    '</div>' +
    liftHistoryCard(sess) +
  '</div>';

  bindLift(d, prog);
}


function exCard(ex){
  const d = todayISO();
  const sets = L.setsOf(d, ex.id);
  const sg = L.suggest(ex.id, d);
  const unit = ex.kind === 'time' ? 'сек' : 'повт';
  const showKg = ex.kind === 'weight';

  return '<div class="card ex-card">' +
    '<div class="ex-head"><b>' + esc(ex.name) + '</b>' +
      '<span class="tgt">' + ex.sets + '×' + ex.reps + (showKg ? '' : ' ' + unit) + '</span></div>' +
    '<div class="ex-hint">' + esc(ex.note) + '</div>' +
    (sg ? '<div class="ex-why' + (sg.up ? ' up' : '') + '">' + esc(sg.why) + '</div>' : '') +
    (sets.length ? '<div class="set-list">' + sets.map((s, i) =>
      '<span class="set-chip' + (s.reps >= ex.reps ? ' ok' : '') + '">' +
        (showKg && s.kg ? L.fmtKg(s.kg) + ' × ' : '') + num(s.reps) + (showKg ? '' : ' ' + unit) +
        '<button data-del="' + ex.id + '|' + i + '">×</button></span>').join('') + '</div>' : '') +
    '<div class="set-add">' +
      (showKg ? '<label class="f"><span>Вес, кг</span><input type="number" step="0.5" inputmode="decimal" data-kg="' + ex.id + '" value="' + (sg && sg.kg ? sg.kg : '') + '"></label>' : '') +
      '<label class="f"><span>' + (ex.kind === 'time' ? 'Секунды' : 'Повторы') + '</span>' +
        '<input type="number" inputmode="numeric" data-reps="' + ex.id + '" value="' + (sg ? sg.reps : ex.reps) + '"></label>' +
      '<button class="btn primary" data-add="' + ex.id + '">+</button>' +
    '</div>' +
  '</div>';
}

function bindLift(d, prog){
  $$('[data-add]').forEach(el => el.onclick = () => {
    const id = el.dataset.add;
    const kgEl = $('[data-kg="' + id + '"]');
    const reps = Number($('[data-reps="' + id + '"]').value) || 0;
    if (!reps) return toast('Сколько повторов сделал?');
    L.addSet(d, id, kgEl ? Number(kgEl.value) || 0 : 0, reps);
    const ex = L.BY_EX[id];
    const n = L.setsOf(d, id).length;
    render();
    toast(n >= ex.sets ? ex.name + ' — всё, ' + n + ' из ' + ex.sets : ex.name + ': подход ' + n + ' из ' + ex.sets);
  });
  $$('[data-del]').forEach(el => el.onclick = () => {
    const [id, i] = el.dataset.del.split('|');
    L.removeSet(d, id, Number(i));
    render();
  });
}

function liftHistoryCard(sess){
  if (!sess.length) return '';
  const last = sess[sess.length - 1];
  const perWeek = Math.round(sess.length / 4 * 10) / 10;
  return '<div class="card"><h2>Силовые за месяц</h2>' +
    '<div class="row between mb"><span class="muted small">Всего тренировок</span><b>' + sess.length + '</b></div>' +
    '<div class="row between mb"><span class="muted small">В среднем в неделю</span>' +
      '<b class="' + (perWeek >= 2.5 ? '' : 'dim') + '">' + num(perWeek,1) + '</b></div>' +
    '<div class="row between"><span class="muted small">Последняя</span><b>' + esc(fmtDate(last)) + '</b></div>' +
    '<div class="tiny dim mt">Три силовых в неделю — норма для удержания мышц на дефиците. Две — минимум, ниже начнёшь терять вместе с жиром и мышцы.</div>' +
  '</div>';
}

/* ---------- замеры и фото ---------- */
function viewBody(){
  const l = B.latest();
  const bf = B.bodyFat();
  const w = E.currentWeight();
  const lean = B.leanMass(w);
  const due = B.isDue();
  const ph = B.photos();

  main.innerHTML = '<div class="view">' +
    '<div class="card">' +
      '<div class="row between mb"><h2 style="margin:0">Замеры</h2>' +
        (due ? '<span class="badge warn">пора мерить</span>' : '<span class="badge ok">' + B.daysSince() + ' дн. назад</span>') + '</div>' +
      '<div class="tiny muted mb">Вес скачет от воды и соли и может стоять две недели, пока жир уходит. Талия так не врёт. Мерь раз в две недели, утром, натощак, всегда одинаково.</div>' +
      (l ? '<div class="mz-grid">' + B.FIELDS.filter(f => l[f.id] != null).map(f => {
        const dl = B.delta(f.id);
        const good = dl && dl.fromStart != null && dl.fromStart < 0;
        return '<div class="mz-cell"><div class="n">' + esc(f.name) + '</div>' +
          '<div class="v">' + num(dl.now,1) + ' см</div>' +
          (dl.fromStart != null
            ? '<div class="d ' + (good ? 'good' : 'bad') + '">' + (dl.fromStart > 0 ? '+' : '') + num(dl.fromStart,1) + ' см за ' + dl.days + ' дн.</div>'
            : '<div class="d dim">первый замер</div>') +
        '</div>';
      }).join('') + '</div>' : '<div class="empty">Пока ни одного замера. Возьми сантиметр — это две минуты.</div>') +
      '<button class="btn primary block mt" id="b-add">' + (l ? 'Новый замер' : 'Записать первый замер') + '</button>' +
    '</div>' +

    (bf != null ? '<div class="card"><h2>Состав тела</h2>' +
      '<div class="row between mb"><span class="muted small">Жира примерно</span><b style="font-size:20px">' + num(bf,1) + ' %</b></div>' +
      (lean ? '<div class="row between mb"><span class="muted small">Сухая масса</span><b>' + num(lean,1) + ' кг</b></div>' : '') +
      '<div class="tiny dim">Считается по талии, шее и росту — формула ВМФ США. Точность ±3–4 %, поэтому смотри не на само число, а на то, как оно меняется. Сухая масса не должна падать: если падает — мало белка или мало силовых.</div>' +
    '</div>' : '') +

    '<div class="card">' +
      '<div class="row between mb"><h2 style="margin:0">Фото прогресса</h2>' +
        (B.photoDue() ? '<span class="badge warn">пора снять</span>' : '') + '</div>' +
      '<div class="tiny muted mb">Раз в две недели, утром, одно и то же место и свет, та же поза. В зеркале ты себя не видишь — глаз привыкает. На фото разница за месяц бросается в глаза.</div>' +
      (ph.length >= 2
        ? (() => { const pr = B.photoPair(); return '<div class="ph-grid">' +
            '<figure><img src="' + pr.then.dataUrl + '"><figcaption>' + esc(fmtDate(pr.then.date)) +
              (pr.then.weight ? ' · ' + num(pr.then.weight,1) + ' кг' : '') + '</figcaption></figure>' +
            '<figure><img src="' + pr.now.dataUrl + '"><figcaption>' + esc(fmtDate(pr.now.date)) +
              (pr.now.weight ? ' · ' + num(pr.now.weight,1) + ' кг' : '') + '</figcaption></figure>' +
          '</div>'; })()
        : (ph.length === 1
            ? '<div class="ph-grid"><figure><img src="' + ph[0].dataUrl + '"><figcaption>' + esc(fmtDate(ph[0].date)) + '</figcaption></figure></div>'
            : '<div class="empty">Первое фото — точка отсчёта. Сделай сегодня.</div>')) +
      '<input type="file" accept="image/*" capture="environment" id="b-file" style="display:none">' +
      '<button class="btn block mt" id="b-photo">Сделать фото</button>' +
      (ph.length ? '<div class="chips mt">' + ph.map(p =>
        '<button class="chip" data-ph="' + esc(p.id) + '">' + esc(fmtDate(p.date)) + ' ✕</button>').join('') + '</div>' : '') +
    '</div>' +
  '</div>';

  $('#b-add').onclick = openMeasure;
  const file = $('#b-file');
  $('#b-photo').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    try{
      const img = await G.fileToBase64(f, 720, 0.62);
      S.addPhoto({ dataUrl: img.dataUrl, weight: E.currentWeight() });
      render(); toast('Фото сохранено');
    }catch(e){ toast(e.message); }
  };
  $$('[data-ph]').forEach(el => el.onclick = () => {
    confirmSheet('Удалить фото', 'Фото за ' + fmtDate((S.photos.find(p => p.id === el.dataset.ph)||{}).date) + ' удалится навсегда.',
      'Удалить', () => { S.delPhoto(el.dataset.ph); render(); toast('Удалил'); });
  });
}

function openMeasure(){
  const l = B.latest() || {};
  sheet('Замеры, см',
    '<div class="tiny muted mb">Мерь утром, натощак, не втягивая живот. Сантиметр плотно, но не врезается. Пустые поля просто пропустятся.</div>' +
    B.FIELDS.map(f =>
      '<label class="f"><span>' + esc(f.name) + (f.main ? ' — главная цифра' : '') + '</span>' +
        '<input type="number" step="0.5" inputmode="decimal" data-m="' + f.id + '" value="" placeholder="' + (l[f.id] != null ? 'в прошлый раз ' + num(l[f.id],1) : '—') + '">' +
      '<span class="tiny dim" style="margin-top:3px;display:block">' + esc(f.hint) + '</span></label>').join('') +
    '<button class="btn primary block mt" id="mz-save">Записать</button>',
    (m, close) => {
      $('#mz-save', m).onclick = () => {
        const rec = {};
        let any = false;
        B.FIELDS.forEach(f => {
          const v = Number($('[data-m="' + f.id + '"]', m).value);
          if (v > 0){ rec[f.id] = Math.round(v * 10) / 10; any = true; }
        });
        if (!any) return toast('Заполни хотя бы талию');
        S.addMeasure(rec);
        close(); render(); toast('Замеры записаны');
      };
    });
}
