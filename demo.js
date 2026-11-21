// MODO DEMO (?demo=1): libros SIMULADOS para probar la pantalla sin red. No son datos de mercado.
import { EX } from './aggregate.js';

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

export function startDemo({ sym, books, enabled, onStatus }) {
  const base = sym === 'ETH' ? 3500 : 100000;
  let px = base;
  let t = 0;
  const spacing = { binancePerp: base * 0.00005, binance: base * 0.00005, bybit: base * 0.00008, okx: base * 0.00008, hl: base * 0.0001, coinbase: base * 0.0002, bitstamp: base * 0.0003 };
  const depth = { binancePerp: 0.012, binance: 0.012, bybit: 0.01, okx: 0.01, hl: 0.003, coinbase: 0.3, bitstamp: 0.3 };
  const wallLvl = [[0.0035, 1], [-0.006, 1], [0.0065, 1]];
  const fill = () => {
    t++;
    px *= 1 + (rnd() - 0.5) * 0.0004 + Math.sin(t / 40) * 0.00004;
    for (const k of EX) {
      if (!enabled[k]) continue;
      const b = books[k]; b.bids.clear(); b.asks.clear();
      const sp = spacing[k], n = Math.min(400, Math.floor((px * depth[k]) / sp));
      const skew = 1 + 0.6 * Math.sin(t / 25);
      for (let i = 1; i <= n; i++) {
        const q = (0.2 + rnd() * 0.8) * (1 + 6 / (1 + i / 20)) * (sym === 'ETH' ? 20 : 1);
        b.bids.set(+(px - i * sp).toFixed(2), q * skew);
        b.asks.set(+(px + i * sp).toFixed(2), q / skew);
      }
      if (k === 'binancePerp' || k === 'okx') {
        for (const [d, m] of wallLvl) { const p = +(px * (1 + d)).toFixed(0); (d > 0 ? b.asks : b.bids).set(p, 60 * m * (sym === 'ETH' ? 20 : 1)); }
      }
      onStatus(k, 'ok');
    }
  };
  EX.forEach((k) => onStatus(k, enabled[k] ? 'connecting' : 'off'));
  fill();
  const id = setInterval(fill, 1000);
  return { books, setEnabled(k, on) { enabled[k] = on; if (!on) { books[k].bids.clear(); books[k].asks.clear(); onStatus(k, 'off'); } }, onRange() {}, stop() { clearInterval(id); } };
}

export const demoGlobal = () => ({
  g: { ok: true, data: { total_market_cap: { usd: 3.21e12 }, market_cap_change_percentage_24h_usd: -1.84 } },
  m: { ok: true, data: Array.from({ length: 40 }, (_, i) => ({ symbol: i === 1 ? 'usdt' : 's' + i, market_cap: 1e12 / (i + 1), price_change_percentage_24h: -2 + (i % 5) })) },
  f: { ok: true, data: [{ value: '34' }] },
  t: { ok: true, coins: [] , data: Array.from({ length: 8 }, (_, i) => ({ item: { symbol: 'DEMO' + (i + 1), name: 'Moneda simulada ' + (i + 1), thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', data: { price: 1 + i * 0.37, price_change_percentage_24h: { usd: (i - 3) * 1.7 } } } })) },
});
