/* ================================================================
   Cartera · app principal
   Datos guardados automáticamente en el iPhone (localStorage + IndexedDB).
   ================================================================ */
'use strict';

const KEY = 'cartera.v1';
const APP_VERSION = '1.1.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- Estado ---------------- */
function freshState() {
  return {
    v: 1,
    cats: DEFAULT_CATS.map((c) => ({ ...c })),
    tx: [], fixed: [], inst: [], goals: [], chat: [],
    learn: { words: {}, merchants: {}, feedback: {}, dismissed: {}, preds: {}, bias: 1, corrections: 0, confirms: 0, notFixed: [] },
    settings: { name: '', pin: '', lastBackup: '', onboarded: false, installHidden: false, theme: 'auto' }
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    const base = freshState();
    const out = { ...base, ...s, learn: { ...base.learn, ...(s.learn || {}) }, settings: { ...base.settings, ...(s.settings || {}) } };
    // categorías nuevas de futuras versiones
    for (const c of base.cats) if (!out.cats.some((x) => x.id === c.id)) out.cats.push(c);
    return out;
  } catch (e) { console.error(e); return freshState(); }
}
let S = loadState();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('⚠️ No se pudo guardar: memoria llena'); }
  }, 60);
}
function saveNow() { clearTimeout(saveTimer); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function commit() { save(); render(); }

/* ---------------- Tema claro / oscuro ---------------- */
const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const pref = S.settings.theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && !!darkMQ?.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('#theme-color')?.setAttribute('content', dark ? '#000000' : '#F2F2F7');
}
darkMQ?.addEventListener?.('change', () => { if ((S.settings.theme || 'auto') === 'auto') applyTheme(); });

const UI = { tab: 'home', homeYm: U.ym(), movSeg: 'hist', movCat: 'all', search: '', saveSeg: 'goals', novaSeg: 'chat', typing: false };

/* ---------------- Fotos de tickets (IndexedDB) ---------------- */
const Photos = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('cartera-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(id, dataUrl) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('p', 'readwrite'); t.objectStore('p').put(dataUrl, id); t.oncomplete = res; t.onerror = res; }); },
  async get(id) { const db = await this.open(); return new Promise((res) => { const r = db.transaction('p').objectStore('p').get(id); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); },
  async del(id) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('p', 'readwrite'); t.objectStore('p').delete(id); t.oncomplete = res; t.onerror = res; }); },
  async all() { const db = await this.open(); return new Promise((res) => { const out = {}; const r = db.transaction('p').objectStore('p').openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); }; r.onerror = () => res(out); }); },
  async clear() { const db = await this.open(); return new Promise((res) => { const t = db.transaction('p', 'readwrite'); t.objectStore('p').clear(); t.oncomplete = res; }); }
};

/* ---------------- Gastos fijos y cuotas automáticos ---------------- */
function processRecurring() {
  const today = U.today();
  const now = U.ym();
  let added = 0;
  for (const f of S.fixed) {
    if (!f.active) continue;
    let ym = (f.genFrom || today).slice(0, 7);
    for (let guard = 0; ym <= now && guard < 60; ym = U.addMonths(ym, 1), guard++) {
      const date = U.dateIn(ym, f.day);
      if (date > today || date < (f.genFrom || '')) continue;
      if ((f.skip || []).includes(ym)) continue;
      if (S.tx.some((t) => t.fixedId === f.id && t.date.slice(0, 7) === ym)) continue;
      S.tx.push({ id: U.uid(), type: f.type, amount: f.amount, desc: f.name, cat: f.cat, date, note: '', fixedId: f.id, auto: true });
      added++;
    }
  }
  for (const p of S.inst) {
    const startYm = p.start.slice(0, 7);
    const day = U.dayOf(p.start);
    for (let k = 0; k < p.months; k++) {
      const ym = U.addMonths(startYm, k);
      const date = U.dateIn(ym, day);
      if (date > today) break;
      if (date < (p.genFrom || '')) continue;
      if ((p.skip || []).includes(ym)) continue;
      if (S.tx.some((t) => t.instId === p.id && t.date.slice(0, 7) === ym)) continue;
      S.tx.push({ id: U.uid(), type: 'expense', amount: p.monthly, desc: `${p.name} (${k + 1}/${p.months})`, cat: p.cat, date, note: '', instId: p.id, auto: true });
      added++;
    }
  }
  if (added) save();
  Nova.calibrate(S);
  return added;
}

/* ---------------- Utilidades de interfaz ---------------- */
const cat = (id) => S.cats.find((c) => c.id === id) || { id, name: 'Otros', emoji: '📦', color: '#8E8E93', type: 'expense' };
function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const CHEV = '<svg class="chev" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';
const CAMERA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#007AFF"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 14.5A4.5 4.5 0 1 1 12 8.5a4.5 4.5 0 0 1 0 9zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>';

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2300);
}
function iosAlert(title, text, buttons = [{ label: 'OK', bold: true }]) {
  return new Promise((res) => {
    const w = $('#alert');
    w.innerHTML = `<div class="alert"><div class="alert-body"><b>${U.esc(title)}</b>${text ? `<p>${U.esc(text)}</p>` : ''}</div>
      <div class="alert-btns">${buttons.map((b, i) => `<button data-i="${i}" class="${b.bold ? 'bold' : ''} ${b.destructive ? 'destructive' : ''}">${U.esc(b.label)}</button>`).join('')}</div></div>`;
    w.classList.remove('hidden');
    w.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; w.classList.add('hidden'); w.onclick = null; res(buttons[+b.dataset.i].value ?? +b.dataset.i); };
  });
}
const confirmDel = (title, text, label = 'Eliminar') => iosAlert(title, text, [{ label: 'Cancelar', value: false }, { label, destructive: true, bold: true, value: true }]);

function txRow(t) {
  const c = cat(t.cat);
  const inc = t.type === 'income';
  const tags = (t.auto ? '<span class="tag auto">auto</span>' : '') + (t.photo ? '<span class="tag">🧾</span>' : '');
  return `<button class="row" data-act="editTx" data-id="${t.id}">
    <div class="row-ico" style="background:${hexA(c.color, .16)}">${c.emoji}</div>
    <div class="row-main"><div class="row-title">${U.esc(t.desc || c.name)}</div><div class="row-sub">${U.esc(c.name)}${tags}</div></div>
    <div class="row-end ${inc ? 'pos' : 'neg'}">${inc ? '+' : '−'}${U.eur2(t.amount)}</div></button>`;
}

/* ---------------- Gráficos ---------------- */
function donut(items, total, center, sub) {
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const segs = items.map((it) => {
    const len = total ? (it.v / total) * C : 0;
    const s = `<circle r="${R}" cx="66" cy="66" fill="none" stroke="${it.color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" />`;
    off += len; return s;
  }).join('');
  return `<div class="donut"><svg viewBox="0 0 132 132"><circle r="${R}" cx="66" cy="66" fill="none" stroke="var(--fill)" stroke-width="16"/>${segs}</svg>
    <div class="donut-center"><div><b>${center}</b><small>${sub}</small></div></div></div>`;
}
function ring(pct, color, emoji) {
  const R = 28, C = 2 * Math.PI * R;
  return `<div class="ring"><svg viewBox="0 0 64 64"><circle r="${R}" cx="32" cy="32" fill="none" stroke="var(--fill)" stroke-width="6"/>
    <circle r="${R}" cx="32" cy="32" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C * U.clamp(pct, 0, 1)} ${C}"/></svg><span>${emoji}</span></div>`;
}

/* ================================================================
   PANTALLAS
   ================================================================ */
function render() {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === UI.tab));
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === UI.tab));
  ({ home: renderHome, movs: renderMovs, save: renderSave, nova: renderNova })[UI.tab]();
}

