/* ================================================================
   Nova · el asistente de Cartera
   Todo se calcula en el iPhone: nada sale del dispositivo.
   Aprende de: tus correcciones de categoría, tus 👍/👎 en los avisos,
   y de comparar lo que predijo con lo que gastaste de verdad.
   ================================================================ */

/* ---------- Utilidades compartidas ---------- */
const U = {
  pad: (n) => String(n).padStart(2, '0'),
  today() { const d = new Date(); return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`; },
  ym(date) { return (date || U.today()).slice(0, 7); },
  addMonths(ym, n) {
    let [y, m] = ym.split('-').map(Number);
    m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
    return `${y}-${U.pad(m)}`;
  },
  monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); },
  dim(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); },
  dateIn(ym, day) { return `${ym}-${U.pad(Math.min(day, U.dim(ym)))}`; },
  dayOf(date) { return Number(date.slice(8, 10)); },
  monthName(ym, short) {
    const [y, m] = ym.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: short ? 'short' : 'long' }).replace('.', '');
    return s;
  },
  monthLabel(ym) { const n = U.monthName(ym); return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + ym.slice(0, 4); },
  dateLabel(date) {
    const t = U.today();
    if (date === t) return 'Hoy';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (date === `${y.getFullYear()}-${U.pad(y.getMonth() + 1)}-${U.pad(y.getDate())}`) return 'Ayer';
    const [Y, M, D] = date.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  },
  shortDate(date) { const [Y, M, D] = date.split('-').map(Number); return new Date(Y, M - 1, D).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', ''); },
  daysUntil(date) { const [Y, M, D] = date.split('-').map(Number); const a = new Date(Y, M - 1, D); const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((a - n) / 86400000); },
  eur(n, dec) {
    const v = Number(n) || 0;
    const d = dec === undefined ? (Math.abs(v) >= 1000 || Number.isInteger(v) ? 0 : 2) : dec;
    return v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true }) + ' €';
  },
  eur2(n) { return U.eur(n, 2); },
  r2(n) { return Math.round(n * 100) / 100; },
  norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  },
  STOP: new Set(['del', 'las', 'los', 'una', 'uno', 'con', 'por', 'para', 'que', 'mas', 'muy', 'sin', 'sus', 'este', 'esta', 'pago', 'compra', 'gasto', 'euros', 'eur', 'hoy', 'ayer', 'the', 'and', 'tienda', 'calle', 'sl', 'sa', 'slu']),
  tokens(s) { return U.norm(s).split(' ').filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !U.STOP.has(w)); },
  parseAmount(txt) {
    if (txt === null || txt === undefined) return NaN;
    let s = String(txt).trim().replace(/\s/g, '').replace(/€|eur(os)?/gi, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    const v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  sum(arr, f) { return arr.reduce((a, x) => a + (f ? f(x) : x), 0); },
  mean(arr) { return arr.length ? U.sum(arr) / arr.length : 0; },
  sd(arr) { if (arr.length < 2) return 0; const m = U.mean(arr); return Math.sqrt(U.mean(arr.map((x) => (x - m) ** 2))); },
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
};

/* ---------- Categorías por defecto ---------- */
const DEFAULT_CATS = [
  { id: 'comida', name: 'Comida', emoji: '🛒', color: '#34C759', type: 'expense', budget: 0 },
  { id: 'gasolina', name: 'Gasolina', emoji: '⛽', color: '#FF9500', type: 'expense', budget: 0 },
  { id: 'cenas', name: 'Cenas', emoji: '🍽️', color: '#FF2D55', type: 'expense', budget: 0 },
  { id: 'ocio', name: 'Ocio', emoji: '🎉', color: '#AF52DE', type: 'expense', budget: 0 },
  { id: 'micro', name: 'Microgastos', emoji: '☕', color: '#A2845E', type: 'expense', budget: 0 },
  { id: 'fumar', name: 'Fumar', emoji: '🚬', color: '#8E8E93', type: 'expense', budget: 0 },
  { id: 'casa', name: 'Casa y facturas', emoji: '🏠', color: '#007AFF', type: 'expense', budget: 0 },
  { id: 'suscrip', name: 'Suscripciones', emoji: '📺', color: '#5856D6', type: 'expense', budget: 0 },
  { id: 'transporte', name: 'Transporte', emoji: '🚗', color: '#5AC8FA', type: 'expense', budget: 0 },
  { id: 'compras', name: 'Compras', emoji: '🛍️', color: '#FF6482', type: 'expense', budget: 0 },
  { id: 'salud', name: 'Salud', emoji: '💊', color: '#30B0C7', type: 'expense', budget: 0 },
  { id: 'otros', name: 'Otros', emoji: '📦', color: '#C7A26A', type: 'expense', budget: 0 },
  { id: 'nomina', name: 'Nómina', emoji: '💼', color: '#10B981', type: 'income' },
  { id: 'extra', name: 'Extras', emoji: '💸', color: '#22C55E', type: 'income' },
  { id: 'otros_ing', name: 'Otros ingresos', emoji: '🪙', color: '#84CC16', type: 'income' }
];
const DISCRETIONARY = ['cenas', 'ocio', 'compras', 'micro', 'fumar', 'suscrip'];

/* Palabras con las que Nova arranca sabiendo algo (luego aprende las tuyas) */
const SEED = {
  comida: 'mercadona carrefour lidl aldi dia eroski alcampo consum hipercor supermercado super fruteria carniceria panaderia pescaderia bonarea ahorramas condis spar coviran gadis froiz caprabo mercado hiper charcuteria verduleria alimentacion bonpreu familia masymas',
  gasolina: 'gasolina gasolinera repsol cepsa moeve bp galp shell petronor plenoil ballenoil diesel gasoil combustible repostar carburante avia disa petroprix',
  cenas: 'cena cenas restaurante bar burger burguer mcdonalds mcdonald kfc telepizza dominos pizza pizzeria sushi kebab glovo ubereats justeat tapas cerveceria fosters vips goiko taberna almuerzo brunch comida_fuera asador meson tasca wok ramen tagliatella 100montaditos montaditos',
  ocio: 'cine cines concierto entradas entrada teatro museo bolera discoteca copas copa festival steam playstation psn xbox nintendo juego videojuego hotel airbnb booking escape parque fiesta futbol partido karaoke billar padel ticketmaster',
  micro: 'cafe cafes chicle chuches golosinas refresco cocacola snack maquina vending bolleria donut helado chocolatina loteria',
  fumar: 'tabaco estanco cigarros cigarrillos cigarro marlboro winston camel chesterfield lucky pueblo ducados fortuna vaper vapeo vape iqos heets terea papel papelillos filtros mechero puros puro shisha cachimba nicotina pod pods elfbar',
  casa: 'alquiler hipoteca luz endesa iberdrola naturgy holaluz factura internet fibra movistar vodafone orange digi yoigo lowi pepephone movil telefono comunidad ikea leroy limpieza butano gas agua_factura seguro_hogar',
  suscrip: 'netflix spotify hbo disney prime youtube icloud apple chatgpt claude dazn suscripcion patreon twitch filmin crunchyroll audible kindle',
  transporte: 'metro bus autobus taxi uber cabify bolt renfe tren parking aparcamiento peaje itv taller neumaticos lavado bicing blablacar alsa avion vueling ryanair iberia',
  compras: 'ropa zara primark hm pull bershka stradivarius mango decathlon amazon aliexpress shein temu zapatos zapatillas mediamarkt fnac regalo corteingles corte ingles pccomponentes action tiger',
  salud: 'farmacia medico dentista gimnasio gym fisio fisioterapeuta optica hospital clinica psicologo analisis basicfit',
  nomina: 'nomina sueldo salario paga empresa',
  extra: 'bizum venta wallapop vinted devolucion reembolso freelance propina premio regalo',
  otros_ing: 'intereses cashback'
};
const SEED_MAP = (() => {
  const m = {};
  for (const [cat, words] of Object.entries(SEED)) for (const w of words.split(' ')) for (const p of w.split('_')) if (p.length > 1 && !m[p]) m[p] = cat;
  return m;
})();

/* ================================================================ */
const Nova = {

  /* ---------- Datos agregados ---------- */
  monthTx(S, ym) { return S.tx.filter((t) => t.date.slice(0, 7) === ym); },
  totals(S, ym) {
    const tx = Nova.monthTx(S, ym);
    const inc = U.sum(tx.filter((t) => t.type === 'income'), (t) => t.amount);
    const exp = U.sum(tx.filter((t) => t.type === 'expense'), (t) => t.amount);
    const saved = U.sum(S.goals, (g) => U.sum((g.moves || []).filter((m) => m.date.slice(0, 7) === ym), (m) => m.amount));
    return { inc, exp, saved, net: inc - exp - saved, tx };
  },
  byCat(S, ym, type = 'expense') {
    const out = {};
    for (const t of Nova.monthTx(S, ym)) if (t.type === type) out[t.cat] = (out[t.cat] || 0) + t.amount;
    return out;
  },
  /* Meses anteriores con datos (máx. 6), sin el actual */
  histMonths(S, ym) {
    const set = new Set(S.tx.map((t) => t.date.slice(0, 7)).filter((m) => m < ym));
    return [...set].sort().slice(-6);
  },
  histAvg(S, ym) {
    const months = Nova.histMonths(S, ym);
    const res = { months, n: months.length, cat: {}, exp: 0, inc: 0, varExp: 0 };
    if (!months.length) return res;
    for (const m of months) {
      const tx = Nova.monthTx(S, m);
      for (const t of tx) {
        if (t.type === 'expense') {
          res.exp += t.amount; res.cat[t.cat] = (res.cat[t.cat] || 0) + t.amount;
          if (!t.fixedId && !t.instId) res.varExp += t.amount;
        } else res.inc += t.amount;
      }
    }
    const n = months.length;
    res.exp /= n; res.inc /= n; res.varExp /= n;
    for (const k in res.cat) res.cat[k] /= n;
    return res;
  },

  /* Pagos programados (fijos + cuotas) de un mes: los ya generados y los pendientes */
  scheduled(S, ym) {
    const out = [];
    for (const f of S.fixed) {
      if (!f.active) continue;
      const date = U.dateIn(ym, f.day);
      if (date < (f.genFrom || '')) continue;
      const done = S.tx.some((t) => t.fixedId === f.id && t.date.slice(0, 7) === ym) || (f.skip || []).includes(ym);
      out.push({ kind: 'fixed', ref: f, name: f.name, amount: f.amount, type: f.type, cat: f.cat, date, done });
    }
    for (const p of S.inst) {
      const k = U.monthsBetween(p.start.slice(0, 7), ym);
      if (k < 0 || k >= p.months) continue;
      const date = U.dateIn(ym, U.dayOf(p.start));
      const done = S.tx.some((t) => t.instId === p.id && t.date.slice(0, 7) === ym) || date < (p.genFrom || '') || (p.skip || []).includes(ym);
      out.push({ kind: 'inst', ref: p, name: `${p.name} (${k + 1}/${p.months})`, amount: p.monthly, type: 'expense', cat: p.cat, date, done, n: k + 1 });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },

  /* ---------- Previsión del mes (aprende de sus errores) ---------- */
  forecast(S, ym = U.ym()) {
    const now = U.ym();
    const t = Nova.totals(S, ym);
    const h = Nova.histAvg(S, ym);
    const sched = Nova.scheduled(S, ym);
    const pendingExp = U.sum(sched.filter((s) => !s.done && s.type === 'expense'), (s) => s.amount);
    const pendingInc = U.sum(sched.filter((s) => !s.done && s.type === 'income'), (s) => s.amount);
    const varSpent = U.sum(t.tx.filter((x) => x.type === 'expense' && !x.fixedId && !x.instId), (x) => x.amount);
    if (ym !== now) {
      return { exp: t.exp, inc: t.inc, varSpent, varProj: varSpent, pendingExp: 0, pendingInc: 0, end: t.net, frac: 1, bias: 1, h };
    }
    const dim = U.dim(ym);
    const day = U.dayOf(U.today());
    const frac = day / dim;
    const linear = varSpent / Math.max(frac, 0.08);
    // Al principio de mes pesa más tu media histórica; según avanza, pesa más lo real
    let varProj = h.n ? frac * linear + (1 - frac) * Math.max(h.varExp, varSpent) : linear;
    varProj = Math.max(varProj, varSpent);
    const bias = (S.learn.bias || 1);
    varProj = Math.max(varSpent, varProj * bias);
    const exp = t.exp + pendingExp + (varProj - varSpent);
    let inc = t.inc + pendingInc;
    if (inc === 0 && h.inc > 0) inc = h.inc; // sin ingresos registrados aún: usa tu media
    const end = inc - exp - t.saved;
    return { exp, inc, varSpent, varProj, pendingExp, pendingInc, end, frac, bias, h, day, dim };
  },

  /* Guarda predicciones y calibra el sesgo con los meses cerrados */
  calibrate(S) {
    const L = S.learn; L.preds = L.preds || {};
    const now = U.ym();
    const day = U.dayOf(U.today());
    if (day >= 8 && day <= 20 && !L.preds[now] && Nova.histMonths(S, now).length) {
      const f = Nova.forecast(S, now);
      L.preds[now] = { varProj: U.r2(f.varProj / (f.bias || 1)), day };
    }
    const ratios = [];
    for (const [m, p] of Object.entries(L.preds)) {
      if (m >= now || !p.varProj) continue;
      const actual = U.sum(Nova.monthTx(S, m).filter((x) => x.type === 'expense' && !x.fixedId && !x.instId), (x) => x.amount);
      if (actual > 0) ratios.push(actual / p.varProj);
    }
    const last = ratios.slice(-6);
    if (last.length) {
      L.bias = U.clamp(U.mean(last), 0.75, 1.35);
      L.accuracy = U.clamp(1 - U.mean(last.map((r) => Math.abs(1 - r))), 0, 1);
    }
  },

  /* ---------- Clasificación automática ---------- */
  classify(S, desc, amount, type = 'expense') {
    const cats = S.cats.filter((c) => c.type === type);
    const valid = new Set(cats.map((c) => c.id));
    const toks = U.tokens(desc);
    const full = U.norm(desc);
    const score = {};
    const add = (cat, v) => { if (valid.has(cat)) score[cat] = (score[cat] || 0) + v; };
    const L = S.learn;
    // 1. Comercios que ya conoce (descripción completa)
    const mer = L.merchants[full];
    if (mer) for (const [c, v] of Object.entries(mer)) add(c, v * 5);
    // 2. Palabras aprendidas de ti
    for (const w of toks) { const m = L.words[w]; if (m) for (const [c, v] of Object.entries(m)) add(c, v * 2); }
    // 3. Palabras base
    let seedHit = false;
    for (const w of toks) {
      let c = SEED_MAP[w];
      if (!c && w.length >= 5) { const k = Object.keys(SEED_MAP).find((s) => s.length >= 5 && (w.startsWith(s) || s.startsWith(w))); if (k) c = SEED_MAP[k]; }
      if (c) { add(c, 2); seedHit = true; }
    }
    // 4. Categorías que creaste tú: si el nombre aparece en la descripción
    for (const c of cats) { const n = U.norm(c.name); if (n.length > 2 && full.includes(n)) add(c.id, 3); }

    let best = null, bestV = 0, second = 0;
    for (const [c, v] of Object.entries(score)) { if (v > bestV) { second = bestV; bestV = v; best = c; } else if (v > second) second = v; }
    const learnedStrong = (mer && Object.values(mer).some((v) => v >= 1)) || bestV >= 6;

    // Microgastos: menos de 5 € sin una pista clara (el tabaco sigue siendo Fumar)
    if (type === 'expense' && amount > 0 && amount < 5 && valid.has('micro') && best !== 'fumar' && !learnedStrong) {
      return { cat: 'micro', conf: 'media', why: 'menos de 5 €' };
    }
    if (!best) return { cat: type === 'income' ? (valid.has('extra') ? 'extra' : cats[0]?.id) : (valid.has('otros') ? 'otros' : cats[0]?.id), conf: 'baja', why: 'sin pistas' };
    const conf = bestV >= 5 && bestV >= second * 2 ? 'alta' : bestV >= 2 ? 'media' : 'baja';
    return { cat: best, conf, why: mer ? 'lo has usado antes' : seedHit ? 'por el nombre' : 'aprendido de ti' };
  },

  learn(S, desc, cat, corrected, wrongCat) {
    const L = S.learn;
    const full = U.norm(desc);
    if (!full) return;
    const inc = corrected ? 3 : 1;
    L.merchants[full] = L.merchants[full] || {};
    L.merchants[full][cat] = (L.merchants[full][cat] || 0) + inc;
    for (const w of U.tokens(desc)) {
      L.words[w] = L.words[w] || {};
      L.words[w][cat] = (L.words[w][cat] || 0) + inc;
      if (corrected && wrongCat && L.words[w][wrongCat]) L.words[w][wrongCat] = Math.max(0, L.words[w][wrongCat] - 2);
    }
    if (corrected && wrongCat && L.merchants[full][wrongCat]) L.merchants[full][wrongCat] = 0;
    if (corrected) L.corrections = (L.corrections || 0) + 1; else L.confirms = (L.confirms || 0) + 1;
  },

  /* ---------- Avisos y consejos ---------- */
  insights(S) {
    const out = [];
    const ym = U.ym();
    const cat = (id) => S.cats.find((c) => c.id === id) || { name: id, emoji: '📦' };
    const f = Nova.forecast(S, ym);
    const h = f.h;
    const spent = Nova.byCat(S, ym);
    const daysLeft = f.dim - f.day;
    const push = (o) => out.push(o);

    // 1. Presupuestos
    for (const c of S.cats.filter((c) => c.type === 'expense' && c.budget > 0)) {
      const s = spent[c.id] || 0;
      const pct = s / c.budget;
      if (pct >= 1) push({ id: `bud-over-${c.id}-${ym}`, key: 'budget', tone: 'bad', emoji: c.emoji, prio: 95,
        title: `${c.name}: presupuesto superado`, text: `Llevas ${U.eur(s)} de ${U.eur(c.budget)} (${Math.round(pct * 100)} %). Intenta no sumar más en ${c.name.toLowerCase()} hasta fin de mes.`,
        action: { label: 'Ver gastos', do: 'filterCat', arg: c.id } });
      else if (pct >= 0.8) push({ id: `bud-80-${c.id}-${ym}`, key: 'budget', tone: 'warn', emoji: c.emoji, prio: 80,
        title: `${c.name} al ${Math.round(pct * 100)} %`, text: `Te quedan ${U.eur(c.budget - s)} para ${daysLeft} días (≈ ${U.eur((c.budget - s) / Math.max(daysLeft, 1), 2)}/día).`,
        action: { label: 'Ver gastos', do: 'filterCat', arg: c.id } });
    }

    // 2. Categorías que se disparan respecto a tu media
    if (h.n) {
      const frac = Math.max(f.frac, 0.15);
      for (const [id, s] of Object.entries(spent)) {
        const avg = h.cat[id] || 0;
        const c = cat(id);
        if (c.budget > 0 && s >= c.budget * 0.8) continue;
        const isSched = S.fixed.some((x) => x.cat === id && x.active) && !DISCRETIONARY.includes(id);
        if (isSched) continue;
        const proj = f.frac * (s / frac) + (1 - f.frac) * Math.max(avg, s);
        if (f.day < 5 && !(c.budget > 0)) continue;
        if (avg > 0 && proj > avg * 1.3 && proj - avg > 15 && s > avg * 0.6) {
          push({ id: `trend-${id}-${ym}`, key: 'trend', tone: 'warn', emoji: c.emoji, prio: 75 + Math.min(15, (proj - avg) / 10),
            title: `${c.name} se te está yendo de las manos`, text: `Llevas ${U.eur(s)} y a este ritmo acabarás en ~${U.eur(proj)}, cuando tu media es ${U.eur(avg)}. Son ${U.eur(proj - avg)} de más.`,
            action: { label: 'Ver gastos', do: 'filterCat', arg: id } });
        } else if (avg === 0 && s > 40 && DISCRETIONARY.includes(id)) {
          push({ id: `new-${id}-${ym}`, key: 'trend', tone: 'info', emoji: c.emoji, prio: 45,
            title: `Gasto nuevo en ${c.name}`, text: `Este mes llevas ${U.eur(s)} en ${c.name.toLowerCase()} y en los meses anteriores no gastabas nada aquí.` });
        }
      }
    }

    // 3. Cierre de mes previsto
    if (f.inc <= 0 && f.exp > 0) push({ id: `no-income-${ym}`, key: 'tip', tone: 'nova', emoji: '💼', prio: 65, title: 'Apunta tus ingresos',
      text: 'Sin tu nómina no puedo prever cómo cierras el mes ni aconsejarte antes de una compra. Añádela como ingreso fijo y se apuntará sola.',
      action: { label: 'Añadir nómina', do: 'newFixedIncome' } });
    if (f.inc > 0) {
      if (f.end < 0) push({ id: `end-neg-${ym}`, key: 'forecast', tone: 'bad', emoji: '📉', prio: 92,
        title: 'Vas camino de cerrar en negativo', text: `Con lo que llevas y lo que queda por pagar, acabarías el mes en ${U.eur(f.end)}. Para equilibrar, recorta ~${U.eur(-f.end / Math.max(daysLeft, 1), 2)} al día.` });
      else if (f.inc > 0 && f.day >= 5) {
        const free = f.end;
        const g = S.goals.find((x) => x.saved < x.target);
        push({ id: `end-pos-${ym}`, key: 'forecast', tone: 'good', emoji: '🌱', prio: 50 + Math.min(25, free / 40),
          title: `Previsión: te sobrarán ~${U.eur(free)}`, text: g && free > 20 ? `Si apartas ${U.eur(Math.floor(free * 0.5 / 5) * 5)} ahora para «${g.name}», no lo gastarás sin darte cuenta.` : 'Vas bien este mes. Cada euro que no gastes ahora suma para tus metas.',
          action: g && free > 20 ? { label: `Aportar a ${g.name}`, do: 'contribute', arg: g.id, amount: Math.floor(free * 0.5 / 5) * 5 } : null });
      }
    }

    // 4. Microgastos (todo lo menor de 5 €)
    const micro = Nova.monthTx(S, ym).filter((t) => t.type === 'expense' && t.amount < 5);
    if (micro.length >= 5) {
      const s = U.sum(micro, (t) => t.amount);
      const perMonth = f.day ? s / Math.max(f.frac, 0.15) : s;
      push({ id: `micro-${ym}-${Math.floor(micro.length / 5)}`, key: 'micro', tone: 'info', emoji: '☕', prio: 55,
        title: `${micro.length} microgastos = ${U.eur(s)}`, text: `Los gastos de menos de 5 € no se notan, pero a este ritmo son ~${U.eur(perMonth)} al mes y ${U.eur(perMonth * 12)} al año.` });
    }

    // 5. Fumar
    const smoke = spent.fumar || 0;
    if (smoke > 0) {
      const perMonth = Math.max(smoke / Math.max(f.frac, 0.15), h.cat.fumar || 0);
      push({ id: `smoke-${ym}`, key: 'smoke', tone: 'warn', emoji: '🚬', prio: 52,
        title: `Fumar: ${U.eur(smoke)} este mes`, text: `Al ritmo actual son ~${U.eur(perMonth * 12)} al año. Reduciéndolo a la mitad ahorrarías ${U.eur(perMonth / 2)} cada mes.` });
    }

    // 6. Próximos pagos (7 días)
    const upcoming = [...Nova.scheduled(S, ym), ...Nova.scheduled(S, U.addMonths(ym, 1))]
      .filter((s) => !s.done && s.type === 'expense' && U.daysUntil(s.date) >= 0 && U.daysUntil(s.date) <= 7);
    if (upcoming.length) {
      const tot = U.sum(upcoming, (s) => s.amount);
      push({ id: `upcoming-${U.today()}`, key: 'upcoming', tone: 'info', emoji: '🗓️', prio: 70,
        title: `Próximos 7 días: ${U.eur(tot)} en pagos`, text: upcoming.slice(0, 4).map((s) => `${s.name} · ${U.eur(s.amount)} (${U.daysUntil(s.date) === 0 ? 'hoy' : U.shortDate(s.date)})`).join('\n'),
        action: { label: 'Ver fijos', do: 'goSched' } });
    }

    // 7. Cuotas que terminan pronto
    for (const p of S.inst) {
      const left = p.months - U.monthsBetween(p.start.slice(0, 7), ym) - 1;
      if (left >= 0 && left <= 2 && U.monthsBetween(p.start.slice(0, 7), ym) >= 0) {
        const endYm = U.addMonths(p.start.slice(0, 7), p.months);
        push({ id: `inst-end-${p.id}-${ym}`, key: 'inst', tone: 'good', emoji: '🎯', prio: 48,
          title: left === 0 ? `Última cuota de ${p.name}` : `Quedan ${left + 1} cuotas de ${p.name}`,
          text: `Desde ${U.monthName(endYm)} liberas ${U.eur(p.monthly)} al mes. Buena idea mandarlos directamente al ahorro.` });
      }
    }

    // 8. Metas de ahorro
    for (const g of S.goals) {
      if (g.saved >= g.target) {
        push({ id: `goal-done-${g.id}`, key: 'goal', tone: 'good', emoji: '🏆', prio: 60, title: `¡Meta «${g.name}» conseguida!`, text: `Has llegado a ${U.eur(g.target)}. Puedes crear una meta nueva para seguir con el impulso.` });
        continue;
      }
      if (!g.deadline) continue;
      const months = Math.max(1, U.monthsBetween(ym, g.deadline.slice(0, 7)));
      const need = (g.target - g.saved) / months;
      const recent = [1, 2, 3].map((i) => U.sum((g.moves || []).filter((m) => m.date.slice(0, 7) === U.addMonths(ym, -i)), (m) => m.amount));
      const pace = U.mean(recent);
      if (U.daysUntil(g.deadline) < 0) push({ id: `goal-late-${g.id}`, key: 'goal', tone: 'warn', emoji: g.emoji, prio: 58, title: `«${g.name}» ha pasado su fecha`, text: `Te faltan ${U.eur(g.target - g.saved)}. Puedes ampliar la fecha o ajustar el objetivo.` });
      else if (pace > 0 && pace < need * 0.8) push({ id: `goal-behind-${g.id}-${ym}`, key: 'goal', tone: 'warn', emoji: g.emoji, prio: 62,
        title: `«${g.name}» va algo lenta`, text: `Para llegar a tiempo necesitas ${U.eur(need)}/mes y estás aportando ~${U.eur(pace)}/mes.`, action: { label: 'Aportar', do: 'contribute', arg: g.id, amount: Math.ceil(need) } });
      else if (pace >= need) push({ id: `goal-ok-${g.id}-${ym}`, key: 'goal', tone: 'good', emoji: g.emoji, prio: 35, title: `«${g.name}» va en buen camino`, text: `Al ritmo actual llegarás a tiempo. Te faltan ${U.eur(g.target - g.saved)}.` });
    }

    // 9. Gastos raros (comparado con tu historial en esa categoría)
    const recent = S.tx.filter((t) => t.type === 'expense' && !t.fixedId && !t.instId && U.daysUntil(t.date) >= -7 && U.daysUntil(t.date) <= 0);
    for (const t of recent) {
      const past = S.tx.filter((x) => x.cat === t.cat && x.type === 'expense' && x.id !== t.id && !x.fixedId && !x.instId).map((x) => x.amount);
      if (past.length < 6) continue;
      const m = U.mean(past), sd = U.sd(past);
      if (t.amount > m + 2.2 * sd && t.amount > m * 2 && t.amount > 20) {
        push({ id: `odd-${t.id}`, key: 'odd', tone: 'info', emoji: '🔎', prio: 56,
          title: 'Gasto fuera de lo normal', text: `«${t.desc || cat(t.cat).name}» por ${U.eur(t.amount)}: es ${(t.amount / m).toFixed(1)}× lo que sueles gastar en ${cat(t.cat).name.toLowerCase()} (${U.eur(m)}).` });
        break;
      }
    }

    // 10. Detecta gastos que se repiten cada mes (posibles fijos)
    const groups = {};
    for (const t of S.tx) {
      if (t.type !== 'expense' || t.fixedId || t.instId || !t.desc) continue;
      if (U.monthsBetween(t.date.slice(0, 7), ym) > 4) continue;
      const k = U.norm(t.desc);
      (groups[k] = groups[k] || []).push(t);
    }
    for (const [k, list] of Object.entries(groups)) {
      const months = new Set(list.map((t) => t.date.slice(0, 7)));
      if (months.size < 3) continue;
      const amts = list.map((t) => t.amount); const m = U.mean(amts);
      if (U.sd(amts) > m * 0.15 || list.length > months.size + 1) continue;
      if (S.fixed.some((f) => U.norm(f.name) === k) || (S.learn.notFixed || []).includes(k)) continue;
      const last = list[list.length - 1];
      push({ id: `recurring-${k}`, key: 'recurring', tone: 'nova', emoji: '🔁', prio: 60,
        title: `«${last.desc}» parece un gasto fijo`, text: `Lo pagas cada mes (~${U.eur(m)}). Si lo marco como fijo, lo apuntaré solo y te avisaré antes de cada cobro.`,
        action: { label: 'Convertir en fijo', do: 'makeFixed', arg: last.id } });
      break;
    }

    // 11. Dónde recortar
    if (h.n) {
      const opts = DISCRETIONARY.map((id) => ({ id, v: Math.max(h.cat[id] || 0, (spent[id] || 0) / Math.max(f.frac, 0.3)) })).filter((o) => o.v > 30).sort((a, b) => b.v - a.v);
      if (opts.length) {
        const o = opts[0]; const c = cat(o.id); const save = o.v * 0.2;
        push({ id: `cut-${o.id}-${ym}`, key: 'cut', tone: 'nova', emoji: '✂️', prio: 46,
          title: `Dónde recortar: ${c.name}`, text: `Es tu gasto prescindible más alto (~${U.eur(o.v)}/mes). Bajarlo un 20 % son ${U.eur(save)} al mes y ${U.eur(save * 12)} al año.`,
          action: c.budget ? null : { label: `Fijar límite de ${U.eur(Math.round(o.v * 0.8 / 5) * 5)}`, do: 'setBudget', arg: o.id, amount: Math.round(o.v * 0.8 / 5) * 5 } });
      }
      if (f.day >= 10 && h.varExp > 0 && f.varProj < h.varExp * 0.9) {
        push({ id: `good-${ym}`, key: 'praise', tone: 'good', emoji: '👏', prio: 40, title: 'Este mes gastas menos que de costumbre',
          text: `Tus gastos variables van un ${Math.round((1 - f.varProj / h.varExp) * 100)} % por debajo de tu media. ¡Sigue así!` });
      }
    }

    // 12. Aprendizaje y copias
    if (!h.n && S.tx.length < 15) push({ id: 'learning', key: 'learning', tone: 'nova', emoji: '✨', prio: 30, title: 'Estoy conociéndote',
      text: 'Apunta tus gastos durante unas semanas. Con un mes de datos ya podré compararte con tu media, avisarte de lo que se dispara y prever cómo cierras el mes.' });
    const lastB = S.settings.lastBackup ? -U.daysUntil(S.settings.lastBackup) : 999;
    if (S.tx.length > 30 && lastB > 30) push({ id: `backup-${ym}`, key: 'backup', tone: 'info', emoji: '💾', prio: 25, title: 'Haz una copia de seguridad',
      text: 'Tus datos solo viven en este iPhone. Una copia al mes te protege si cambias de móvil.', action: { label: 'Hacer copia', do: 'backup' } });
    if (!S.cats.some((c) => c.budget > 0) && S.tx.length > 20) push({ id: 'set-budgets', key: 'tip', tone: 'nova', emoji: '🎚️', prio: 34, title: 'Ponle límites a tus categorías',
      text: 'Con un presupuesto por categoría te aviso al 80 % y al 100 %. En Ajustes → Categorías.', action: { label: 'Configurar', do: 'goCats' } });

    // Peso según tus 👍/👎 y avisos descartados
    const fb = S.learn.feedback || {};
    const dis = S.learn.dismissed || {};
    return out
      .filter((i) => !dis[i.id] || U.daysUntil(dis[i.id]) < -3)
      .map((i) => { const w = fb[i.key] || { up: 0, down: 0 }; i.score = i.prio * U.clamp((w.up + 1.5) / (w.down + 1.5), 0.3, 2.5); return i; })
      .sort((a, b) => b.score - a.score);
  },

  /* ================== Chat ================== */
  reply(S, text) {
    const t = U.norm(text);
    const amount = Nova.extractAmount(text);
    const ym = U.ym();
    const cat = (id) => S.cats.find((c) => c.id === id) || { name: id, emoji: '📦' };

    // Apuntar un gasto o ingreso hablando
    if (amount > 0 && /^(anade|apunta|registra|anota|mete|he gastado|me he gastado|gaste|he pagado|pague|gasto de|gastado)\b/.test(t)) {
      const desc = Nova.cleanDesc(text);
      const c = Nova.classify(S, desc, amount, 'expense');
      return { add: { type: 'expense', amount, desc: desc || cat(c.cat).name, cat: c.cat, conf: c.conf },
        html: `Apuntado: <b>${U.esc(desc || cat(c.cat).name)}</b> · ${U.eur2(amount)} en ${cat(c.cat).emoji} <b>${U.esc(cat(c.cat).name)}</b>.` };
    }
    if (amount > 0 && /^(he cobrado|cobre|me han pagado|me han ingresado|ingreso de|ingresa|he ingresado)\b/.test(t)) {
      const desc = Nova.cleanDesc(text);
      const c = Nova.classify(S, desc, amount, 'income');
      return { add: { type: 'income', amount, desc: desc || cat(c.cat).name, cat: c.cat, conf: c.conf },
        html: `¡Bien! Ingreso apuntado: <b>${U.eur2(amount)}</b> en ${cat(c.cat).emoji} ${U.esc(cat(c.cat).name)}.` };
    }

    // ¿Me compro esto?
    if (amount > 0 && /(compr|gastar|gasto|permitir|merece|buena idea|deberia|puedo|quiero|pillo|pillar|capricho|vale la pena|me lo|reservar|apuntarme|pagar|viaje)/.test(t)) {
      return Nova.adviseBuy(S, amount, Nova.cleanDesc(text, true));
    }

    // ¿Cuánto llevo en X?
    const mentioned = S.cats.find((c) => { const n = U.norm(c.name); return t.includes(n) || (n.length > 5 && t.includes(n.slice(0, n.length - 1))); })
      || (/tabaco|fum/.test(t) ? cat('fumar') : null) || (/gasolin|coche/.test(t) ? cat('gasolina') : null) || (/micro|pequen/.test(t) ? cat('micro') : null) || (/super|comida/.test(t) ? cat('comida') : null);
    if (mentioned && /(cuanto|llevo|gastado|gasto|gaste|como voy|que tal)/.test(t)) {
      const prev = /pasado|anterior/.test(t);
      const m = prev ? U.addMonths(ym, -1) : ym;
      const s = Nova.byCat(S, m)[mentioned.id] || 0;
      const h = Nova.histAvg(S, m);
      const n = Nova.monthTx(S, m).filter((x) => x.cat === mentioned.id).length;
      let html = `${mentioned.emoji} En <b>${U.esc(mentioned.name)}</b> ${prev ? 'el mes pasado gastaste' : 'llevas este mes'} <b>${U.eur2(s)}</b> (${n} movimiento${n === 1 ? '' : 's'}).`;
      if (h.cat[mentioned.id]) html += `\nTu media mensual es ${U.eur(h.cat[mentioned.id])}.`;
      if (mentioned.budget) html += `\nPresupuesto: ${U.eur(mentioned.budget)} → ${s <= mentioned.budget ? `te quedan ${U.eur(mentioned.budget - s)}` : `te has pasado ${U.eur(s - mentioned.budget)}`}.`;
      return { html, actions: [{ label: 'Ver movimientos', do: 'filterCat', arg: mentioned.id }] };
    }

    if (/(recort|ahorrar mas|donde ahorro|consejo|consejos|mejorar|se me va|me sobra|optimiz)/.test(t)) {
      const list = Nova.insights(S).filter((i) => ['cut', 'trend', 'micro', 'smoke', 'budget', 'forecast'].includes(i.key)).slice(0, 4);
      if (!list.length) return { html: 'Todavía no veo ningún gasto disparado. Cuando tenga algo más de historial (unas semanas) podré decirte con precisión dónde se te va el dinero. 💪' };
      return { html: 'Esto es lo que yo tocaría primero:\n\n' + list.map((i) => `${i.emoji} <b>${U.esc(i.title)}</b>\n${U.esc(i.text)}`).join('\n\n') };
    }

    if (/(como voy|resumen|balance|como va|estado|situacion|este mes|que tal voy)/.test(t)) return { html: Nova.summary(S) };

    if (/(fijo|fijos|proximo|proximos|pagos|que tengo que pagar|recibos|cuotas|fraccionad)/.test(t)) {
      const list = [...Nova.scheduled(S, ym), ...Nova.scheduled(S, U.addMonths(ym, 1))].filter((s) => !s.done && U.daysUntil(s.date) >= 0).slice(0, 8);
      if (!list.length) return { html: 'No tienes pagos programados pendientes. Puedes añadir tus gastos fijos y cuotas en Movimientos → Fijos.', actions: [{ label: 'Ir a fijos', do: 'goSched' }] };
      return { html: '🗓️ <b>Próximos pagos</b>\n' + list.map((s) => `${U.shortDate(s.date)} · ${U.esc(s.name)} · ${s.type === 'income' ? '+' : ''}${U.eur2(s.amount)}`).join('\n'), actions: [{ label: 'Ver fijos', do: 'goSched' }] };
    }

    if (/(meta|metas|ahorro|ahorrado|hucha)/.test(t)) {
      if (!S.goals.length) return { html: 'Aún no tienes metas de ahorro. Crear una (un viaje, un colchón de emergencia…) me ayuda a aconsejarte mejor antes de cada compra.', actions: [{ label: 'Crear meta', do: 'newGoal' }] };
      return { html: '🐷 <b>Tus metas</b>\n' + S.goals.map((g) => `${g.emoji} ${U.esc(g.name)}: ${U.eur(g.saved)} de ${U.eur(g.target)} (${Math.round(g.saved / g.target * 100)} %)`).join('\n') };
    }

    if (/(aprend|que sabes|me conoces|precision)/.test(t)) {
      const L = S.learn;
      return { html: `✨ Llevo ${Nova.histMonths(S, ym).length + 1} mes(es) aprendiendo de ti.\n• ${Object.keys(L.merchants).length} comercios reconocidos\n• ${L.corrections || 0} correcciones tuyas aprendidas\n• ${L.accuracy ? `Mis previsiones aciertan un ${Math.round(L.accuracy * 100)} %` : 'Mi precisión la sabré cuando cierre el primer mes con previsión'}\nCada vez que corriges una categoría o valoras un aviso con 👍/👎, me ajusto.` };
    }

    if (/^(hola|buenas|hey|ey|holi|buenos dias|buenas tardes|buenas noches)/.test(t)) {
      return { html: `¡Hola${S.settings.name ? ', ' + U.esc(S.settings.name) : ''}! 👋\n${Nova.summary(S)}` };
    }
    if (/(gracias|genial|perfecto|vale|ok)/.test(t)) return { html: '¡A ti! Aquí estoy para lo que necesites. 😊' };

    if (amount > 0) return Nova.adviseBuy(S, amount, Nova.cleanDesc(text, true));

    return { html: 'Puedo ayudarte con cosas como:\n• «¿Me compro unas zapatillas de 90 €?»\n• «He gastado 12 € en Mercadona»\n• «¿Cuánto llevo en cenas?»\n• «¿Dónde puedo recortar?»\n• «¿Cómo voy este mes?»\n• «¿Qué pagos tengo pronto?»' };
  },

  extractAmount(text) {
    const re = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(€|eur\b|euros|pavos|k\b)?/gi;
    const found = [];
    let m;
    while ((m = re.exec(String(text)))) {
      let v = U.parseAmount(m[1]);
      if (m[2] && /k/i.test(m[2])) v *= 1000;
      if (v > 0) found.push({ v, cur: !!m[2] });
    }
    if (!found.length) return 0;
    const withCur = found.filter((x) => x.cur);
    return (withCur.length ? withCur[withCur.length - 1] : found.reduce((a, b) => (b.v > a.v ? b : a))).v;
  },
  cleanDesc(text, item) {
    let s = String(text)
      .replace(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(€|euros?|eur|pavos)?/gi, ' ')
      .replace(/^\s*(añade|anade|apunta|registra|anota|mete|he gastado|me he gastado|gasté|gaste|he pagado|pagué|pague|gasto de|gastado|he cobrado|cobré|cobre|me han pagado|me han ingresado|ingreso de|ingresa|he ingresado)\b/i, ' ');
    if (item) s = s.replace(/\b(gasto|algo|cosa|me|compro|comprar|comprarme|compraria|debería|deberia|puedo|quiero|pillo|pillar|pillarme|es|buena|idea|merece|la|pena|vale|un|una|unos|unas|el|los|las|de|por|permitir|permitirme|gastar|gastarme|en|lo|si|no|que|o|mejor|espero|esperar|al|del)\b/gi, ' ');
    else s = s.replace(/^\s*(en|de|el|la|por)\b/i, ' ');
    s = s.replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  },

  summary(S) {
    const ym = U.ym();
    const t = Nova.totals(S, ym);
    const f = Nova.forecast(S, ym);
    const spent = Object.entries(Nova.byCat(S, ym)).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const cat = (id) => S.cats.find((c) => c.id === id) || { name: id, emoji: '📦' };
    let s = `📊 <b>${U.monthLabel(ym)}</b>\nIngresos: ${U.eur2(t.inc)}\nGastos: ${U.eur2(t.exp)}`;
    if (t.saved) s += `\nAhorrado: ${U.eur2(t.saved)}`;
    if (spent.length) s += `\nDonde más gastas: ${spent.map(([id, v]) => `${cat(id).emoji} ${cat(id).name} (${U.eur(v)})`).join(', ')}`;
    if (f.inc > 0) s += `\n\n${f.end >= 0 ? '🌱' : '⚠️'} Previsión a fin de mes: <b>${U.eur(f.end)}</b>`;
    else s += '\n\nApunta tu nómina (o ponla como ingreso fijo) para que pueda prever cómo cierras el mes.';
    return s;
  },

  /* ---------- ¿Es buena idea este gasto? ---------- */
  adviseBuy(S, amount, item) {
    const ym = U.ym();
    const f = Nova.forecast(S, ym);
    const h = f.h;
    const t = Nova.totals(S, ym);
    const cls = Nova.classify(S, item, amount, 'expense');
    const c = S.cats.find((x) => x.id === cls.cat) || { name: 'Otros', emoji: '📦', budget: 0 };
    const goals = S.goals.filter((g) => g.saved < g.target);
    const goalNeed = U.sum(goals.filter((g) => g.deadline), (g) => (g.target - g.saved) / Math.max(1, U.monthsBetween(ym, g.deadline.slice(0, 7))));
    const goalNeedLeft = Math.max(0, goalNeed - t.saved);
    const name = item ? `«${U.esc(item)}»` : 'este gasto';
    const actions = [];

    if (f.inc <= 0) {
      return { html: `Para decirte si ${name} (${U.eur2(amount)}) es buena idea necesito conocer tus ingresos.\nApunta tu nómina o añádela como ingreso fijo y te respondo con números reales.`, actions: [{ label: 'Añadir ingreso fijo', do: 'newFixedIncome' }] };
    }

    const free = f.end - goalNeedLeft; // lo que te queda libre este mes tras gastos previstos y metas
    const avgInc = h.n ? h.inc : f.inc;
    const avgExp = h.n ? h.exp : f.exp;
    const monthlyFree = Math.max(0, avgInc - avgExp - goalNeed);
    const catLeft = c.budget ? c.budget - (Nova.byCat(S, ym)[c.id] || 0) : Infinity;
    const workDays = avgInc > 0 ? amount / (avgInc / 22) : 0;

    let verdict, cls2, body;
    if (free <= 0) {
      verdict = 'Mejor espera'; cls2 = 'no';
      body = `Este mes ya vas justo: la previsión es cerrar con ${U.eur(f.end)}${goalNeedLeft ? ` y aún te faltan ${U.eur(goalNeedLeft)} para tus metas` : ''}. Si compras ${name} ahora, tendrías que tirar de ahorros.`;
    } else if (amount <= free * 0.3 && amount <= catLeft) {
      verdict = 'Adelante'; cls2 = 'ok';
      body = `Te lo puedes permitir: tras todos los gastos previstos te quedarían ~${U.eur(free - amount)} libres este mes.`;
    } else if (amount <= free * 0.3) {
      verdict = 'Puedes, con matices'; cls2 = 'wait';
      body = `El mes lo aguanta (te quedarían ~${U.eur(free - amount)}), pero en ${c.emoji} ${c.name} solo te quedan ${U.eur(Math.max(0, catLeft))} de presupuesto. Te pasarías ${U.eur(amount - Math.max(0, catLeft))}.`;
    } else if (amount <= free) {
      verdict = 'Puedes, pero piénsalo'; cls2 = 'wait';
      body = `Cabe, pero se lleva el ${Math.round(amount / free * 100)} % de lo que te queda libre este mes. Te quedarías con solo ${U.eur(free - amount)} de margen para imprevistos.`;
      if (f.day < f.dim - 7) body += `\nSi no es urgente, esperar a principio del mes que viene es más cómodo.`;
    } else {
      verdict = 'Mejor espera'; cls2 = 'no';
      body = `Ahora mismo no cabe: te quedan ~${U.eur(free)} libres y ${name} cuesta ${U.eur(amount)}.`;
    }

    if (cls2 !== 'ok') {
      const missing = Math.max(0, amount - Math.max(0, free));
      if (monthlyFree > 0) {
        const months = Math.max(1, Math.ceil(missing / (monthlyFree * 0.6)));
        const when = U.addMonths(ym, months);
        body += `\n\n📅 Apartando ~${U.eur(Math.ceil(amount / months))}/mes, lo tendrías en <b>${U.monthName(when)}</b> sin agobios.`;
        actions.push({ label: 'Crear meta para esto', do: 'goalFor', name: item || 'Compra', amount, deadline: U.dateIn(when, 28) });
        if (amount >= 150) {
          const opt = [3, 6, 12].find((n) => amount / n <= monthlyFree * 0.35);
          if (opt) body += `\n💳 Fraccionado en ${opt} meses serían ${U.eur2(amount / opt)}/mes, asumible con lo que te suele sobrar (${U.eur(monthlyFree)}/mes). Ojo con los intereses.`;
        }
      } else if (h.n) {
        body += `\n\nDe media gastas lo mismo o más de lo que ingresas, así que antes de compras extra conviene recortar. Pregúntame «¿dónde puedo recortar?».`;
      }
    }
    if (goals.length && cls2 !== 'ok' && amount > 0) {
      const g = goals[0];
      const monthlyPace = goalNeed || monthlyFree || 1;
      const weeks = Math.round(amount / monthlyPace * 4.3);
      if (weeks >= 1) body += `\n🐷 Equivale a retrasar «${U.esc(g.name)}» ${weeks === 1 ? 'una semana' : `unas ${weeks} semanas`}.`;
    }
    if (workDays >= 0.5) body += `\n⏱️ Equivale a ~${workDays < 1.5 ? '1 día' : Math.round(workDays) + ' días'} de trabajo.`;
    if (['ocio', 'compras'].includes(c.id) && amount >= 80 && cls2 !== 'ok') body += `\n💡 Truco: espera 48 h. Si sigues queriéndolo, es que lo necesitas de verdad.`;

    return { html: `<span class="verdict ${cls2}">${cls2 === 'ok' ? '✅' : cls2 === 'wait' ? '🤔' : '✋'} ${verdict}</span>\n${body}`, actions };
  },

  /* ---------- Lectura de tickets (texto del OCR) ---------- */
  /* ocrLines (opcional): [{ text, h }] con la altura de cada línea en la foto.
     El total suele ir en negrita y más grande: la altura de la línea pesa mucho. */
  parseTicket(text, ocrLines) {
    const fix = (t) => String(t || '')
      .replace(/(\d)\s*[oO]\b/g, '$10').replace(/\b[oO](\d)/g, '0$1')      // O leída en vez de 0
      .replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3')                  // "12 , 50" -> "12,50"
      .replace(/(\d)[lI|](\d)/g, '$11$2');                                     // l/I leída en vez de 1
    const raw = ocrLines && ocrLines.length ? ocrLines : text.split('\n').map((t) => ({ text: t, h: 0 }));
    const lines = raw.map((l) => ({ text: fix(l.text).trim(), h: l.h || 0 })).filter((l) => l.text);
    const hs = lines.map((l) => l.h).filter((h) => h > 0).sort((a, b) => a - b);
    const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
    const num = /(\d{1,4})[.,](\d{2})(?!\d)/g;
    const KEY_STRONG = /total\s*(a\s*)?pagar|importe\s*total|total\s*(eur|€|compra|venta)|^\W*total\b/i;
    const KEY = /\btotal\b|a\s*pagar|importe/i;
    const PAY = /tarjeta|visa|mastercard|maestro|contactless|efectivo|pagado|cobrado/i;
    const BAD = /sub\s*total|base\s*imp|\biva\b|i\.v\.a|cuota|cambio|entregad|devoluc|descuento|dto\b|ahorr|puntos|saldo|\d\s*%|\bkg\b|€\/|precio\s*\/|unid|uds\b|x\s*\d/i;
    const byVal = {};
    lines.forEach((l, i) => {
      const vals = [...l.text.matchAll(num)].map((m) => U.parseAmount(m[1] + ',' + m[2])).filter((v) => v > 0 && v < 10000);
      if (!vals.length) return;
      const prev = lines[i - 1]?.text || '';
      const lettersHere = /[a-zA-Z]{3,}/.test(l.text);
      let score = 0;
      if (KEY_STRONG.test(l.text)) score += 7;
      else if (KEY.test(l.text)) score += 5;
      else if (!lettersHere && KEY.test(prev) && !BAD.test(prev)) score += 5;   // "TOTAL" en una línea y el número en la siguiente
      if (PAY.test(l.text)) score += 2.5;
      if (BAD.test(l.text) && !KEY_STRONG.test(l.text)) score -= 8;
      if (medH && l.h) score += U.clamp((l.h / medH - 1) * 8, -2, 10);         // letra más grande → muy probable que sea el total
      score += (i / lines.length) * 1.5;                                        // el total suele ir en la mitad de abajo
      const v = vals[vals.length - 1];                                          // en una línea, el importe es el último número
      const c = byVal[v] || (byVal[v] = { v, score: -99, n: 0 });
      c.score = Math.max(c.score, score); c.n++;
    });
    const cands = Object.values(byVal).map((c) => ({ v: c.v, score: c.score + (c.n - 1) * 2 }));  // el total suele repetirse (TOTAL, TARJETA…)
    // Si no hay ninguna pista, el importe más alto razonable
    const maxV = Math.max(0, ...cands.map((c) => c.v));
    cands.forEach((c) => { if (c.v === maxV) c.score += 1.5; });
    cands.sort((a, b) => b.score - a.score);
    const total = cands.length ? cands[0].v : 0;
    // Fecha
    let date = null;
    const dm = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dm) {
      let [, d, m, y] = dm; y = y.length === 2 ? '20' + y : y;
      const iso = `${y}-${U.pad(+m)}-${U.pad(+d)}`;
      if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 && U.daysUntil(iso) <= 0 && U.daysUntil(iso) > -400) date = iso;
    }
    // Comercio: primera línea con letras de verdad
    let merchant = '';
    for (const l of lines.slice(0, 6)) {
      const clean = l.text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .,&'-]/g, '').trim();
      const letters = (clean.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      if (letters >= 3 && letters / clean.length > 0.6 && !/factura|ticket|simplificada|cif|nif|tel|www|c\/|calle|avda/i.test(clean)) { merchant = clean; break; }
    }
    // Comercios conocidos en cualquier parte del ticket
    const known = Object.keys(SEED_MAP).filter((w) => w.length >= 4);
    const nt = U.norm(text);
    const hit = known.find((w) => new RegExp(`\\b${w}\\b`).test(nt) && ['comida', 'gasolina', 'cenas', 'fumar', 'compras', 'salud'].includes(SEED_MAP[w]));
    if (hit && !U.norm(merchant).includes(hit)) merchant = hit.charAt(0).toUpperCase() + hit.slice(1);
    merchant = merchant.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
    return { total: U.r2(total), date, merchant, cands: cands.slice(0, 4).map((c) => U.r2(c.v)) };
  }
};
