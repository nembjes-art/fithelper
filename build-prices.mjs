import fs from 'fs';

// [key, store, product, price, packQty, packUnit, old, until, note]
const ROWS = [
["курица_грудка","maxima","Eestimaine broilerifilee TALLEGG, kg",9.35,1,"kg",null,null,null],
["курица_грудка","rimi","Eestimaine broilerifilee kg Tallegg",9.35,1,"kg",null,null,"Та же цена, что в Maxima"],
["курица_грудка","rimi","Broileri rinnafilee värske A-klass Rimi 500g",3.29,500,"g",null,null,"Своя марка Rimi — на треть дешевле Tallegg"],
["курица_окорочка","maxima","Eestimaine broilerikoib TALLEGG, kg",1.99,1,"kg",4.79,"2026-08-31","Акция, последний день"],
["курица_окорочка","maxima","Jah.broil.poolkoib A-klass TALUPOJA, kg",3.69,1,"kg",null,null,"Обычная цена без акции"],
["курица_окорочка","maxima","Jahutatud broiler A-klass WELL DONE, kg",3.49,1,"kg",null,null,"Целая тушка — дешевле окорочков"],
["курица_окорочка","rimi","Broileri poolkoivad Rimi 500g",1.49,500,"g",null,null,"Самое дешёвое мясо в Rimi"],
["курица_окорочка","rimi","Broilerikoivad Rimi värske A-klass kg",3.59,1,"kg",null,null,null],
["курица_окорочка","rimi","Broilerikoib seljaosaga Rimi kg",3.79,1,"kg",null,null,null],
["фарш_куриный","maxima","Broilerifilee hakklihamass KEKAVA, 450g",3.99,450,"g",null,null,null],
["фарш_куриный","rimi","Broilerikoiva hakkliha Rimi 400g",2.99,400,"g",null,null,"Дешевле фарша из грудки"],
["фарш_индейки","maxima","Jah.hakklihasegu kalkunilihast, 400g",3.59,400,"g",null,null,null],
["фарш_индейки","rimi","Kalkunihakklihasegu Rimi 500g",3.99,500,"g",null,null,null],
["фарш_индейки","rimi","Kalkuni rinnafilee hakkliha Rimi 500g",5.89,500,"g",null,null,"Из чистой грудки — дорого"],
["индейка","rimi","Kalkuni kintsuliha kondita-nahata, kg",8.99,1,"kg",null,null,null],
["индейка","rimi","Kalkuni rinnafilee värske A-klass, kg",15.99,1,"kg",null,null,"Очень дорого. Куриная грудка — тот же белок"],
["свинина","maxima","Seaabaliha kamarata, kondita, kg",2.59,1,"kg",5.99,"2026-08-31","Акция, последний день"],
["свинина","maxima","Seahakkliha WELL DONE, 400g",1.89,400,"g",null,null,null],
["свинина","rimi","Seahakklihasegu jahutatud Farmers Market 350g",1.65,350,"g",null,null,null],
["свинина","rimi","Seahakkliha Rimi 500g",2.15,500,"g",null,null,null],
["говядина","maxima","Veise hakkliha BEST BUTCHER 450g",4.99,450,"g",null,null,null],
["говядина","rimi","Veisehakkliha Rimi 400g",3.99,400,"g",null,null,null],
["лосось","maxima","Jahutatud lõhefilee C-trim, kg",12.49,1,"kg",null,null,null],
["лосось","rimi","Lõhefilee Rimi, kg",12.99,1,"kg",null,null,null],
["треска","maxima","Külmutatud Atlandi tursa hakkliha 450g",4.49,450,"g",null,null,null],
["треска","rimi","Atlandi tursa hakkliha Nowaco külmutatud 450g",4.49,450,"g",null,null,"Филе трески в е-магазине не продают — это фарш из неё"],
["сельдь","maxima","Heeringafilee õlis 500 г",3.99,500,"g",null,null,"Дешёвая омега-3"],
["творог","maxima","Kodujuust 5% Farm Milk, 500g",1.09,500,"g",null,null,"Самый дешёвый белок в списке"],
["творог","maxima","Kodujuust FARM MILK 5%, 200g",0.69,200,"g",null,null,null],
["творог","maxima","Kohupiim FARMI Lahja 0,5%, 200g",0.79,200,"g",null,null,"Обезжиренный творог"],
["творог","rimi","Kodujuust väherasvane Rimi 3% 500g",1.75,500,"g",null,null,null],
["творог","rimi","Kodujuust Rimi 5% 500g",1.95,500,"g",null,null,null],
["творог","rimi","Pehme kohupiim rasvatu MO Saaremaa 500g",1.99,500,"g",null,null,null],
["йогурт","maxima","Jogurt FARM MILK Naturaalne 3%, 400g",0.91,400,"g",null,null,null],
["йогурт","maxima","Jogurt HELLUS maitsestamata, 1kg",2.05,1,"kg",null,null,null],
["йогурт","rimi","Jogurt maitsestamata Rimi Smart 1kg",1.79,1,"kg",null,null,"Дешевле любого йогурта в Maxima"],
["йогурт","rimi","Kreeka jogurt maitsestamata Rimi 400g",1.09,400,"g",null,null,"Греческий — больше белка"],
["сыр","maxima","Juust FARM MILK Vene, 45%, 250g",0.92,250,"g",null,null,null],
["сыр","maxima","Viilutatud juust Estover 500g",2.89,500,"g",6.29,"2026-08-31","Акция, последний день"],
["сыр","maxima","Guni juust, EPIIM, 400 g",4.99,400,"g",null,null,null],
["сыр","rimi","Juust Rimi Basic Tilsit 45% 250g",1.79,250,"g",null,null,null],
["сыр","rimi","Juust Vene Rimi 45% 500g",3.59,500,"g",null,null,null],
["сыр","rimi","Juust tilsit E-piim 350g",3.49,350,"g",null,null,null],
["масло_сливочное","maxima","Või 82%, VALIO VIOLA, 200g",0.99,200,"g",2.29,"2026-08-31","Акция, последний день"],
["масло_сливочное","maxima","Või WELL DONE 82% 500g",2.31,500,"g",null,null,"Обычная цена без акции"],
["масло_сливочное","maxima","Või FARM MILK 82%, 180g",0.99,180,"g",null,null,null],
["масло_сливочное","rimi","Või Rimi Smart 82% 180g",0.95,180,"g",null,null,null],
["масло_сливочное","rimi","Võru või 82%, VALIO, 200 g",1.49,200,"g",null,null,null],
["яйца","maxima","Pesamuna S10 EGGO, 10tk",1.35,10,"tk",null,null,"Мелкие, но самые дешёвые"],
["яйца","maxima","Õrrekanade munad M 10 tk",1.99,10,"tk",null,null,null],
["яйца","maxima","Õrrekanade munad WELL DONE, 10tk",2.69,10,"tk",null,null,null],
["яйца","rimi","Kanamunad Rimi Basic M 10tk",1.59,10,"tk",null,null,null],
["яйца","rimi","Õrrekanade munad A/M Nr.2 Rimi Smart 10tk",2.49,10,"tk",null,null,null],
["белки_яичные","rimi","Munavalgemass Balticovo 500 г",1.59,15,"tk",null,null,"500 г ≈ 15 белков. Дешевле, чем разбивать яйца"],
["овсянка","maxima","Täistera kaerahelbed WELL DONE 500g",0.99,500,"g",null,null,null],
["овсянка","maxima","Kaerahelbed BALTIX 1kg",1.59,1,"kg",null,null,null],
["овсянка","rimi","Baltix Kiirkaerahelbed 1kg",1.39,1,"kg",null,null,"Тот же Baltix дешевле, чем в Maxima"],
["овсянка","rimi","Kiirkaerahelbed Rimi 450g",0.99,450,"g",null,null,null],
["рис","maxima","Aurutatud riis EXTRA LINE 800g",1.59,800,"g",null,null,null],
["рис","maxima","Jasmiini riis WELL DONE 400g",1.09,400,"g",null,null,null],
["рис","rimi","Pikateraline riis Rimi Basic 800g",0.79,800,"g",null,null,"Самый дешёвый гарнир вообще"],
["рис","rimi","Aurutatud riis Rimi Smart 800g",1.55,800,"g",null,null,null],
["гречка","maxima","Tatar, WELL DONE, 800 g",1.29,800,"g",null,null,null],
["гречка","maxima","Tatar EXTRA LINE 4x100g",0.99,400,"g",null,null,null],
["гречка","rimi","Tatar Rimi, aurutatud 800g",1.55,800,"g",null,null,null],
["гречка","rimi","Tatar Rimi Basic 4x100g",0.98,400,"g",null,null,null],
["булгур","maxima","Bulgur GALINTA 4x100g",1.99,400,"g",null,null,"В Maxima выбора почти нет"],
["булгур","rimi","Pruun täistera bulgur Rimi 400g",1.25,400,"g",null,null,null],
["булгур","rimi","Bulgur Rimi 400g",1.65,400,"g",null,null,null],
["киноа","maxima","Punane kinoa Just Nature, 500g",3.55,500,"g",null,null,null],
["киноа","maxima","Valge kinoa JUST NATURE 500g",3.85,500,"g",null,null,null],
["киноа","rimi","Kinoa Rimi Free From 375g",2.69,375,"g",null,null,"Дорого. Рис вместо неё — в 7 раз дешевле"],
["киноа","rimi","Kinoa valge Rimi 400g",2.99,400,"g",null,null,null],
["картофель","maxima","Kartul lahtine, kg",0.34,1,"kg",null,null,"Развесная — вдвое дешевле мытой в пакете"],
["картофель","maxima","Pestud kartul Laheotsa 2kg",1.75,2,"kg",2.79,"2026-08-31","Акция, последний день"],
["картофель","rimi","Kartul pesemata, kg",0.34,1,"kg",null,null,null],
["картофель","rimi","Kartul Heakartul 2kg",2.59,2,"kg",null,null,null],
["ягоды","maxima","Külmutatud maasikad BAUER, 400g",1.99,400,"g",null,null,null],
["ягоды","maxima","Külmutatud maasikad WELL DONE, 400g",2.09,400,"g",null,null,null],
["ягоды","rimi","Maasikad kiirkülmutatud Rimi Smart 1kg",3.99,1,"kg",null,null,"Килограммовый пакет — вдвое выгоднее мелких"],
["ягоды","rimi","Külmutatud maasikad Rimi 400g",2.79,400,"g",null,null,null],
["овощная_смесь","maxima","Külm.porgandi&herne segu WELL DONE, 400g",0.97,400,"g",null,null,null],
["овощная_смесь","maxima","Külm.rohelised oad WELL DONE, 400g",0.99,400,"g",null,null,null],
["овощная_смесь","rimi","Herned sügavkülmutatud Rimi 400g",0.99,400,"g",null,null,null],
["овощная_смесь","rimi","Porgandikuubikud ja herne segu Rimi 400g",1.29,400,"g",null,null,null],
["брокколи","maxima","Külmutatud brokkoli WELL DONE, 400g",1.29,400,"g",null,null,"Замороженная втрое дешевле свежей"],
["брокколи","rimi","Hortex brokolisegu 400g",1.29,400,"g",null,null,null],
["морковь_лук","maxima","Porgand lahtine, kg",0.59,1,"kg",null,null,null],
["морковь_лук","maxima","Sibul, kg",0.36,1,"kg",null,null,null],
["морковь_лук","rimi","Porgand, kg Eesti",0.65,1,"kg",null,null,null],
["морковь_лук","rimi","Sibul 50/70 mm, kg",0.42,1,"kg",null,null,"Подорожал с 0.36"],
["перец_шпинат","maxima","Paprika punane, kg",2.49,1,"kg",null,null,null],
["перец_шпинат","rimi","Paprika punane, kg",2.29,1,"kg",null,null,null],
["кабачок_перец","maxima","Paprika punane, kg",2.49,1,"kg",null,null,null],
["кабачок_перец","rimi","Paprika punane, kg",2.29,1,"kg",null,null,null],
["огурцы_помидоры","maxima","Vaarikatomat 1 kl., kg",1.69,1,"kg",null,null,null],
["огурцы_помидоры","maxima","Kurk lühike, kg",2.69,1,"kg",null,null,null],
["огурцы_помидоры","rimi","Tomat, kg",0.79,1,"kg",null,null,"Вдвое дешевле, чем в Maxima"],
["огурцы_помидоры","rimi","Kurk lühike, kg",1.69,1,"kg",null,null,"Огурец резко подешевел — было 2.59"],
["томаты_консерв","maxima","Purustatud tomatid WELL DONE 400 г",1.19,400,"g",null,null,null],
["томаты_консерв","rimi","Tomatid tükeldatud Rimi 400 г",1.69,400,"g",null,null,null],
["фасоль","maxima","Kons.küps.oad tomatikast. EXTRA LINE 400g",0.95,400,"g",null,null,null],
["фасоль","maxima","Kons.punased oad EXTRA LINE 400g",1.15,400,"g",null,null,null],
["фасоль","rimi","Punased oad, 400 g",0.88,400,"g",null,null,null],
["фасоль","rimi","Konserveeritud valged oad Rimi Basic 400g",0.89,400,"g",null,null,null],
["масло_оливковое","maxima","Rapsiõli EXTRA LINE 1l",0.99,1,"l",null,null,"Рапсовое. Для жарки — то же самое, что оливковое"],
["масло_оливковое","maxima","Oliivijääkõli EXTRA LINE 1l",4.99,1,"l",null,null,"Оливковое, самое дешёвое"],
["масло_оливковое","rimi","Rapsiõli Rimi Basic 1l",1.09,1,"l",null,null,null],
["масло_оливковое","rimi","Oliiviõli Extra Light Rimi 750ml",9.29,750,"ml",null,null,"Втрое дороже, чем в Maxima"],
["орехи","maxima","Mandlid EXTRA LINE 500g",5.99,500,"g",null,null,"Дешевле, чем WELL DONE"],
["орехи","maxima","Mandlid WELL DONE 500g",6.50,500,"g",null,null,null],
["орехи","rimi","Kooritud maapähkel blanšeeritud Rimi kg",4.79,1,"kg",null,null,"Арахис втрое дешевле миндаля"],
["орехи","rimi","Kooritud mandel Awake 400g",5.49,400,"g",null,null,null],
["фрукты","maxima","Õun PAULARED 2 kl., kg",0.59,1,"kg",null,null,null],
["фрукты","maxima","Banaan, kg",0.99,1,"kg",1.29,"2026-08-31","Акция, последний день"],
["фрукты","rimi","Õun Gloster 1 kl., kg",0.57,1,"kg",null,null,null],
["фрукты","rimi","Banaan, kg",1.29,1,"kg",null,null,null],
["протеин","maxima","Vadakuvalk 80 IconFit 1kg",23.89,1,"kg",null,null,"В Maxima на 9 € дешевле, чем в Rimi"],
["протеин","rimi","Vadakuvalk 80 IconFit 1kg",32.99,1,"kg",null,null,"Тот же товар, но заметно дороже"],
];

