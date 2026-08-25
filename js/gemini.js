/* gemini.js — распознавание еды по фото и разбор графика из текста/голоса */
import { S } from './store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function keyOrThrow(){
  const k = S.settings.geminiKey && S.settings.geminiKey.trim();
  if (!k) throw new Error('Не задан ключ Gemini. Настройки → Ключ Gemini.');
  return k;
}

// Текстовые задачи гоняем на самой лёгкой модели: у неё выше бесплатные лимиты
// и она быстрее. Фото остаётся на основной — там нужна точность оценки порций.
const LITE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

async function call(parts, schema, systemText, opts){
  const main = S.settings.geminiModel || 'gemini-3.7-flash';
  const chain = (opts && opts.lite) ? LITE_MODELS.concat([main]) : [main];
  let lastErr;
  for (const m of chain){
    try { return await callOnce(parts, schema, systemText, m); }
    catch(e){
      lastErr = e;
      // модели нет у этого ключа — пробуем следующую; любая другая ошибка выходит сразу
      if (!/снял эту модель|not found|no longer available|is not supported/i.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

async function callOnce(parts, schema, systemText, model){
  const key = keyOrThrow();
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.25,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {})
    }
  };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  const res = await fetch(BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok){
    let msg = 'HTTP ' + res.status;
    try { const e = await res.json(); msg = (e.error && e.error.message) || msg; } catch(_){}
    if (res.status === 400 && /API key/i.test(msg)) msg = 'Ключ Gemini неверный или без доступа к модели.';
    if (res.status === 429) msg = 'Лимит запросов Gemini исчерпан. Подожди минуту.';
    if (/no longer available|not found|is not supported|deprecated/i.test(msg)){
      msg = 'Google снял эту модель. Настройки → Обновить список моделей → выбери верхнюю из списка.';
    }
    throw new Error(msg);
  }
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '';
  if (!txt) throw new Error('Пустой ответ модели. Попробуй ещё раз или другое фото.');
  try { return JSON.parse(txt); }
  catch(e){
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Модель вернула не JSON.');
  }
}

/* ---------- фото еды ---------- */
const FOOD_SCHEMA = {
  type:'object',
  properties:{
    ok:{type:'boolean'},
    note:{type:'string'},
    items:{
      type:'array',
      items:{
        type:'object',
        properties:{
          name:{type:'string'},
          grams:{type:'number'},
          kcal:{type:'number'},
          p:{type:'number'},
          f:{type:'number'},
          c:{type:'number'},
          confidence:{type:'string'}
        },
        required:['name','grams','kcal','p','f','c']
      }
    }
  },
  required:['ok','items']
};

const FOOD_PROMPT = `Ты нутрициолог, который оценивает еду по фотографии.

Задача: определить каждое блюдо/продукт на фото, оценить вес порции в граммах и КБЖУ.

Правила:
- Оценивай порции по видимым ориентирам: тарелка ~26 см, вилка ~19 см, кружка ~250 мл, ладонь ~90 г мяса.
- Учитывай невидимые калории: масло для жарки, заправка, соус, сахар в напитке. Если блюдо явно жарено или заправлено — добавь это в оценку и напиши в note.
- Лучше слегка ЗАВЫСИТЬ калорийность, чем занизить: занижение ломает весь учёт.
- confidence: "высокая" | "средняя" | "низкая".
- Если на фото нет еды — ok=false, items пустой, в note объясни что видишь.
- Названия на русском языке, коротко.
- Числа — только числа, без единиц.`;

export async function analyzePhoto(base64, mime, hint){
  const parts = [
    { text: hint ? ('Подсказка от пользователя: ' + hint) : 'Определи еду на фото и посчитай КБЖУ.' },
    { inline_data: { mime_type: mime || 'image/jpeg', data: base64 } }
  ];
  const r = await call(parts, FOOD_SCHEMA, FOOD_PROMPT);
  return { ok: r.ok !== false, note: r.note || '', items: (r.items || []).map(normFood) };
}

/* ---------- еда текстом ---------- */
export async function analyzeText(text){
  const parts = [{ text: 'Пользователь описал что съел: "' + text + '". Определи блюда, вес и КБЖУ.' }];
  const r = await call(parts, FOOD_SCHEMA, FOOD_PROMPT, { lite:true });
  return { ok: r.ok !== false, note: r.note || '', items: (r.items || []).map(normFood) };
}

function normFood(i){
  const num = v => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };
  const it = {
    name: String(i.name || 'Блюдо').trim(),
    grams: Math.round(num(i.grams)),
    kcal: Math.round(num(i.kcal)),
    p: +num(i.p).toFixed(1),
    f: +num(i.f).toFixed(1),
    c: +num(i.c).toFixed(1),
    confidence: i.confidence || 'средняя'
  };
  // сверка: если ккал сильно расходятся с БЖУ — доверяем БЖУ
  const fromMacros = it.p*4 + it.f*9 + it.c*4;
  if (fromMacros > 0 && Math.abs(fromMacros - it.kcal) > Math.max(60, it.kcal*0.3)){
    it.kcal = Math.round(fromMacros);
  }
  return it;
}

