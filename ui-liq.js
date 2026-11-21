// HTML de la pantalla «Liquidez» (Brújula, libro de órdenes, estadísticas)
import { EX, EX_LABEL, EX_COLOR, BANDS, bestBidAsk, isReady } from './aggregate.js';
import { fmtN, fmtUsd, fmtPrice, fmtPct, mmss, esc, median } from './util.js';
import { SIG_NAMES, W, M } from './compass.js';

export const RANGES = [0.5, 1, 2, 5, 10, 25, 50];
export const STATUS_TXT = { ok: 'conectado', connecting: 'conectando', retry: 'reconectando', off: 'apagado', na: 'no disponible' };
const sdot = { ok: 'ok', connecting: 'wait', retry: 'bad', off: 'off', na: 'off' };

export function exChips(enabled, status) {
  return EX.map((k) => {
    const s = status[k] || { s: 'off' };
    const cls = enabled[k] ? 'chip on' : 'chip';
    return `<button class="${cls}" data-act="ex" data-k="${k}" title="${esc(STATUS_TXT[s.s] || '')}${s.msg ? ' · ' + esc(s.msg) : ''}"><i class="dot ${enabled[k] ? sdot[s.s] : 'off'}"></i>${EX_LABEL[k]}</button>`;
  }).join('');
}

export function rangeChips(range, custom) {
  return RANGES.map((r) => `<button class="chip${!custom && r === range ? ' on' : ''}" data-act="range" data-r="${r}">±${fmtN(r, r < 1 ? 1 : 0)} %</button>`).join('')
    + `<button class="chip${custom ? ' on' : ''}" data-act="range" data-r="custom">Personalizado</button>`;
}

export function recBar(rec) {
  return `<button class="chip rec${rec.on ? ' on' : ''}" data-act="rec">${rec.on ? '■ Parar' : '● Grabar'}</button><span class="rec-st dim">${esc(rec.status())}</span>
    <button class="chip" data-act="rec-export">Exportar</button><button class="chip" data-act="rec-clear">Vaciar</button>`;
}

const sigBar = (v) => `<span class="sbar"><i style="left:${v >= 0 ? 50 : 50 + v * 50}%;width:${Math.abs(v) * 50}%;background:${v >= 0 ? '#8FE3D2' : '#F2704F'}"></i></span>`;

export function compassHtml(view, open, hasData) {
  if (!view || !hasData) {
    return `<div class="panel"><div class="sec">Brújula · próximo precio</div><div class="dim pad">sin datos: ningún libro está listo todavía (mira los puntos de los exchanges).</div></div>`;
  }
  const rows = view.map((v) => {
    const up = v.dir > 0;
    const state = v.flash ? v.flash : v.confirmed ? '✓ confirmada' : 'en curso';
    const pos = Math.min(1, Math.max(0, (v.mid - v.valid) / (v.invalid - v.valid || 1))) * 100;
    let det = '';
    if (open[v.i]) {
      const s = v.signals;
      const rowsS = ['near', 'wide', 'flow', 'inr', 'mag', 'ghost'].map((k) => {
        const w = k === 'ghost' ? W.ghost : W[k][v.i];
        return `<div class="sig"><span>${SIG_NAMES[k]}</span>${sigBar(s[k])}<span class="mono">${fmtN(s[k], 2)}</span><span class="dim mono">×${fmtN(w, 2)}</span></div>`;
      }).join('');
      const wl = (w) => (w ? `muro de ${fmtUsd(w.size, 1)} en ${fmtPrice(w.price)} (confianza ${fmtN(w.trust * 100, 0)} %)` : 'sin muro: se usa una distancia proporcional');
      det = `<div class="cdet">${rowsS}
        <div class="mono small">Puntuación ${fmtN(v.score, 3)} (suave ${fmtN(v.scoreSmooth, 3)}) · σ(${M[v.i]}m) ${fmtN(v.sigma * 100, 3)} % · prob. bruta ${fmtN(v.probRaw * 100, 0)} %</div>
        <div class="small"><b>Objetivo:</b> ${wl(v.lv.targetWall)}</div>
        <div class="small"><b>VALIDA:</b> ${v.lv.validWall ? 'un tramo después del ' + wl(v.lv.validWall) : 'sin muro en contra en el camino'}</div>
        <div class="small"><b>INVALIDA:</b> ${wl(v.lv.invalidWall)}</div></div>`;
    }
    return `<div class="crow" data-act="comp" data-i="${v.i}">
      <div class="chead"><b>${v.label}</b><span class="dim mono">quedan ${mmss(v.remaining)}</span><span class="cst${v.flash ? ' flash' : ''}">${esc(state)}</span></div>
      <div class="cmain">
        <div class="lv ok"><small>VALIDA</small><span class="mono">${fmtPrice(v.valid)}</span></div>
        <div class="tg ${up ? 'pos' : 'neg'}"><div class="tp"><span>${up ? '▲' : '▼'}</span> ${fmtPrice(v.target)}</div><small class="dim">${fmtN(v.prob * 100, 0)} % · ${fmtPct(v.change, 2, true)}</small></div>
        <div class="lv bad"><small>INVALIDA</small><span class="mono">${fmtPrice(v.invalid)}</span></div>
      </div>
      <div class="cbar"><i style="left:${pos}%"></i></div>${det}</div>`;
  }).join('');
  const acc = view.filter((v) => v.accuracy).map((v) => `${v.label} ${fmtN(v.accuracy.rate * 100, 0)} % (${v.accuracy.n})`).join(' · ');
  return `<div class="panel"><div class="sec">Brújula · próximo precio</div>${rows}
    ${acc ? `<div class="small dim pad">Acierto real: ${acc}</div>` : ''}
    <div class="small dim pad">Es una lectura del libro, no una certeza. Toca una fila para ver el porqué.</div></div>`;
}