const KEYS = new Set(["курица_грудка","курица_окорочка","фарш_куриный","фарш_индейки","индейка","свинина","говядина","лосось","треска","сельдь","творог","йогурт","сыр","масло_сливочное","яйца","белки_яичные","овсянка","рис","гречка","булгур","киноа","картофель","ягоды","овощная_смесь","брокколи","морковь_лук","перец_шпинат","кабачок_перец","огурцы_помидоры","томаты_консерв","фасоль","масло_оливковое","орехи","фрукты","протеин"]);
const TODAY = "2026-08-31";
const r2 = n => Math.round(n * 100) / 100;

const items = [];
for (const [key, store, product, price, qty, unit, old, until, note] of ROWS) {
  if (!KEYS.has(key)) throw new Error(`неизвестный key: ${key}`);
  if (!["maxima","rimi"].includes(store)) throw new Error(`неизвестный store: ${store} (${product})`);
  if (until && until < TODAY) { console.log(`пропущено (истекло ${until}): ${product}`); continue; }

  let base, amount, pack;
  if (unit === "tk")      { base = "шт"; amount = qty;        pack = `${qty} шт`; }
  else if (unit === "g")  { base = "кг"; amount = qty / 1000;  pack = `${qty} г`; }
  else if (unit === "kg") { base = "кг"; amount = qty;         pack = qty === 1 ? "кг" : `${qty} кг`; }
  else if (unit === "ml") { base = "л";  amount = qty / 1000;  pack = `${qty} мл`; }
  else if (unit === "l")  { base = "л";  amount = qty;         pack = qty === 1 ? "л" : `${qty} л`; }
  else throw new Error(`неизвестная единица: ${unit} (${product})`);

  const per = r2(price / amount);

  if (per > 60)                    throw new Error(`per=${per} > 60 у «${product}» (${store})`);
  if (base === "кг" && per < 0.15) throw new Error(`per=${per} < 0.15 €/кг у «${product}» (${store})`);
  if (old !== null && !(old > price)) throw new Error(`старая цена ${old} не больше новой ${price} у «${product}»`);

  const it = { key, store, product, price: r2(price), pack, per, base };
  if (old !== null) it.old = r2(old);
  it.until = until || null;
  if (note) it.note = note;
  items.push(it);
}

