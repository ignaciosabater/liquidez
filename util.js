// Utilidades pequeñas compartidas
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sign = (x) => (x >= 0 ? 1 : -1);
export const tanh = Math.tanh;
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const cache = {};
function nf(d) {
  return (cache[d] ||= new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));
}
export function fmtN(x, d = 2) {
  return Number.isFinite(x) ? nf(d).format(x) : '–';
}
export function fmtUsd(x, d = 2) {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1e12) return '$' + fmtN(x / 1e12, d) + ' B';
  if (a >= 1e9) return '$' + fmtN(x / 1e9, d) + ' MM';
  if (a >= 1e6) return '$' + fmtN(x / 1e6, d) + ' M';
  if (a >= 1e3) return '$' + fmtN(x / 1e3, d) + ' K';
  return '$' + fmtN(x, 0);
}
export function fmtPrice(p) {
  if (!Number.isFinite(p)) return '–';
  if (p >= 1000) return fmtN(p, 2);
  if (p >= 1) return fmtN(p, 3);
  return fmtN(p, 5);
}
export function fmtPct(x, d = 2, plus = false) {
  if (!Number.isFinite(x)) return '–';
  return (plus && x > 0 ? '+' : '') + fmtN(x, d) + ' %';
}
export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
