// Model accuracy card (bottom of the left column) + live log of every bot decision (time, stock, price, P(up), action).
(function () {
  'use strict';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (v, d = 1) => (v == null ? '–' : (v * 100).toFixed(d) + '%');
  const signed = (v) => (v == null ? '–' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%');

  let filter = '';

  function build() {
    const left = document.querySelector('.col-left');
    const grid = document.querySelector('.grid');
    if (!left || !grid) return false;

    const card = document.createElement('section');
    card.className = 'panel';
    card.id = 'model-card';
    card.dataset.v = 'dashboard signals';
    card.innerHTML = '<div class="hd"><h2>Model accuracy</h2><span class="engine">test set</span></div><div id="mc-body" class="hint">Loading…</div>';
    left.appendChild(card);

    const log = document.createElement('section');
    log.className = 'panel';
    log.id = 'sig-log';
    log.dataset.v = 'dashboard signals logs';
    log.style.marginTop = '16px';
    log.innerHTML = `
      <div class="hd"><h2>Bot activity</h2>
        <span class="hint" id="sl-meta"></span>
        <select id="sl-filter" class="btn" aria-label="Filter by stock"><option value="">All stocks</option></select>
      </div>
      <div class="sl-scroll"><table class="sl-table">
        <thead><tr><th>Time</th><th>Stock</th><th>Price</th><th>Held</th><th>Chance of rise</th><th>Action</th><th>Source</th></tr></thead>
        <tbody id="sl-body"><tr><td colspan="7" class="hint">Waiting for the bot's first decision…</td></tr></tbody>
      </table></div>`;
    grid.after(log);
    log.querySelector('#sl-filter').addEventListener('change', (e) => { filter = e.target.value; loadSignals(); });
    return true;
  }

  async function loadStats() {
    const el = document.getElementById('mc-body');
    try {
      const s = await window.astbApi('/api/model/stats');
      if (!s.available) {
        el.innerHTML = 'No saved results yet. Run <code>python train_model.py</code> to create them.';
        return;
      }
      const auc = s.auc;
      const tone = auc == null ? 'flat' : auc < 0.53 ? 'down' : auc < 0.6 ? 'flat' : 'up';
      const verdict = auc == null ? '' : auc < 0.53 ? 'No real skill' : auc < 0.6 ? 'Weak edge' : 'Some edge';
      el.className = '';
      el.innerHTML = `
        <div class="mc-big ${tone}">${auc == null ? '–' : auc.toFixed(3)}<span> AUC · ${esc(verdict)}</span></div>
        <div class="hint">0.50 = coin flip. Higher is better.</div>
        <div class="mc-row"><span>Base rate (rises beyond costs)</span><b>${pct(s.base_rate)}</b></div>
        <div class="mc-row"><span>Train / test rows</span><b>${(s.train_rows || 0).toLocaleString()} / ${(s.test_rows || 0).toLocaleString()}</b></div>
        <table class="mc-table"><thead><tr><th>Min chance</th><th>Signals</th><th>Win rate</th><th>Net / trade</th></tr></thead><tbody>
          ${(s.thresholds || []).map((t) => `<tr><td>≥ ${Math.round(t.p * 100)}%</td><td>${t.signals}</td><td>${pct(t.win_rate)}</td>
            <td class="${t.avg_net == null ? 'flat' : t.avg_net >= 0 ? 'up' : 'down'}">${signed(t.avg_net)}</td></tr>`).join('')}
        </tbody></table>
        <div class="hint">${esc((s.symbols || []).join(', '))} · ${esc(s.trained_at || '')}</div>`;
    } catch (e) { el.textContent = 'Could not load model results.'; }
  }

  async function loadSignals() {
    try {
      const q = '/api/bot/signals?n=150' + (filter ? '&symbol=' + encodeURIComponent(filter) : '');
      const rows = (await window.astbApi(q)).signals || [];
      const sel = document.getElementById('sl-filter');
      if (!filter) {
        const have = new Set([...sel.options].map((o) => o.value));
        [...new Set(rows.map((r) => r.symbol))].forEach((s) => { if (!have.has(s)) sel.add(new Option(s, s)); });
      }
      document.getElementById('sl-meta').textContent = rows.length ? `${rows.length} latest decisions` : '';
      document.getElementById('sl-body').innerHTML = rows.length ? rows.map((r) => {
        const p = r.p_up;
        const cls = r.action === 'BUY' ? 'up' : r.action === 'SELL' ? 'down' : 'flat';
        return `<tr title="${esc(r.note)}"><td>${esc(r.ts)}</td><td><b>${esc(r.symbol)}</b></td>
          <td>${r.price == null ? '–' : '$' + r.price.toFixed(2)}</td><td>${r.held}</td>
          <td class="${p == null ? 'flat' : p >= 0.6 ? 'up' : p <= 0.4 ? 'down' : 'flat'}">${p == null ? '–' : (p * 100).toFixed(0) + '%'}</td>
          <td class="${cls}">${esc(r.action)}</td><td class="flat">${esc(r.source)}</td></tr>`;
      }).join('') : '<tr><td colspan="7" class="hint">No decisions yet. Start <code>python bot.py</code> or switch on the Auto bot.</td></tr>';
    } catch (e) { /* server busy; try again next tick */ }
  }

  window.addEventListener('DOMContentLoaded', () => {
    let tries = 0;
    const wait = setInterval(() => {
      if (build()) {
        clearInterval(wait);
        loadStats(); loadSignals();
        setInterval(loadSignals, 5000);
        setInterval(loadStats, 60000);
      } else if (++tries > 40) clearInterval(wait);
    }, 150);
  });
})();
