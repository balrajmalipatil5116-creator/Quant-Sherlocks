// ASTB Autonomous AI Trading Terminal & Market Advisor Engine

// Shared fetch helper. The X-ASTB-Client header is required by the server for every action that changes
// something (chat, watchlist, trades); it blocks other websites from calling those endpoints.
window.astbApi = async function (url, body) {
  const opts = body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ASTB-Client': '1' }, body: JSON.stringify(body) };
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = data && data.detail;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${res.status})`);
  }
  return data;
};

const TF_LIST = ['1m', '5m', '15m', '1h', '1d'];
const SOURCE_LABEL = {
  alpaca: ['Live · Alpaca', 'live'],
  yahoo: ['Yahoo · a few seconds behind', 'delayed'],
  simulated: ['Simulated data: no market feed reachable', 'sim'],
};
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money0 = (n) => '$' + Math.round(n).toLocaleString();
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>';

class ASTBDashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.holdings = [];
    this.watchlist = [];
    this.selectedSymbol = 'NVDA';
    this.tf = '5m';
    this.chart = null;
    this.candlestickSeries = null;
    this.lastBar = null;
    this.source = null;
    this.pollMs = 3000;
    this.chartToken = 0;
    this.liveTimer = null;
    this.bars = [];
    this.barSeconds = 300;
    this.drawings = null;
    this.priceCtl = null;
    this.tradeMode = 'manual';

    this.initUI();
    try { this.initCandlestickChart(); } catch (e) { console.error('Chart error:', e); this.showChartError('Chart library failed to load. Check your internet connection.'); }
    this.attachEvents();
    this.startPolling();
  }

  initUI() {
    this.container.innerHTML = `
      <div class="shell">
        <aside class="sidebar" id="sidebar">
          <div class="sb-brand">
            <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="28,9 28,23 16,30" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div><b>ASTB</b><small>AI / TERMINAL</small></div>
          </div>
          <div class="sb-bot"><span class="dot"></span><div><b>ASTB AI</b><small>PAPER &middot; APPROVAL REQUIRED</small></div></div>
          <div class="sb-label">Workspace</div>
          <nav class="nav" aria-label="Sections"><button type="button" class="nav-i on" data-view="dashboard"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>Dashboard</span><i class="pip"></i></button><button type="button" class="nav-i" data-view="markets"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-6 4 3 8-9"/><path d="M3 21h18"/></svg><span>Markets</span><i class="pip"></i></button><button type="button" class="nav-i" data-view="signals"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg><span>AI signals</span><i class="pip"></i></button><button type="button" class="nav-i" data-view="risk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg><span>Risk</span><i class="pip"></i></button><button type="button" class="nav-i" data-view="world"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg><span>World markets</span><i class="pip"></i></button><button type="button" class="nav-i" data-view="logs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg><span>Bot activity</span><i class="pip"></i></button></nav>
          <div class="sb-foot">Educational only.<br>Not financial advice.</div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button type="button" id="menu-btn" class="iconbtn" aria-label="Toggle sidebar"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
            <div class="crumb"><span class="mk">MARKETS</span><span class="sl">/</span><b id="crumb-now">Dashboard</b></div>
            <div class="chips">
              <span class="clock"><span>UTC</span> <b id="utc-clock">--:--:--</b></span>
              <span id="chip-mode" class="chip ok"><span class="dot"></span><span id="chip-mode-txt">Manual: every order needs your approval</span></span>
              <span id="chip-acct" class="chip">Paper trading</span>
              <span id="chip-feed" class="chip"><span class="dot"></span><span id="chip-feed-txt">Connecting</span></span>
            </div>
          </header>
          <div class="page">
            <div class="pagehead" data-v="dashboard markets signals risk logs world">
              <p class="eyebrow" id="ph-eye"></p>
              <h1 id="ph-title"></h1>
              <p class="lede" id="ph-sub"></p>
            </div>

      <section class="strip" data-v="dashboard risk" aria-label="Portfolio numbers">
        <div class="cell"><div class="k">Portfolio value <span id="tag-demo" class="tag hidden">Sample data</span></div><div id="nav" class="v">--</div><div id="nav-sub" class="s">&nbsp;</div></div>
        <div class="cell"><div class="k">Return today</div><div id="return" class="v">--</div><div class="s">vs previous close</div></div>
        <div class="cell"><div class="k">Sharpe ratio <span class="tag est hidden">Estimate</span></div><div id="sharpe" class="v">--</div><div class="s">return per unit of risk, yearly</div></div>
        <div class="cell"><div class="k">1-day VaR, 95% <span class="tag est hidden">Estimate</span></div><div id="var" class="v down">--</div><div id="var-sub" class="s">worst typical day</div></div>
        <div class="cell"><div class="k">1-day CVaR, 95% <span class="tag est hidden">Estimate</span></div><div id="cvar" class="v down">--</div><div id="cvar-sub" class="s">average of the worst days</div></div>
      </section>

      <div class="grid">
        <aside class="col-left">
          <section class="panel" data-v="dashboard markets">
            <div class="hd">
              <h2>Watchlist</h2>
              <div class="add">
                <input id="quick-add-input" type="text" maxlength="9" placeholder="Ticker" aria-label="Add a ticker">
                <button id="quick-add-btn" class="btn">Add</button>
              </div>
            </div>
            <div id="watchlist-msg" class="msg hidden"></div>
            <div id="watchlist-container" class="wl"><div class="hint">Loading watchlist…</div></div>
            <div class="hint" style="margin-top:10px">Click a stock to chart it live.</div>
          </section>
          <section class="panel" data-v="dashboard risk">
            <div class="hd"><h2>Positions</h2></div>
            <table>
              <thead><tr><th>Stock</th><th>Last</th><th>P&amp;L</th><th>Weight</th></tr></thead>
              <tbody id="holdings-table"><tr><td colspan="4" class="hint">Loading positions…</td></tr></tbody>
            </table>
          </section>
        </aside>

        <main class="col-chart" id="chart-anchor">
          <section class="panel" data-v="dashboard markets">
            <div class="chart-top">
              <div>
                <div class="symline"><span id="chart-header" class="sym">NVDA</span><span id="chart-price" class="px">--</span></div>
                <span id="chart-source" class="srcbadge">Connecting…</span>
              </div>
              <div class="chart-ctl">
                <div id="draw-actions" class="dactions" role="group" aria-label="Drawing actions"></div>
                <button id="btn-auto" type="button" class="btn tog on" title="Price scale: auto-fit">Auto</button>
                <button id="btn-fit" type="button" class="btn" title="Show all candles and auto-fit the price scale">Fit</button>
                <div id="tf-buttons" class="seg" role="group" aria-label="Candle size"></div>
              </div>
            </div>
            <div class="chartrow">
              <div id="draw-tools" class="drawtools" role="toolbar" aria-label="Drawing tools"></div>
              <div class="chartwrap">
                <div id="candlestickChart"></div>
                <div id="chart-overlay" class="overlay hidden"></div>
              </div>
            </div>
            <div class="chart-hints">
              <span><b>Move the chart:</b> drag left/right or up/down, <kbd>Shift</kbd>+wheel for up/down, wheel to zoom time</span>
              <span>Drag the price axis to stretch it · double-click it to auto-fit</span>
            </div>
            <div class="trade-mode" role="group" aria-label="Trading mode">
              <div class="seg" id="mode-seg">
                <button type="button" data-mode="manual" class="on" aria-pressed="true">Manual</button>
                <button type="button" data-mode="auto" aria-pressed="false">Auto bot</button>
              </div>
              <span id="mode-desc" class="hint">You place every order yourself. A Yes / No card appears in the chat first.</span>
            </div>
            <div id="manual-ticket" class="ticket">
              <label for="trade-qty">Shares</label>
              <input id="trade-qty" type="number" min="1" value="1">
              <button id="trade-buy" class="go buy">Buy</button>
              <button id="trade-sell" class="go sell">Sell</button>
              <span class="hint">Nothing is sent from here. You'll get a Yes / No card in the chat first.</span>
            </div>
            <div id="auto-panel" class="autopanel hidden"></div>
          </section>
        </main>

        <aside class="col-right">
          <section class="panel" data-v="dashboard signals">
            <div class="hd"><h2 id="sig-title">AI signal</h2><span id="sig-engine" class="engine"></span></div>
            <svg class="gauge" viewBox="0 0 240 176" role="img" aria-label="Model probability gauge">
              <path id="z-sell" class="zone" stroke="var(--down)" opacity=".85"/>
              <path id="z-hold" class="zone" stroke="var(--line)"/>
              <path id="z-buy" class="zone" stroke="var(--up)" opacity=".85"/>
              <text id="t-sell" class="tick" text-anchor="middle"></text>
              <text id="t-buy" class="tick" text-anchor="middle"></text>
              <g id="needle" class="needle" style="transform: rotate(90deg)">
                <line x1="120" y1="120" x2="40" y2="120" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/>
                <circle cx="120" cy="120" r="7" fill="var(--text)"/><circle cx="120" cy="120" r="2.5" fill="var(--panel)"/>
              </g>
              <text id="g-pct" class="pct" x="120" y="168" text-anchor="middle">--</text>
            </svg>
            <div id="sig-verdict" class="verdict">Reading the market…</div>
            <div id="sig-sub" class="verdict-sub">Chance the price rises more than trading costs in 30 min</div>
            <div id="sig-read" class="read"></div>
          </section>
          <section class="panel" data-v="dashboard risk">
            <div class="hd"><h2>Safety gate</h2></div>
            <ul id="gate" class="gate"></ul>
            <div class="fine">Educational project. Not financial advice.</div>
          </section>
        </aside>
      </div>
          </div>
        </div>
      </div>
    `;
    this.initShell();
    const tfWrap = document.getElementById('tf-buttons');
    tfWrap.innerHTML = TF_LIST.map(t => `<button data-tf="${t}" class="tf-btn">${t === '1d' ? '1D' : t}</button>`).join('');
    this.renderTfButtons();
    this.renderGate(null);
  }

  initShell() {
    const root = this.container;
    const PAGES = {
      dashboard: ['Portfolio command center', null, 'Live prices, the AI signal and your safety limits in one place. Nothing trades without your approval.', 'Dashboard'],
      markets: ['Markets / live chart', 'Markets', 'Chart any stock live, draw on it and place orders through a Yes / No card.', 'Markets'],
      signals: ['Model lab / AI signal', 'AI signals', 'What the model thinks right now, how accurate it has been, and every decision the bot made.', 'AI signals'],
      risk: ['Guardrails / capital protection', 'Risk control', 'Portfolio numbers, positions and the safety checks every order must pass.', 'Risk'],
      world: ['Global markets / sessions', 'World markets', 'Every major exchange on one map: which are open right now, when they open and close in your time, and the countdown.', 'World markets'],
      logs: ['Observability / runtime', 'Bot activity', 'Every decision the bot logged: time, stock, price, chance of rise and action.', 'Bot activity'],
    };
    const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
    const show = (v) => {
      if (!PAGES[v]) v = 'dashboard';
      const p = PAGES[v];
      root.dataset.view = v;
      document.getElementById('ph-eye').textContent = p[0];
      document.getElementById('ph-title').innerHTML = p[1] ? esc(p[1]) : esc(greet()) + ', <em>operator</em>.';
      document.getElementById('ph-sub').textContent = p[2];
      document.getElementById('crumb-now').textContent = p[3];
      root.querySelectorAll('.nav-i').forEach(b => b.classList.toggle('on', b.dataset.view === v));
      try { localStorage.setItem('astb-view', v); } catch (e) { /* storage may be blocked */ }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (this.chart && v !== 'signals' && v !== 'logs' && v !== 'risk' && v !== 'world') setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    };
    root.querySelectorAll('.nav-i').forEach(b => b.addEventListener('click', () => { show(b.dataset.view); document.body.classList.remove('sb-open'); }));
    document.getElementById('menu-btn').addEventListener('click', () => {
      if (window.innerWidth <= 860) document.body.classList.toggle('sb-open'); else document.body.classList.toggle('sb-collapsed');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    });
    let first = 'dashboard';
    try { first = localStorage.getItem('astb-view') || 'dashboard'; } catch (e) { /* ignore */ }
    show(first);
    const tick = () => { const el = document.getElementById('utc-clock'); if (el) el.textContent = new Date().toISOString().slice(11, 19); };
    tick(); setInterval(tick, 1000);
  }

  renderTfButtons() {
    document.querySelectorAll('.tf-btn').forEach(b => {
      const on = b.dataset.tf === this.tf;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  // ------------------------------------------------------------------ chart
  initCandlestickChart() {
    const el = document.getElementById('candlestickChart');
    if (!el || typeof LightweightCharts === 'undefined') throw new Error('LightweightCharts missing');
    el.innerHTML = '';

    const fmtDate = (d) => d.toLocaleDateString([], { day: '2-digit', month: 'short' });
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    this.chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight || 540,
      layout: { background: { color: '#0d121b' }, textColor: '#7d8b9f', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12 },
      grid: { vertLines: { color: '#161d29' }, horzLines: { color: '#161d29' } },
      crosshair: { mode: 1 },
      handleScale: { axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: false },
      rightPriceScale: { borderColor: '#1c2533' },
      localization: {
        timeFormatter: (t) => { const d = new Date(t * 1000); return this.tf === '1d' ? fmtDate(d) : `${fmtDate(d)} ${fmtTime(d)}`; },
      },
      timeScale: {
        borderColor: '#1c2533', timeVisible: true, secondsVisible: false, rightOffset: 4,
        tickMarkFormatter: (t, type) => { const d = new Date(t * 1000); return type <= 2 || this.tf === '1d' ? fmtDate(d) : fmtTime(d); },
      },
    });

    const opts = { upColor: '#34d399', downColor: '#fb7185', borderVisible: false, wickUpColor: '#34d399', wickDownColor: '#fb7185' };
    // v4 API; fall back to the v5 API if a different version ever gets loaded
    this.candlestickSeries = typeof this.chart.addCandlestickSeries === 'function'
      ? this.chart.addCandlestickSeries(opts)
      : this.chart.addSeries(LightweightCharts.CandlestickSeries, opts);

    const wrap = el.parentElement;
    this.drawings = new ASTBChartDrawings(this, wrap);
    this.priceCtl = new ASTBPriceScaleControl(this, wrap);

    new ResizeObserver(() => { if (this.chart) this.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }); }).observe(el);

    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.liveTick(); });
    this.loadChart();
  }

  showChartError(msg) {
    const o = document.getElementById('chart-overlay');
    if (!o) return;
    o.textContent = msg || '';
    o.classList.toggle('hidden', !msg);
  }

  setSourceBadge(source) {
    const b = document.getElementById('chart-source');
    if (!b) return;
    const [label, cls] = SOURCE_LABEL[source] || ['No data feed', ''];
    b.textContent = label;
    b.className = 'srcbadge ' + cls;
    const chip = document.getElementById('chip-feed');
    if (chip) {
      chip.className = 'chip ' + (cls === 'live' ? 'ok' : cls ? 'warn' : '');
      document.getElementById('chip-feed-txt').textContent = cls === 'live' ? 'Live prices' : cls === 'delayed' ? 'Prices a few seconds behind' : cls === 'sim' ? 'Simulated prices' : 'No price feed';
    }
  }

  isCrypto(sym) { return /-USD$/.test(sym || ''); }

  setPrice(price) {
    const el = document.getElementById('chart-price');
    if (!el || price == null) return;
    const prev = parseFloat(el.dataset.p);
    el.textContent = `$${price >= 1 ? price.toFixed(2) : price.toFixed(6)}`;
    el.dataset.p = price;
    if (!isNaN(prev) && prev !== price) {
      el.style.color = price > prev ? 'var(--up)' : 'var(--down)';
      setTimeout(() => { el.style.color = ''; }, 700);
    }
  }

  // Full load: used when you pick a stock or a timeframe. Replaces all candles once.
  async loadChart() {
    const token = ++this.chartToken;
    clearTimeout(this.liveTimer);
    const sym = this.selectedSymbol, tf = this.tf;
    document.getElementById('chart-header').textContent = sym;
    document.getElementById('chart-price').dataset.p = '';
    this.showChartError('Loading ' + sym + '…');
    try {
      const data = await window.astbApi(`/api/chart/${encodeURIComponent(sym)}?tf=${tf}`);
      if (token !== this.chartToken) return;            // user already picked something else
      const candles = data.candles.slice().sort((a, b) => a.time - b.time);
      this.bars = candles;
      this.candlestickSeries.setData(candles);
      if (this.priceCtl) this.priceCtl.reset();            // new stock / timeframe: back to automatic price fitting
      this.chart.timeScale().fitContent();
      this.lastBar = candles[candles.length - 1] || null;
      const prec = this.lastBar && this.lastBar.close < 1 ? 6 : 2;
      try { this.candlestickSeries.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: Math.pow(10, -prec) } }); } catch (e) { /* older chart builds */ }
      this.applyQtyMode();
      this.source = data.source;
      this.pollMs = data.poll_ms || 3000;
      this.barSeconds = data.bar_seconds || this.barSeconds;
      if (this.drawings) this.drawings.setSymbol(sym);
      this.setSourceBadge(data.source);
      this.refreshMarkers();
      if (this.lastBar) this.setPrice(this.lastBar.close);
      this.showChartError(candles.length ? '' : 'No candles returned for ' + sym);
    } catch (e) {
      if (token !== this.chartToken) return;
      this.showChartError(`Couldn't load ${sym}: ${e.message}`);
      this.setSourceBadge(null);
    }
    this.scheduleLive(token);
  }

  scheduleLive(token) {
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => this.liveTick(token), this.pollMs || 3000);
  }

  // Live tick: fetch only the newest candles and update the chart in place (no flicker, zoom is kept).
  async liveTick(token = this.chartToken) {
    clearTimeout(this.liveTimer);
    if (token !== this.chartToken) return;
    if (document.hidden) { this.scheduleLive(token); return; }
    const sym = this.selectedSymbol, tf = this.tf;
    try {
      const data = await window.astbApi(`/api/chart/${encodeURIComponent(sym)}/live?tf=${tf}`);
      if (token !== this.chartToken) return;
      const fresh = data.candles.slice().sort((a, b) => a.time - b.time);
      const gap = this.lastBar && fresh.length && fresh[0].time > this.lastBar.time + 3 * (this.barSeconds || 60);
      if (data.source !== this.source || gap) { await this.loadChart(); return; }   // feed changed / missed bars
      for (const c of fresh) {
        if (!this.lastBar || c.time >= this.lastBar.time) {
          this.candlestickSeries.update(c);
          if (this.bars.length && this.bars[this.bars.length - 1].time === c.time) this.bars[this.bars.length - 1] = c;
          else this.bars.push(c);
          this.lastBar = c;
        }
      }
      if (this.lastBar) this.setPrice(this.lastBar.close);
      this.showChartError('');
    } catch (e) { /* keep the old chart, try again next tick */ }
    this.scheduleLive(token);
  }

  // Arrows on the chart for orders that were really executed (manual, chat or auto bot),
  // plus small dots where the bot's model said BUY / SELL (with its probability), so you can see its calls.
  async refreshMarkers() {
    if (!this.candlestickSeries || typeof this.candlestickSeries.setMarkers !== 'function') return;
    const sym = this.selectedSymbol;
    try {
      const q = encodeURIComponent(sym);
      const [hist, sigs] = await Promise.all([
        window.astbApi(`/api/trade/history?symbol=${q}`),
        window.astbApi(`/api/bot/signals?symbol=${q}&n=200`).catch(() => ({ signals: [] })),
      ]);
      if (sym !== this.selectedSymbol || !this.bars.length) return;
      const barAt = (ts) => {
        for (let i = this.bars.length - 1; i >= 0; i--) { if (this.bars[i].time <= ts) return this.bars[i]; }
        return null;
      };
      const out = [], taken = new Set();
      for (const t of hist.trades) {
        const bar = barAt(Math.floor(t.ts));
        if (!bar) continue;
        const buy = t.side === 'buy';
        taken.add(bar.time + ':' + (buy ? 'BUY' : 'SELL'));
        out.push({ time: bar.time, position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#34d399' : '#fb7185',
          shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'BUY' : 'SELL'} ${t.qty}${t.source === 'auto' ? ' (bot)' : ''}` });
      }
      for (const s of (sigs.signals || [])) {
        if (s.action !== 'BUY' && s.action !== 'SELL') continue;
        const ts = Date.parse(String(s.ts).replace(' ', 'T')) / 1000;      // the log stores this computer's local time
        if (!isFinite(ts)) continue;
        const bar = barAt(Math.floor(ts));
        if (!bar || ts - bar.time > 2 * (this.barSeconds || 300) || taken.has(bar.time + ':' + s.action)) continue;
        taken.add(bar.time + ':' + s.action);
        const buy = s.action === 'BUY';
        out.push({ time: bar.time, position: buy ? 'belowBar' : 'aboveBar', color: buy ? 'rgba(52,211,153,.75)' : 'rgba(251,113,133,.75)',
          shape: 'circle', text: s.p_up == null ? s.action : `${Math.round(s.p_up * 100)}%` });
      }
      out.sort((a, b) => a.time - b.time);
      this.candlestickSeries.setMarkers(out);
    } catch (e) { /* markers are optional */ }
  }

  setTimeframe(tf) {
    if (!TF_LIST.includes(tf) || tf === this.tf) return;
    this.tf = tf;
    this.renderTfButtons();
    this.loadChart();
  }

  applyQtyMode() {
    const c = this.isCrypto(this.selectedSymbol);
    const q = document.getElementById('trade-qty'), l = document.querySelector('label[for="trade-qty"]');
    if (!q) return;
    q.min = c ? '0.000001' : '1'; q.step = c ? 'any' : '1';
    if (l) l.textContent = c ? 'Coins' : 'Shares';
    if (c && q.value === '1') q.value = '0.001';
    if (!c && !/^\d+$/.test(q.value)) q.value = '1';
  }

  selectSymbol(symbol) {
    this.selectedSymbol = symbol;
    this.renderHoldingsTable();
    this.renderWatchlist();
    this.loadChart();
    this.fetchSignal();
  }

  // ------------------------------------------------------------------ holdings & watchlist
  renderHoldingsTable() {
    const tbody = document.getElementById('holdings-table');
    if (!tbody || !this.holdings.length) return;
    tbody.innerHTML = this.holdings.map(h => {
      const on = h.symbol === this.selectedSymbol;
      return `
        <tr data-sym="${esc(h.symbol)}" class="hrow ${on ? 'on' : ''}">
          <td>${esc(h.symbol)}</td>
          <td>$${h.last.toFixed(2)}</td>
          <td class="${h.pnl_pct >= 0 ? 'up' : 'down'}">${h.pnl_pct >= 0 ? '+' : ''}${h.pnl_pct}%</td>
          <td>${h.weight}%</td>
        </tr>`;
    }).join('');
  }

  async fetchWatchlist() {
    try {
      this.watchlist = await window.astbApi('/api/watchlist');
      this.renderWatchlist();
    } catch (e) { console.error(e); }
  }

  renderWatchlist() {
    const container = document.getElementById('watchlist-container');
    if (!container) return;
    if (!this.watchlist || this.watchlist.length === 0) {
      container.innerHTML = '<div class="hint">Your watchlist is empty. Type a ticker above and press Add.</div>';
      return;
    }
    container.innerHTML = this.watchlist.map(w => {
      const on = w.symbol === this.selectedSymbol;
      const price = w.price == null ? '—' : `$${w.price >= 1 ? w.price.toFixed(2) : w.price.toFixed(6)}`;
      const chg = w.change_pct == null ? '' : `${w.change_pct >= 0 ? '+' : ''}${w.change_pct}%`;
      return `
        <div class="wrow ${on ? 'on' : ''}">
          <div data-sym="${esc(w.symbol)}" class="wmain" role="button" tabindex="0">
            <div><div class="wsym">${esc(w.symbol)}</div><div class="wsec">${esc(w.sector || 'Watchlist')}</div></div>
            <div class="wpx"><div>${price}</div><div class="wchg ${(w.change_pct || 0) >= 0 ? 'up' : 'down'}">${chg}</div></div>
          </div>
          <button data-remove="${esc(w.symbol)}" class="xbtn" aria-label="Remove ${esc(w.symbol)}">✕</button>
        </div>`;
    }).join('');
  }

  async addToWatchlist(symbol) {
    symbol = (symbol || '').trim().toUpperCase();
    if (!symbol) return;
    const msg = document.getElementById('watchlist-msg');
    msg.classList.add('hidden');
    try {
      const data = await window.astbApi('/api/watchlist/add', { symbol });
      this.watchlist = data.watchlist;
      this.renderWatchlist();
      this.selectSymbol(data.symbol);
    } catch (e) {
      msg.textContent = e.message;
      msg.classList.remove('hidden');
    }
  }

  async removeFromWatchlist(symbol) {
    try {
      const data = await window.astbApi('/api/watchlist/remove', { symbol });
      this.watchlist = data.watchlist;
      this.renderWatchlist();
    } catch (e) { console.error(e); }
  }

  // ------------------------------------------------------------------ metrics / holdings
  async fetchMetrics() {
    try {
      const d = await window.astbApi('/api/metrics');
      const set = (id, t) => { document.getElementById(id).textContent = t; };
      set('nav', money0(d.nav));
      const r = document.getElementById('return');
      r.textContent = `${d.return_pct >= 0 ? '+' : ''}${d.return_pct}%`;
      r.className = 'v ' + (d.return_pct >= 0 ? 'up' : 'down');
      set('sharpe', d.sharpe);
      set('var', '-' + money0(Math.abs(d.var_95)));
      set('cvar', '-' + money0(Math.abs(d.cvar_95)));
      set('var-sub', `${(Math.abs(d.var_95) / d.nav * 100).toFixed(2)}% of portfolio`);
      set('cvar-sub', `${(Math.abs(d.cvar_95) / d.nav * 100).toFixed(2)}% of portfolio`);
      document.getElementById('tag-demo').classList.toggle('hidden', !d.demo);
      set('nav-sub', d.demo ? 'Connect Alpaca keys for live numbers' : 'Paper account');
      document.querySelectorAll('.tag.est').forEach(t => t.classList.toggle('hidden', !d.estimated));
    } catch (e) {}
  }

  // ------------------------------------------------------------------ AI signal gauge
  async fetchSignal() {
    const sym = this.selectedSymbol;
    document.getElementById('sig-title').textContent = `AI signal for ${sym}`;
    try {
      const v = await window.astbApi(`/api/signal/${encodeURIComponent(sym)}`);
      if (sym !== this.selectedSymbol) return;
      this.renderSignal(v);
    } catch (e) {
      this.renderSignal({ ok: false, reason: e.message, buy_at: 0.6, sell_at: 0.4 });
    }
  }

  renderSignal(v) {
    const R = 100, cx = 120, cy = 120;
    const pt = (p, r) => { const a = Math.PI * (1 - p); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const arc = (p0, p1) => { const [x0, y0] = pt(p0, R), [x1, y1] = pt(p1, R); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
    const g = 0.008, lo = v.sell_at ?? 0.4, hi = v.buy_at ?? 0.6;
    document.getElementById('z-sell').setAttribute('d', arc(0, lo - g));
    document.getElementById('z-hold').setAttribute('d', arc(lo + g, hi - g));
    document.getElementById('z-buy').setAttribute('d', arc(hi + g, 1));
    for (const [id, p] of [['t-sell', lo], ['t-buy', hi]]) {
      const el = document.getElementById(id), [x, y] = pt(p, R + 24);
      el.setAttribute('x', x.toFixed(1)); el.setAttribute('y', (y + 4).toFixed(1)); el.textContent = p.toFixed(2);
    }
    const verdict = document.getElementById('sig-verdict'), sub = document.getElementById('sig-sub');
    const needle = document.getElementById('needle'), read = document.getElementById('sig-read');
    const engine = document.getElementById('sig-engine');
    this.renderGate(v.limits || null);
    if (!v.ok) {
      needle.style.transform = 'rotate(90deg)';
      document.getElementById('g-pct').textContent = '--';
      verdict.textContent = 'No signal right now'; verdict.className = 'verdict flat';
      sub.textContent = v.reason || 'Try again in a moment.';
      read.innerHTML = ''; engine.textContent = '';
      return;
    }
    if (v.crypto) {            // coins: the stock model is not used, only a trend + RSI rule
      const a = v.rule_action || 'HOLD';
      needle.style.transform = `rotate(${a === 'BUY' ? 150 : a === 'SELL' ? 30 : 90}deg)`;
      document.getElementById('g-pct').textContent = a;
      verdict.textContent = a === 'BUY' ? 'Rule says: uptrend' : a === 'SELL' ? 'Rule says: trend broke' : 'Rule says: no edge';
      verdict.className = 'verdict ' + (a === 'BUY' ? 'up' : a === 'SELL' ? 'down' : 'flat');
      sub.textContent = (v.engine_note || '') + '. Coins use a simple trend + RSI rule, not the AI model.';
      engine.textContent = 'Trend + RSI rule'; engine.className = 'engine fallback';
      read.innerHTML = (v.readings || []).map(r =>
        `<div><span>${esc(r.label)}</span><span><b class="${esc(r.tone)}">${esc(r.value)}</b><span class="flat">${esc(r.note)}</span></span></div>`).join('');
      return;
    }
    const p = v.p_up;
    needle.style.transform = `rotate(${(p * 180).toFixed(1)}deg)`;
    document.getElementById('g-pct').textContent = `${Math.round(p * 100)}%`;
    if (p >= hi) { verdict.textContent = 'Above the buy line'; verdict.className = 'verdict up'; sub.textContent = 'The bot would propose a buy. You still decide.'; }
    else if (p <= lo) { verdict.textContent = 'Below the sell line'; verdict.className = 'verdict down'; sub.textContent = 'If you held it, the bot would close the position.'; }
    else { verdict.textContent = 'Between the lines: hold'; verdict.className = 'verdict flat'; sub.textContent = 'Not confident enough either way, so no action.'; }
    engine.textContent = v.engine === 'model' ? 'Trained model' : 'Simple rules (model not loaded)';
    engine.className = 'engine' + (v.engine === 'model' ? '' : ' fallback');
    read.innerHTML = (v.readings || []).map(r =>
      `<div><span>${esc(r.label)}</span><span><b class="${esc(r.tone)}">${esc(r.value)}</b><span class="flat">${esc(r.note)}</span></span></div>`).join('');
    const acct = document.getElementById('chip-acct');
    if (v.limits) {
      acct.textContent = v.limits.paper ? (v.limits.dry_run ? 'Paper trading, rehearsal mode' : 'Paper trading') : 'Live account';
      acct.className = 'chip' + (v.limits.paper ? '' : ' warn');
    }
  }

  renderGate(l) {
    this.gateLimits = l;
    const auto = this.tradeMode === 'auto';
    const items = [auto
      ? [false, 'Auto bot is ON: it places orders by itself, without asking. Switch to Manual to stop it.']
      : [true, 'Manual mode: every order waits for your Yes. The bot can only propose.']];
    if (l) {
      items.push(this.isCrypto(this.selectedSymbol)
        ? [false, 'Coins: no automatic stop-loss on orders you place. The crypto bot checks its own stop every few seconds.']
        : [true, `Each buy comes with a stop-loss ${l.stop_loss_pct}% below the entry price.`]);
      items.push([true, `New buys stop for the day after a ${l.daily_loss_pct}% loss.`]);
      items.push([true, `Orders capped at ${money0(l.max_order_usd)}, and at most ${l.max_positions} open positions.`]);
      items.push([l.paper, l.paper ? 'Paper trading: no real money moves.' : 'Live account: real money is at risk.']);
      if (l.dry_run) items.push([true, 'Rehearsal mode: approved orders are logged, not sent.']);
    }
    document.getElementById('gate').innerHTML = items.map(([ok, t]) => `<li class="${ok ? '' : 'warn'}">${ok ? CHECK : ALERT}<span>${esc(t)}</span></li>`).join('');
  }

  async fetchHoldings() {
    try {
      this.holdings = await window.astbApi('/api/holdings');
      this.renderHoldingsTable();
    } catch (e) {}
  }

  // ------------------------------------------------------------------ events & polling
  attachEvents() {
    document.getElementById('quick-add-btn').addEventListener('click', () => {
      const input = document.getElementById('quick-add-input');
      this.addToWatchlist(input.value);
      input.value = '';
    });
    document.getElementById('quick-add-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('quick-add-btn').click();
    });
    document.getElementById('tf-buttons').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tf]'); if (b) this.setTimeframe(b.dataset.tf);
    });
    // event delegation: no inline onclick handlers, so ticker text can never be run as code
    document.getElementById('watchlist-container').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { this.removeFromWatchlist(rm.dataset.remove); return; }
      const row = e.target.closest('[data-sym]'); if (row) this.selectSymbol(row.dataset.sym);
    });
    document.getElementById('watchlist-container').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('[data-sym]'); if (row) { e.preventDefault(); this.selectSymbol(row.dataset.sym); }
    });
    document.getElementById('holdings-table').addEventListener('click', (e) => {
      const row = e.target.closest('[data-sym]'); if (row) this.selectSymbol(row.dataset.sym);
    });

    const ticket = (side) => {
      const crypto = this.isCrypto(this.selectedSymbol);
      const qty = crypto ? parseFloat(document.getElementById('trade-qty').value) : parseInt(document.getElementById('trade-qty').value, 10);
      if (!qty || qty <= 0 || (!crypto && qty < 1)) { this.showChartError(crypto ? 'Enter how many coins (e.g. 0.001).' : 'Enter a whole number of shares (1 or more).'); setTimeout(() => this.showChartError(''), 2500); return; }
      if (window.astbChat) window.astbChat.proposeTrade(this.selectedSymbol, side, qty);
    };
    document.getElementById('trade-buy').addEventListener('click', () => ticket('buy'));
    document.getElementById('trade-sell').addEventListener('click', () => ticket('sell'));
  }

  startPolling() {
    this.fetchMetrics();
    this.fetchHoldings();
    this.fetchWatchlist();
    this.fetchSignal();
    setInterval(() => {
      if (document.hidden) return;
      this.fetchMetrics();
      this.fetchHoldings();
      this.fetchWatchlist();
    }, 15000);
    setInterval(() => { if (!document.hidden) this.fetchSignal(); }, 30000);
    setInterval(() => { if (!document.hidden) this.refreshMarkers(); }, 8000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new ASTBDashboard('app');
});
