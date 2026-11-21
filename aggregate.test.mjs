import test from 'node:test';
import assert from 'node:assert/strict';
import { niceStep, aggregate, windowFor, stepFor, pickMid, newBook } from '../js/aggregate.js';
import { computeTop20, fngClass } from '../js/global.js';

const mk = (bids, asks) => { const b = newBook(); bids.forEach(([p, q]) => b.bids.set(p, q)); asks.forEach(([p, q]) => b.asks.set(p, q)); return b; };

test('niceStep redondea a 1, 2, 2,5, 5, 10 × 10^n', () => {
  assert.equal(niceStep(0.9), 1);
  assert.equal(niceStep(1.7), 2);
  assert.equal(niceStep(2.3), 2.5);
  assert.equal(niceStep(4.1), 5);
  assert.equal(niceStep(7), 10);
  assert.equal(niceStep(63), 100);
  assert.equal(niceStep(0.03), 0.05);
});

test('mid sale del primer libro listo por orden de prioridad', () => {
  const books = { binance: mk([[100, 1]], [[102, 1]]), bybit: mk([[10, 1]], [[12, 1]]), binancePerp: newBook() };
  const m = pickMid(books);
  assert.equal(m.src, 'binance');
  assert.equal(m.mid, 101);
  books.binancePerp = mk([[200, 1]], [[202, 1]]);
  assert.equal(pickMid(books).mid, 201);
});

test('ventana ampliada un 30 % y tramo ≈ ancho/160', () => {
  const w = windowFor(100000, 1);
  assert.ok(Math.abs(w.lo - 98700) < 1e-6 && Math.abs(w.hi - 101300) < 1e-6);
  assert.equal(stepFor(w.lo, w.hi), 20); // 2600/160 = 16,25 → 20
  const c = windowFor(100000, 1, { min: 99000, max: 101000 });
  assert.ok(Math.abs(c.lo - 98700) < 1e-6);
});

test('agregación por tramos y por exchange, en dólares', () => {
  const books = {
    binance: mk([[99990, 1], [99800, 2]], [[100010, 1], [100200, 3]]),
    bybit: mk([[99990, 1]], [[100010, 2]]),
  };
  const mid = 100000;
  const win = windowFor(mid, 1);
  const step = 100;
  const a = aggregate(books, win, step, mid);
  const idx = (p) => Math.floor(p / step) - a.b0;
  assert.equal(a.buy[idx(99990)], 99990 * 2);          // 1 BTC binance + 1 BTC bybit
  assert.equal(a.sell[idx(100010)], 100010 * 3);
  assert.equal(a.perEx.bybit[idx(99990)], 99990);
  assert.deepEqual(a.exs, ['binance', 'bybit']);
});

test('imbalance por bandas = (B − A)/(B + A) y solo las que caben', () => {
  const books = { binance: mk([[99950, 3], [99000, 1]], [[100050, 1], [101000, 1]]) };
  const mid = 100000;
  const a = aggregate(books, windowFor(mid, 1), 100, mid);
  assert.deepEqual(a.bands.map((b) => b.pct), [0.1, 0.25, 0.5, 1]); // ±1,3 % de ventana
  const b01 = a.bands.find((b) => b.pct === 0.1);
  assert.equal(b01.B, 99950 * 3);
  assert.equal(b01.A, 100050);
  assert.ok(Math.abs(b01.imb - (99950 * 3 - 100050) / (99950 * 3 + 100050)) < 1e-12);
  const b1 = a.bands.find((b) => b.pct === 1);
  assert.equal(b1.B, 99950 * 3 + 99000); // 99000 está justo en −1 %
  assert.equal(b1.A, 100050 + 101000);
  assert.ok(Math.abs(b1.ex.binance.B - b1.B) < 1e-9);
});

test('alcance de cada libro = compra más baja y venta más alta', () => {
  const a = aggregate({ okx: mk([[99000, 1], [99900, 1]], [[100100, 1], [100500, 1]]) }, windowFor(100000, 1), 100, 100000);
  assert.deepEqual(a.reach.okx, { lowBid: 99000, highAsk: 100500 });
});

test('Top 20 quita estables y envueltas y pondera el cambio 24 h', () => {
  const coins = [
    { symbol: 'btc', market_cap: 1000, price_change_percentage_24h: 10 },
    { symbol: 'usdt', market_cap: 500, price_change_percentage_24h: 0 },
    { symbol: 'eth', market_cap: 500, price_change_percentage_24h: -10 },
    { symbol: 'wbtc', market_cap: 300, price_change_percentage_24h: 10 },
  ];
  const t = computeTop20(coins);
  assert.equal(t.n, 2);
  assert.equal(t.cap, 1500);
  const expected = (1500 / (1000 / 1.1 + 500 / 0.9) - 1) * 100;
  assert.ok(Math.abs(t.change24h - expected) < 1e-9);
});

test('clases de Miedo y Codicia', () => {
  assert.equal(fngClass(10), 'Miedo extremo');
  assert.equal(fngClass(30), 'Miedo');
  assert.equal(fngClass(50), 'Neutral');
  assert.equal(fngClass(60), 'Codicia');
  assert.equal(fngClass(90), 'Codicia extrema');
  assert.equal(fngClass(100), 'Codicia extrema');
});
