// Liquidez · punto de entrada: estado, bucle de 1 s y eventos
import { EX, pickMid, windowFor, stepFor, aggregate, bandImb, BANDS } from './aggregate.js';
import { startFeeds, SRC_NOTE } from './feeds.js';
import { Compass } from './compass.js';
import { Recorder } from './recorder.js';
import { GlobalPanel } from './ui-global.js';
import { drawHeatmap, drawImbalance, drawDepth } from './charts.js';
import { exChips, rangeChips, recBar, compassHtml, bookHtml, statsHtml } from './ui-liq.js';
import { startDemo, demoGlobal } from './demo.js';
import { sdLog } from './compass.js';
import { fmtN, esc } from './util.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has('demo');
const ls = (() => { try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); return localStorage; } catch { return null; } })();
const load = (k, d) => { try { return JSON.parse(ls.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { ls.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

const S = {
  sym: 'BTC', range: 1, custom: null, tab: 'map', bandSel: 1, group: 10, openRow: null,
  enabled: load('liq.enabled', Object.fromEntries(EX.map((k) => [k, true]))),
  status: {}, step: null, cols: [], agg: null, mid: null, feeds: null, open: [false, false, false, false, false], maxDist: 1000,
};
for (const k of EX) if (S.enabled[k] === undefined) S.enabled[k] = true;
const compass = new Compass({ storage: ls });
const rec = new Recorder();
const groupsFor = () => (S.sym === 'ETH' ? [0.2, 0.4, 1, 2, 5] : [5, 10, 25, 50, 125]);

function onStatus(k, s, msg) { S.status[k] = { s, msg }; paintChips(); }

function startAll() {
  if (S.feeds) S.feeds.stop();
  S.cols = []; S.step = null; S.agg = null; S.mid = null; S.status = {};
  compass.reset(); S.group = groupsFor()[1]; S.openRow = null;
  const opts = { sym: S.sym, enabled: S.enabled, onStatus, getMid: () => S.mid, getMaxDist: () => S.maxDist };
  S.feeds = demo ? startDemo({ ...opts, books: Object.fromEntries(EX.map((k) => [k, { bids: new Map(), asks: new Map() }])) }) : startFeeds(opts);
  if (rec.on) { rec.stop(); paintRec(); } // al cambiar de moneda se para
  loadKlines();
}

async function loadKlines() {
  if (demo) { compass.setKlines(Array.from({ length: 480 }, (_, i) => (S.sym === 'ETH' ? 3500 : 100000) * (1 + 0.0004 * Math.sin(i * 1.7)))); return; }
  const sym = S.sym;
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1m&limit=480`);
    const j = await r.json();
    if (sym === S.sym && Array.isArray(j)) compass.setKlines(j.map((k) => +k[4]));
  } catch { /* sin velas: la Brújula usa el historial propio del mid */ }
}
setInterval(() => !document.hidden && loadKlines(), 60000);

function tick() {
  if (!S.feeds) return;
  const m = pickMid(S.feeds.books);
  S.mid = m ? m.mid : null;
  if (!m) { S.agg = null; if (!document.hidden) render(); return; }
  const win = windowFor(m.mid, S.range, S.custom);
  if (!S.step) { S.step = stepFor(win.lo, win.hi); S.maxDist = Math.max(m.mid - win.vlo, win.vhi - m.mid); S.feeds.onRange(); }
  const agg = aggregate(S.feeds.books, win, S.step, m.mid);
  agg.vlo = win.vlo; agg.vhi = win.vhi; agg.bid = m.bid; agg.ask = m.ask; agg.src = m.src;
  const vals = new Float32Array(agg.nb);
  for (let i = 0; i < agg.nb; i++) vals[i] = agg.buy[i] + agg.sell[i];
  const now = Date.now();
  S.cols.push({ t: now, mid: m.mid, vals, b0: agg.b0, imb: bandImb(agg, S.bandSel) });
  if (S.cols.length > 1800) S.cols.splice(0, S.cols.length - 1800);
  compass.tick(now, agg);
  rec.push(agg, m.bid, m.ask, now);
  S.agg = agg;
  if (!document.hidden) render();
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ---------- pintado ----------
function paintChips() { $('exchips').innerHTML = exChips(S.enabled, S.status); }
function paintRec() { $('recbar').innerHTML = recBar(rec); }
function paintRanges() { $('ranges').innerHTML = rangeChips(S.range, S.custom); }
function paintTabs() {
  $('tabs').innerHTML = `<button class="chip${S.tab === 'map' ? ' on' : ''}" data-act="tab" data-t="map">Mapa de liquidez</button><button class="chip${S.tab === 'book' ? ' on' : ''}" data-act="tab" data-t="book">Libro de órdenes</button>`;
  $('v-map').hidden = S.tab !== 'map'; $('v-book').hidden = S.tab !== 'book';
}
function paintSyms() {
  $('syms').innerHTML = ['BTC', 'ETH'].map((s) => `<button class="chip big${S.sym === s ? ' on' : ''}" data-act="sym" data-s="${s}">${s}</button>`).join('');
}

function render() {
  const view = compass.view;
  $('compass').innerHTML = compassHtml(view, S.open, !!S.agg);
  $('stats').innerHTML = statsHtml(S.agg, S.bandSel);
  $('rec-st-live') && ($('rec-st-live').textContent = rec.status());
  const rs = document.querySelector('.rec-st'); if (rs) rs.textContent = rec.status();
  if (S.tab === 'book') {
    $('groups').innerHTML = groupsFor().map((g) => `<button class="chip${S.group === g ? ' on' : ''}" data-act="group" data-g="${g}">${g} $</button>`).join('');
    $('bookTable').innerHTML = bookHtml(S.feeds.books, S.agg, S.group, S.bandSel, S.openRow);
  } else if (S.agg) {
    const a = S.agg;
    const top = [];
    const bigs = [...a.buy].map((v, i) => ({ v, i, side: 1 })).concat([...a.sell].map((v, i) => ({ v, i, side: -1 }))).sort((x, y) => y.v - x.v).slice(0, 4);
    for (const b of bigs) top.push({ price: (a.b0 + b.i + 0.5) * a.step, size: b.v });
    drawHeatmap($('heat'), S.cols, { vlo: a.vlo, vhi: a.vhi, step: a.step }, a, top);
    drawImbalance($('imbc'), S.cols, '±' + S.bandSel + ' %');
    drawDepth($('depth'), a);
  } else drawHeatmap($('heat'), [], { vlo: 0, vhi: 0, step: 1 }, { mid: 0, nb: 0, buy: [], sell: [], b0: 0 });
  $('nodata').hidden = !!S.agg;
  $('nodata').textContent = S.agg ? '' : 'sin datos: ningún libro está listo. ' + Object.entries(S.status).filter(([, v]) => v.s !== 'ok' && v.s !== 'off').map(([k, v]) => `${k}: ${v.msg || v.s}`).join(' · ');
}

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const d = el.dataset;
  switch (d.act) {
    case 'sym': if (S.sym !== d.s) { S.sym = d.s; paintSyms(); startAll(); } break;
    case 'ex': S.enabled[d.k] = !S.enabled[d.k]; save('liq.enabled', S.enabled); S.feeds.setEnabled(d.k, S.enabled[d.k]); paintChips(); break;
    case 'range': {
      if (d.r === 'custom') {
        const mn = +String(prompt('Precio mínimo (USD)', S.mid ? Math.round(S.mid * 0.97) : '') || '').replace(',', '.');
        const mx = +String(prompt('Precio máximo (USD)', S.mid ? Math.round(S.mid * 1.03) : '') || '').replace(',', '.');
        if (mn > 0 && mx > mn) S.custom = { min: mn, max: mx }; else return;
      } else { S.range = +d.r; S.custom = null; }
      S.step = null; S.cols = []; compass.wallSeen.clear(); paintRanges(); break;
    }
    case 'tab': S.tab = d.t; paintTabs(); render(); break;
    case 'group': S.group = +d.g; render(); break;
    case 'band': S.bandSel = +d.b; S.cols.forEach((c) => (c.imb = NaN)); render(); break;
    case 'comp': S.open[+d.i] = !S.open[+d.i]; render(); break;
    case 'obrow': S.openRow = S.openRow === d.key ? null : d.key; render(); break;
    case 'rec':
      if (rec.on) rec.stop(); else { try { await rec.start(S.sym); } catch { /* el estado muestra el error */ } }
      paintRec(); break;
    case 'rec-export': {
      try {
        const blob = new Blob([await rec.export()], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `libro-${S.sym}-${new Date().toISOString().slice(0, 19)}.json`; a.click();
      } catch (err) { alert('No se pudo exportar: ' + err.message); }
      break;
    }
    case 'rec-clear': if (confirm('¿Vaciar todas las muestras grabadas? No se puede deshacer.')) { await rec.clear(); paintRec(); } break;
    case 'settings': $('settings').showModal(); break;
  }
});
$('closeSettings').addEventListener('click', () => $('settings').close());
$('srcnote').textContent = SRC_NOTE;

// ---------- arranque ----------
paintSyms(); paintRanges(); paintTabs(); paintRec(); paintChips();
const gp = new GlobalPanel($('global'), demo ? demoGlobal() : null);
gp.start();
if (demo) $('demoflag').hidden = false;
startAll();
if ('serviceWorker' in navigator && !demo && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__S = S; window.__compass = compass; // para pruebas en navegador
