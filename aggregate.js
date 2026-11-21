// Agregación del libro de órdenes de varias fuentes (lógica pura, sin DOM)
export const BANDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50];
export const EX = ['binancePerp', 'binance', 'bybit', 'okx', 'hl', 'coinbase', 'bitstamp'];
export const EX_LABEL = {
  binancePerp: 'Binance Perp', binance: 'Binance', bybit: 'Bybit', okx: 'OKX',
  hl: 'Hyperliquid', coinbase: 'Coinbase', bitstamp: 'Bitstamp',
};
export const EX_COLOR = {
  binancePerp: '#F0B90B', binance: '#C99A06', bybit: '#F7A600', okx: '#E6E8EC',
  hl: '#8FE3D2', coinbase: '#3B6FF5', bitstamp: '#2FB66B',
};

export function niceStep(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / e;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * e;
}

export const newBook = () => ({ bids: new Map(), asks: new Map() });
export const isReady = (b) => !!b && b.bids.size > 0 && b.asks.size > 0;

export function bestBidAsk(book) {
  let bid = -Infinity, ask = Infinity;
  for (const p of book.bids.keys()) if (p > bid) bid = p;
  for (const p of book.asks.keys()) if (p < ask) ask = p;
  return { bid, ask };
}

// mid del primer libro listo, en el orden de prioridad pedido
export function pickMid(books) {
  for (const k of EX) {
    const b = books[k];
    if (!isReady(b)) continue;
    const { bid, ask } = bestBidAsk(b);
    if (Number.isFinite(bid) && Number.isFinite(ask) && ask >= bid) {
      return { mid: (bid + ask) / 2, bid, ask, src: k };
    }
  }
  return null;
}

// Ventana visible ampliada un 30 % por cada lado (sobre la mitad del rango)
export function windowFor(mid, rangePct, custom) {
  let lo, hi;
  if (custom && custom.min > 0 && custom.max > custom.min) {
    lo = custom.min; hi = custom.max;
  } else {
    lo = mid * (1 - rangePct / 100); hi = mid * (1 + rangePct / 100);
  }
  const half = (hi - lo) / 2;
  return { vlo: lo, vhi: hi, lo: Math.max(0, lo - 0.3 * half), hi: hi + 0.3 * half };
}

export function stepFor(lo, hi) {
  return niceStep((hi - lo) / 160);
}

/**
 * books: {ex:{bids:Map,asks:Map}}; win: {lo,hi}; step fijo; mid.
 * Devuelve tramos (buy, sell, perEx), bandas de imbalance y alcance de cada libro.
 */
export function aggregate(books, win, step, mid) {
  const { lo, hi } = win;
  const b0 = Math.floor(lo / step);
  const nb = Math.ceil(hi / step) - b0 + 1;
  const buy = new Float64Array(nb), sell = new Float64Array(nb);
  const perEx = {}, reach = {}, exs = [];
  const halfPct = (Math.min(mid - lo, hi - mid) / mid) * 100;
  const bandList = BANDS.filter((b) => b <= halfPct + 1e-9);
  const nBands = BANDS.length;
  const Bt = new Float64Array(nBands), At = new Float64Array(nBands);
  const BtEx = {}, AtEx = {};

  for (const k of EX) {
    const bk = books[k];
    if (!isReady(bk)) continue;
    exs.push(k);
    const arr = new Float64Array(nb);
    const bB = new Float64Array(nBands), bA = new Float64Array(nBands);
    let lowBid = Infinity, highAsk = -Infinity;
    for (const [p, q] of bk.bids) {
      if (p < lowBid) lowBid = p;
      const usd = p * q;
      const d = ((mid - p) / mid) * 100;
      for (let j = 0; j < nBands; j++) if (d <= BANDS[j]) { bB[j] += usd; break; }
      if (p >= lo && p < hi) { const i = Math.floor(p / step) - b0; buy[i] += usd; arr[i] += usd; }
    }
    for (const [p, q] of bk.asks) {
      if (p > highAsk) highAsk = p;
      const usd = p * q;
      const d = ((p - mid) / mid) * 100;
      for (let j = 0; j < nBands; j++) if (d <= BANDS[j]) { bA[j] += usd; break; }
      if (p >= lo && p < hi) { const i = Math.floor(p / step) - b0; sell[i] += usd; arr[i] += usd; }
    }
    for (let j = 1; j < nBands; j++) { bB[j] += bB[j - 1]; bA[j] += bA[j - 1]; }
    for (let j = 0; j < nBands; j++) { Bt[j] += bB[j]; At[j] += bA[j]; }
    BtEx[k] = bB; AtEx[k] = bA;
    perEx[k] = arr;
    reach[k] = { lowBid, highAsk };
  }

  const bandsAll = BANDS.map((pct, j) => {
    const B = Bt[j], A = At[j];
    const ex = {};
    for (const k of exs) ex[k] = { B: BtEx[k][j], A: AtEx[k][j] };
    return { pct, B, A, imb: B + A > 0 ? (B - A) / (B + A) : 0, ex };
  });
  const bands = bandsAll.filter((b) => bandList.includes(b.pct)); // solo las que caben en la ventana

  return { mid, lo, hi, step, b0, nb, buy, sell, perEx, bands, bandsAll, reach, exs };
}

export const bandImb = (agg, pct) => (agg.bandsAll || agg.bands).find((b) => b.pct === pct)?.imb;