/* ---------- Inicio ---------- */
function renderHome() {
  const ym = UI.homeYm;
  const isNow = ym === U.ym();
  const t = Nova.totals(S, ym);
  const f = Nova.forecast(S, ym);
  const avail = t.inc - t.exp - t.saved;
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  const spent = Object.entries(Nova.byCat(S, ym)).sort((a, b) => b[1] - a[1]);
  const totalSpent = U.sum(spent, (x) => x[1]);
  const items = spent.slice(0, 6).map(([id, v]) => ({ id, v, color: cat(id).color }));
  if (spent.length > 6 && U.sum(spent.slice(6), (x) => x[1]) / totalSpent >= 0.005) items.push({ id: 'rest', v: U.sum(spent.slice(6), (x) => x[1]), color: '#C7C7CC' });
  const insights = isNow ? Nova.insights(S).slice(0, 4) : [];
  const budgets = S.cats.filter((c) => c.type === 'expense' && c.budget > 0);
  const byCat = Nova.byCat(S, ym);
  const upcoming = [...Nova.scheduled(S, U.ym()), ...Nova.scheduled(S, U.addMonths(U.ym(), 1))].filter((s) => !s.done && U.daysUntil(s.date) >= 0).slice(0, 4);
  const recent = [...S.tx].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const pctUsed = t.inc > 0 ? U.clamp(t.exp / t.inc, 0, 1) : 0;

  // evolución 6 meses
  const months = [...Array(6)].map((_, i) => U.addMonths(U.ym(), i - 5));
  const evo = months.map((m) => { const x = Nova.totals(S, m); return { m, inc: x.inc, exp: x.exp }; });
  const maxEvo = Math.max(1, ...evo.map((e) => Math.max(e.inc, e.exp)));

  $('#screen-home').innerHTML = `
    <div class="nav"><div></div><button class="icon-btn" data-act="openSettings" aria-label="Ajustes">${GEAR}</button></div>
    <div class="large-title">${greet}${S.settings.name ? ', ' + U.esc(S.settings.name) : ''}</div>
    ${!standalone && !S.settings.installHidden ? `<div class="card" style="margin-bottom:14px;display:flex;gap:12px;align-items:center">
      <img src="icon-180.png" style="width:44px;height:44px;border-radius:11px" alt="">
      <div style="flex:1;font-size:14px"><b>Instala Cartera</b><div style="color:var(--label2)">Pulsa <b>Compartir</b> ⬆️ y luego <b>Añadir a pantalla de inicio</b>.</div></div>
      <button data-act="hideInstall" style="color:var(--label2);font-size:20px;padding:4px">✕</button></div>` : ''}
    <div class="hero">
      <div class="hero-month">
        <button data-act="homePrev" aria-label="Mes anterior"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg></button>
        <span>${U.monthLabel(ym)}</span>
        <button data-act="homeNext" aria-label="Mes siguiente" ${isNow ? 'style="visibility:hidden"' : ''}><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg></button>
      </div>
      <div class="hero-label">Disponible</div>
      <div class="hero-amount">${U.eur2(avail)}</div>
      <div class="hero-row">
        <div class="hero-pill"><small>Ingresos</small><b>${U.eur(t.inc)}</b></div>
        <div class="hero-pill"><small>Gastos</small><b>${U.eur(t.exp)}</b></div>
        <div class="hero-pill"><small>Ahorrado</small><b>${U.eur(t.saved)}</b></div>
      </div>
      ${t.inc > 0 ? `<div class="hero-progress"><i style="width:${pctUsed * 100}%"></i></div>
      <div class="hero-foot">Has gastado el ${Math.round(pctUsed * 100)} % de tus ingresos${isNow && f.inc > 0 ? ` · previsión fin de mes: <b>${U.eur(f.end)}</b>` : ''}</div>` : `<div class="hero-foot" style="margin-top:12px">${isNow ? 'Apunta tu nómina para ver cuánto te queda y la previsión de Nova.' : ''}</div>`}
    </div>

    ${insights.length ? `<div class="section-h"><span class="nova-badge" style="font-size:20px;font-weight:700">✦ Nova te dice</span><button class="link" data-act="goNovaTips">Ver todo</button></div>
      <div class="nova-strip">${insights.map((i) => insightCard(i)).join('')}</div>` : ''}

    <div class="section-h"><span>Gastos por categoría</span></div>
    <div class="card">${totalSpent ? `<div class="donut-wrap">${donut(items, totalSpent, U.eur(totalSpent), 'gastado')}
      <div class="legend">${items.map((it) => `<div><i style="background:${it.color}"></i><span>${it.id === 'rest' ? 'Resto' : cat(it.id).emoji + ' ' + U.esc(cat(it.id).name)}</span><b>${Math.round(it.v / totalSpent * 100)}%</b></div>`).join('')}</div></div>`
      : '<div class="empty" style="padding:18px"><div class="big">🧾</div>Aún no hay gastos este mes.<br>Pulsa <b>+</b> para apuntar el primero.</div>'}</div>

    ${budgets.length ? `<div class="section-h"><span>Presupuestos</span><button class="link" data-act="openCats">Editar</button></div>
    <div class="list">${budgets.map((c) => { const s = byCat[c.id] || 0; const p = s / c.budget; const col = p >= 1 ? 'var(--red)' : p >= .8 ? 'var(--orange)' : c.color;
      return `<div class="budget"><div class="budget-top"><span>${c.emoji} ${U.esc(c.name)}</span><span>${U.eur(s)} / ${U.eur(c.budget)}</span></div><div class="bar"><i style="width:${U.clamp(p, 0, 1) * 100}%;background:${col}"></i></div></div>`; }).join('')}</div>` : ''}

    ${upcoming.length ? `<div class="section-h"><span>Próximos pagos</span><button class="link" data-act="goSched">Ver fijos</button></div>
    <div class="list">${upcoming.map((s) => { const c = cat(s.cat); const d = U.daysUntil(s.date);
      return `<div class="row"><div class="row-ico" style="background:${hexA(c.color, .16)}">${c.emoji}</div><div class="row-main"><div class="row-title">${U.esc(s.name)}</div><div class="row-sub">${d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `En ${d} días · ${U.shortDate(s.date)}`}</div></div><div class="row-end ${s.type === 'income' ? 'pos' : ''}">${s.type === 'income' ? '+' : ''}${U.eur2(s.amount)}</div></div>`; }).join('')}</div>` : ''}

    <div class="section-h"><span>Evolución</span></div>
    <div class="card"><div class="bars">${evo.map((e) => `<div class="col"><div class="stack"><i style="height:${e.inc / maxEvo * 100}%;background:var(--accent)"></i><i style="height:${e.exp / maxEvo * 100}%;background:#FF6482"></i></div><small>${U.monthName(e.m, true)}</small></div>`).join('')}</div>
      <div class="bars-legend"><span><i style="background:var(--accent)"></i>Ingresos</span><span><i style="background:#FF6482"></i>Gastos</span></div></div>

    <div class="section-h"><span>Últimos movimientos</span>${recent.length ? '<button class="link" data-act="goMovs">Ver todo</button>' : ''}</div>
    ${recent.length ? `<div class="list">${recent.map(txRow).join('')}</div>` : '<div class="card empty">Todavía no hay movimientos.</div>'}
  `;
}

function insightCard(i, full) {
  const fb = (S.learn.feedback || {})[i.key] || {};
  return `<div class="insight tone-${i.tone} ${full ? 'full' : ''}">
    <div class="insight-top"><div class="insight-emoji">${i.emoji}</div><div style="flex:1;min-width:0"><div class="insight-title">${U.esc(i.title)}</div><div class="insight-text">${U.esc(i.text).replace(/\n/g, '<br>')}</div></div></div>
    <div class="insight-actions">${i.action ? `<button class="act" data-act="insightAction" data-id="${U.esc(i.id)}">${U.esc(i.action.label)}</button>` : '<span></span>'}
      <div class="fb"><button data-act="fb" data-key="${i.key}" data-id="${U.esc(i.id)}" data-v="up" aria-label="Útil">👍</button><button data-act="fb" data-key="${i.key}" data-id="${U.esc(i.id)}" data-v="down" aria-label="No me sirve">👎</button></div></div>
  </div>`;
}

/* ---------- Movimientos ---------- */
function renderMovs() {
  const seg = UI.movSeg;
  let body = '';
  if (seg === 'hist') {
    const q = U.norm(UI.search);
    let list = [...S.tx].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (UI.movCat !== 'all') list = list.filter((t) => t.cat === UI.movCat);
    if (q) list = list.filter((t) => U.norm(t.desc + ' ' + cat(t.cat).name + ' ' + (t.note || '')).includes(q));
    const used = [...new Set(S.tx.map((t) => t.cat))];
    const chips = `<div class="chips"><button class="chip ${UI.movCat === 'all' ? 'on' : ''}" data-act="movCat" data-id="all">Todas</button>${used.map((id) => `<button class="chip ${UI.movCat === id ? 'on' : ''}" data-act="movCat" data-id="${id}">${cat(id).emoji} ${U.esc(cat(id).name)}</button>`).join('')}</div>`;
    let html = '', lastM = '', lastD = '', open = false;
    const shown = list.slice(0, 400);
    for (const t of shown) {
      const m = t.date.slice(0, 7);
      if (m !== lastM) {
        if (open) { html += '</div>'; open = false; }
        const mt = list.filter((x) => x.date.slice(0, 7) === m);
        const e = U.sum(mt.filter((x) => x.type === 'expense'), (x) => x.amount), i = U.sum(mt.filter((x) => x.type === 'income'), (x) => x.amount);
        html += `<div class="section-h" style="margin-top:20px"><span>${U.monthLabel(m)}</span><span style="font-size:13px;font-weight:500;color:var(--label2)">${i ? `+${U.eur(i)} · ` : ''}−${U.eur(e)}</span></div>`;
        lastM = m; lastD = '';
      }
      if (t.date !== lastD) {
        if (open) html += '</div>';
        html += `<div class="day-h"><span>${U.dateLabel(t.date)}</span></div><div class="list">`; open = true; lastD = t.date;
      }
      html += txRow(t);
    }
    if (open) html += '</div>';
    body = `<div class="search"><svg viewBox="0 0 24 24"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg><input id="mov-search" placeholder="Buscar" value="${U.esc(UI.search)}" autocomplete="off"></div>
      ${chips}${shown.length ? html : `<div class="empty"><div class="big">🔍</div>${S.tx.length ? 'No hay movimientos con ese filtro.' : 'Aún no has apuntado nada.<br>Pulsa <b>+</b> para empezar.'}</div>`}`;
  } else if (seg === 'fixed') {
    const exp = S.fixed.filter((f) => f.type === 'expense'), inc = S.fixed.filter((f) => f.type === 'income');
    const totE = U.sum(exp.filter((f) => f.active), (f) => f.amount), totI = U.sum(inc.filter((f) => f.active), (f) => f.amount);
    const row = (f) => { const c = cat(f.cat); const next = nextDate(f);
      return `<button class="row" data-act="editFixed" data-id="${f.id}" style="${f.active ? '' : 'opacity:.45'}"><div class="row-ico" style="background:${hexA(c.color, .16)}">${c.emoji}</div>
        <div class="row-main"><div class="row-title">${U.esc(f.name)}</div><div class="row-sub">Día ${f.day}${f.active ? ` · próx. ${U.shortDate(next)}` : ' · pausado'}</div></div>
        <div class="row-end ${f.type === 'income' ? 'pos' : ''}">${f.type === 'income' ? '+' : ''}${U.eur2(f.amount)}</div>${CHEV}</button>`; };
    body = `<div class="card" style="display:flex;justify-content:space-around;text-align:center">
        <div><div style="font-size:13px;color:var(--label2)">Gastos fijos/mes</div><div style="font-size:22px;font-weight:700">${U.eur(totE)}</div></div>
        <div><div style="font-size:13px;color:var(--label2)">Ingresos fijos/mes</div><div style="font-size:22px;font-weight:700;color:var(--accent-ink)">${U.eur(totI)}</div></div></div>
      <p class="footnote">Se apuntan solos el día que toca y Nova te avisa unos días antes.</p>
      ${exp.length ? `<div class="group-label">Gastos fijos</div><div class="list">${exp.map(row).join('')}</div>` : ''}
      ${inc.length ? `<div class="group-label">Ingresos fijos</div><div class="list">${inc.map(row).join('')}</div>` : ''}
      ${!S.fixed.length ? '<div class="empty"><div class="big">🗓️</div>Añade tu alquiler, recibos, suscripciones o tu nómina.</div>' : ''}
      <div class="btn-row"><button class="btn secondary" data-act="newFixed" data-type="expense">＋ Gasto fijo</button><button class="btn secondary" data-act="newFixed" data-type="income">＋ Ingreso fijo</button></div>`;
  } else {
    const now = U.ym();
    const rows = S.inst.map((p) => {
      const c = cat(p.cat);
      const paid = U.clamp(U.monthsBetween(p.start.slice(0, 7), now) + (U.today() >= U.dateIn(now, U.dayOf(p.start)) ? 1 : 0), 0, p.months);
      const left = p.months - paid;
      const endYm = U.addMonths(p.start.slice(0, 7), p.months - 1);
      return `<button class="card" data-act="editInst" data-id="${p.id}" style="display:block;width:100%;text-align:left;margin-top:12px">
        <div style="display:flex;align-items:center;gap:12px"><div class="row-ico" style="background:${hexA(c.color, .16)}">${c.emoji}</div>
        <div style="flex:1;min-width:0"><div class="row-title" style="font-weight:600">${U.esc(p.name)}</div><div class="row-sub">${U.eur2(p.monthly)}/mes · ${p.months} meses</div></div>
        <div class="row-end">${U.eur(p.monthly * left)}<small>pendiente</small></div></div>
        <div class="bar" style="margin-top:12px"><i style="width:${paid / p.months * 100}%;background:${c.color}"></i></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--label2);margin-top:6px"><span>${paid} de ${p.months} pagadas</span><span>${left ? 'Termina en ' + U.monthName(endYm) + ' ' + endYm.slice(0, 4) : '✅ Terminado'}</span></div></button>`;
    }).join('');
    const active = S.inst.filter((p) => U.monthsBetween(p.start.slice(0, 7), now) < p.months);
    body = `${S.inst.length ? `<div class="card" style="text-align:center"><div style="font-size:13px;color:var(--label2)">Pagas en cuotas cada mes</div><div style="font-size:26px;font-weight:700">${U.eur2(U.sum(active.filter((p) => U.monthsBetween(p.start.slice(0, 7), now) >= 0), (p) => p.monthly))}</div></div>${rows}`
      : '<div class="empty"><div class="big">💳</div>Añade compras a plazos: el móvil, un mueble, un préstamo…<br>Cartera apunta cada cuota y te dice cuándo terminas.</div>'}
      <div class="btn-row"><button class="btn secondary" data-act="newInst">＋ Gasto fraccionado</button></div>`;
  }
  $('#screen-movs').innerHTML = `<div class="nav"></div><div class="large-title">Movimientos</div>
    <div class="seg"><button class="${seg === 'hist' ? 'on' : ''}" data-act="movSeg" data-id="hist">Historial</button><button class="${seg === 'fixed' ? 'on' : ''}" data-act="movSeg" data-id="fixed">Fijos</button><button class="${seg === 'inst' ? 'on' : ''}" data-act="movSeg" data-id="inst">Fraccionados</button></div>${body}`;
}
function nextDate(f) {
  const t = U.today();
  let ym = U.ym();
  for (let i = 0; i < 3; i++, ym = U.addMonths(ym, 1)) { const d = U.dateIn(ym, f.day); if (d >= t && d >= (f.genFrom || '')) return d; }
  return U.dateIn(ym, f.day);
}

