// Conexiones de red a los 7 libros públicos (sin claves). Toda la lógica de formato vive en booksync.js
import { newBook, EX } from './aggregate.js';
import { BinanceSpotSync, BinancePerpSync, applyBybit, applyOkx, applyHl, applyRest, hlNSigFigs, applyLevels, OKX_CTVAL_FALLBACK } from './booksync.js';

export const SRC_NOTE = 'Binance, Bybit y OKX solo publican los niveles cercanos (±1–5 %); Coinbase y Bitstamp, el libro completo; Hyperliquid agrupa precios.';

function ws(url, { onOpen, onMessage, onStatus, pingMsg }) {
  let sock, retry = 0, timer, ping, closed = false;
  const connect = () => {
    if (closed) return;
    onStatus('connecting');
    try { sock = new WebSocket(url); } catch (e) { onStatus('retry', e.message); schedule(); return; }
    sock.onopen = () => {
      retry = 0; onStatus('ok');
      if (pingMsg) ping = setInterval(() => { try { sock.readyState === 1 && sock.send(pingMsg); } catch { /* ignorar */ } }, 20000);
      onOpen && onOpen(sock);
    };
    sock.onmessage = (e) => { try { onMessage(e.data, sock); } catch (err) { /* mensaje raro: se ignora */ } };
    sock.onclose = () => { clearInterval(ping); if (!closed) { onStatus('retry'); schedule(); } };
    sock.onerror = () => { try { sock.close(); } catch { /* ignorar */ } };
  };
  const schedule = () => { const d = Math.min(20, 2 ** retry) * 1000; retry++; timer = setTimeout(connect, d); };
  connect();
  return {
    send: (m) => { try { sock && sock.readyState === 1 && sock.send(m); } catch { /* ignorar */ } },
    close: () => { closed = true; clearTimeout(timer); clearInterval(ping); try { sock && sock.close(); } catch { /* ignorar */ } },
    reconnect: () => { try { sock && sock.close(); } catch { /* ignorar */ } },
  };
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/**
 * Arranca las fuentes activas. Devuelve {books, stop, setEnabled, onRange}.
 * Al parar (stop) cualquier mensaje tardío se ignora (contador de generación).
 */
export function startFeeds({ sym, enabled, getMaxDist, onStatus, getMid }) {
  let alive = true;
  const base = sym, lower = sym.toLowerCase();
  const books = Object.fromEntries(EX.map((k) => [k, newBook()]));
  const conns = {}, timers = {};
  const st = (k) => (s, msg) => alive && onStatus(k, s, msg);

  const starters = {
    binance() {
      const sync = new BinanceSpotSync(books.binance);
      let sock;
      const snapshot = async () => {
        try {
          const s = await getJson(`https://data-api.binance.vision/api/v3/depth?symbol=${base}USDT&limit=5000`);
          if (!alive) return;
          if (sync.setSnapshot(s) === 'gap') { sync.reset(); setTimeout(snapshot, 1000); }
        } catch (e) { st('binance')('retry', 'snapshot: ' + e.message); setTimeout(() => alive && snapshot(), 3000); }
      };
      const c = ws(`wss://data-stream.binance.vision/ws/${lower}usdt@depth@100ms`, {
        onStatus: st('binance'),
        onOpen: () => { sync.reset(); snapshot(); },
        onMessage: (d) => {
          if (!alive) return;
          const j = JSON.parse(d);
          if (j.e !== 'depthUpdate') return;
          const r = sync.onEvent({ U: j.U, u: j.u, b: j.b, a: j.a });
          if (r === 'gap') { sync.reset(); snapshot(); }
        },
      });
      return c;
    },
    binancePerp() {
      const sync = new BinancePerpSync(books.binancePerp);
      let fails = 0, fallback = false, c;
      const snapshot = async () => {
        try {
          const s = await getJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${base}USDT&limit=1000`);
          if (!alive) return;
          if (sync.setSnapshot(s) === 'gap') {
            sync.reset();
            if (++fails >= 3) { fallback = true; c.reconnect(); return; }
            setTimeout(snapshot, 1000);
          }
        } catch (e) { st('binancePerp')('retry', 'snapshot: ' + e.message); setTimeout(() => alive && snapshot(), 3000); }
      };
      const open = () => ws(`wss://fstream.binance.com/ws/${lower}usdt@depth${fallback ? '20' : ''}@500ms`, {
        onStatus: st('binancePerp'),
        onOpen: () => { if (!fallback) { sync.reset(); snapshot(); } },
        onMessage: (d) => {
          if (!alive) return;
          const j = JSON.parse(d);
          if (fallback) { // depth20: cada mensaje es un libro completo
            if (j.b && j.a) { books.binancePerp.bids.clear(); books.binancePerp.asks.clear(); applyLevels(books.binancePerp.bids, j.b); applyLevels(books.binancePerp.asks, j.a); }
            return;
          }
          if (j.e !== 'depthUpdate') return;
          const r = sync.onEvent({ U: j.U, u: j.u, pu: j.pu, b: j.b, a: j.a });
          if (r === 'gap') { sync.reset(); snapshot(); }
        },
      });
      c = open();
      return c;
    },
    bybit() {
      const topic = `orderbook.1000.${base}USDT`;
      return ws('wss://stream.bybit.com/v5/public/linear', {
        onStatus: st('bybit'), pingMsg: '{"op":"ping"}',
        onOpen: (s) => { books.bybit.bids.clear(); books.bybit.asks.clear(); s.send(JSON.stringify({ op: 'subscribe', args: [topic] })); },
        onMessage: (d) => { if (alive) applyBybit(books.bybit, JSON.parse(d)); },
      });
    },
    okx() {
      let ctVal = OKX_CTVAL_FALLBACK[base] || 1;
      const instId = `${base}-USDT-SWAP`;
      getJson(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`)
        .then((j) => { const v = +j.data?.[0]?.ctVal; if (v > 0) ctVal = v; }).catch(() => {});
      return ws('wss://ws.okx.com:8443/ws/v5/public', {
        onStatus: st('okx'), pingMsg: 'ping',
        onOpen: (s) => { books.okx.bids.clear(); books.okx.asks.clear(); s.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'books', instId }] })); },
        onMessage: (d) => { if (alive && d !== 'pong') applyOkx(books.okx, JSON.parse(d), ctVal); },
      });
    },
    hl() {
      let n = null, sock;
      const sub = (s, type) => s.send(JSON.stringify({ method: type, subscription: { type: 'l2Book', coin: base, nSigFigs: n } }));
      const c = ws('wss://api.hyperliquid.xyz/ws', {
        onStatus: st('hl'),
        onOpen: (s) => { sock = s; const m = getMid(); n = hlNSigFigs(m || 1e5, getMaxDist()); books.hl.bids.clear(); books.hl.asks.clear(); sub(s, 'subscribe'); },
        onMessage: (d) => { if (alive) applyHl(books.hl, JSON.parse(d)); },
      });
      c.onRange = () => {
        const m = getMid(); if (!m || !sock || sock.readyState !== 1) return;
        const nn = hlNSigFigs(m, getMaxDist());
        if (nn === n) return;
        sub(sock, 'unsubscribe'); n = nn; books.hl.bids.clear(); books.hl.asks.clear(); sub(sock, 'subscribe');
      };
      return c;
    },
    coinbase: () => poller('coinbase', `https://api.exchange.coinbase.com/products/${base}-USD/book?level=2`, 15000),
    bitstamp: () => poller('bitstamp', `https://www.bitstamp.net/api/v2/order_book/${lower}usd/`, 30000),
  };

  function poller(k, url, every) {
    const run = async () => {
      if (!alive) return;
      if (document.hidden) return; // solo descarga mientras la pestaña está a la vista
      try {
        const j = await getJson(url);
        if (!alive) return;
        if (applyRest(books[k], j)) st(k)('ok'); else st(k)('retry', 'respuesta inesperada');
      } catch (e) { st(k)('retry', e.message); }
    };
    st(k)('connecting');
    run();
    const id = setInterval(run, every);
    return { close: () => clearInterval(id), reconnect: run };
  }

  function start(k) {
    if (conns[k]) return;
    books[k].bids.clear(); books[k].asks.clear();
    conns[k] = starters[k]();
  }
  function stopOne(k) {
    if (conns[k]) { conns[k].close(); delete conns[k]; }
    books[k].bids.clear(); books[k].asks.clear();
    onStatus(k, 'off');
  }
  EX.forEach((k) => (enabled[k] ? start(k) : onStatus(k, 'off')));

  return {
    books,
    setEnabled(k, on) { on ? start(k) : stopOne(k); },
    onRange() { conns.hl && conns.hl.onRange && conns.hl.onRange(); },
    stop() { alive = false; Object.keys(conns).forEach((k) => conns[k].close()); },
  };
}
