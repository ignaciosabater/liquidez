// Brújula: próximo precio para 1m, 5m, 15m, 1h y 4h. Lógica pura (sin DOM).
import { clamp, sign, tanh, mean, median } from './util.js';
import { bandImb } from './aggregate.js';

export const M = [1, 5, 15, 60, 240];
export const LBL = ['1m', '5m', '15m', '1h', '4h'];
export const W = {
  near: [0.40, 0.32, 0.24, 0.15, 0.10],
  wide: [0.12, 0.22, 0.28, 0.32, 0.32],
  flow: [0.25, 0.20, 0.16, 0.12, 0.08],
  mag: [0.13, 0.16, 0.18, 0.21, 0.23],
  inr: [0.10, 0.10, 0.14, 0.20, 0.27],
  ghost: 0.08,
};
export const CAP = [0.30, 0.28, 0.22, 0.16, 0.12];
export const SIG_NAMES = {
  near: 'Cerca (±0,1–0,25 %)', wide: 'Lejos (±0,5–2 %)', flow: 'Flujo (cambio en 60 s)',
  inr: 'Inercia del precio', mag: 'Imán de muros', ghost: 'Espejismo (muros nuevos)',
};

/** Desviación típica de log-retornos */
export function sdLog(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 2) return null;
  const m = mean(r);
  return Math.sqrt(mean(r.map((x) => (x - m) * (x - m))));
}

/** Niveles (objetivo, valida, invalida) para una dirección. Pura y exportada para pruebas. */
export function computeLevels({ dir, mid, sig, score, walls, step, symmetric = false }) {
  const mov = mid * sig * (0.55 + 0.9 * Math.min(1, Math.abs(score) * 2));
  let target = mid + dir * mov;
  let targetWall = null;
  if (!symmetric) {
    const cand = walls.filter((w) => w.side === dir && w.trust > 0.6 && Math.abs(w.price - mid) >= 0.5 * mov && Math.abs(w.price - mid) <= 2.2 * mov);
    if (cand.length) {
      targetWall = cand.reduce((a, b) => (b.size > a.size ? b : a));
      target = targetWall.price - dir * step;
    }
  }
  const dist = Math.abs(target - mid) || mid * 1e-6;

  // VALIDA: un tramo tras el primer muro en contra (en el camino al objetivo)
  let valid = mid + dir * dist * 0.35, validWall = null;
  if (!symmetric) {
    const path = walls
      .filter((w) => w.side === dir && w.trust > 0.4 && (w.price - mid) * dir > 0 && (target - w.price) * dir > 0)
      .sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid));
    if (path.length) { validWall = path[0]; valid = validWall.price + dir * step; }
  }
  valid = mid + dir * clamp(Math.abs(valid - mid) / dist, 0.15, 0.8) * dist;

  // INVALIDA: detrás del mayor muro que sostiene la idea
  let invalid = mid - dir * dist * 0.7, invalidWall = null;
  if (!symmetric) {
    const sup = walls.filter((w) => w.side === -dir && w.trust > 0.4 && Math.abs(w.price - mid) < 1.4 * dist);
    if (sup.length) {
      invalidWall = sup.reduce((a, b) => (b.size > a.size ? b : a));
      invalid = invalidWall.price - dir * mid * sig * 0.25;
    }
  }
  invalid = mid - dir * clamp(Math.abs(mid - invalid) / dist, 0.3, 1.2) * dist;
  return { mov, target, valid, invalid, targetWall, validWall, invalidWall };
}

export const bucketOf = (pb) => Math.min(9, Math.max(0, Math.floor((pb - 0.5) * 20 + 1e-9)));

export function calibrate(cal, i, pb) {
  const c = cal[i][bucketOf(pb)];
  const acc = c.n ? c.hit / c.n : 0.5;
  return clamp((c.n * acc + 25 * pb) / (c.n + 25), 0.35, 0.9);
}

const emptyCal = () => M.map(() => Array.from({ length: 10 }, () => ({ n: 0, hit: 0 })));
const emptyStats = () => M.map(() => ({ n: 0, hit: 0 }));
const KEY = 'liq.compass.v1';