/* ---------- Ahorro ---------- */
function renderSave() {
  const total = U.sum(S.goals, (g) => g.saved);
  const thisM = Nova.totals(S, U.ym()).saved;
  const goals = S.goals.map((g) => {
    const pct = g.target ? g.saved / g.target : 0;
    let sub = '';
    if (g.saved >= g.target) sub = '🏆 ¡Conseguida!';
    else if (g.deadline) { const m = Math.max(1, U.monthsBetween(U.ym(), g.deadline.slice(0, 7))); sub = `${U.eur((g.target - g.saved) / m)}/mes para llegar el ${U.shortDate(g.deadline)} ${g.deadline.slice(0, 4)}`; }
    else sub = `Faltan ${U.eur(g.target - g.saved)}`;
    return `<div class="card"><div class="goal" data-act="editGoal" data-id="${g.id}">${ring(pct, g.saved >= g.target ? '#FFB800' : 'var(--accent)', g.emoji)}
      <div class="goal-main"><div class="goal-name">${U.esc(g.name)}</div><div class="goal-amt"><b>${U.eur(g.saved)}</b> de ${U.eur(g.target)} · ${Math.round(pct * 100)} %</div><div class="goal-sub">${sub}</div></div>${CHEV}</div>
      <div class="goal-btns"><button class="btn small secondary" data-act="contribute" data-id="${g.id}">＋ Aportar</button><button class="btn small gray" data-act="withdraw" data-id="${g.id}">− Retirar</button></div></div>`;
  }).join('');
  $('#screen-save').innerHTML = `<div class="nav"></div><div class="large-title">Ahorro</div>
    <div class="card save-total"><div style="color:var(--label2);font-size:14px">Total ahorrado</div><div class="hero-amount">${U.eur2(total)}</div>
      <div style="color:var(--label2);font-size:14px">${thisM ? `Este mes has apartado ${U.eur(thisM)}` : 'Aparta algo cada mes, aunque sea poco 🌱'}</div></div>
    <div class="section-h"><span>Tus metas</span></div>
    ${goals || '<div class="card empty"><div class="big">🐷</div>Crea tu primera meta: un viaje, un fondo de emergencia, un capricho…<br>Nova te dirá cuánto apartar cada mes.</div>'}
    <div class="btn-row"><button class="btn" data-act="newGoal">＋ Nueva meta</button></div>`;
}

/* ---------- Nova ---------- */
function renderNova() {
  const seg = UI.novaSeg;
  let body = '', composer = '';
  if (seg === 'chat') {
    if (!S.chat.length) S.chat.push({ from: 'nova', html: `¡Hola${S.settings.name ? ', ' + U.esc(S.settings.name) : ''}! Soy <b>Nova</b> ✨, tu asistente de Cartera.\nAprendo de tus gastos para avisarte de lo que se dispara, decirte dónde recortar y aconsejarte antes de comprar algo.\n\nPrueba a preguntarme «¿me compro unas zapatillas de 90 €?» o dime «he gastado 12 € en Mercadona» y lo apunto.`, ts: Date.now() });
    body = `<div class="msgs" id="msgs">${S.chat.map((m, i) => `<div class="msg ${m.from}">${m.from === 'me' ? U.esc(m.text) : m.html}${(m.actions || []).length ? `<div class="msg-actions">${m.actions.map((a, j) => `<button data-act="chatAction" data-i="${i}" data-j="${j}">${U.esc(a.label)}</button>`).join('')}</div>` : ''}</div>`).join('')}
      ${UI.typing ? '<div class="msg nova typing"><i></i><i></i><i></i></div>' : ''}</div>`;
    const q = ['¿Cómo voy este mes?', '¿Dónde puedo recortar?', '¿Me puedo permitir un gasto de 100 €?', '¿Qué pagos tengo pronto?', '¿Cuánto llevo en cenas?', '¿Qué has aprendido de mí?'];
    composer = `<div class="composer-wrap"><div class="quick">${q.map((x) => `<button data-act="quick" data-q="${U.esc(x)}">${U.esc(x)}</button>`).join('')}</div>
      <div class="composer"><textarea id="chat-input" rows="1" placeholder="Pregúntale a Nova…"></textarea><button class="send" data-act="send" aria-label="Enviar"><svg viewBox="0 0 24 24"><path d="M12 4l7 7-1.4 1.4L13 7.8V20h-2V7.8l-4.6 4.6L5 11z"/></svg></button></div></div>`;
  } else if (seg === 'tips') {
    const list = Nova.insights(S);
    body = list.length ? list.map((i) => insightCard(i, true)).join('') : '<div class="empty"><div class="big">✨</div>Todo en orden por ahora. Cuantos más movimientos apuntes, mejores serán mis avisos.</div>';
    body += '<p class="footnote">Valora los avisos con 👍/👎: Nova te mostrará más de los que te sirven y menos de los que no.</p><div style="height:20px"></div>';
  } else {
    const L = S.learn;
    const months = new Set(S.tx.map((t) => t.date.slice(0, 7))).size;
    const merchants = Object.entries(L.merchants).map(([k, v]) => { const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; return best && best[1] > 0 ? { k, cat: best[0], n: best[1] } : null; }).filter(Boolean).sort((a, b) => b.n - a.n);
    const fbCount = U.sum(Object.values(L.feedback || {}), (x) => x.up + x.down);
    const level = U.clamp(months / 6 * 0.5 + Math.min(merchants.length, 40) / 40 * 0.3 + Math.min((L.corrections || 0) + fbCount, 20) / 20 * 0.2, 0.03, 1);
    const lvlName = level < .25 ? 'Conociéndote' : level < .5 ? 'Aprendiendo tus hábitos' : level < .8 ? 'Te conoce bien' : 'Experta en ti';
    body = `<div class="learn-card"><div><b>${months}</b><small>meses de datos</small></div><div><b>${merchants.length}</b><small>comercios aprendidos</small></div><div><b>${L.accuracy ? Math.round(L.accuracy * 100) + '%' : '—'}</b><small>acierto previsiones</small></div></div>
      <div class="card level"><div style="display:flex;justify-content:space-between;font-size:15px"><b>${lvlName}</b><span style="color:var(--label2)">${Math.round(level * 100)} %</span></div><div class="bar"><i style="width:${level * 100}%"></i></div>
      <div style="font-size:13.5px;color:var(--label2);margin-top:10px;line-height:1.45">Nova aprende cada vez que:<br>• apuntas un gasto y confirmas la categoría<br>• corriges una categoría (${L.corrections || 0} veces hasta ahora)<br>• valoras un aviso con 👍/👎 (${fbCount} valoraciones)<br>• cierra un mes y compara su previsión con lo real${L.bias && L.bias !== 1 ? ` (ajuste actual ×${L.bias.toFixed(2)})` : ''}</div></div>
      <div class="group-label">Lo que Nova sabe de tus comercios</div>
      ${merchants.length ? `<div class="list">${merchants.slice(0, 60).map((m) => `<button class="row" data-act="forgetMerchant" data-k="${U.esc(m.k)}"><div class="row-ico" style="background:${hexA(cat(m.cat).color, .16)}">${cat(m.cat).emoji}</div><div class="row-main"><div class="row-title" style="text-transform:capitalize">${U.esc(m.k)}</div><div class="row-sub">→ ${U.esc(cat(m.cat).name)} · ${m.n} ${m.n === 1 ? 'vez' : 'veces'}</div></div><span style="color:var(--label3);font-size:13px">Olvidar</span></button>`).join('')}</div>`
        : '<div class="card empty">Aún nada. Apunta gastos con un concepto (p. ej. «Mercadona») y Nova irá aprendiendo.</div>'}
      <div class="btn-row"><button class="btn danger" data-act="resetLearn">Olvidar todo lo aprendido</button></div><div style="height:20px"></div>`;
  }
  $('#screen-nova').innerHTML = `
    <div class="nova-head"><div class="nova-orb big ${UI.typing ? 'pulse' : ''}"></div><div><div class="t">Nova</div><div class="s">Tu asistente · aprende de ti · 100 % privado</div></div></div>
    <div class="seg nova-tabs"><button class="${seg === 'chat' ? 'on' : ''}" data-act="novaSeg" data-id="chat">Chat</button><button class="${seg === 'tips' ? 'on' : ''}" data-act="novaSeg" data-id="tips">Avisos</button><button class="${seg === 'learn' ? 'on' : ''}" data-act="novaSeg" data-id="learn">Aprendizaje</button></div>
    <div class="nova-body" id="nova-body" ${seg !== 'chat' ? 'style="padding-bottom:110px"' : ''}>${body}</div>${composer}`;
  if (seg === 'chat') { const b = $('#nova-body'); b.scrollTop = b.scrollHeight; }
}

async function sendChat(text) {
  text = (text || '').trim();
  if (!text || UI.typing) return;
  S.chat.push({ from: 'me', text, ts: Date.now() });
  UI.typing = true; renderNova(); save();
  await new Promise((r) => setTimeout(r, 550 + Math.random() * 500));
  let res;
  try { res = Nova.reply(S, text); } catch (e) { console.error(e); res = { html: 'Uy, me he liado con eso. ¿Puedes decírmelo de otra forma?' }; }
  const msg = { from: 'nova', html: res.html, actions: res.actions || [], ts: Date.now() };
  if (res.add) {
    const tx = { id: U.uid(), type: res.add.type, amount: U.r2(res.add.amount), desc: res.add.desc, cat: res.add.cat, date: U.today(), note: '' };
    S.tx.push(tx);
    Nova.learn(S, tx.desc, tx.cat, false);
    msg.actions = [{ label: 'Cambiar categoría', do: 'editTxId', arg: tx.id }, { label: 'Deshacer', do: 'undoTx', arg: tx.id }];
  }
  S.chat.push(msg);
  if (S.chat.length > 200) S.chat = S.chat.slice(-200);
  UI.typing = false; save(); renderNova();
}

