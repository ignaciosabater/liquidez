// Pintado de «Mercado global»
import { fetchGlobal, fetchMarkets, fetchFng, fetchTrending, computeTop20, fngClass, gaugeSvg } from './global.js';
import { fmtN, fmtUsd, fmtPct, esc } from './util.js';

const arrowPct = (x) => (Number.isFinite(x) ? `<span class="${x >= 0 ? 'pos' : 'neg'}">${x >= 0 ? '▲' : '▼'} ${fmtN(Math.abs(x), 2)} %</span>` : '<span class="dim">–</span>');
const nodata = (why) => `<div class="mc-sub dim">sin datos${why ? ': ' + esc(why) : ''}</div>`;

export class GlobalPanel {
  constructor(el, demo) {
    this.el = el; this.tab = 'main'; this.data = {}; this.demo = demo; this.timer = null;
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-gtab]'); if (b) { this.tab = b.dataset.gtab; this.render(); } });
  }
  start() { this.load(); this.timer = setInterval(() => !document.hidden && this.load(), 150000); document.addEventListener('visibilitychange', () => !document.hidden && this.load()); }
  async load() {
    if (this.demo) { this.data = this.demo; this.render(); return; }
    const [g, m, f, t] = await Promise.all([fetchGlobal(), fetchMarkets(), fetchFng(), fetchTrending()]);
    this.data = { g, m, f, t }; this.render();
  }
  render() {
    const { g, m, f, t } = this.data;
    const tabs = `<div class="gtabs"><button data-gtab="main" class="${this.tab === 'main' ? 'on' : ''}">Activos principales</button><button data-gtab="trend" class="${this.tab === 'trend' ? 'on' : ''}">En tendencia</button></div>`;
    let body = '';
    if (!g) body = '<div class="dim pad">Cargando…</div>';
    else if (this.tab === 'main') {
      const cap = g.ok ? `<div class="mc-val">${fmtUsd(g.data.total_market_cap.usd)}</div><div class="mc-sub">${arrowPct(g.data.market_cap_change_percentage_24h_usd)}</div>` : nodata(g.error);
      let top = nodata(m && m.error);
      if (m && m.ok) { const t20 = computeTop20(m.data); top = `<div class="mc-val">${fmtUsd(t20.cap)}</div><div class="mc-sub">${arrowPct(t20.change24h)}</div>`; }
      const liq = '<div class="mc-val dim">–</div><div class="mc-sub dim">fase 4 · sin servidor</div>';
      let fng = nodata(f && f.error);
      if (f && f.ok) { const v = +f.data[0].value; fng = `<div class="gauge">${gaugeSvg(v, 92)}</div><div class="mc-sub">${fngClass(v)}</div>`; }
      body = `<div class="mcards">
        <div class="mc"><div class="mc-t">Capitalización</div>${cap}</div>
        <div class="mc"><div class="mc-t">Top 20</div>${top}</div>
        <div class="mc"><div class="mc-t">Liquid. 24h</div>${liq}</div>
        <div class="mc"><div class="mc-t">Miedo y Codicia</div>${fng}</div></div>`;
    } else if (!t || !t.ok) body = `<div class="pad dim">sin datos${t && t.error ? ': ' + esc(t.error) : ''}</div>`;
    else {
      body = '<div class="trend">' + t.data.slice(0, 8).map((c, i) => {
        const it = c.item, ch = it.data && it.data.price_change_percentage_24h ? it.data.price_change_percentage_24h.usd : NaN;
        const price = it.data && it.data.price != null ? (typeof it.data.price === 'number' ? '$' + fmtN(it.data.price, it.data.price < 1 ? 5 : 2) : esc(it.data.price)) : '–';
        return `<div class="tr"><span class="dim">${i + 1}</span><img src="${esc(it.thumb)}" alt="" width="20" height="20" loading="lazy"><b>${esc(it.symbol)}</b><span class="dim nm">${esc(it.name)}</span><span class="mono">${price}</span>${arrowPct(ch)}</div>`;
      }).join('') + '</div>';
    }
    this.el.innerHTML = `<div class="panel">${tabs}${body}</div>`;
  }
}