export class Compass {
  constructor({ storage = null } = {}) {
    this.storage = storage;
    this.h = M.map(() => null);
    this.hist = [];
    this.imbHist = [];
    this.wallSeen = new Map();
    this.sd1m = null;
    this.cal = emptyCal();
    this.stats = emptyStats();
    this._load();
    this.sigmaNow = M.map(() => 0);
  }
  _load() {
    try {
      const j = JSON.parse(this.storage?.getItem(KEY) || 'null');
      if (j && j.cal && j.stats) { this.cal = j.cal; this.stats = j.stats; }
    } catch { /* sin almacenamiento: seguimos en memoria */ }
  }
  _save() {
    try { this.storage?.setItem(KEY, JSON.stringify({ cal: this.cal, stats: this.stats })); } catch { /* ignorar */ }
  }
  setKlines(closes) { const sd = sdLog(closes); if (sd) this.sd1m = sd; }
  reset() { this.h = M.map(() => null); this.hist = []; this.imbHist = []; this.wallSeen.clear(); }

  sigma(m) {
    if (this.sd1m) return this.sd1m * Math.sqrt(m);
    const mids = this.hist.slice(-600);
    if (mids.length >= 30) {
      const r = [];
      for (let i = 1; i < mids.length; i++) r.push(Math.log(mids[i].mid / mids[i - 1].mid));
      return Math.sqrt(mean(r.map((x) => x * x))) * Math.sqrt(60) * Math.sqrt(m) || 0.0008 * Math.sqrt(m);
    }
    return 0.0008 * Math.sqrt(m);
  }

