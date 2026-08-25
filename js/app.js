/* app.js — сборка приложения, роутер и все экраны */
import { S, todayISO, addDays, daysBetween, fmtDate, dowRu, isWeekend, mondayOf } from './store.js';
import * as E from './engine.js';
import * as G from './gemini.js';
import { $, $$, h, esc, num, toast, sheet, confirmSheet, ring, meter } from './ui.js';

const main = $('#main');
const TITLES = { today:'Сегодня', food:'Дневник еды', weight:'Вес', plan:'План', stats:'Итоги', settings:'Настройки' };
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
  const sub = $('#viewSub');
  const w = E.currentWeight();
  sub.textContent = view === 'settings' ? '' : num(w,1) + ' кг → ' + S.profile.goalWeight + ' кг';
  ({ today:viewToday, food:viewFood, weight:viewWeight, plan:viewPlan, stats:viewStats, settings:viewSettings }[view] || viewToday)();
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
  const slots = E.ensureSchedule(d);
  const done = S.doneFor(d);
  const wToday = S.weightFor(d);

  const pctEaten = tg.kcal ? Math.min(100, dt.kcal/tg.kcal*100) : 0;
  const ringColor = left < 0 ? 'var(--bad)' : (pctEaten > 80 ? 'var(--warn)' : 'var(--accent)');

  main.innerHTML =
  '<div class="view">' +
    '<div class="verdict '+v.kind+'"><div class="t">'+esc(v.title)+'</div><div class="d">'+esc(v.text)+'</div></div>' +

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
    '</div></div>' +

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

/* ================= ДНЕВНИК ЕДЫ ================= */
function viewFood(){
  const days = [];
  for (let i = 0; i < 14; i++) days.push(addDays(todayISO(), -i));
  const tg = E.targets();

  main.innerHTML =
  '<div class="view">' +
    '<div class="btn-row mb">' +
      '<button class="btn primary" id="f-photo">Фото еды</button>' +
      '<button class="btn" id="f-manual">Вручную</button>' +
    '</div>' +
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

  $('#f-photo').onclick = openPhoto;
  $('#f-manual').onclick = openManual;
  bindFoodDelete();
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
    '<div class="card">' +
      '<h2>Рабочая неделя</h2>' +
      '<div class="chips" id="p-wt">' +
        '<button class="chip'+(wt==='morning'?' on':'')+'" data-w="morning">Утро 7–16</button>' +
        '<button class="chip'+(wt==='evening'?' on':'')+'" data-w="evening">Вечер 15–00</button>' +
      '</div>' +
      '<div class="tiny dim mt">Недели чередуются автоматически. Если сбилось — переключи здесь, план пересоберётся.</div>' +
      '<button class="btn block mt" id="p-voice">Продиктовать график голосом</button>' +
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

  $('#p-wt').onclick = e => {
    const b = e.target.closest('.chip'); if(!b) return;
    S.setSettings({ weekType: b.dataset.w, weekAnchor: mondayOf(today) });
    S.clearScheduleFrom(today);
    toast('План пересобран'); render();
  };
  $('#p-voice').onclick = openVoice;

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
    '<div class="tiny muted mb">Скажи или напиши свободно: «на этой неделе работаю с семи до четырёх, в среду выходной, в субботу свободен весь день».</div>' +
    (SR ? '<button class="btn block mb" id="v-rec">Начать запись</button>' : '<div class="tiny dim mb">Голосовой ввод в этом браузере недоступен — используй диктовку клавиатуры iPhone (значок микрофона).</div>') +
    '<label class="f"><span>Текст</span><textarea id="v-text" placeholder="работаю с 7 до 16, в выходные свободен"></textarea></label>' +
    '<button class="btn primary block" id="v-go">Разобрать и перестроить план</button>');

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
      applySchedule(r);
      close();
      toast(r.summary || 'План перестроен');
      render();
    }catch(e){ btn.disabled=false; btn.textContent='Повторить'; toast(e.message); }
  };
}

