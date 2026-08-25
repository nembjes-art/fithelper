/* ui.js — базовые помощники интерфейса */
export const $ = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

export function h(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function num(n, d=0){
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toFixed(d).replace('.', ',');
}

/* ---------- тост ---------- */
let toastTimer = null;
export function toast(msg, ms=2600){
  const old = $('.toast'); if (old) old.remove();
  const el = h('<div class="toast">'+esc(msg)+'</div>');
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.remove(), ms);
}

/* ---------- модалка ---------- */
export function sheet(title, bodyHtml, onMount){
  const m = h(
    '<div class="modal"><div class="bg"></div><div class="sheet">' +
    '<div class="grab"></div>' +
    (title ? '<h3>'+esc(title)+'</h3>' : '') +
    '<div class="sheet-body"></div>' +
    '</div></div>'
  );
  $('.sheet-body', m).innerHTML = bodyHtml;
  const close = () => { m.remove(); document.body.style.overflow = ''; };
  $('.bg', m).addEventListener('click', close);
  document.body.appendChild(m);
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(m, close);
  return { el: m, close };
}

export function confirmSheet(title, text, okLabel, onOk){
  sheet(title,
    '<p class="muted small" style="margin:0 0 14px">'+esc(text)+'</p>' +
    '<div class="btn-row"><button class="btn ghost" data-x>Отмена</button>' +
    '<button class="btn primary" data-ok>'+esc(okLabel||'Да')+'</button></div>',
    (m, close) => {
      $('[data-x]', m).onclick = close;
      $('[data-ok]', m).onclick = () => { close(); onOk(); };
    });
}

/* ---------- кольцо прогресса ---------- */
export function ring(pct, big, small, color){
  const p = Math.max(0, Math.min(100, pct));
  const R = 48, C = 2*Math.PI*R;
  const off = C * (1 - p/100);
  return (
    '<div class="ring">' +
      '<svg viewBox="0 0 112 112" width="112" height="112">' +
        '<circle cx="56" cy="56" r="'+R+'" fill="none" stroke="var(--surface-2)" stroke-width="10"/>' +
        '<circle cx="56" cy="56" r="'+R+'" fill="none" stroke="'+color+'" stroke-width="10" stroke-linecap="round" ' +
          'stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/>' +
      '</svg>' +
      '<div class="val"><b>'+esc(big)+'</b><span>'+esc(small)+'</span></div>' +
    '</div>'
  );
}

/* ---------- полоса-метр ---------- */
export function meter(label, cur, target, unit, cls){
  const pct = target > 0 ? Math.min(100, cur/target*100) : 0;
  return (
    '<div class="meter">' +
      '<div class="lab"><span class="muted">'+esc(label)+'</span>' +
      '<b>'+esc(num(cur))+' <span class="dim" style="font-weight:400">/ '+esc(num(target))+' '+esc(unit)+'</span></b></div>' +
      '<div class="bar"><i class="'+cls+'" style="width:'+pct.toFixed(1)+'%"></i></div>' +
    '</div>'
  );
}
