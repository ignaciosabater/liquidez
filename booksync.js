// Lógica pura de sincronización y lectura de libros (sin red ni DOM, para poder probarla)

export function applyLevels(map, levels) {
  for (const l of levels) {
    const p = +l[0], q = +l[1];
    if (!(p > 0)) continue;
    if (q === 0 || !Number.isFinite(q)) map.delete(p);
    else map.set(p, q);
  }
}

function fillSnapshot(book, snap) {
  book.bids.clear(); book.asks.clear();
  applyLevels(book.bids, snap.bids || []);
  applyLevels(book.asks, snap.asks || []);
}

/** Binance spot: procedimiento oficial de sincronización con snapshot + buffer */
export class BinanceSpotSync {
  constructor(book) { this.book = book; this.reset(); }
  reset() {
    this.book.bids.clear(); this.book.asks.clear();
    this.buf = []; this.lastId = null; this.first = true; this.prevU = null; this.hasSnap = false;
  }
  onEvent(e) { // e: {U,u,b,a}
    if (!this.hasSnap) { this.buf.push(e); return 'buffered'; }
    return this._apply(e);
  }
  setSnapshot(s) { // {lastUpdateId,bids,asks}
    fillSnapshot(this.book, s);
    this.lastId = s.lastUpdateId; this.hasSnap = true; this.first = true;
    const b = this.buf; this.buf = [];
    for (const e of b) { if (this._apply(e) === 'gap') return 'gap'; }
    return 'ok';
  }
  _apply(e) {
    if (e.u < this.lastId + 1) return 'stale';
    if (this.first) {
      if (e.U > this.lastId + 1) return 'gap';
      this.first = false;
    } else if (e.U !== this.prevU + 1) return 'gap';
    applyLevels(this.book.bids, e.b || []);
    applyLevels(this.book.asks, e.a || []);
    this.prevU = e.u;
    return 'ok';
  }
}

/** Binance futuros: continuidad con pu == u anterior */
export class BinancePerpSync extends BinanceSpotSync {
  _apply(e) {
    if (e.u < this.lastId) return 'stale';
    if (this.first) {
      if (e.U > this.lastId || e.u < this.lastId) return 'gap';
      this.first = false;
    } else if (e.pu !== this.prevU) return 'gap';
    applyLevels(this.book.bids, e.b || []);
    applyLevels(this.book.asks, e.a || []);
    this.prevU = e.u;
    return 'ok';
  }
}

/** Bybit v5: snapshot (o u==1) limpia el libro; luego deltas */
export function applyBybit(book, msg) {
  if (!msg || !msg.topic || !String(msg.topic).startsWith('orderbook') || !msg.data) return false;
  const d = msg.data;
  if (msg.type === 'snapshot' || d.u === 1) { book.bids.clear(); book.asks.clear(); }
  applyLevels(book.bids, d.b || []);
  applyLevels(book.asks, d.a || []);
  return true;
}

/** OKX: tamaños en CONTRATOS → multiplicar por ctVal */
export function applyOkx(book, msg, ctVal) {
  if (!msg || !msg.arg || msg.arg.channel !== 'books' || !msg.data || !msg.data[0]) return false;
  const d = msg.data[0];
  if (msg.action === 'snapshot') { book.bids.clear(); book.asks.clear(); }
  const conv = (arr) => (arr || []).map((l) => [l[0], +l[1] === 0 ? 0 : +l[1] * ctVal]);
  applyLevels(book.bids, conv(d.bids));
  applyLevels(book.asks, conv(d.asks));
  return true;
}

export const OKX_CTVAL_FALLBACK = { BTC: 0.01, ETH: 0.1 };

/** Hyperliquid: solo 20 niveles por lado. Elige nSigFigs (5,4,3,2) según el rango visible */
export function hlNSigFigs(price, maxDist) {
  const e = Math.floor(Math.log10(price));
  for (const n of [5, 4, 3, 2]) {
    if (20 * Math.pow(10, e - n + 1) >= maxDist) return n;
  }
  return 2;
}
export function applyHl(book, msg) {
  if (!msg || msg.channel !== 'l2Book' || !msg.data || !msg.data.levels) return false;
  const [b, a] = msg.data.levels;
  book.bids.clear(); book.asks.clear();
  applyLevels(book.bids, b.map((l) => [l.px, l.sz]));
  applyLevels(book.asks, a.map((l) => [l.px, l.sz]));
  return true;
}

/** Coinbase / Bitstamp: libro completo por REST */
export function applyRest(book, data) {
  if (!data || !Array.isArray(data.bids) || !Array.isArray(data.asks)) return false;
  fillSnapshot(book, data);
  return true;
}
