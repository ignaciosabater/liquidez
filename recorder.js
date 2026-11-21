// Grabadora del libro: IndexedDB, bloques de 60 filas, máximo 120 bloques
const DB = 'liquidez-rec', STORE = 'bloques', BLOCK = 60, MAX_BLOCKS = 120;

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** [desplazamiento, enteros…] sin ceros en los extremos */
export function packArr(arr) {
  let a = 0, b = arr.length - 1;
  while (a <= b && !arr[a]) a++;
  while (b >= a && !arr[b]) b--;
  if (a > b) return [0];
  const out = [a];
  for (let i = a; i <= b; i++) out.push(Math.round(arr[i]));
  return out;
}
export function unpackArr(p, n) {
  const out = new Array(n).fill(0);
  for (let i = 1; i < p.length; i++) out[p[0] + i - 1] = p[i];
  return out;
}

export class Recorder {
  constructor() { this.on = false; this.buf = []; this.count = 0; this.t0 = null; this.sym = null; this.error = null; this.db = null; }
  async start(sym) {
    try { this.db = await open(); } catch (e) { this.error = 'IndexedDB no disponible: ' + e.message; throw e; }
    this.on = true; this.sym = sym; this.t0 = Date.now(); this.error = null;
    const n = await wrap(tx(this.db, 'readonly').count());
    this.count = n * BLOCK;
  }
  stop() { this.on = false; this.flush(); }
  push(agg, bestBid, bestAsk, t = Date.now()) {
    if (!this.on) return;
    this.buf.push({
      t, mid: agg.mid, mejorCompra: bestBid, mejorVenta: bestAsk, tramo: agg.step, b0: agg.b0,
      compras: packArr(agg.buy), ventas: packArr(agg.sell), n: agg.exs.length,
    });
    this.count++;
    if (this.buf.length >= BLOCK) this.flush();
  }
  async flush() {
    if (!this.db || !this.buf.length) return;
    const rows = this.buf; this.buf = [];
    try {
      const s = tx(this.db, 'readwrite');
      await wrap(s.add({ sym: this.sym, rows }));
      const s2 = tx(this.db, 'readwrite');
      const keys = await wrap(s2.getAllKeys());
      if (keys.length > MAX_BLOCKS) for (const k of keys.slice(0, keys.length - MAX_BLOCKS)) await wrap(tx(this.db, 'readwrite').delete(k));
    } catch (e) { this.error = e.message; }
  }
  async export() {
    await this.flush();
    this.db = this.db || (await open());
    const all = await wrap(tx(this.db, 'readonly').getAll());
    const filas = all.flatMap((b) => b.rows);
    const sym = all.length ? all[all.length - 1].sym : this.sym;
    return JSON.stringify({ formato: 'libro', version: 1, sym, filas });
  }
  async clear() {
    this.db = this.db || (await open());
    await wrap(tx(this.db, 'readwrite').clear());
    this.buf = []; this.count = 0;
  }
  status() {
    if (this.error) return 'Error: ' + this.error;
    if (!this.on) return 'Grabadora del libro parada';
    const min = Math.floor((Date.now() - this.t0) / 60000);
    return `Grabando · ${min} min · ${this.count} muestras`;
  }
}