/** Agrupa el libro agregado en niveles de «group» dólares: 14 ventas arriba y 14 compras abajo */
export function groupBook(books, mid, group, n = 14) {
  const bids = new Map(), asks = new Map();
  for (const k of EX) {
    const b = books[k]; if (!isReady(b)) continue;
    for (const [p, q] of b.bids) { if (p > mid) continue; const g = Math.floor(p / group + 1e-9) * group; const e = bids.get(g) || { q: 0, usd: 0, ex: {} }; e.q += q; e.usd += p * q; e.ex[k] = (e.ex[k] || 0) + p * q; bids.set(g, e); }
    for (const [p, q] of b.asks) { if (p < mid) continue; const g = Math.ceil(p / group - 1e-9) * group; const e = asks.get(g) || { q: 0, usd: 0, ex: {} }; e.q += q; e.usd += p * q; e.ex[k] = (e.ex[k] || 0) + p * q; asks.set(g, e); }
  }
  const take = (m, asc) => [...m.entries()].sort((a, b) => (asc ? a[0] - b[0] : b[0] - a[0])).slice(0, n).map(([p, e]) => ({ p, ...e }));
  const a = take(asks, true), bd = take(bids, false);
  let c = 0; a.forEach((r) => { c += r.usd; r.cum = c; });
  c = 0; bd.forEach((r) => { c += r.usd; r.cum = c; });
  const all = [...a, ...bd].map((r) => r.usd);
  const med = median(all), maxCum = Math.max(a.at(-1)?.cum || 0, bd.at(-1)?.cum || 0, 1);
  [...a, ...bd].forEach((r) => { r.wall = med > 0 && r.usd >= 3 * med; r.rel = med > 0 ? r.usd / med : 0; });
  return { asks: a.reverse(), bids: bd, maxCum };
}

export function bookHtml(books, agg, group, bandSel, openRow) {
  if (!agg) return '<div class="dim pad">sin datos</div>';
  const g = groupBook(books, agg.mid, group);
  const { bid, ask } = (() => { let b = -Infinity, a = Infinity; for (const k of EX) if (isReady(books[k])) { const x = bestBidAsk(books[k]); b = Math.max(b, x.bid); a = Math.min(a, x.ask); } return { bid: b, ask: a }; })();
  const band = agg.bandsAll.find((x) => x.pct === bandSel) || agg.bands[0];
  const ratio = band ? (band.B >= band.A ? ['Compras', band.B / (band.A || 1)] : ['Ventas', band.A / (band.B || 1)]) : ['', 0];
  const row = (r, side) => {
    const bars = EX.filter((k) => r.ex[k]).map((k) => `<i style="width:${(r.ex[k] / r.usd) * 100}%;background:${EX_COLOR[k]}"></i>`).join('');
    const key = side + r.p;
    return `<div class="ob ${side}${r.wall ? ' wall' : ''}" data-act="obrow" data-key="${key}" style="--w:${(r.cum / g.maxCum) * 100}%">
      <span class="mono p">${fmtN(r.p, group < 1 ? 2 : 0)}</span><span class="mono">${fmtN(r.q, 2)}</span><span class="mono">${fmtUsd(r.usd, 1)}</span><span class="mono dim">${fmtUsd(r.cum, 1)}</span><span class="xb">${bars}</span></div>
      ${openRow === key ? `<div class="small pad ob-exp">${fmtUsd(r.usd)} a ${fmtN(r.p, 2)}: ${fmtN(r.rel, 1)}× la mediana de las filas visibles${r.wall ? ' (muro)' : ''}. Lo ponen ${EX.filter((k) => r.ex[k]).map((k) => `${EX_LABEL[k]} ${fmtN((r.ex[k] / r.usd) * 100, 0)} %`).join(', ')}. Las órdenes pueden retirarse antes de ejecutarse.</div>` : ''}`;
  };
  return `<div class="ob head"><span>Precio</span><span>Cantidad</span><span>Importe</span><span>Acum.</span><span></span></div>
    ${g.asks.map((r) => row(r, 'sell')).join('')}
    <div class="obmid"><b class="mono">${fmtPrice(agg.mid)}</b><span class="dim mono">spread ${fmtN(ask - bid, 2)} $ · ${fmtN(((ask - bid) / agg.mid) * 1e4, 2)} pb</span><span class="${ratio[0] === 'Compras' ? 'pos' : 'neg'} mono">${ratio[0]} ${fmtN(ratio[1], 2)}×</span></div>
    ${g.bids.map((r) => row(r, 'buy')).join('')}`;
}

