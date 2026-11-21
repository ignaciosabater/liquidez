import test from 'node:test';
import assert from 'node:assert/strict';
import { BinanceSpotSync, BinancePerpSync, applyOkx, applyBybit, applyHl, applyRest, hlNSigFigs, OKX_CTVAL_FALLBACK } from '../js/booksync.js';
import { newBook } from '../js/aggregate.js';

const snap = (id) => ({ lastUpdateId: id, bids: [['100', '1'], ['99', '2']], asks: [['101', '1'], ['102', '2']] });

test('Binance spot: descarta eventos viejos y aplica el primero válido', () => {
  const b = newBook(), s = new BinanceSpotSync(b);
  assert.equal(s.onEvent({ U: 90, u: 95, b: [['100', '9']], a: [] }), 'buffered'); // viejo (u < 101)
  assert.equal(s.onEvent({ U: 98, u: 103, b: [['100', '5']], a: [['101', '0']] }), 'buffered'); // cubre 101
  assert.equal(s.onEvent({ U: 104, u: 105, b: [['98', '3']], a: [] }), 'buffered');
  assert.equal(s.setSnapshot(snap(100)), 'ok');
  assert.equal(b.bids.get(100), 5);          // evento aplicado sobre el snapshot
  assert.equal(b.asks.has(101), false);       // cantidad 0 borra el nivel
  assert.equal(b.bids.get(98), 3);
  assert.equal(b.bids.has(99), true);
});

test('Binance spot: huecos piden otro snapshot', () => {
  const b = newBook(), s = new BinanceSpotSync(b);
  s.setSnapshot(snap(100));
  assert.equal(s.onEvent({ U: 101, u: 102, b: [], a: [] }), 'ok');
  assert.equal(s.onEvent({ U: 105, u: 106, b: [], a: [] }), 'gap');
});

test('Binance spot: primer evento posterior al snapshot sin cubrirlo es hueco', () => {
  const b = newBook(), s = new BinanceSpotSync(b);
  s.onEvent({ U: 110, u: 112, b: [], a: [] });
  assert.equal(s.setSnapshot(snap(100)), 'gap');
});

test('Binance perp: continuidad con pu', () => {
  const b = newBook(), s = new BinancePerpSync(b);
  s.setSnapshot(snap(100));
  assert.equal(s.onEvent({ U: 99, u: 101, pu: 98, b: [['100', '4']], a: [] }), 'ok');
  assert.equal(s.onEvent({ U: 102, u: 103, pu: 101, b: [], a: [] }), 'ok');
  assert.equal(s.onEvent({ U: 105, u: 106, pu: 104, b: [], a: [] }), 'gap');
  assert.equal(b.bids.get(100), 4);
});

test('OKX: tamaños en contratos × ctVal y snapshot limpia', () => {
  const b = newBook();
  const ct = OKX_CTVAL_FALLBACK.BTC;
  applyOkx(b, { arg: { channel: 'books' }, action: 'snapshot', data: [{ bids: [['100', '300', '0', '1']], asks: [['101', '50', '0', '1']] }] }, ct);
  assert.equal(b.bids.get(100), 3);      // 300 contratos × 0,01 BTC
  assert.equal(b.asks.get(101), 0.5);
  applyOkx(b, { arg: { channel: 'books' }, action: 'update', data: [{ bids: [['100', '0', '0', '0']], asks: [] }] }, ct);
  assert.equal(b.bids.has(100), false);
  applyOkx(b, { arg: { channel: 'books' }, action: 'snapshot', data: [{ bids: [['90', '1']], asks: [['91', '1']] }] }, ct);
  assert.equal(b.asks.has(101), false);
});

test('Bybit: snapshot (o u==1) limpia; deltas aplican', () => {
  const b = newBook();
  applyBybit(b, { topic: 'orderbook.1000.BTCUSDT', type: 'snapshot', data: { b: [['100', '1']], a: [['101', '1']], u: 5 } });
  applyBybit(b, { topic: 'orderbook.1000.BTCUSDT', type: 'delta', data: { b: [['100', '0'], ['99', '2']], a: [], u: 6 } });
  assert.deepEqual([...b.bids], [[99, 2]]);
  applyBybit(b, { topic: 'orderbook.1000.BTCUSDT', type: 'delta', data: { b: [['50', '1']], a: [['51', '1']], u: 1 } });
  assert.deepEqual([...b.bids], [[50, 1]]);
});

test('Hyperliquid: nSigFigs según rango y lectura de niveles', () => {
  assert.equal(hlNSigFigs(100000, 1000), 4);   // ±1 % de BTC
  assert.equal(hlNSigFigs(100000, 100), 5);    // ±0,1 %
  assert.equal(hlNSigFigs(100000, 5000), 3);
  assert.equal(hlNSigFigs(100000, 50000), 2);
  const b = newBook();
  applyHl(b, { channel: 'l2Book', data: { levels: [[{ px: '99990', sz: '1', n: 2 }], [{ px: '100010', sz: '2', n: 1 }]] } });
  assert.equal(b.bids.get(99990), 1);
  assert.equal(b.asks.get(100010), 2);
});

test('Coinbase/Bitstamp REST: libro completo, tolera datos rotos', () => {
  const b = newBook();
  assert.equal(applyRest(b, { bids: [['10', '1', 1]], asks: [['11', '2', 1]] }), true);
  assert.equal(b.asks.get(11), 2);
  assert.equal(applyRest(b, { message: 'error' }), false);
  assert.equal(b.asks.get(11), 2);
});