/* ================================================================
   HOJAS (formularios)
   ================================================================ */
const Sheet = {
  cur: null,
  open(name, d = {}) { this.cur = { name, d }; this.render(); $('#sheet').classList.add('on'); $('#sheet-backdrop').classList.add('on'); $('#sheet-body').scrollTop = 0; },
  render() { if (!this.cur) return; $('#sheet-body').innerHTML = SHEETS[this.cur.name].render(this.cur.d); SHEETS[this.cur.name].after?.(this.cur.d); },
  close() { this.cur = null; $('#sheet').classList.remove('on'); $('#sheet-backdrop').classList.remove('on'); document.activeElement?.blur?.(); setTimeout(() => { if (!Sheet.cur) $('#sheet-body').innerHTML = ''; }, 400); }
};
const nav = (title, left = 'Cancelar', right = '', rightAct = '', leftAct = 'closeSheet') =>
  `<div class="sheet-nav"><button class="l" data-act="${leftAct}">${left}</button><div class="t">${title}</div>${right ? `<button class="r" data-act="${rightAct}">${right}</button>` : '<span></span>'}</div>`;
const catOptions = (type, sel) => S.cats.filter((c) => c.type === type).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.emoji} ${U.esc(c.name)}</option>`).join('');

const EMOJIS = '🛒⛽🍽️🎉☕🚬🏠📺🚗🛍️💊📦🐶👶🎓✈️🏋️🎮📚💇🎁🍺🍕🚌🔧💡📱💻👕🧴🎬⚽🏖️🎵🍔🧾💼💸🪙🏦📈'.match(/\p{Extended_Pictographic}️?/gu);
const COLORS = ['#34C759', '#FF9500', '#FF2D55', '#AF52DE', '#A2845E', '#8E8E93', '#007AFF', '#5856D6', '#5AC8FA', '#FF6482', '#30B0C7', '#FFCC00', '#FF3B30', '#10B981'];

const SHEETS = {
  /* ----- Nuevo / editar movimiento ----- */
  tx: {
    render(d) {
      const isInc = d.type === 'income';
      const sug = d.desc ? Nova.classify(S, d.desc, U.parseAmount(d.amount) || 0, d.type) : null;
      d.suggest = sug;
      const selected = d.cat || sug?.cat || '';
      return `${nav(d.id ? 'Editar' : isInc ? 'Nuevo ingreso' : 'Nuevo gasto', 'Cancelar', 'Guardar', 'saveTx')}
        ${d.id ? '' : `<div class="seg"><button class="${!isInc ? 'on' : ''}" data-act="txType" data-id="expense">Gasto</button><button class="${isInc ? 'on' : ''}" data-act="txType" data-id="income">Ingreso</button></div>`}
        <div class="amount-box ${isInc ? 'income' : 'expense'}"><div class="amount-input"><input id="tx-amount" inputmode="decimal" placeholder="0" value="${U.esc(d.amount ?? '')}" autocomplete="off"><span>€</span></div></div>
        ${!isInc && !d.id ? `<button class="scan-btn" data-act="scanTicket"><div class="row-ico">${CAMERA}</div><div style="flex:1"><div style="font-weight:600">Escanear ticket o factura</div><div style="font-size:13px;color:var(--label2)">Nova lee el importe, la fecha y el comercio</div></div>${CHEV}</button>
          <div style="text-align:right;margin-top:6px"><button style="color:var(--accent-ink);font-size:14px" data-act="pickTicket">o elegir una foto de la galería</button></div>` : ''}
        ${d.photoData ? `<img class="ticket-thumb" src="${d.photoData}" alt="Ticket">` : d.hasPhoto ? '<div id="photo-slot"></div>' : ''}
        ${d.ocrNote ? `<div class="nova-suggest"><div class="nova-orb"></div><div>${d.ocrNote}</div></div>` : ''}
        ${(d.ocrCands || []).length > 1 ? `<div class="chips" style="margin:10px -16px 0">${d.ocrCands.map((v) => `<button class="chip ${U.parseAmount(d.amount) === v ? 'on' : ''}" data-act="pickAmount" data-v="${v}">${U.eur2(v)}</button>`).join('')}</div>` : ''}
        <div class="group-label">Detalles</div>
        <div class="form">
          <div class="field"><label>Concepto</label><input id="tx-desc" placeholder="${isInc ? 'Nómina, Bizum…' : 'Mercadona, gasolina…'}" value="${U.esc(d.desc || '')}" autocomplete="off"></div>
          <div class="field"><label>Fecha</label><input id="tx-date" type="date" value="${d.date}"></div>
          <div class="field"><label>Nota</label><input id="tx-note" placeholder="Opcional" value="${U.esc(d.note || '')}"></div>
          ${!d.id ? `<div class="field"><label style="flex:1">Repetir cada mes (fijo)</label><label class="switch"><input type="checkbox" id="tx-repeat" ${d.repeat ? 'checked' : ''}><span></span></label></div>` : ''}
        </div>
        <div class="group-label">Categoría</div>
        <div id="tx-cats">${SHEETS.tx.cats(d, selected)}</div>
        ${!isInc && !d.id ? '<div style="text-align:center;margin-top:16px"><button style="color:var(--accent-ink);font-size:15px" data-act="txToInst">💳 ¿Lo pagas a plazos? Fraccionar</button></div>' : ''}
        ${d.id ? `<div class="btn-row" style="margin-top:24px"><button class="btn danger" data-act="deleteTx">Eliminar movimiento</button></div>` : ''}`;
    },
    cats(d, selected) {
      const sug = d.suggest;
      const list = S.cats.filter((c) => c.type === d.type);
      return `${sug && d.desc ? `<div class="nova-suggest" id="tx-suggest" style="margin:0 0 10px"><div class="nova-orb"></div><div>Nova lo pondría en <b>${cat(sug.cat).emoji} ${U.esc(cat(sug.cat).name)}</b> <span style="color:var(--label2)">· ${sug.why}${d.cat && d.cat !== sug.cat ? ' · tú has elegido otra, aprenderé de ello' : ''}</span></div></div>` : ''}
        <div class="cat-grid">${list.map((c) => `<button class="cat-pick ${c.id === selected ? 'on' : ''}" data-act="txCat" data-id="${c.id}"><span class="e" style="background:${hexA(c.color, .16)}">${c.emoji}</span>${sug && sug.cat === c.id ? '<span class="spark">✨</span>' : ''}<span>${U.esc(c.name)}</span></button>`).join('')}
        <button class="cat-pick" data-act="newCatFromTx"><span class="e" style="background:var(--fill)">＋</span><span>Nueva</span></button></div>`;
    },
    after(d) {
      const a = $('#tx-amount'), de = $('#tx-desc'), dt = $('#tx-date'), no = $('#tx-note'), rp = $('#tx-repeat');
      const fit = () => { a.style.width = Math.max(2, (a.value || a.placeholder).length + 0.6) + 'ch'; };
      fit();
      a.oninput = () => { d.amount = a.value.replace(/[^\d.,]/g, ''); if (a.value !== d.amount) a.value = d.amount; fit(); refreshCats(); };
      de.oninput = () => { d.desc = de.value; refreshCats(); };
      dt.onchange = () => { d.date = dt.value || U.today(); };
      no.oninput = () => { d.note = no.value; };
      if (rp) rp.onchange = () => { d.repeat = rp.checked; };
      if (!d.id && !d.amount && !d.photoData) setTimeout(() => a.focus(), 350);
      if (d.hasPhoto && !d.photoData) Photos.get(d.id).then((p) => { const s = $('#photo-slot'); if (p && s) s.outerHTML = `<img class="ticket-thumb" src="${p}" alt="Ticket">`; });
      function refreshCats() {
        d.suggest = d.desc ? Nova.classify(S, d.desc, U.parseAmount(d.amount) || 0, d.type) : null;
        $('#tx-cats').innerHTML = SHEETS.tx.cats(d, d.cat || d.suggest?.cat || '');
      }
    }
  },

  /* ----- Leyendo ticket ----- */
  scanning: {
    render(d) {
      return `${nav('Escaneando', 'Cancelar', '', '', 'cancelScan')}
        ${d.preview ? `<img class="ticket-thumb" src="${d.preview}" alt="">` : ''}
        <div class="card scan-progress" style="text-align:center"><div class="nova-orb big pulse" style="margin:6px auto 12px"></div>
        <div style="font-weight:600">${U.esc(d.status || 'Preparando…')}</div>
        <div class="bar" style="margin-top:12px"><i id="scan-bar" style="width:${(d.p || 0) * 100}%;background:linear-gradient(90deg,var(--nova1),var(--nova2))"></i></div>
        <div style="font-size:13px;color:var(--label2);margin-top:10px">La lectura se hace en tu iPhone. La primera vez descarga el lector (~5 MB) y después funciona sin conexión.</div></div>`;
    }
  },

  /* ----- Gasto / ingreso fijo ----- */
  fixed: {
    render(d) {
      const todayDay = U.dayOf(U.today());
      const day = Number(d.day) || 1;
      return `${nav(d.id ? 'Editar fijo' : d.type === 'income' ? 'Ingreso fijo' : 'Gasto fijo', 'Cancelar', 'Guardar', 'saveFixed')}
        <div class="seg"><button class="${d.type === 'expense' ? 'on' : ''}" data-act="fixType" data-id="expense">Gasto</button><button class="${d.type === 'income' ? 'on' : ''}" data-act="fixType" data-id="income">Ingreso</button></div>
        <div class="form">
          <div class="field"><label>Nombre</label><input data-bind="name" placeholder="${d.type === 'income' ? 'Nómina' : 'Alquiler, Netflix, gimnasio…'}" value="${U.esc(d.name || '')}"></div>
          <div class="field"><label>Importe</label><input data-bind="amount" inputmode="decimal" placeholder="0,00 €" value="${U.esc(d.amount ?? '')}"></div>
          <div class="field"><label>Día del mes</label><select data-bind="day" data-rerender="1">${[...Array(31)].map((_, i) => `<option value="${i + 1}" ${i + 1 === day ? 'selected' : ''}>Día ${i + 1}</option>`).join('')}</select></div>
          <div class="field"><label>Categoría</label><select data-bind="cat">${catOptions(d.type, d.cat)}</select></div>
          ${!d.id && day < todayDay ? `<div class="field"><label style="flex:1;font-size:15px">Apuntar también el de este mes</label><label class="switch"><input type="checkbox" data-bind="thisMonth" ${d.thisMonth ? 'checked' : ''}><span></span></label></div>` : ''}
          ${d.id ? `<div class="field"><label style="flex:1">Activo</label><label class="switch"><input type="checkbox" data-bind="active" ${d.active ? 'checked' : ''}><span></span></label></div>` : ''}
        </div>
        <p class="footnote">Cada mes, el día ${day}, Cartera lo apunta sola${d.type === 'expense' ? ' y Nova te avisa unos días antes' : ''}. Si cambia el importe, edítalo aquí y se aplicará a partir del próximo.</p>
        ${d.id ? '<div class="btn-row" style="margin-top:24px"><button class="btn danger" data-act="deleteFixed">Eliminar fijo</button></div>' : ''}`;
    }
  },

  /* ----- Gasto fraccionado ----- */
  inst: {
    hint(d) {
      const total = U.parseAmount(d.total) || 0;
      const months = Number(d.months) || 0;
      const auto = total && months ? U.r2(total / months) : 0;
      const endYm = U.addMonths(d.start.slice(0, 7), months - 1);
      return `<p class="footnote">${auto ? `Pagarás <b>${U.eur2(U.parseAmount(d.monthly) || auto)}</b> al mes durante ${months} meses, hasta ${U.monthName(endYm)} ${endYm.slice(0, 4)}. ` : ''}Si hay intereses, escribe la cuota real en «Cuota mensual».</p>`;
    },
    render(d) {
      const total = U.parseAmount(d.total) || 0;
      const months = Number(d.months) || 0;
      const auto = total && months ? U.r2(total / months) : 0;
      const pastPayments = d.start < U.today() ? U.clamp(U.monthsBetween(d.start.slice(0, 7), U.ym()) + 1, 0, months || 1) : 0;
      return `${nav(d.id ? 'Editar fraccionado' : 'Gasto fraccionado', 'Cancelar', 'Guardar', 'saveInst')}
        <div class="form">
          <div class="field"><label>Nombre</label><input data-bind="name" placeholder="iPhone, sofá, préstamo…" value="${U.esc(d.name || '')}"></div>
          <div class="field"><label>Importe total</label><input data-bind="total" data-rerender="1" inputmode="decimal" placeholder="0,00 €" value="${U.esc(d.total ?? '')}"></div>
          <div class="field"><label>Nº de meses</label><input data-bind="months" data-rerender="1" inputmode="numeric" placeholder="12" value="${U.esc(d.months ?? '')}"></div>
          <div class="field"><label>Cuota mensual</label><input data-bind="monthly" inputmode="decimal" placeholder="${auto ? U.eur2(auto) : 'auto'}" value="${U.esc(d.monthly ?? '')}"></div>
          <div class="field"><label>Primer pago</label><input type="date" data-bind="start" data-rerender="1" value="${d.start}"></div>
          <div class="field"><label>Categoría</label><select data-bind="cat">${catOptions('expense', d.cat)}</select></div>
          ${!d.id && pastPayments > 0 ? `<div class="field"><label style="flex:1;font-size:15px">Apuntar las ${pastPayments} cuota(s) ya pagadas</label><label class="switch"><input type="checkbox" data-bind="backfill" ${d.backfill ? 'checked' : ''}><span></span></label></div>` : ''}
        </div>
        <div id="sheet-hint">${SHEETS.inst.hint(d)}</div>
        ${d.id ? '<div class="btn-row" style="margin-top:24px"><button class="btn danger" data-act="deleteInst">Eliminar fraccionado</button></div>' : ''}`;
    }
  },

  /* ----- Meta de ahorro ----- */
  goal: {
    hint(d) {
      const target = U.parseAmount(d.target) || 0;
      const months = d.deadline ? Math.max(1, U.monthsBetween(U.ym(), d.deadline.slice(0, 7))) : 0;
      const already = U.parseAmount(d.saved) || 0;
      return target && months ? `<p class="footnote">Para llegar necesitas apartar <b>${U.eur2(Math.max(0, target - (d.id ? d.savedNow : already)) / months)}</b> al mes.</p>` : '';
    },
    render(d) {
      const target = U.parseAmount(d.target) || 0;
      const months = d.deadline ? Math.max(1, U.monthsBetween(U.ym(), d.deadline.slice(0, 7))) : 0;
      const already = U.parseAmount(d.saved) || 0;
      return `${nav(d.id ? 'Editar meta' : 'Nueva meta', 'Cancelar', 'Guardar', 'saveGoal')}
        <div style="text-align:center;font-size:52px;margin:6px 0">${d.emoji}</div>
        <div class="form">
          <div class="field"><label>Nombre</label><input data-bind="name" placeholder="Viaje, colchón, coche…" value="${U.esc(d.name || '')}"></div>
          <div class="field"><label>Objetivo</label><input data-bind="target" data-rerender="1" inputmode="decimal" placeholder="0 €" value="${U.esc(d.target ?? '')}"></div>
          ${!d.id ? `<div class="field"><label>Ya tengo</label><input data-bind="saved" data-rerender="1" inputmode="decimal" placeholder="0 €" value="${U.esc(d.saved ?? '')}"></div>` : ''}
          <div class="field"><label>Fecha límite</label><input type="date" data-bind="deadline" data-rerender="1" value="${d.deadline || ''}"></div>
        </div>
        <div id="sheet-hint">${SHEETS.goal.hint(d)}</div>
        <div class="group-label">Icono</div>
        <div class="card" style="padding:0"><div class="emoji-grid">${['✈️', '🏖️', '🚗', '🏠', '💍', '🎓', '💻', '📱', '🛟', '🎁', '🐷', '🏍️', '🎸', '👶', '🐶', '💎'].map((e) => `<button class="${e === d.emoji ? 'on' : ''}" data-act="goalEmoji" data-e="${e}">${e}</button>`).join('')}</div></div>
        ${d.id ? '<div class="btn-row" style="margin-top:24px"><button class="btn danger" data-act="deleteGoal">Eliminar meta</button></div>' : ''}`;
    }
  },

  /* ----- Aportar / retirar ----- */
  move: {
    render(d) {
      const g = S.goals.find((x) => x.id === d.goalId);
      return `${nav(d.sign > 0 ? 'Aportar' : 'Retirar', 'Cancelar', 'Hecho', 'saveMove')}
        <div style="text-align:center;margin-top:6px;color:var(--label2)">${g.emoji} ${U.esc(g.name)} · ${U.eur(g.saved)} de ${U.eur(g.target)}</div>
        <div class="amount-box ${d.sign > 0 ? 'income' : 'expense'}"><div class="amount-input"><input id="move-amount" data-bind="amount" inputmode="decimal" placeholder="0" value="${U.esc(d.amount ?? '')}"><span>€</span></div></div>
        <div class="chips" style="justify-content:center">${[10, 25, 50, 100, 200].map((v) => `<button class="chip" data-act="moveQuick" data-v="${v}">${v} €</button>`).join('')}</div>
        <p class="footnote" style="text-align:center">${d.sign > 0 ? 'Lo que apartas se descuenta de tu «Disponible» del mes.' : 'Lo que retiras vuelve a tu «Disponible» del mes.'}</p>`;
    },
    after() { setTimeout(() => $('#move-amount')?.focus(), 350); }
  },

  /* ----- Ajustes ----- */
  settings: {
    render() {
      const st = S.settings;
      return `${nav('Ajustes', '', 'OK', 'closeSheet', 'noop')}
        <div style="text-align:center;margin:8px 0 4px"><img src="icon-180.png" style="width:72px;height:72px;border-radius:17px" alt=""><div style="font-weight:700;font-size:20px;margin-top:6px">Cartera</div><div style="color:var(--label2);font-size:13px">Versión ${APP_VERSION} · tus datos se guardan solos en este iPhone</div></div>
        <div class="group-label">Perfil</div>
        <div class="form"><div class="field"><label>Tu nombre</label><input id="set-name" placeholder="Opcional" value="${U.esc(st.name)}"></div></div>
        <div class="group-label">Apariencia</div>
        <div class="seg" style="margin-bottom:0">${[['auto', 'Automático'], ['light', '☀️ Claro'], ['dark', '🌙 Oscuro']].map(([v, l]) => `<button class="${(st.theme || 'auto') === v ? 'on' : ''}" data-act="setTheme" data-id="${v}">${l}</button>`).join('')}</div>
        <p class="footnote">«Automático» sigue el modo claro u oscuro de tu iPhone.</p>
        <div class="group-label">Organización</div>
        <div class="list">
          <button class="row" data-act="openCats"><div class="row-ico" style="background:var(--accent-soft)">🏷️</div><div class="row-main"><div class="row-title">Categorías y presupuestos</div></div>${CHEV}</button>
          <button class="row" data-act="goSchedFromSettings"><div class="row-ico" style="background:var(--blue-soft)">🗓️</div><div class="row-main"><div class="row-title">Gastos e ingresos fijos</div></div>${CHEV}</button>
        </div>
        <div class="group-label">Seguridad</div>
        <div class="list"><div class="row"><div class="row-ico" style="background:var(--fill)">🔒</div><div class="row-main"><div class="row-title">Código de acceso</div><div class="row-sub">${st.pin ? 'Activado' : 'Pide un PIN al abrir la app'}</div></div><label class="switch"><input type="checkbox" id="set-pin" ${st.pin ? 'checked' : ''}><span></span></label></div></div>
        <div class="group-label">Copia de seguridad</div>
        <div class="list">
          <button class="row" data-act="backup"><div class="row-ico" style="background:var(--accent-soft)">💾</div><div class="row-main"><div class="row-title">Exportar copia</div><div class="row-sub">${st.lastBackup ? 'Última: ' + U.shortDate(st.lastBackup) + ' ' + st.lastBackup.slice(0, 4) : 'Nunca'} · incluye lo aprendido por Nova</div></div>${CHEV}</button>
          <button class="row" data-act="restore"><div class="row-ico" style="background:var(--blue-soft)">📥</div><div class="row-main"><div class="row-title">Restaurar copia</div><div class="row-sub">Desde un archivo .json</div></div>${CHEV}</button>
        </div>
        <p class="footnote">Cartera guarda todo automáticamente en tu iPhone. La copia sirve para pasar tus datos a otro móvil; guárdala en Archivos o iCloud Drive.</p>
        <div class="group-label">Zona peligrosa</div>
        <div class="list"><button class="row" data-act="wipe"><div class="row-ico" style="background:var(--red-soft)">🗑️</div><div class="row-main"><div class="row-title" style="color:var(--red)">Borrar todos los datos</div></div></button></div>
        <p class="footnote" style="text-align:center;margin:24px 0">Hecho con ✨ para ti. Nada de lo que apuntas sale de este dispositivo.</p>`;
    },
    after() {
      const n = $('#set-name'); n.oninput = () => { S.settings.name = n.value.trim(); save(); };
      $('#set-pin').onchange = async (e) => {
        if (e.target.checked) { e.target.checked = false; Sheet.open('pin', { step: 1, a: '' }); }
        else { const ok = await confirmDel('¿Quitar el código?', 'Cartera se abrirá sin pedir PIN.', 'Quitar'); if (ok) { S.settings.pin = ''; save(); toast('Código desactivado'); } Sheet.render(); }
      };
    }
  },

  /* ----- Crear PIN ----- */
  pin: {
    render(d) {
      return `${nav('Código', 'Cancelar', '', '', 'openSettings')}
        <div style="text-align:center;margin-top:20px;font-size:18px;font-weight:600">${d.step === 1 ? 'Elige un código de 4 cifras' : 'Repite el código'}</div>
        <div style="display:flex;justify-content:center;margin-top:18px"><input id="pin-in" inputmode="numeric" maxlength="4" autocomplete="off" style="font-size:34px;letter-spacing:20px;text-align:center;width:200px;border:0;border-bottom:2px solid var(--sep);background:none;outline:0;-webkit-text-security:disc"></div>
        <p class="footnote" style="text-align:center;margin-top:16px">Si lo olvidas, solo podrás entrar borrando los datos. Haz una copia antes.</p>`;
    },
    after(d) {
      const i = $('#pin-in'); setTimeout(() => i.focus(), 300);
      i.oninput = async () => {
        i.value = i.value.replace(/\D/g, '').slice(0, 4);
        if (i.value.length < 4) return;
        if (d.step === 1) { d.a = i.value; d.step = 2; Sheet.render(); return; }
        if (i.value !== d.a) { toast('No coinciden. Prueba otra vez'); d.step = 1; d.a = ''; Sheet.render(); return; }
        S.settings.pin = await sha(i.value); save(); toast('🔒 Código activado'); Sheet.open('settings');
      };
    }
  },

  /* ----- Categorías ----- */
  cats: {
    render() {
      const row = (c) => `<button class="row" data-act="editCat" data-id="${c.id}"><div class="row-ico" style="background:${hexA(c.color, .16)}">${c.emoji}</div><div class="row-main"><div class="row-title">${U.esc(c.name)}</div>${c.type === 'expense' ? `<div class="row-sub">${c.budget ? 'Límite ' + U.eur(c.budget) + '/mes' : 'Sin límite'}</div>` : ''}</div>${CHEV}</button>`;
      return `${nav('Categorías', '‹ Ajustes', 'Nueva', 'newCat', 'openSettings')}
        <p class="footnote" style="margin-top:4px">Pon un límite mensual y Nova te avisará al llegar al 80 % y al 100 %.</p>
        <div class="group-label">Gastos</div><div class="list">${S.cats.filter((c) => c.type === 'expense').map(row).join('')}</div>
        <div class="group-label">Ingresos</div><div class="list">${S.cats.filter((c) => c.type === 'income').map(row).join('')}</div><div style="height:20px"></div>`;
    }
  },
  cat: {
    render(d) {
      const used = d.id ? S.tx.filter((t) => t.cat === d.id).length : 0;
      return `${nav(d.id ? 'Editar categoría' : 'Nueva categoría', 'Cancelar', 'Guardar', 'saveCat', d.back || 'openCats')}
        <div style="text-align:center;margin:6px 0 4px"><span style="display:inline-grid;place-items:center;width:72px;height:72px;border-radius:20px;font-size:38px;background:${hexA(d.color, .18)}">${d.emoji}</span></div>
        ${!d.id ? `<div class="seg" style="margin-top:12px"><button class="${d.type === 'expense' ? 'on' : ''}" data-act="catType" data-id="expense">Gasto</button><button class="${d.type === 'income' ? 'on' : ''}" data-act="catType" data-id="income">Ingreso</button></div>` : ''}
        <div class="form" style="margin-top:12px">
          <div class="field"><label>Nombre</label><input data-bind="name" placeholder="Mascota, gimnasio…" value="${U.esc(d.name || '')}"></div>
          ${d.type === 'expense' ? `<div class="field"><label>Límite al mes</label><input data-bind="budget" inputmode="decimal" placeholder="Sin límite" value="${U.esc(d.budget || '')}"></div>` : ''}
        </div>
        <div class="group-label">Icono</div><div class="card" style="padding:0"><div class="emoji-grid">${EMOJIS.map((e) => `<button class="${e === d.emoji ? 'on' : ''}" data-act="catEmoji" data-e="${e}">${e}</button>`).join('')}</div></div>
        <div class="group-label">Color</div><div class="card" style="padding:0"><div class="color-row">${COLORS.map((c) => `<button class="${c === d.color ? 'on' : ''}" style="background:${c}" data-act="catColor" data-c="${c}" aria-label="color"></button>`).join('')}</div></div>
        ${d.id && !['otros', 'otros_ing'].includes(d.id) ? `<div class="btn-row" style="margin-top:24px"><button class="btn danger" data-act="deleteCat">Eliminar categoría</button></div><p class="footnote">${used ? `Sus ${used} movimientos pasarán a «Otros».` : ''}</p>` : ''}`;
    }
  },

  /* ----- Bienvenida ----- */
  welcome: {
    render(d) {
      return `<div style="text-align:center;padding:18px 4px 6px"><img src="icon-180.png" style="width:88px;height:88px;border-radius:21px;box-shadow:0 10px 30px rgba(4,120,87,.3)" alt="">
        <div style="font-size:28px;font-weight:700;margin-top:14px">Bienvenido a Cartera</div>
        <div style="color:var(--label2);margin-top:6px;font-size:15px">Controla tus gastos y ahorros con <b class="nova-badge" style="font-size:15px">✦ Nova</b>, tu asistente que aprende de ti. Todo se queda en tu iPhone.</div></div>
        <div class="group-label">Para empezar (opcional)</div>
        <div class="form">
          <div class="field"><label>Tu nombre</label><input data-bind="name" placeholder="¿Cómo te llamas?" value="${U.esc(d.name || '')}"></div>
          <div class="field"><label>Nómina al mes</label><input data-bind="salary" inputmode="decimal" placeholder="0 €" value="${U.esc(d.salary || '')}"></div>
          <div class="field"><label>Día de cobro</label><select data-bind="payday">${[...Array(31)].map((_, i) => `<option value="${i + 1}" ${i + 1 === (+d.payday || 1) ? 'selected' : ''}>Día ${i + 1}</option>`).join('')}</select></div>
        </div>
        <p class="footnote">Con tu nómina, Nova puede prever cómo cierras el mes y decirte si un gasto es buena idea. Se apuntará sola cada mes.</p>
        <div class="btn-row" style="margin-top:20px"><button class="btn" data-act="finishWelcome">Empezar</button></div><div style="height:10px"></div>`;
    }
  }
};

/* ================================================================
   ACCIONES
   ================================================================ */
const A = {
  noop() {},
  closeSheet() { Sheet.close(); },
  tab(el) { UI.tab = el.dataset.tab; if (UI.tab === 'home') UI.homeYm = U.ym(); render(); $('#screen-' + UI.tab).scrollTop = 0; },
  homePrev() { UI.homeYm = U.addMonths(UI.homeYm, -1); renderHome(); },
  homeNext() { if (UI.homeYm < U.ym()) { UI.homeYm = U.addMonths(UI.homeYm, 1); renderHome(); } },
  hideInstall() { S.settings.installHidden = true; commit(); },
  goMovs() { UI.tab = 'movs'; UI.movSeg = 'hist'; UI.movCat = 'all'; render(); },
  goSched() { Sheet.close(); UI.tab = 'movs'; UI.movSeg = 'fixed'; render(); },
  goSchedFromSettings() { A.goSched(); },
  goNovaTips() { UI.tab = 'nova'; UI.novaSeg = 'tips'; render(); },
  movSeg(el) { UI.movSeg = el.dataset.id; renderMovs(); },
  movCat(el) { UI.movCat = el.dataset.id; renderMovs(); },
  novaSeg(el) { UI.novaSeg = el.dataset.id; renderNova(); },
  saveSeg(el) { UI.saveSeg = el.dataset.id; renderSave(); },

  /* Movimientos */
  addTx(type = 'expense', extra = {}) { Sheet.open('tx', { type, amount: '', desc: '', date: U.today(), note: '', cat: '', ...extra }); },
  editTx(el) { A.editTxId(el.dataset.id); },
  editTxId(id) {
    const t = S.tx.find((x) => x.id === id); if (!t) return toast('Ese movimiento ya no existe');
    Sheet.open('tx', { id: t.id, type: t.type, amount: String(t.amount).replace('.', ','), desc: t.desc, date: t.date, note: t.note || '', cat: t.cat, origCat: t.cat, hasPhoto: t.photo });
  },
  txType(el) { const d = Sheet.cur.d; d.type = el.dataset.id; d.cat = ''; Sheet.render(); },
  txCat(el) { const d = Sheet.cur.d; d.cat = el.dataset.id; $('#tx-cats').innerHTML = SHEETS.tx.cats(d, d.cat); },
  async saveTx() {
    const d = Sheet.cur.d;
    const amount = U.r2(U.parseAmount(d.amount));
    if (!(amount > 0)) { toast('Escribe un importe'); $('#tx-amount')?.focus(); return; }
    const sug = d.desc ? Nova.classify(S, d.desc, amount, d.type) : null;
    const chosen = d.cat || sug?.cat || (d.type === 'income' ? 'extra' : 'otros');
    const desc = (d.desc || '').trim();
    if (d.id) {
      const t = S.tx.find((x) => x.id === d.id);
      Object.assign(t, { amount, desc, date: d.date, note: d.note, cat: chosen });
      if (desc && chosen !== d.origCat) Nova.learn(S, desc, chosen, true, d.origCat);
      toast('Guardado');
    } else {
      const t = { id: U.uid(), type: d.type, amount, desc, cat: chosen, date: d.date || U.today(), note: d.note || '' };
      if (desc) { const corrected = sug && d.cat && d.cat !== sug.cat; Nova.learn(S, desc, chosen, corrected, corrected ? sug.cat : null); }
      if (d.photoData) { await Photos.put(t.id, d.photoData); t.photo = true; }
      if (d.repeat) {
        const f = { id: U.uid(), name: desc || cat(chosen).name, amount, type: d.type, cat: chosen, day: U.dayOf(t.date), genFrom: t.date, active: true, skip: [] };
        S.fixed.push(f); t.fixedId = f.id;
      }
      S.tx.push(t);
      const c = cat(chosen);
      toast(`${c.emoji} ${d.type === 'income' ? '+' : '−'}${U.eur2(amount)} en ${c.name}`);
    }
    Sheet.close(); commit();
  },
  async deleteTx() {
    const d = Sheet.cur.d;
    if (!(await confirmDel('¿Eliminar movimiento?', 'Esta acción no se puede deshacer.'))) return;
    removeTx(d.id); Sheet.close(); commit(); toast('Eliminado');
  },
  undoTx(id) { if (!S.tx.some((t) => t.id === id)) return toast('Ya estaba eliminado'); removeTx(id); commit(); toast('Deshecho'); },
  pickAmount(el) { const d = Sheet.cur.d; d.amount = String(el.dataset.v).replace('.', ','); Sheet.render(); },
  txToInst() { const d = Sheet.cur.d; A.newInst({ name: d.desc, total: d.amount, cat: d.cat || d.suggest?.cat || 'compras' }); },

  /* Tickets */
  scanTicket() { $('#ticket-input').click(); },
  pickTicket() { $('#ticket-input-lib').click(); },
  cancelScan() { scanCancelled = true; Sheet.open('tx', scanDraft || { type: 'expense', amount: '', desc: '', date: U.today(), cat: '' }); },

  /* Fijos */
  newFixed(el, pre = {}) {
    const type = el?.dataset?.type || pre.type || 'expense';
    Sheet.open('fixed', { type, name: '', amount: '', day: U.dayOf(U.today()), cat: type === 'income' ? 'nomina' : 'casa', thisMonth: false, ...pre });
  },
  newFixedIncome() { A.newFixed(null, { type: 'income', name: 'Nómina', cat: 'nomina', day: 1 }); },
  editFixed(el) { const f = S.fixed.find((x) => x.id === el.dataset.id); Sheet.open('fixed', { ...f, amount: String(f.amount).replace('.', ',') }); },
  fixType(el) { const d = Sheet.cur.d; d.type = el.dataset.id; d.cat = d.type === 'income' ? 'nomina' : 'casa'; Sheet.render(); },
  saveFixed() {
    const d = Sheet.cur.d;
    const amount = U.r2(U.parseAmount(d.amount));
    if (!d.name?.trim()) return toast('Ponle un nombre');
    if (!(amount > 0)) return toast('Escribe un importe');
    const day = Number(d.day) || 1;
    if (d.id) {
      const f = S.fixed.find((x) => x.id === d.id);
      Object.assign(f, { name: d.name.trim(), amount, type: d.type, cat: d.cat, day, active: !!d.active });
    } else {
      const todayDay = U.dayOf(U.today());
      const genFrom = day < todayDay && d.thisMonth ? U.dateIn(U.ym(), 1) : U.today();
      S.fixed.push({ id: U.uid(), name: d.name.trim(), amount, type: d.type, cat: d.cat, day, genFrom, active: true, skip: [] });
      if (d.fromTx) { const t = S.tx.find((x) => x.id === d.fromTx); if (t) { /* el gasto detectado pasa a formar parte del fijo */ } }
    }
    const n = processRecurring();
    Sheet.close(); commit(); toast(n ? `Guardado · ${n} apuntado(s)` : 'Gasto fijo guardado');
  },
  async deleteFixed() {
    const d = Sheet.cur.d;
    if (!(await confirmDel('¿Eliminar este fijo?', 'Los movimientos ya apuntados se mantienen en tu historial.'))) return;
    S.fixed = S.fixed.filter((f) => f.id !== d.id);
    S.tx.forEach((t) => { if (t.fixedId === d.id) delete t.fixedId; });
    Sheet.close(); commit();
  },
  makeFixed(id) {
    const t = S.tx.find((x) => x.id === id); if (!t) return;
    A.newFixed(null, { type: t.type, name: t.desc, amount: String(t.amount).replace('.', ','), cat: t.cat, day: U.dayOf(t.date) });
  },

  /* Fraccionados */
  newInst(pre = {}) {
    if (pre instanceof HTMLElement) pre = {};
    Sheet.open('inst', { name: '', total: '', months: '', monthly: '', start: U.today(), cat: 'compras', backfill: false, ...pre });
  },
  editInst(el) { const p = S.inst.find((x) => x.id === el.dataset.id); Sheet.open('inst', { ...p, total: String(p.total).replace('.', ','), monthly: String(p.monthly).replace('.', ',') }); },
  saveInst() {
    const d = Sheet.cur.d;
    const total = U.r2(U.parseAmount(d.total)); const months = parseInt(d.months, 10);
    if (!d.name?.trim()) return toast('Ponle un nombre');
    if (!(total > 0)) return toast('Escribe el importe total');
    if (!(months >= 1 && months <= 120)) return toast('Número de meses entre 1 y 120');
    const monthly = U.r2(U.parseAmount(d.monthly) || total / months);
    if (d.id) {
      const p = S.inst.find((x) => x.id === d.id);
      Object.assign(p, { name: d.name.trim(), total, months, monthly, start: d.start, cat: d.cat });
    } else {
      S.inst.push({ id: U.uid(), name: d.name.trim(), total, months, monthly, start: d.start, cat: d.cat, genFrom: d.backfill ? d.start : U.today(), skip: [] });
    }
    const n = processRecurring();
    Sheet.close(); UI.tab = 'movs'; UI.movSeg = 'inst'; commit(); toast(n ? `Guardado · ${n} cuota(s) apuntada(s)` : 'Fraccionado guardado');
  },
  async deleteInst() {
    const d = Sheet.cur.d;
    if (!(await confirmDel('¿Eliminar fraccionado?', 'Las cuotas ya apuntadas se mantienen en tu historial.'))) return;
    S.inst = S.inst.filter((p) => p.id !== d.id);
    S.tx.forEach((t) => { if (t.instId === d.id) delete t.instId; });
    Sheet.close(); commit();
  },

  /* Ahorro */
  newGoal(pre = {}) { if (pre instanceof HTMLElement) pre = {}; Sheet.open('goal', { name: '', target: '', saved: '', deadline: '', emoji: '🐷', ...pre }); },
  goalFor(a) { A.newGoal({ name: a.name, target: String(Math.ceil(a.amount)), deadline: a.deadline, emoji: '🎁' }); },
  editGoal(el) { const g = S.goals.find((x) => x.id === el.dataset.id); Sheet.open('goal', { ...g, target: String(g.target), savedNow: g.saved }); },
  goalEmoji(el) { Sheet.cur.d.emoji = el.dataset.e; Sheet.render(); },
  saveGoal() {
    const d = Sheet.cur.d;
    const target = U.r2(U.parseAmount(d.target));
    if (!d.name?.trim()) return toast('Ponle un nombre');
    if (!(target > 0)) return toast('Escribe el objetivo');
    if (d.id) Object.assign(S.goals.find((g) => g.id === d.id), { name: d.name.trim(), target, deadline: d.deadline, emoji: d.emoji });
    else {
      const saved = U.r2(U.parseAmount(d.saved) || 0);
      // lo que ya tenías ahorrado no cuenta como apartado este mes
      S.goals.push({ id: U.uid(), name: d.name.trim(), target, saved, deadline: d.deadline, emoji: d.emoji, moves: [], initial: saved });
    }
    Sheet.close(); UI.tab = 'save'; commit(); toast('Meta guardada');
  },
  async deleteGoal() {
    if (!(await confirmDel('¿Eliminar meta?', 'Se borrará su historial de aportaciones.'))) return;
    S.goals = S.goals.filter((g) => g.id !== Sheet.cur.d.id); Sheet.close(); commit();
  },
  contribute(el, amount) { const id = el?.dataset?.id || el; Sheet.open('move', { goalId: id, sign: 1, amount: amount ? String(amount) : '' }); },
  withdraw(el) { Sheet.open('move', { goalId: el.dataset.id, sign: -1, amount: '' }); },
  moveQuick(el) { Sheet.cur.d.amount = el.dataset.v; $('#move-amount').value = el.dataset.v; },
  saveMove() {
    const d = Sheet.cur.d; const g = S.goals.find((x) => x.id === d.goalId);
    let v = U.r2(U.parseAmount(d.amount));
    if (!(v > 0)) return toast('Escribe un importe');
    if (d.sign < 0) v = -Math.min(v, g.saved);
    g.saved = U.r2(g.saved + v); g.moves = g.moves || []; g.moves.push({ date: U.today(), amount: v });
    Sheet.close(); commit();
    toast(g.saved >= g.target && v > 0 ? `🏆 ¡Meta «${g.name}» conseguida!` : v > 0 ? `🐷 +${U.eur2(v)} a ${g.name}` : `${U.eur2(-v)} retirados`);
  },

  /* Nova */
  send() { const i = $('#chat-input'); const v = i.value; i.value = ''; i.style.height = ''; sendChat(v); },
  quick(el) { sendChat(el.dataset.q); },
  chatAction(el) { const a = S.chat[+el.dataset.i]?.actions?.[+el.dataset.j]; if (a) runAction(a); },
  insightAction(el) { const i = Nova.insights(S).find((x) => x.id === el.dataset.id); if (i?.action) runAction(i.action); },
  fb(el) {
    const L = S.learn; const k = el.dataset.key;
    L.feedback[k] = L.feedback[k] || { up: 0, down: 0 };
    L.feedback[k][el.dataset.v]++;
    if (el.dataset.v === 'down') { L.dismissed[el.dataset.id] = U.today(); toast('Entendido, te mostraré menos avisos así'); }
    else toast('👍 ¡Gracias! Tendré en cuenta que te sirve');
    commit();
  },
  forgetMerchant(el) { delete S.learn.merchants[el.dataset.k]; commit(); toast('Olvidado'); },
  async resetLearn() {
    if (!(await confirmDel('¿Olvidar lo aprendido?', 'Nova volverá a empezar a conocerte. Tus movimientos no se borran.', 'Olvidar'))) return;
    S.learn = { ...freshState().learn }; commit();
  },

  /* Ajustes */
  openSettings() { Sheet.open('settings'); },
  setTheme(el) { S.settings.theme = el.dataset.id; applyTheme(); save(); Sheet.render(); },
  openCats() { Sheet.open('cats'); },
  goCats() { Sheet.open('cats'); },
  newCat() { Sheet.open('cat', { name: '', emoji: '🐶', color: '#5AC8FA', type: 'expense', budget: '' }); },
  newCatFromTx() { const d = Sheet.cur.d; scanDraft = d; Sheet.open('cat', { name: '', emoji: '🐶', color: '#5AC8FA', type: d.type, budget: '', back: 'backToTx' }); },
  backToTx() { Sheet.open('tx', scanDraft); },
  editCat(el) { const c = cat(el.dataset.id); Sheet.open('cat', { ...c, budget: c.budget ? String(c.budget) : '' }); },
  catEmoji(el) { Sheet.cur.d.emoji = el.dataset.e; Sheet.render(); },
  catColor(el) { Sheet.cur.d.color = el.dataset.c; Sheet.render(); },
  catType(el) { Sheet.cur.d.type = el.dataset.id; Sheet.render(); },
  saveCat() {
    const d = Sheet.cur.d;
    if (!d.name?.trim()) return toast('Ponle un nombre');
    const budget = d.type === 'expense' ? U.r2(U.parseAmount(d.budget) || 0) : undefined;
    let id = d.id;
    if (d.id) Object.assign(S.cats.find((c) => c.id === d.id), { name: d.name.trim(), emoji: d.emoji, color: d.color, budget });
    else { id = 'c_' + U.uid(); S.cats.push({ id, name: d.name.trim(), emoji: d.emoji, color: d.color, type: d.type, budget, custom: true }); }
    save(); render();
    if (d.back === 'backToTx') { scanDraft.cat = id; Sheet.open('tx', scanDraft); } else Sheet.open('cats');
    toast('Categoría guardada');
  },
  async deleteCat() {
    const d = Sheet.cur.d;
    if (!(await confirmDel(`¿Eliminar «${d.name}»?`, 'Sus movimientos pasarán a «Otros».'))) return;
    const to = d.type === 'income' ? 'otros_ing' : 'otros';
    S.tx.forEach((t) => { if (t.cat === d.id) t.cat = to; });
    S.fixed.forEach((t) => { if (t.cat === d.id) t.cat = to; });
    S.inst.forEach((t) => { if (t.cat === d.id) t.cat = to; });
    S.cats = S.cats.filter((c) => c.id !== d.id);
    save(); render(); Sheet.open('cats');
  },
  setBudget(id, amount) { const c = cat(id); c.budget = amount; commit(); toast(`${c.emoji} Límite de ${U.eur(amount)} en ${c.name}`); },
  backup() { exportBackup(); },
  restore() { $('#import-input').click(); },
  async wipe() {
    if (!(await confirmDel('¿Borrar todo?', 'Se eliminarán todos tus movimientos, metas y lo aprendido por Nova. Haz una copia antes si la quieres conservar.', 'Borrar todo'))) return;
    if (!(await confirmDel('¿Seguro del todo?', 'No se puede deshacer.', 'Sí, borrar'))) return;
    S = freshState(); S.settings.onboarded = true; applyTheme(); await Photos.clear(); saveNow(); Sheet.close(); UI.tab = 'home'; render(); toast('Datos borrados');
  },
  finishWelcome() {
    const d = Sheet.cur.d;
    S.settings.name = (d.name || '').trim();
    const salary = U.r2(U.parseAmount(d.salary) || 0);
    if (salary > 0) {
      const day = Number(d.payday) || 1;
      S.fixed.push({ id: U.uid(), name: 'Nómina', amount: salary, type: 'income', cat: 'nomina', day, genFrom: U.dateIn(U.ym(), 1), active: true, skip: [] });
      processRecurring();
    }
    S.settings.onboarded = true; Sheet.close(); commit();
    toast('¡Todo listo! 🎉');
  }
};

function runAction(a) {
  switch (a.do) {
    case 'filterCat': Sheet.close(); UI.tab = 'movs'; UI.movSeg = 'hist'; UI.movCat = a.arg; render(); break;
    case 'goSched': A.goSched(); break;
    case 'contribute': A.contribute(a.arg, a.amount); break;
    case 'makeFixed': A.makeFixed(a.arg); break;
    case 'setBudget': A.setBudget(a.arg, a.amount); break;
    case 'backup': exportBackup(); break;
    case 'goCats': A.goCats(); break;
    case 'newGoal': A.newGoal(); break;
    case 'goalFor': A.goalFor(a); break;
    case 'newFixedIncome': A.newFixedIncome(); break;
    case 'editTxId': A.editTxId(a.arg); break;
    case 'undoTx': A.undoTx(a.arg); break;
  }
}

function removeTx(id) {
  const t = S.tx.find((x) => x.id === id); if (!t) return;
  const ym = t.date.slice(0, 7);
  // si era un fijo o una cuota automática, no volver a crearla este mes
  if (t.fixedId) { const f = S.fixed.find((x) => x.id === t.fixedId); if (f) { f.skip = f.skip || []; if (!f.skip.includes(ym)) f.skip.push(ym); } }
  if (t.instId) { const p = S.inst.find((x) => x.id === t.instId); if (p) { p.skip = p.skip || []; if (!p.skip.includes(ym)) p.skip.push(ym); } }
  if (t.photo) Photos.del(id);
  S.tx = S.tx.filter((x) => x.id !== id);
}

/* ================================================================
   ESCÁNER DE TICKETS (OCR en el propio iPhone con Tesseract)
   ================================================================ */
let scanDraft = null, scanCancelled = false;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s); });
}
function readImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = rej;
    img.src = url;
  });
}
function toCanvas(img, max, filter) {
  // reduce las fotos grandes y amplía las pequeñas (hasta 2×) para que el lector vea mejor los números
  const k = Math.min(filter ? 2 : 1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const x = c.getContext('2d');
  if (filter) x.filter = 'grayscale(1) contrast(1.6) brightness(1.08)';
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function handleTicket(file) {
  if (!file) return;
  scanCancelled = false;
  scanDraft = Sheet.cur?.name === 'tx' ? Sheet.cur.d : { type: 'expense', amount: '', desc: '', date: U.today(), note: '', cat: '' };
  let img, url;
  try { ({ img, url } = await readImage(file)); } catch (e) { toast('No se pudo abrir la imagen'); return; }
  const thumb = toCanvas(img, 1000, false).toDataURL('image/jpeg', 0.6);
  const st = { preview: thumb, status: 'Preparando el lector…', p: 0.03 };
  Sheet.open('scanning', st);
  const setP = (status, p) => { if (Sheet.cur?.name !== 'scanning') return; st.status = status; st.p = p; const b = $('#scan-bar'); if (b) { b.style.width = (p * 100) + '%'; $('#sheet-body .scan-progress > div:nth-child(2)').textContent = status; } };
  try {
    if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    if (scanCancelled) return;
    setP('Leyendo el ticket…', 0.1);
    const canvas = toCanvas(img, 1800, true);
    const res = await Tesseract.recognize(canvas, 'spa', {
      logger: (m) => {
        if (m.status === 'recognizing text') setP('Leyendo el ticket… ' + Math.round(m.progress * 100) + ' %', 0.3 + m.progress * 0.68);
        else if (/loading|initializ/.test(m.status)) setP('Cargando el lector…', 0.1 + (m.progress || 0) * 0.2);
      }
    });
    if (scanCancelled) return;
    // altura de cada línea: el total suele ir en negrita y más grande
    const ocrLines = (res.data.lines || []).map((l) => {
      const words = (l.words || []).filter((w) => /\d[.,]\s?\d{2}/.test(w.text));
      const box = (b) => (b ? b.y1 - b.y0 : 0);
      return { text: l.text, h: words.length ? Math.max(...words.map((w) => box(w.bbox))) : box(l.bbox) };
    });
    const p = Nova.parseTicket(res.data.text || '', ocrLines);
    const d = scanDraft;
    d.type = 'expense';
    d.photoData = thumb;
    if (p.total) d.amount = String(p.total).replace('.', ',');
    d.ocrCands = (p.cands || []).filter((v) => v > 0);
    if (p.merchant && !d.desc) d.desc = p.merchant;
    if (p.date) d.date = p.date;
    const found = [p.total && 'importe', p.merchant && 'comercio', p.date && 'fecha'].filter(Boolean);
    d.ocrNote = found.length ? `He leído ${found.join(', ')}. <b>Revisa el total</b>: si no es el bueno, toca el correcto aquí debajo.` : 'No he podido leer bien el ticket. Prueba con más luz y el ticket bien estirado, o escribe el importe a mano.';
    Sheet.open('tx', d);
  } catch (e) {
    console.error(e);
    if (scanCancelled) return;
    const d = scanDraft; d.photoData = thumb;
    d.ocrNote = navigator.onLine ? 'No he podido leer el ticket. Escribe el importe a mano; la foto queda guardada.' : 'La primera vez necesito internet para descargar el lector de tickets. La foto queda guardada; escribe el importe a mano.';
    Sheet.open('tx', d);
  } finally { URL.revokeObjectURL(url); }
}

/* ================================================================
   COPIA DE SEGURIDAD
   ================================================================ */
async function exportBackup() {
  const photos = await Photos.all();
  const data = { app: 'Cartera', version: APP_VERSION, exported: new Date().toISOString(), state: S, photos };
  const name = `cartera-copia-${U.today()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Copia de Cartera' });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    S.settings.lastBackup = U.today(); save(); if (Sheet.cur?.name === 'settings') Sheet.render(); toast('💾 Copia creada');
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo crear la copia'); }
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'Cartera' || !data.state?.tx) throw new Error('formato');
    const ok = await confirmDel('¿Restaurar esta copia?', `Del ${new Date(data.exported).toLocaleDateString('es-ES')}. Sustituirá los datos actuales de este iPhone.`, 'Restaurar');
    if (!ok) return;
    localStorage.setItem(KEY, JSON.stringify(data.state));
    await Photos.clear();
    for (const [k, v] of Object.entries(data.photos || {})) await Photos.put(k, v);
    S = loadState(); S.settings.onboarded = true; applyTheme(); processRecurring(); saveNow(); Sheet.close(); render(); toast('✅ Copia restaurada');
  } catch (e) { iosAlert('Archivo no válido', 'Elige un archivo de copia creado con Cartera (.json).'); }
}

