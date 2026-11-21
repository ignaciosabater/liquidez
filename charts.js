// Gráficos en canvas: mapa de calor, perfil, mini imbalance y profundidad
import { fmtUsd, fmtPrice, fmtPct } from './util.js';

const STOPS = [
  [0, [13, 17, 28]], [0.25, [23, 37, 84]], [0.5, [30, 90, 200]], [0.75, [20, 190, 220]], [0.9, [250, 204, 21]], [1, [255, 247, 220]],
];
export function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function percentile(values, p) {
  if (!values.length) return 1;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 1;
}

/** cols: [{t, mid, vals, b0}]; view: {vlo,vhi,step}; cur: agg actual */
export function drawHeatmap(canvas, cols, view, cur, topWalls = []) {
  const { ctx, w, h } = setup(canvas);
  const profileW = 58, axisW = 48, heatW = w - profileW - axisW, bottom = 14, H = h - bottom;
  const { vlo, vhi, step } = view;
  ctx.fillStyle = '#0D111C'; ctx.fillRect(0, 0, w, h);
  const N = cols.length;
  if (!N || !(vhi > vlo)) {
    ctx.fillStyle = '#8A8F9A'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('sin datos: esperando libros…', w / 2, h / 2); return;
  }
  // escala = percentil 98,5 de los valores visibles (muestreados)
  const sample = [];
  const stride = Math.max(1, Math.floor(N / 60));
  for (let c = N - 1; c >= 0; c -= stride) {
    const v = cols[c].vals;
    for (let i = 0; i < v.length; i += 2) if (v[i] > 0) sample.push(v[i]);
  }
  const scale = percentile(sample, 0.985);
  const maxCols = Math.floor(heatW / 6);
  const D = N <= maxCols ? N : Math.min(N, Math.floor(heatW));
  const R = Math.max(2, Math.floor(H));
  const off = document.createElement('canvas'); off.width = D; off.height = R;
  const octx = off.getContext('2d');
  const img = octx.createImageData(D, R);
  const colIdx = (j) => (N <= maxCols ? j : Math.min(N - 1, Math.floor((j * N) / D)));
  const rowBin = new Float64Array(R);
  for (let y = 0; y < R; y++) rowBin[y] = vhi - ((y + 0.5) / R) * (vhi - vlo);
  for (let j = 0; j < D; j++) {
    const col = cols[colIdx(j)];
    for (let y = 0; y < R; y++) {
      const i = Math.floor(rowBin[y] / step) - col.b0;
      const v = i >= 0 && i < col.vals.length ? col.vals[i] : 0;
      const [r, g, b] = heatColor(Math.sqrt(v / scale));
      const o = (y * D + j) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const drawW = N <= maxCols ? D * 6 : heatW;
  ctx.drawImage(off, 0, 0, D, R, heatW - drawW, 0, drawW, H);

  const yOf = (p) => ((vhi - p) / (vhi - vlo)) * H;
  // línea del precio
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath();
  for (let j = 0; j < D; j++) {
    const x = heatW - drawW + ((j + 0.5) / D) * drawW, y = yOf(cols[colIdx(j)].mid);
    j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();

  // eje de precios (derecha)
  ctx.fillStyle = '#8A8F9A'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
  for (let k = 0; k <= 4; k++) {
    const p = vhi - ((vhi - vlo) * k) / 4, y = Math.min(H - 2, Math.max(9, yOf(p)));
    ctx.fillText(fmtPrice(p).replace(/,\d+$/, ''), heatW + profileW + 3, y + 3);
  }
  const ym = yOf(cur.mid);
  ctx.fillStyle = '#F2B33D'; ctx.fillRect(heatW + profileW, ym - 7, axisW, 14);
  ctx.fillStyle = '#0F1115'; ctx.font = 'bold 10px ui-monospace,monospace';
  ctx.fillText(fmtPrice(cur.mid).replace(/,\d+$/, ''), heatW + profileW + 3, ym + 3.5);

  // perfil actual (derecha)
  ctx.fillStyle = '#12151c'; ctx.fillRect(heatW, 0, profileW, H);
  let maxV = 0;
  for (let i = 0; i < cur.nb; i++) maxV = Math.max(maxV, cur.buy[i], cur.sell[i]);
  const rowH = Math.max(1, (step / (vhi - vlo)) * H);
  for (let i = 0; i < cur.nb; i++) {
    const p = (cur.b0 + i) * step;
    if (p < vlo - step || p > vhi) continue;
    const y = yOf(p + step);
    if (cur.buy[i] > 0) { ctx.fillStyle = '#8FE3D2'; ctx.fillRect(heatW, y, (cur.buy[i] / maxV) * (profileW - 2), rowH); }
    if (cur.sell[i] > 0) { ctx.fillStyle = '#F2704F'; ctx.fillRect(heatW, y, (cur.sell[i] / maxV) * (profileW - 2), rowH); }
  }
  ctx.font = '9px ui-monospace,monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  for (const wl of topWalls.slice(0, 4)) {
    const y = yOf(wl.price);
    if (y < 6 || y > H - 4) continue;
    ctx.fillText(fmtUsd(wl.size, 0), heatW + 2, y - 2);
  }
  ctx.fillStyle = '#8A8F9A'; ctx.textAlign = 'left'; ctx.font = '9px system-ui';
  const secs = N;
  ctx.fillText(secs >= 90 ? `← hace ${Math.round(secs / 60)} min` : `← hace ${secs} s`, 3, h - 3);
  ctx.textAlign = 'right'; ctx.fillText('ahora', heatW - 3, h - 3);
}

export function drawImbalance(canvas, cols, label) {
  const { ctx, w, h } = setup(canvas);
  ctx.fillStyle = '#12151c'; ctx.fillRect(0, 0, w, h);
  const mid = h / 2;
  ctx.strokeStyle = '#262A33'; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  const pts = cols.filter((c) => Number.isFinite(c.imb));
  if (pts.length < 2) { ctx.fillStyle = '#8A8F9A'; ctx.font = '11px system-ui'; ctx.fillText('sin datos', 8, mid - 4); return; }
  const n = Math.min(pts.length, 600), sl = pts.slice(-n);
  const last = sl[sl.length - 1].imb;
  ctx.strokeStyle = last >= 0 ? '#8FE3D2' : '#F2704F'; ctx.lineWidth = 1.5; ctx.beginPath();
  sl.forEach((c, i) => { const x = (i / (n - 1)) * (w - 44), y = mid - (c.imb * (h - 8)) / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.fillStyle = last >= 0 ? '#8FE3D2' : '#F2704F'; ctx.font = 'bold 11px ui-monospace,monospace'; ctx.textAlign = 'right';
  ctx.fillText(fmtPct(last * 100, 1, true), w - 4, 14);
  ctx.fillStyle = '#8A8F9A'; ctx.font = '9px system-ui'; ctx.textAlign = 'left'; ctx.fillText('Imbalance ' + label, 4, 11);
}

export function drawDepth(canvas, agg) {
  const { ctx, w, h } = setup(canvas);
  ctx.fillStyle = '#12151c'; ctx.fillRect(0, 0, w, h);
  const foot = 14, H = h - foot;
  const mi = Math.floor(agg.mid / agg.step) - agg.b0;
  const bids = [], asks = [];
  let c = 0;
  for (let i = Math.min(mi, agg.nb - 1); i >= 0; i--) { c += agg.buy[i]; bids.push(c); }
  c = 0;
  for (let i = Math.max(mi + 1, 0); i < agg.nb; i++) { c += agg.sell[i]; asks.push(c); }
  const max = Math.max(bids[bids.length - 1] || 0, asks[asks.length - 1] || 0, 1);
  const half = w / 2;
  const area = (arr, dir, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(half, H);
    arr.forEach((v, i) => ctx.lineTo(half + dir * ((i + 1) / Math.max(arr.length, 1)) * half, H - (v / max) * (H - 4)));
    ctx.lineTo(half + dir * half, H); ctx.closePath(); ctx.fill();
  };
  area(bids, -1, 'rgba(143,227,210,.35)'); area(asks, 1, 'rgba(242,112,79,.35)');
  ctx.strokeStyle = '#E6E8EC'; ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, H); ctx.stroke();
  ctx.fillStyle = '#8A8F9A'; ctx.font = '9px ui-monospace,monospace';
  ctx.textAlign = 'left'; ctx.fillText(fmtPrice(agg.lo).replace(/,\d+$/, ''), 3, h - 3);
  ctx.textAlign = 'center'; ctx.fillText(fmtPrice(agg.mid).replace(/,\d+$/, ''), half, h - 3);
  ctx.textAlign = 'right'; ctx.fillText(fmtPrice(agg.hi).replace(/,\d+$/, ''), w - 3, h - 3);
}