export function statsHtml(agg, bandSel) {
  if (!agg) return '';
  const bands = agg.bands;
  const maxBA = Math.max(...bands.map((b) => Math.max(b.B, b.A)), 1);
  const imbRows = bands.map((b) => `<div class="irow${b.pct === bandSel ? ' sel' : ''}" data-act="band" data-b="${b.pct}"><span class="mono pos">${fmtUsd(b.B, 1)}</span>
      <span class="ibar"><i class="b" style="width:${(b.B / maxBA) * 50}%"></i><i class="a" style="width:${(b.A / maxBA) * 50}%"></i></span><span class="mono neg">${fmtUsd(b.A, 1)}</span>
      <span class="mono ${b.imb >= 0 ? 'pos' : 'neg'}">±${b.pct} % · ${fmtPct(b.imb * 100, 0, true)}</span></div>`).join('');
  const sel = agg.bandsAll.find((b) => b.pct === bandSel) || bands[0];
  let exRows = '';
  if (sel) {
    const tot = agg.exs.reduce((s, k) => s + sel.ex[k].B + sel.ex[k].A, 0) || 1;
    exRows = agg.exs.map((k) => {
      const t = sel.ex[k].B + sel.ex[k].A;
      return `<div class="erow"><span>${EX_LABEL[k]}</span><span class="ibar"><i style="width:${(t / tot) * 100}%;background:${EX_COLOR[k]}"></i></span><span class="mono">${fmtUsd(t, 1)}</span><span class="mono dim">${fmtN((t / tot) * 100, 0)} %</span></div>`;
    }).join('');
  }
  // muros: mayor compra y venta en la ventana
  const big = (arr) => { let bi = -1, bv = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; } return bi < 0 ? null : { i: bi, v: bv }; };
  const wallLine = (w, lbl, cls) => {
    if (!w) return `<div class="small dim">${lbl}: sin datos</div>`;
    const p = (agg.b0 + w.i + 0.5) * agg.step;
    const parts = agg.exs.map((k) => [k, agg.perEx[k][w.i]]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const sum = agg.exs.reduce((s, k) => s + agg.perEx[k][w.i], 0) || 1;
    return `<div class="small"><b class="${cls}">${lbl}</b> ${fmtUsd(w.v, 1)} en ${fmtPrice(p)} (${fmtPct(((p - agg.mid) / agg.mid) * 100, 2, true)}) · ${parts.map(([k, v]) => `${EX_LABEL[k]} ${fmtN((v / sum) * 100, 0)} %`).join(', ')}</div>`;
  };
  const reach = agg.exs.map((k) => { const r = agg.reach[k]; return `<div class="small"><span>${EX_LABEL[k]}</span> <span class="mono dim">${fmtPrice(r.lowBid)} (${fmtPct(((r.lowBid - agg.mid) / agg.mid) * 100, 2)}) → ${fmtPrice(r.highAsk)} (${fmtPct(((r.highAsk - agg.mid) / agg.mid) * 100, 2, true)})</span></div>`; }).join('');
  const last = sel ? `Dentro de ±${sel.pct} % hay ${fmtN(sel.B >= sel.A ? sel.B / (sel.A || 1) : sel.A / (sel.B || 1), 2)}× más liquidez ${sel.B >= sel.A ? 'compradora' : 'vendedora'} que ${sel.B >= sel.A ? 'vendedora' : 'compradora'} (${fmtUsd(sel.B + sel.A)} en total). Las órdenes pueden retirarse antes de ejecutarse.` : '';
  return `<div class="panel"><div class="sec">Imbalance por distancia</div>${imbRows}
    <div class="sec">Por exchange (±${sel ? sel.pct : '–'} %)</div>${exRows}
    <div class="sec">Muros de liquidez</div>${wallLine(big(agg.buy), 'Mayor comprador', 'pos')}${wallLine(big(agg.sell), 'Mayor vendedor', 'neg')}
    <div class="sec">Alcance de cada libro</div>${reach}
    <div class="small pad">${last}</div></div>`;
}