for (const k of KEYS) if (!items.some(i => i.key === k)) throw new Error(`нет ни одной цены для категории: ${k}`);
if (items.length < 70) throw new Error(`позиций всего ${items.length}, нужно ≥70 — парсинг сломался`);

const out = {
  updated: TODAY,
  city: "Нарва",
  source: "ostukorvid.ee (обычные цены Maxima и Rimi) + maxima.ee/pakkumised (акции)",
  note: "Ориентир, а не гарантия — сети меняют цены каждую неделю. Lidl цены в интернет не выкладывает, только бумажные листовки: снимай их на камеру в приложении.",
  stores: {
    maxima: { name: "Maxima", priority: 1, online: true },
    lidl:   { name: "Lidl", priority: 2, online: false, note: "Lidl не публикует цены в интернете. Единственный способ — сфотографировать листовку." },
    rimi:   { name: "Rimi", priority: 3, online: true }
  },
  items
};

fs.writeFileSync(process.argv[2] || "prices.json", JSON.stringify(out, null, 2) + "\n", "utf8");
const m = items.filter(i => i.store === "maxima").length, rr = items.filter(i => i.store === "rimi").length;
console.log(`OK: ${items.length} позиций (maxima ${m}, rimi ${rr}), категорий ${new Set(items.map(i=>i.key)).size}`);