/* ---------- что съесть прямо сейчас ---------- */
const SUGGEST_SCHEMA = {
  type:'object',
  properties:{
    verdict:{type:'string'},
    options:{
      type:'array',
      items:{
        type:'object',
        properties:{
          name:{type:'string'},
          kcal:{type:'number'},
          p:{type:'number'},
          f:{type:'number'},
          c:{type:'number'},
          why:{type:'string'},
          how:{type:'string'}
        },
        required:['name','kcal','p','f','c','why']
      }
    }
  },
  required:['options']
};

const SUGGEST_PROMPT = `Ты жёсткий, но неглупый тренер по питанию. Отвечаешь по-русски, коротко, на «ты».

Тебе дают состояние дня человека: лимит калорий, сколько уже съедено, сколько осталось, цель по белку и сколько белка недобрано, сколько он прошёл, время суток и до скольки открыто окно питания.

Задача: предложить 3 варианта еды, которые:
- укладываются в остаток калорий (ни один вариант не должен выводить за лимит);
- максимально закрывают недобор белка — это главный приоритет;
- реалистичны для обычного человека в Эстонии: продукты из Rimi/Selver/Maxima, готовка максимум 15 минут;
- подходят по времени суток (в 22:00 не предлагать полноценный обед).

Если осталось меньше 150 ккал — не выдумывай еду: в options верни один вариант с водой/чаем и честно скажи в verdict, что на сегодня еда закончилась.

Правила полей:
- name — коротко, с граммовкой: «Творог 5% 200 г + горсть черники»
- kcal/p/f/c — числа, честный расчёт на указанную порцию
- why — одно предложение: почему именно это сейчас
- how — как приготовить, одна строка; можно пусто если готовить нечего
- verdict — одно-два предложения общего вердикта по дню

Не читай морали и не извиняйся. Говори как тренер, который считает.`;

export async function suggestMeal(ctx, wish){
  const parts = [{ text: 'Состояние дня:\n' + JSON.stringify(ctx, null, 1) +
    (wish ? '\n\nЧего хочется человеку: ' + wish : '') }];
  return await call(parts, SUGGEST_SCHEMA, SUGGEST_PROMPT, { lite:true });
}

/* ---------- можно ли это съесть ---------- */
const JUDGE_SCHEMA = {
  type:'object',
  properties:{
    verdict:{type:'string'},
    kcal:{type:'number'},
    p:{type:'number'},
    f:{type:'number'},
    c:{type:'number'},
    name:{type:'string'},
    reason:{type:'string'},
    alternative:{type:'string'}
  },
  required:['verdict','kcal','name','reason']
};