/* ================================================================
   CÓDIGO DE ACCESO
   ================================================================ */
async function sha(s) {
  if (crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cartera:' + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  let h = 0; for (const ch of 'cartera:' + s) h = (h * 31 + ch.charCodeAt(0)) | 0; return 'h' + h;
}
let pinBuf = '';
function showLock() {
  if (!S.settings.pin) return;
  pinBuf = ''; updDots();
  const pad = $('.pin-pad');
  pad.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k ? `<button class="${k === '⌫' ? 'ghost' : ''}" data-k="${k}">${k}</button>` : '<span></span>').join('');
  $('#lock').classList.remove('hidden');
}
function updDots() { $$('.pin-dots span').forEach((s, i) => s.classList.toggle('on', i < pinBuf.length)); }
document.querySelector('.pin-pad').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.dataset.k;
  if (k === '⌫') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 4) pinBuf += k;
  updDots();
  if (pinBuf.length === 4) {
    if (await sha(pinBuf) === S.settings.pin) { $('#lock').classList.add('hidden'); pinBuf = ''; }
    else { const d = $('.pin-dots'); d.classList.add('shake'); setTimeout(() => { d.classList.remove('shake'); pinBuf = ''; updDots(); }, 420); }
  }
});

/* ================================================================
   EVENTOS GLOBALES
   ================================================================ */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return A.tab(tab);
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = A[el.dataset.act];
  if (fn) fn(el);
});
$('#tab-add').addEventListener('click', () => A.addTx('expense'));
$('#sheet-backdrop').addEventListener('click', () => { if (Sheet.cur?.name !== 'welcome' && Sheet.cur?.name !== 'scanning') Sheet.close(); });