function applySchedule(r){
  const mon = mondayOf(todayISO());
  if (r.weekType === 'morning' || r.weekType === 'evening'){
    S.setSettings({ weekType: r.weekType, weekAnchor: mon });
  }
  S.clearScheduleFrom(todayISO());
  (r.days || []).forEach(d => {
    const idx = Math.min(6, Math.max(0, (Number(d.dow)||1) - 1));
    const date = addDays(mon, idx);
    if (date < todayISO()) return;
    const slots = E.buildDay(date);
    if (d.freeFrom){
      slots.forEach(s => {
        if (s.kind === 'train') s.time = d.freeFrom;
        if (s.kind === 'walk' && d.freeTo) s.time = d.freeTo;
      });
    }
    if (!d.busyFrom && !d.busyTo && d.note){
      slots.forEach(s => { if (s.kind === 'train') s.desc += ' (' + d.note + ')'; });
    }
    S.setSchedule(date, slots);
  });
  S.pushLog({ kind:'schedule', text:'График перестроен голосом' });
}

/* ================= ИТОГИ ================= */
function viewStats(){
  const tg = E.targets();
  const pr = E.progress();
  const rev = E.weeklyReview();
  const p = S.profile;

  // сводка за 7 дней
  const days = Array.from({length:7}, (_,i)=> addDays(todayISO(), -6+i));
  const rows = days.map(d => {
    const t = E.dayTotals(d);
    const w = S.weightFor(d);
    return { d, kcal:t.kcal, p:t.p, w, water:S.waterFor(d), done:S.doneFor(d).length, logged:t.n>0 };
  });
  const loggedDays = rows.filter(r=>r.logged);
  const avgKcal = loggedDays.length ? Math.round(loggedDays.reduce((a,r)=>a+r.kcal,0)/loggedDays.length) : 0;
  const avgP = loggedDays.length ? Math.round(loggedDays.reduce((a,r)=>a+r.p,0)/loggedDays.length) : 0;
  const adherence = Math.round(loggedDays.length/7*100);

  main.innerHTML =
  '<div class="view">' +
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

    '<div class="card"><h2>Последние 7 дней</h2>' +
      '<div class="grid3 mb">' +
        '<div class="stat"><b>'+num(avgKcal)+'</b><span>ккал в среднем</span></div>' +
        '<div class="stat"><b>'+num(avgP)+'</b><span>белка в среднем</span></div>' +
        '<div class="stat"><b>'+adherence+'%</b><span>дней записано</span></div>' +
      '</div>' +
      '<ul class="list" style="margin:0 -14px -14px">' + rows.map(r =>
        '<li><div class="grow"><div class="nm">'+dowRu(r.d)+', '+fmtDate(r.d)+'</div>' +
        '<div class="mt2">'+(r.logged ? 'Б '+num(r.p)+' г · вода '+num(r.water)+' мл · заданий '+r.done : 'нет записей')+'</div></div>' +
        '<div class="kcal" style="color:'+(!r.logged?'var(--dim)':(r.kcal>tg.kcal?'var(--bad)':'var(--ok)'))+'">'+(r.logged?num(r.kcal):'—')+'</div></li>'
      ).join('') + '</ul>' +
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

  $('#s-settings').onclick = () => go('settings');
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
        ['gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-pro','gemini-1.5-flash'].map(m =>
          '<option value="'+m+'"'+(st.geminiModel===m?' selected':'')+'>'+m+'</option>').join('') +
      '</select></label>' +
      '<div class="btn-row"><button class="btn" id="st-test">Проверить</button>' +
      '<button class="btn primary" id="st-savekey">Сохранить</button></div>' +
      '<div class="tiny dim mt">Ключ берётся на aistudio.google.com. Он не уходит никуда, кроме Google — приложение работает целиком у тебя в браузере.</div>' +
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

/* ================= СТАРТ ================= */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
// каждый новый день — свежий план и перерисовка
let lastDay = todayISO();
setInterval(() => { if (todayISO() !== lastDay){ lastDay = todayISO(); render(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

go('today');
