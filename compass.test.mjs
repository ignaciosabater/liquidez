import test from 'node:test';
import assert from 'node:assert/strict';
import { Compass, computeLevels, calibrate, sdLog, M } from '../js/compass.js';
import { aggregate, windowFor, newBook } from '../js/aggregate.js';

// libro sintético: tramos de 10 $, liquidez plana, con sesgo configurable
function makeAgg(mid, { bidMul = 1, askMul = 1, walls = [] } = {}) {
  const b = newBook();
  for (let k = 1; k <= 150; k++) {
    b.bids.set(mid - k * 10, 1 * bidMul);
    b.asks.set(mid + k * 10, 1 * askMul);
  }
  for (const [p, q] of walls) (p < mid ? b.bids : b.asks).set(p, q);
  const win = windowFor(mid, 1);
  return aggregate({ binance: b }, win, 10, mid);
}
const store = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };

test('sdLog calcula la desviación de log-retornos', () => {
  assert.equal(sdLog([1]), null);
  const sd = sdLog([100, 101, 100, 101, 100]);
  assert.ok(sd > 0.009 && sd < 0.011);
});

test('niveles: el orden VALIDA → objetivo y INVALIDA en sentido contrario (alcista y bajista)', () => {
  for (const dir of [1, -1]) {
    const lv = computeLevels({ dir, mid: 100000, sig: 0.002, score: 0.2 * dir, walls: [], step: 10 });
    const d = (x) => (x - 100000) * dir;
    assert.ok(d(lv.target) > 0);
    assert.ok(d(lv.valid) > 0 && d(lv.valid) < d(lv.target));
    assert.ok(d(lv.invalid) < 0);
    assert.ok(Math.abs(d(lv.valid) / d(lv.target) - 0.35) < 1e-9);
    assert.ok(Math.abs(d(lv.invalid) / d(lv.target) + 0.7) < 1e-9);
  }
});

test('niveles: muro a favor fija el objetivo; muro de apoyo fija la invalidación', () => {
  const mid = 100000, sig = 0.002;
  const mov = mid * sig * (0.55 + 0.9 * 0.4); // score 0.2 → min(1,0.4)
  const walls = [
    { price: mid + mov, size: 50, rel: 10, trust: 1, side: 1, key: 1 },
    { price: mid - 100, size: 30, rel: 6, trust: 1, side: -1, key: 2 },
  ];
  const lv = computeLevels({ dir: 1, mid, sig, score: 0.2, walls, step: 10 });
  assert.equal(lv.target, mid + mov - 10);
  assert.equal(lv.targetWall, walls[0]);
  assert.equal(lv.invalidWall, walls[1]);
  assert.ok(lv.invalid < mid - 100); // detrás del muro de apoyo
});

test('calibración: sin casos ≈ probBruta (acotada); con muchos fallos baja', () => {
  const cal = M.map(() => Array.from({ length: 10 }, () => ({ n: 0, hit: 0 })));
  assert.equal(calibrate(cal, 0, 0.7), 0.7);
  assert.equal(calibrate(cal, 0, 0.95), 0.9);
  cal[0][4] = { n: 100, hit: 40 }; // probBruta 0,7 → cajón 4
  const p = calibrate(cal, 0, 0.7);
  assert.ok(p < 0.7 && p > 0.4);
});

test('señales: libro con más compras → puntuación y dirección alcistas', () => {
  const c = new Compass({ storage: store() });
  c.setKlines(Array.from({ length: 100 }, (_, i) => 100000 * (1 + 0.0005 * Math.sin(i))));
  let v;
  for (let t = 0; t < 5; t++) v = c.tick(1_000_000 + t * 1000, makeAgg(100000, { bidMul: 4 }));
  assert.ok(v[0].signals.near > 0.5);
  assert.ok(v[0].score > 0 && v[0].dir === 1);
  assert.ok(v[0].prob > 0.5 && v[0].prob <= 0.9);
  assert.ok(v[0].target > 100000 && v[0].valid > 100000 && v[0].invalid < 100000);
  const c2 = new Compass({ storage: store() });
  c2.setKlines(Array.from({ length: 100 }, (_, i) => 100000 * (1 + 0.0005 * Math.sin(i))));
  let v2;
  for (let t = 0; t < 5; t++) v2 = c2.tick(1_000_000 + t * 1000, makeAgg(100000, { askMul: 4 }));
  assert.equal(v2[0].dir, -1);
});

test('ciclo de vida: toca VALIDA → confirmada; toca INVALIDA → fallo y nace otra', () => {
  const c = new Compass({ storage: store() });
  c.setKlines(Array.from({ length: 100 }, (_, i) => 100000 * (1 + 0.0005 * Math.sin(i))));
  let t = 2_000_000, v;
  for (let k = 0; k < 3; k++, t += 1000) v = c.tick(t, makeAgg(100000, { bidMul: 4 }));
  const r = v[0];
  // el precio sube hasta VALIDA
  const midUp = Math.ceil(r.valid) + 10;
  v = c.tick(t, makeAgg(midUp, { bidMul: 4 })); t += 1000;
  assert.equal(v[0].confirmed, true);
  assert.ok(v[0].prob >= 0.55);
  const frozen = v[0].valid;
  v = c.tick(t, makeAgg(midUp + 10, { bidMul: 4 })); t += 1000;
  assert.equal(v[0].valid, frozen); // niveles congelados

  // otra brújula: precio cae por debajo de INVALIDA
  const d = new Compass({ storage: store() });
  d.setKlines(Array.from({ length: 100 }, (_, i) => 100000 * (1 + 0.0005 * Math.sin(i))));
  let t2 = 3_000_000, w;
  for (let k = 0; k < 3; k++, t2 += 1000) w = d.tick(t2, makeAgg(100000, { bidMul: 4 }));
  const inv = w[0].invalid;
  w = d.tick(t2, makeAgg(Math.floor(inv) - 10, { bidMul: 4 }));
  assert.match(w[0].flash, /invalidada · nueva/);
  assert.equal(d.stats[0].n, 1);
  assert.equal(d.stats[0].hit, 0);
});

test('ciclo de vida: al caducar se juzga acierto/fallo por el signo del movimiento', () => {
  const c = new Compass({ storage: store() });
  c.setKlines(Array.from({ length: 100 }, (_, i) => 100000 * (1 + 0.0005 * Math.sin(i))));
  let t = 5_000_000, v;
  v = c.tick(t, makeAgg(100000, { bidMul: 4 }));
  const exp = t + 60_000;
  // el precio apenas sube (sin tocar VALIDA) y caduca
  v = c.tick(exp, makeAgg(100001, { bidMul: 4 }));
  assert.match(v[0].flash, /acertó · nueva/);
  assert.deepEqual(c.stats[0], { n: 1, hit: 1 });
});

test('muros nuevos pierden confianza (trust 0,15) y maduran en 20 s', () => {
  const c = new Compass({ storage: store() });
  const wall = [[100200, 500]];
  c.tick(1_000_000, makeAgg(100000, { walls: wall }));
  let w = c._walls(1_000_000, makeAgg(100000, { walls: wall })).find((x) => x.price > 100100 && x.price < 100300);
  assert.equal(w.trust, 0.15);
  w = c._walls(1_020_000, makeAgg(100000, { walls: wall })).find((x) => x.price > 100100 && x.price < 100300);
  assert.equal(w.trust, 1);
  // si desaparece, se olvida
  c._walls(1_021_000, makeAgg(100000));
  assert.equal(c.wallSeen.size, 0);
});