// Campos enlazados de los formularios
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'mov-search') { UI.search = el.value; const pos = el.selectionStart; renderMovs(); const n = $('#mov-search'); n.focus(); n.setSelectionRange(pos, pos); return; }
  if (el.id === 'chat-input') { el.style.height = ''; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; return; }
  const k = el.dataset?.bind; if (!k || !Sheet.cur) return;
  Sheet.cur.d[k] = el.type === 'checkbox' ? el.checked : el.value;
});
document.addEventListener('change', (e) => {
  const el = e.target; const k = el.dataset?.bind; if (!k || !Sheet.cur) return;
  Sheet.cur.d[k] = el.type === 'checkbox' ? el.checked : el.value;
  // al salir del campo se recalculan los textos de ayuda (cuota, ahorro mensual…)
  if (!el.dataset.rerender) return;
  const sh = SHEETS[Sheet.cur.name];
  if (el.tagName === 'INPUT' && el.type !== 'date' && sh.hint) { const h = $('#sheet-hint'); if (h) h.innerHTML = sh.hint(Sheet.cur.d); return; }
  const st = $('#sheet-body').scrollTop; Sheet.render(); $('#sheet-body').scrollTop = st;
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); A.send(); }
});
$('#ticket-input').addEventListener('change', (e) => { handleTicket(e.target.files[0]); e.target.value = ''; });
$('#ticket-input-lib').addEventListener('change', (e) => { handleTicket(e.target.files[0]); e.target.value = ''; });
$('#import-input').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); saveNow(); return; }
  if (processRecurring()) render();
  if (S.settings.pin && Date.now() - hiddenAt > 60000) showLock();
  if (UI.homeYm > U.ym()) UI.homeYm = U.ym();
});
window.addEventListener('pagehide', saveNow);

/* ================================================================
   ARRANQUE
   ================================================================ */
(function init() {
  applyTheme();
  processRecurring();
  render();
  showLock();
  if (!S.settings.onboarded) setTimeout(() => Sheet.open('welcome', { name: '', salary: '', payday: 1 }), 300);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