const JUDGE_PROMPT = `Ты жёсткий тренер по питанию. Отвечаешь по-русски, на «ты», коротко.

Человек спрашивает, можно ли ему съесть конкретную вещь. Тебе дают состояние его дня.

1. Оцени КБЖУ этой еды на реалистичную порцию (если порция не названа — бери обычную).
2. verdict: ровно одно из «можно» / «половину» / «нельзя».
   - «нельзя» если это выбивает за остаток калорий больше чем на 300 ккал, или если окно питания уже закрыто;
   - «половину» если целиком не влезает, а половина влезает;
   - «можно» если влезает.
3. reason — одно-два предложения, по делу и с цифрами. Без морали.
4. alternative — если «нельзя» или «половину», предложи конкретную замену, которая влезает и даёт больше белка. Иначе пусто.
5. name — как это записать в дневник.`;

export async function judgeFood(text, ctx){
  const parts = [{ text: 'Человек спрашивает: "' + text + '"\n\nСостояние дня:\n' + JSON.stringify(ctx, null, 1) }];
  return await call(parts, JUDGE_SCHEMA, JUDGE_PROMPT, { lite:true });
}

/* ---------- разбор графика (голос → текст → слоты) ---------- */
const SCHED_SCHEMA = {
  type:'object',
  properties:{
    weekType:{type:'string'},
    days:{
      type:'array',
      items:{
        type:'object',
        properties:{
          dow:{type:'number'},
          busyFrom:{type:'string'},
          busyTo:{type:'string'},
          freeFrom:{type:'string'},
          freeTo:{type:'string'},
          note:{type:'string'}
        },
        required:['dow']
      }
    },
    summary:{type:'string'}
  },
  required:['days']
};

const SCHED_PROMPT = `Ты разбираешь рабочий график человека из свободной речи и превращаешь в структуру.

Формат:
- dow: 1=понедельник ... 7=воскресенье
- busyFrom/busyTo: рабочее время в формате "HH:MM" (пусто если выходной)
- freeFrom/freeTo: самое большое окно, свободное для тренировки, с учётом дороги и сна
- weekType: "morning" если смена начинается до 12:00, "evening" если после
- summary: одно предложение по-русски

Учитывай: после ночной смены до 00:00 человек не тренируется утром рано — окно ставь ближе к 10:00-12:00.
Если про день ничего не сказано — не выдумывай, пропусти его.`;

export async function parseSchedule(text){
  const parts = [{ text: 'График пользователя: "' + text + '"' }];
  return await call(parts, SCHED_SCHEMA, SCHED_PROMPT, { lite:true });
}

/* ---------- утилита: файл → base64 ---------- */
export function fileToBase64(file, maxSide = 768){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width:w, height:h } = img;
      const scale = Math.min(1, maxSide / Math.max(w,h));
      w = Math.round(w*scale); h = Math.round(h*scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL('image/jpeg', 0.78);
      resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg', dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение.')); };
    img.src = url;
  });
}

/* ---------- какие модели реально доступны этому ключу ---------- */
export async function listModels(){
  const key = keyOrThrow();
  const res = await fetch(BASE.replace(/\/$/, '') + '?key=' + encodeURIComponent(key) + '&pageSize=200');
  if (!res.ok){
    let msg = 'HTTP ' + res.status;
    try { const e = await res.json(); msg = (e.error && e.error.message) || msg; } catch(_){}
    throw new Error(msg);
  }
  const data = await res.json();
  const names = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    // только текстово-визуальные генеративные: без эмбеддингов, картинок, речи
    .filter(n => /^gemini-/.test(n) && !/(embedding|image|tts|audio|live|native-audio|thinking-exp)/.test(n))
    .filter(n => !/^(gemini-1\.|gemini-2\.)/.test(n));

  // новые версии наверх
  const ver = n => { const m = n.match(/gemini-(\d+)\.?(\d*)/); return m ? Number(m[1])*100 + Number(m[2]||0) : 0; };
  names.sort((a,b) => ver(b) - ver(a) || a.length - b.length || a.localeCompare(b));
  return [...new Set(names)];
}

export async function testKey(){
  const r = await call([{ text: 'Ответь JSON: {"ok":true}' }], { type:'object', properties:{ok:{type:'boolean'}}, required:['ok'] });
  return !!r.ok;
}
