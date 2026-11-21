// Mercado global: datos de CoinGecko y alternative.me (lógica de datos; el pintado está en ui-global.js)
import { fmtN } from './util.js';

export const STABLES = new Set(['usdt', 'usdc', 'usde', 'dai', 'fdusd', 'tusd', 'usdd', 'pyusd', 'usds', 'usd1', 'rlusd', 'usdf', 'usdtb', 'bfusd', 'susds', 'susde', 'busd', 'gusd', 'usdg', 'usdx']);
export const WRAPPED = new Set(['wbtc', 'weth', 'steth', 'wsteth', 'weeth', 'cbbtc', 'wbeth', 'reth', 'cbeth', 'meth', 'lbtc', 'solvbtc', 'ezeth', 'rseth', 'tbtc', 'jitosol', 'msol', 'bnsol', 'weth.e']);

export const isExcluded = (c) => STABLES.has(String(c.symbol).toLowerCase()) || WRAPPED.has(String(c.symbol).toLowerCase());

/** Top 20 sin estables ni envueltas: suma de capitalización y cambio 24 h ponderado */
export function computeTop20(coins) {
  const top = coins.filter((c) => !isExcluded(c) && c.market_cap > 0).slice(0, 20);
  const cap = top.reduce((s, c) => s + c.market_cap, 0);
  const prev = top.reduce((s, c) => s + c.market_cap / (1 + (c.price_change_percentage_24h || 0) / 100), 0);
  return { n: top.length, cap, change24h: prev > 0 ? (cap / prev - 1) * 100 : null };
}

export const FNG_CLASSES = [
  [25, 'Miedo extremo'], [45, 'Miedo'], [55, 'Neutral'], [75, 'Codicia'], [101, 'Codicia extrema'],
];
export const fngClass = (v) => FNG_CLASSES.find(([lim]) => v < lim)[1];

async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 429 ? ' (límite de CoinGecko; se reintenta solo)' : ''));
    return await r.json();
  } finally { clearTimeout(t); }
}
const wrap = async (fn) => { try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'tiempo agotado' : e.message }; } };

export const fetchGlobal = () => wrap(async () => (await getJson('https://api.coingecko.com/api/v3/global')).data);
export const fetchMarkets = () => wrap(() => getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=120&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d'));
export const fetchFng = () => wrap(async () => (await getJson('https://api.alternative.me/fng/?limit=31')).data);
export const fetchTrending = () => wrap(async () => (await getJson('https://api.coingecko.com/api/v3/search/trending')).coins);

/** Medidor SVG en semicírculo con 5 tramos redondeados */
export function gaugeSvg(v, size = 150) {
  const cx = 100, cy = 100, r = 80, colors = ['#ea3943', '#ea8c00', '#f3d42f', '#93d900', '#16c784'];
  const pt = (deg, rad = r) => [cx + rad * Math.cos((Math.PI * (180 - deg)) / 180), cy - rad * Math.sin((Math.PI * (180 - deg)) / 180)];
  let arcs = '';
  const gap = 5;
  for (let k = 0; k < 5; k++) {
    const a0 = k * 36 + gap / 2, a1 = (k + 1) * 36 - gap / 2;
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    arcs += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" stroke="${colors[k]}" stroke-width="12" stroke-linecap="round" fill="none"/>`;
  }
  const [dx, dy] = pt((Math.min(100, Math.max(0, v)) / 100) * 180);
  return `<svg viewBox="0 0 200 115" width="${size}" role="img" aria-label="Miedo y codicia ${fmtN(v, 0)}">${arcs}<circle cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="6" fill="#fff" stroke="#0F1115" stroke-width="3"/><text x="100" y="92" text-anchor="middle" font-size="34" font-weight="700" fill="#E6E8EC" font-family="ui-monospace,monospace">${fmtN(v, 0)}</text></svg>`;
}