  _midAgo(now, sec) {
    const t = now - sec * 1000;
    let best = null;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].t <= t) { best = this.hist[i]; break; }
    if (!best) {
      const o = this.hist[0];
      if (o && now - o.t >= 30000) best = o;
    }
    return best ? best.mid : null;
  }

  _walls(now, agg) {
    const tot = new Float64Array(agg.nb);
    const liquid = [];
    for (let i = 0; i < agg.nb; i++) { tot[i] = agg.buy[i] + agg.sell[i]; if (tot[i] > 0) liquid.push(tot[i]); }
    const med = median(liquid);
    const found = new Set(), walls = [];
    if (med > 0) {
      for (let i = 0; i < agg.nb; i++) {
        if (tot[i] < 3 * med) continue;
        const key = agg.b0 + i;
        found.add(key);
        if (!this.wallSeen.has(key)) this.wallSeen.set(key, now);
        const trust = clamp((now - this.wallSeen.get(key)) / 1000 / 20, 0.15, 1);
        const price = (key + 0.5) * agg.step;
        walls.push({ key, price, size: tot[i], rel: tot[i] / med, trust, side: price > agg.mid ? 1 : -1 });
      }
    }
    for (const k of [...this.wallSeen.keys()]) if (!found.has(k)) this.wallSeen.delete(k);
    return walls;
  }

  _signals(i, now, agg, walls) {
    const mid = agg.mid, m = M[i], sig = this.sigma(m);
    const avg = (arr) => { const v = arr.map((p) => bandImb(agg, p)).filter((x) => x !== undefined); return v.length ? mean(v) : 0; };
    const near = tanh(3 * avg([0.1, 0.25]));
    const wide = tanh(3 * avg([0.5, 1, 2]));
    let flow = 0;
    const cur = this.imbHist[this.imbHist.length - 1];
    const old = this.imbHist.find((s) => s.t <= now - 60000) || (this.imbHist.length >= 20 ? this.imbHist[0] : null);
    if (cur && old && cur !== old) flow = tanh(4 * (cur.v - old.v));
    let inr = 0;
    const v = Math.min(m, 5);
    const ago = this._midAgo(now, v * 60);
    if (ago) inr = tanh((1.2 * Math.log(mid / ago)) / this.sigma(v));
    // imán
    const reach = mid * sig * 2.2;
    let up = 0, dn = 0;
    const inReach = walls.filter((w) => { const d = Math.abs(w.price - mid); return d >= agg.step && d <= reach; });
    for (const w of inReach) {
      const d = Math.abs(w.price - mid);
      const pull = (w.rel / (1 + d / (mid * sig))) * w.trust;
      if (w.side > 0) up += pull; else dn += pull;
    }
    const mag = up + dn > 0 ? tanh(1.5 * ((up - dn) / (up + dn))) : 0;
    // espejismo
    let spoof = 0, relSum = 0;
    for (const w of inReach) {
      relSum += w.rel;
      if (w.trust < 0.5) spoof += w.side * w.rel * (1 - w.trust);
    }
    const ghost = relSum > 0 ? -tanh((2 * spoof) / relSum) * 0.5 : 0;
    return { near, wide, flow, inr, mag, ghost, sig, reach };
  }

  tick(now, agg) {
    const mid = agg.mid;
    this.hist.push({ t: now, mid });
    if (this.hist.length > 700) this.hist.splice(0, this.hist.length - 700);
    const vals = [0.1, 0.25, 0.5, 1].map((p) => bandImb(agg, p)).filter((x) => x !== undefined);
    if (vals.length) {
      this.imbHist.push({ t: now, v: mean(vals) });
      if (this.imbHist.length > 130) this.imbHist.splice(0, this.imbHist.length - 130);
    }
    const walls = this._walls(now, agg);
    this.view = M.map((_, i) => this._horizon(i, now, agg, walls));
    return this.view;
  }

  _compute(i, now, agg, walls) {
    const s = this._signals(i, now, agg, walls);
    const score = s.near * W.near[i] + s.wide * W.wide[i] + s.flow * W.flow[i] + s.mag * W.mag[i] + s.inr * W.inr[i] + s.ghost * W.ghost;
    return { s, score };
  }

  _judge(i, h, hit) {
    this.stats[i].n++; if (hit) this.stats[i].hit++;
    const c = this.cal[i][bucketOf(h.pb)];
    c.n++; if (hit) c.hit++;
    this._save();
  }

  _birth(i, now, agg, walls, c, flashText) {
    const mid = agg.mid;
    const prev = this.h[i];
    const ss = prev ? prev.scoreSmooth : c.score;
    const discrepant = sign(ss) !== sign(c.score);
    const useScore = discrepant ? ss : c.score;
    const dir = sign(useScore);
    const lv = computeLevels({ dir, mid, sig: c.s.sig, score: useScore, walls, step: agg.step, symmetric: discrepant });
    const pb = 0.5 + CAP[i] * tanh(2.4 * Math.abs(useScore));
    const h = {
      dir, pb, prob: calibrate(this.cal, i, pb), mid0: mid, born: now, expires: now + M[i] * 60000,
      target: lv.target, valid: lv.valid, invalid: lv.invalid, confirmed: false,
      scoreSmooth: ss, adverse: null, flash: flashText ? { text: flashText + ' · nueva', until: now + 4000 } : null,
      lv, symmetric: discrepant,
    };
    this.h[i] = h;
    return h;
  }

  _horizon(i, now, agg, walls) {
    const mid = agg.mid;
    const c = this._compute(i, now, agg, walls);
    let h = this.h[i];
    if (!h) h = this._birth(i, now, agg, walls, c, null);
    else {
      h.scoreSmooth = 0.75 * h.scoreSmooth + 0.25 * c.score;
      const touchInv = h.dir > 0 ? mid <= h.invalid : mid >= h.invalid;
      const touchVal = h.dir > 0 ? mid >= h.valid : mid <= h.valid;
      const inProfit = (mid - h.mid0) * h.dir > 0;
      if (touchInv) { this._judge(i, h, false); h = this._birth(i, now, agg, walls, c, '✕ invalidada'); }
      else if (now >= h.expires) { this._judge(i, h, inProfit); h = this._birth(i, now, agg, walls, c, inProfit ? '✓ acertó' : '✕ falló'); }
      else {
        if (touchVal && !h.confirmed) { h.confirmed = true; h.prob = Math.max(h.prob, 0.55); }
        // giro: score suave en contra durante 5 s seguidos
        const against = sign(h.scoreSmooth) !== h.dir && Math.abs(h.scoreSmooth) > 0.18;
        if (against) { if (h.adverse == null) h.adverse = now; } else h.adverse = null;
        if (h.adverse != null && now - h.adverse >= 5000) {
          this._judge(i, h, inProfit);
          h = this._birth(i, now, agg, walls, c, '↻ giro');
        } else if (!h.confirmed) {
          const lv = computeLevels({ dir: h.dir, mid, sig: c.s.sig, score: h.dir * Math.abs(c.score), walls, step: agg.step, symmetric: h.symmetric });
          h.target += 0.2 * (lv.target - h.target);
          h.valid += 0.2 * (lv.valid - h.valid);
          h.invalid += 0.2 * (lv.invalid - h.invalid);
          h.lv = lv;
        }
      }
    }
    const st = this.stats[i];
    const flash = h.flash && now < h.flash.until ? h.flash.text : null;
    return {
      i, label: LBL[i], dir: h.dir, prob: h.prob, probRaw: h.pb, mid, target: h.target, valid: h.valid, invalid: h.invalid,
      confirmed: h.confirmed, remaining: h.expires - now, flash, change: ((h.target - mid) / mid) * 100,
      score: c.score, scoreSmooth: h.scoreSmooth, signals: c.s, sigma: c.s.sig, lv: h.lv, accuracy: st.n >= 5 ? { rate: st.hit / st.n, n: st.n } : null,
    };
  }
}
