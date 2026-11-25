// ASTB extras: toasts, equity curve, "why this signal", risk gauges, demo mode, keyboard shortcuts.
// Loaded after dashboard.js; it only adds panels and wraps a few methods, so it can be removed without breaking anything.
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let D = null;                       // the dashboard instance
  let demoActive = false;

  // ======================================================================== toasts
  const ICONS = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    err: '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    bot: '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>',
  };
  function toast(title, text, kind = 'info', ms = 5200) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `${ICONS[kind] || ICONS.info}<div><b>${esc(title)}</b>${text ? esc(text) : ''}</div><button class="x" aria-label="Dismiss">×</button>`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    el.querySelector('.x').addEventListener('click', close);
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    if (ms) setTimeout(close, ms);
  }
  window.astbToast = toast;

  // watch API traffic: confirmed orders and bot trades become toasts, and refresh the panels they affect
  let lastBotTs = null;
  function hookApi() {
    const orig = window.astbApi;
    window.astbApi = async function (url, body) {
      const res = await orig(url, body);
      try { onApi(String(url), res); } catch (e) { /* toasts are optional */ }
      return res;
    };
  }
  function onApi(url, res) {
    if (demoActive || !res) return;
    if (url.startsWith('/api/trade/confirm') && res.proposal) {
      const p = res.proposal;
      if (p.status === 'executed') {
        toast(`${String(p.side).toUpperCase()} ${p.qty} ${p.symbol}`, p.result || 'Order placed.', 'ok', 7000);
        setTimeout(() => { if (D) D.refreshMarkers(); loadRisk(); loadEquity(); }, 1500);
      } else if (p.status === 'declined') toast('Order cancelled', 'Nothing was sent.', 'info');
      else if (p.status === 'failed') toast('Order failed', p.result || '', 'err', 8000);
    } else if ((url.startsWith('/api/autotrade/status') || url.startsWith('/api/autotrade/crypto')) && Array.isArray(res.log)) {
      paintCrypto(res.crypto);
      const fresh = res.log.filter((e) => e.kind === 'trade');
      const newest = fresh.reduce((m, e) => Math.max(m, e.ts || 0), 0);
      if (lastBotTs === null) { lastBotTs = newest || Date.now() / 1000; return; }
      fresh.filter((e) => e.ts > lastBotTs).reverse().forEach((e) => toast('Auto bot', e.text, 'bot', 8000));
      if (newest > lastBotTs) { lastBotTs = newest; if (D) D.refreshMarkers(); loadRisk(); }
    }
  }

  // ======================================================================== equity curve
  let eqChart = null, eqPort = null, eqSpy = null, eqPeriod = '1M';
  function buildEquityPanel() {
    const anchor = $('#chart-anchor');
    if (!anchor || $('#eq-panel')) return;
    const s = document.createElement('section');
    s.className = 'panel'; s.id = 'eq-panel'; s.dataset.v = 'dashboard risk';
    s.innerHTML = `
      <div class="eqtop">
        <div class="hd"><h2>Portfolio performance</h2></div>
        <div class="eqstats">
          <div class="eqstat"><small>Return</small><b id="eq-ret">--</b></div>
          <div class="eqstat"><small>Max drawdown</small><b id="eq-dd" class="down">--</b></div>
          <div class="eqstat"><small>vs S&amp;P 500</small><b id="eq-vs">--</b></div>
        </div>
        <div class="seg" id="eq-seg" role="group" aria-label="Period"><button type="button" data-p="1D">1D</button><button type="button" data-p="1W">1W</button><button type="button" data-p="1M" class="on">1M</button></div>
      </div>
      <div id="eq-chart"></div>
      <div class="eqleg"><span><i style="background:var(--signal)"></i>Your portfolio</span><span><i style="background:#a78bfa"></i>S&amp;P 500 (SPY)</span><span class="eqnote hint" id="eq-note"></span></div>`;
    anchor.appendChild(s);
    $('#eq-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      eqPeriod = b.dataset.p;
      document.querySelectorAll('#eq-seg [data-p]').forEach((x) => x.classList.toggle('on', x === b));
      loadEquity();
    });
    try {
      const el = $('#eq-chart');
      eqChart = LightweightCharts.createChart(el, {
        width: el.clientWidth || 600, height: 250,
        layout: { background: { color: 'rgba(0,0,0,0)' }, textColor: css('--muted'), fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
        grid: { vertLines: { visible: false }, horzLines: { color: gridColor() } },
        rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 }, handleScroll: false, handleScale: false,
        localization: { priceFormatter: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' },
      });
      eqSpy = eqChart.addLineSeries({ color: '#a78bfa', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      eqPort = eqChart.addAreaSeries({ lineColor: css('--signal') || '#22d3ee', topColor: 'rgba(34,211,238,.35)', bottomColor: 'rgba(34,211,238,0)', lineWidth: 2, priceLineVisible: false });
      new ResizeObserver(() => { if (eqChart && el.clientWidth) eqChart.applyOptions({ width: el.clientWidth }); }).observe(el);
    } catch (e) {
      $('#eq-chart').innerHTML = '<div class="hint" style="padding:40px 0;text-align:center">Chart library not loaded. Check your internet connection.</div>';
      eqChart = null;
    }
    loadEquity();
  }
  const gridColor = () => (document.documentElement.dataset.theme === 'light' ? '#e3e9f2' : 'rgba(120,160,200,.10)');

  const norm = (arr, base) => {
    const seen = new Set(), out = [];
    for (const p of arr) { if (seen.has(p.time) || !base) continue; seen.add(p.time); out.push({ time: p.time, value: +((p.value / base - 1) * 100).toFixed(3) }); }
    return out.sort((a, b) => a.time - b.time);
  };
  async function loadEquity() {
    if (!$('#eq-panel')) return;
    try {
      const d = await window.astbApi(`/api/equity?period=${eqPeriod}`);
      if (!d.ok) return;
      const eq = d.equity.slice().sort((a, b) => a.time - b.time);
      const t0 = eq[0].time;
      const spy = (d.benchmark || []).filter((p) => p.time >= t0 - 3600).sort((a, b) => a.time - b.time);
      const pSeries = norm(eq, eq[0].value), sSeries = spy.length ? norm(spy, spy[0].value) : [];
      if (eqPort) { eqPort.setData(pSeries); eqSpy.setData(sSeries); eqChart.timeScale().fitContent(); }
      const ret = d.stats.return_pct, dd = d.stats.max_drawdown_pct;
      const sr = sSeries.length ? sSeries[sSeries.length - 1].value : null;
      const set = (id, t, cls) => { const el = $(id); el.textContent = t; if (cls) el.className = cls; };
      set('#eq-ret', `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`, ret >= 0 ? 'up' : 'down');
      set('#eq-dd', `${dd.toFixed(2)}%`, 'down');
      if (sr == null) set('#eq-vs', '--', 'flat'); else { const v = ret - sr; set('#eq-vs', `${v >= 0 ? '+' : ''}${v.toFixed(2)} pts`, v >= 0 ? 'up' : 'down'); }
      $('#eq-note').textContent = d.demo ? 'Sample data: ' + (d.note || 'connect Alpaca for your real curve') : 'Your Alpaca paper account';
    } catch (e) { $('#eq-note').textContent = 'Could not load performance.'; }
  }

  // ======================================================================== why this signal
  function buildWhyPanel() {
    const first = $('.col-right > .panel');
    if (!first || $('#why-panel')) return;
    const s = document.createElement('section');
    s.className = 'panel'; s.id = 'why-panel'; s.dataset.v = 'dashboard signals';
    s.innerHTML = `<div class="hd"><h2 id="why-title">Why this signal</h2><span class="engine" id="why-sym"></span></div>
      <div id="why-base" class="whybase"></div><div id="why-body" class="why"><div class="hint">Loading…</div></div>
      <div class="fine" id="why-note">Each bar shows how many percentage points this one factor adds to (green) or removes from (red) the chance of a rise, compared with a typical moment.</div>`;
    first.after(s);
  }
  let whyToken = 0;
  async function loadWhy() {
    if (demoActive || !D) return;
    const sym = D.selectedSymbol, tok = ++whyToken;
    $('#why-sym').textContent = sym;
    try {
      const v = await window.astbApi(`/api/explain/${encodeURIComponent(sym)}`);
      if (tok === whyToken && !demoActive) renderWhy(v);
    } catch (e) { if (tok === whyToken) renderWhy({ ok: false, reason: e.message }); }
  }
  function renderWhy(v) {
    const body = $('#why-body'), base = $('#why-base');
    if (!v.ok) { base.textContent = ''; body.innerHTML = `<div class="hint">${esc(v.reason || 'No explanation available right now.')}</div>`; return; }
    base.innerHTML = `<span>Typical moment <b>${Math.round(v.p_base * 100)}%</b></span><span>Right now <b>${Math.round(v.p_up * 100)}%</b></span>`;
    const max = Math.max(1, ...v.factors.map((f) => Math.abs(f.delta)));
    body.innerHTML = v.factors.map((f) => {
      const up = f.delta >= 0;
      return `<div class="wy"><div class="nm">${esc(f.label)}<span>${esc(f.value)} · ${esc(f.hint)}</span></div>
        <div class="bar"><i class="${up ? 'p' : 'n'}" data-w="${(Math.abs(f.delta) / max * 50).toFixed(1)}"></i></div>
        <div class="dl ${up ? 'up' : 'down'}">${up ? '+' : '−'}${Math.abs(f.delta).toFixed(1)}</div></div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => body.querySelectorAll('i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; })));
  }

  // ======================================================================== risk gauges
  function buildRiskPanel() {
    const right = $('.col-right');
    if (!right || $('#risk-panel')) return;
    const s = document.createElement('section');
    s.className = 'panel'; s.id = 'risk-panel'; s.dataset.v = 'dashboard risk';
    s.innerHTML = `<div class="hd"><h2>Risk limits</h2><span class="engine" id="risk-tag"></span></div><div class="rings" id="rings"></div><div id="riskmsg" class="riskmsg"></div>`;
    right.appendChild(s);
  }
  const R = 40, C = 2 * Math.PI * R;
  function ring(label, frac, value, sub) {
    const f = Math.max(0, Math.min(1, frac || 0));
    return `<div class="ring ${f >= .8 ? 'hi' : f >= .5 ? 'mid' : ''}"><div class="box"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="tr" cx="50" cy="50" r="${R}"/>
      <circle class="fg" cx="50" cy="50" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - f)).toFixed(1)}"/></svg>
      <div class="val"><span>${esc(value)}<small>${esc(sub)}</small></span></div></div><div class="lb">${esc(label)}</div></div>`;
  }
  async function loadRisk() {
    if (!$('#risk-panel') || demoActive) return;
    try {
      const r = await window.astbApi('/api/risk');
      const loss = Math.max(0, -r.day_pnl_pct);
      const cap = r.max_position_usd * r.max_positions;
      const k = (n) => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + Math.round(n);
      $('#rings').innerHTML =
        ring('Daily loss', loss / r.loss_limit_pct, `${r.day_pnl_pct >= 0 ? '+' : '−'}${Math.abs(r.day_pnl_pct).toFixed(2)}%`, `limit ${r.loss_limit_pct}%`) +
        ring('Positions', r.positions / r.max_positions, `${r.positions}/${r.max_positions}`, 'open') +
        ring('Bot trades', r.trades_today / r.max_trades_per_day, `${r.trades_today}/${r.max_trades_per_day}`, 'today') +
        ring('Exposure', r.exposure_usd / cap, k(r.exposure_usd), `of ${k(cap)}`);
      $('#risk-tag').textContent = r.demo ? 'sample' : (r.dry_run ? 'rehearsal' : 'live data');
      $('#riskmsg').textContent = r.halted || '';
    } catch (e) { /* panel keeps its last state */ }
  }

  // ======================================================================== chart theme + transparency
  function themeChart() {
    const light = document.documentElement.dataset.theme === 'light';
    const text = light ? '#556579' : '#7d8b9f';
    if (D && D.chart) D.chart.applyOptions({
      layout: { background: { color: 'rgba(0,0,0,0)' }, textColor: text },
      grid: { vertLines: { color: light ? '#e3e9f2' : 'rgba(120,160,200,.08)' }, horzLines: { color: light ? '#e3e9f2' : 'rgba(120,160,200,.08)' } },
      rightPriceScale: { borderColor: light ? '#d8e0ec' : '#1c2533' }, timeScale: { borderColor: light ? '#d8e0ec' : '#1c2533' },
    });
    if (eqChart) {
      eqChart.applyOptions({ layout: { textColor: text }, grid: { horzLines: { color: gridColor() } } });
      eqPort.applyOptions({ lineColor: css('--signal') });
    }
  }

  // ======================================================================== demo mode
  const wait = { skip: null, cancel: false };
  const pause = (ms) => new Promise((res, rej) => {
    if (!demoActive) { rej(new Error('stop')); return; }
    const t = setTimeout(() => { wait.skip = null; res(); }, ms);
    wait.skip = () => { clearTimeout(t); wait.skip = null; res(); };
    wait.rej = () => { clearTimeout(t); rej(new Error('stop')); };
  });
  const spot = (...els) => {
    document.querySelectorAll('.demo-spot').forEach((e) => e.classList.remove('demo-spot'));
    els.filter(Boolean).forEach((e) => { const p = e.closest('.panel, .cell') || e; p.classList.add('demo-spot'); });
    const f = els.filter(Boolean)[0];
    if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  async function startDemo() {
    if (demoActive) { stopDemo(); return; }
    if (!D) return;
    demoActive = true; wait.cancel = false;
    document.body.classList.add('demo-on');
    const rib = document.createElement('div'); rib.className = 'demo-ribbon'; rib.id = 'demo-ribbon'; rib.textContent = 'DEMO · NOTHING IS SENT TO A BROKER';
    document.body.appendChild(rib);
    const bar = document.createElement('div'); bar.id = 'demo-bar';
    bar.innerHTML = `<div><div class="dtag">GUIDED DEMO</div><div class="dt1" id="dm-t"></div></div>
      <div class="dbtns"><button class="btn" id="dm-next" type="button">Next ▸</button><button class="btn" id="dm-stop" type="button">Exit (Esc)</button></div>
      <div class="dt2" id="dm-d"></div><div class="dsteps" id="dm-s"></div>`;
    document.body.appendChild(bar);
    $('#dm-next').addEventListener('click', () => wait.skip && wait.skip());
    $('#dm-stop').addEventListener('click', stopDemo);
    const nav = $('.nav-i[data-view="dashboard"]'); if (nav) nav.click();

    const price = (D.lastBar && D.lastBar.close) || 128.4;
    const lim = D.gateLimits || {};
    const stopPct = lim.stop_loss_pct || 1;
    const fakeSignal = (p) => ({ ok: true, engine: 'model', p_up: p, buy_at: lim.buy_at || 0.6, sell_at: lim.sell_at || 0.4, limits: D.gateLimits || null,
      readings: [
        { label: 'Momentum, last 30 min', value: '+0.42%', tone: 'up', note: 'rising' },
        { label: 'Trend, fast vs slow average', value: '+0.21%', tone: 'up', note: 'uptrend' },
        { label: 'RSI (14)', value: '62', tone: 'flat', note: 'strong' },
        { label: 'Volume vs normal', value: '+2.3σ', tone: 'flat', note: 'unusually busy' },
        { label: 'Volatility (20 bars)', value: '0.14%', tone: 'flat', note: 'moderate' }] });
    const fakeWhy = { ok: true, p_up: 0.71, p_base: 0.38, factors: [
      { label: 'Move, last 30 min', value: '+0.42%', hint: 'momentum', delta: 12.4 }, { label: 'Volume vs normal', value: '+2.3σ', hint: 'unusual activity', delta: 8.1 },
      { label: 'Market (SPY) move, 30 min', value: '+0.18%', hint: 'what the whole market is doing', delta: 5.6 }, { label: 'Fast vs slow average', value: '+0.21%', hint: 'trend direction', delta: 3.2 },
      { label: 'Volatility', value: '0.14%', hint: 'how jumpy the price is', delta: -2.4 }, { label: 'Time of day', value: '10:35', hint: 'time of the trading day', delta: -1.1 }] };

    const steps = [
      ['1 · Pick a stock', 'Your watchlist updates live. Click any stock to chart it and get its AI signal.', 5200, async () => { spot($('#watchlist-container')); D.selectSymbol('NVDA'); }],
      ['2 · A live chart you can draw on', 'Candles stream in every few seconds. Use the tools on the left to draw trend lines and levels; drag up/down to scroll the price axis.', 5600, async () => spot($('#candlestickChart'))],
      ['3 · The AI reads the market', 'A gradient-boosted model scores the last bars and outputs the chance the price rises more than trading costs in the next 30 minutes.', 6200, async () => {
        spot($('#sig-read')); D.renderSignal(fakeSignal(0.5)); await sleep(900); D.renderSignal(fakeSignal(0.71)); }],
      ['4 · Why does it think that?', 'Not a black box: each bar shows how much one factor pushes the odds up (green) or down (red) compared with a typical moment.', 6500, async () => { spot($('#why-panel')); renderWhy(fakeWhy); }],
      ['5 · Safety comes first', 'Every order must pass the gate: stop-loss on each buy, a daily-loss halt, an order cap and a maximum number of open positions.', 6000, async () => { spot($('#gate'), $('#rings')); }],
      ['6 · You stay in control', 'The AI only proposes. In Manual mode nothing is sent until you press Yes on the order card.', 3800, async () => { spot($('#candlestickChart')); await sleep(300); await showFakeOrder(price, stopPct); }],
      ['7 · Order filled, shown on the chart', 'Executed orders appear as arrows on the chart, with a notification. (Demo: nothing was really sent.)', 5600, async () => {
        toast(`DEMO · BUY 5 ${D.selectedSymbol}`, 'Filled (demo only). Stop-loss attached.', 'ok', 5200);
        if (D.lastBar && D.candlestickSeries.setMarkers) D.candlestickSeries.setMarkers([{ time: D.lastBar.time, position: 'belowBar', color: '#34d399', shape: 'arrowUp', text: 'DEMO BUY 5' }]);
        spot($('#candlestickChart')); }],
      ['8 · Track performance', 'Your portfolio is compared with the S&P 500, with drawdown and return at a glance.', 5200, async () => { spot($('#eq-panel')); }],
      ['9 · Manual or Auto — your call', 'Flip the switch under the chart to let the bot run steps 3–7 by itself, inside the same safety limits. Press Exit to finish.', 6500, async () => { spot($('.trade-mode')); }],
    ];
    const dots = $('#dm-s'); dots.innerHTML = steps.map(() => '<i></i>').join('');
    try {
      for (let i = 0; i < steps.length; i++) {
        const [t, d, ms, fn] = steps[i];
        $('#dm-t').textContent = t; $('#dm-d').textContent = d;
        dots.querySelectorAll('i').forEach((x, j) => x.classList.toggle('on', j <= i));
        $('#dm-next').textContent = i === steps.length - 1 ? 'Finish' : 'Next ▸';
        if (!demoActive) break;
        await fn();
        if (!demoActive) break;
        await pause(ms);
      }
    } catch (e) { /* stopped */ }
    stopDemo();
  }

  async function showFakeOrder(price, stopPct) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back'; wrap.id = 'demo-modal';
    const cost = (price * 5).toFixed(2), stop = (price * (1 - stopPct / 100)).toFixed(2);
    wrap.innerHTML = `<div class="modal" role="dialog" aria-label="Demo order"><h3>Confirm order <span class="tag">DEMO</span></h3>
      <div class="fakecard"><div class="row"><span>Action</span><b class="up">BUY 5 ${esc(D.selectedSymbol)}</b></div><div class="row"><span>Estimated cost</span><b>$${cost}</b></div>
      <div class="row"><span>Stop-loss</span><b>$${stop} (−${stopPct}%)</b></div><div class="row"><span>Source</span><b>AI proposal</b></div></div>
      <p class="fine">Nothing is sent to a broker in demo mode.</p>
      <div class="mbtns"><button class="btn" type="button">No</button><button class="go buy" id="dm-yes" type="button">Yes, place order</button></div></div>`;
    document.body.appendChild(wrap);
    try { await pause(2400); $('#dm-yes').classList.add('clicking'); await sleep(1100); } finally { wrap.remove(); }
  }

  function stopDemo() {
    if (!demoActive) return;
    demoActive = false;
    if (wait.rej) { const r = wait.rej; wait.rej = null; wait.skip = null; r(); }
    document.body.classList.remove('demo-on');
    document.querySelectorAll('.demo-spot').forEach((e) => e.classList.remove('demo-spot'));
    ['demo-bar', 'demo-ribbon', 'demo-modal'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    if (D) { D.fetchSignal(); D.refreshMarkers(); }
    loadWhy(); loadRisk();
  }


  // ======================================================================== crypto: quick-add coins + opt-in crypto bot
  const COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'LTC', 'AVAX'];
  function buildCrypto() {
    const input = $('#quick-add-input');
    if (input && !$('#coin-chips')) {
      const row = document.createElement('div');
      row.id = 'coin-chips'; row.className = 'coinrow';
      row.innerHTML = '<span>Coins, 24/7:</span>' + COINS.map((c) => `<button type="button" data-coin="${c}">+ ${c}</button>`).join('');
      (input.closest('.hd') || input.parentElement).after(row);
      row.addEventListener('click', (ev) => { const b = ev.target.closest('[data-coin]'); if (b) D.addToWatchlist(b.dataset.coin); });
    }
    const mode = $('.trade-mode');
    if (mode && !$('#crypto-bot')) {
      const row = document.createElement('div');
      row.id = 'crypto-bot'; row.className = 'cryptobot';
      row.innerHTML = `<label class="sw"><input type="checkbox" id="cb-toggle"><i></i><span>Crypto bot <small>(own engine, runs 24/7 on its own)</small></span></label>
        <span class="hint" id="cb-desc">Off: coins are manual only. The AI model is stock-only, so the crypto bot uses a simple trend + RSI rule.</span>
        <div class="cb-live hidden" id="cb-live"></div>`;
      mode.after(row);
      $('#cb-toggle').addEventListener('change', async (ev) => {
        const on = ev.target.checked;
        ev.target.checked = !on;                       // the real state comes back from the server
        if (on && !(await confirmCrypto())) return;
        try { await window.astbApi('/api/autotrade/crypto', { enabled: on, confirm: on }); loadStatusSoon(); }
        catch (err) { toast('Crypto bot', err.message, 'err', 7000); }
      });
    }
  }
  const loadStatusSoon = () => { if (window.astbAuto && window.astbAuto.poll) window.astbAuto.poll(); else window.astbApi('/api/autotrade/status').catch(() => {}); };
  let cryptoState = null;
  const fmtPx = (n) => '$' + (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(3));
  function liveText() {
    const c = cryptoState, box = $('#cb-live'); if (!box || !c) return;
    box.classList.toggle('hidden', !c.enabled);
    if (!c.enabled) return;
    const nd = c.next_decision ? Math.max(0, Math.round(c.next_decision - Date.now() / 1000)) : null;
    const hb = c.last_risk ? Math.round(Date.now() / 1000 - c.last_risk) : null;
    const pos = (c.holdings || []).map((h) => `<li><b>${esc(h.symbol)}</b> ${h.qty} @ ${fmtPx(h.entry)} · now ${fmtPx(h.price)} `
      + `<span class="${h.pnl_pct >= 0 ? 'up' : 'dn'}">${h.pnl_pct >= 0 ? '+' : ''}${h.pnl_pct}%</span> · stop ${fmtPx(h.stop)}</li>`).join('');
    box.innerHTML = `<div class="cb-row"><span>Next decision: <b>${nd === null ? 'now' : Math.floor(nd / 60) + ':' + String(nd % 60).padStart(2, '0')}</b></span>`
      + `<span>Stop-loss check: <b class="${c.risk_ok === false ? 'dn' : ''}">${c.risk_ok === false ? 'NO PRICE FEED' : hb === null ? 'starting' : hb + 's ago'}</b></span>`
      + `<span>Trades today: <b>${c.trades_today}/${c.max_trades_per_day}</b></span></div>`
      + (c.halted ? `<div class="cb-warn">${esc(c.halted)}</div>` : '')
      + (pos ? `<ul class="cb-pos">${pos}</ul>` : '<div class="cb-none">No coins held right now.</div>');
  }
  function paintCrypto(c) {
    const t = $('#cb-toggle'); if (!t || !c) return;
    cryptoState = c;
    t.checked = !!c.enabled;
    $('#cb-desc').textContent = c.enabled
      ? `On, independent of the stock Auto bot: about $${c.order_usd} per buy, max ${c.max_positions} coins, decides every ${Math.round(c.decision_s / 60)} min, `
        + `stop-loss ${c.stop_pct}% to ${c.stop_max_pct}% (adapts to volatility${c.trailing ? ', trails the high' : ''}) checked every ${c.risk_s} s.`
      : 'Off: coins are manual only. The AI model is stock-only, so the crypto bot uses a simple trend + RSI rule.';
    liveText();
  }
  setInterval(() => { if (!document.hidden) liveText(); }, 1000);
  function confirmCrypto() {
    return new Promise((resolve) => {
      const w = document.createElement('div'); w.className = 'modal-back';
      w.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Let the bot trade crypto?</h3>
        <p>The crypto bot runs on its own (even if the stock Auto bot is off) and will buy and sell the coins in your watchlist <b>without asking you</b>, around the clock while this server is running.</p>
        <ul><li>It uses a plain <b>trend + RSI rule</b>. This rule has <b>not been back-tested</b>, and the stock AI model is not used.</li>
        <li>Coins trade 24/7, so it can act at night.</li>
        <li>Alpaca cannot attach a stop-loss to coin orders, so the bot checks its own stop every few seconds. It only protects you while this server is running and online, and in a fast crash it can fill below the stop.</li><li>It only buys when the trend gap is big enough to cover fees. That makes it trade less, not win more.</li>
        <li>Fees are roughly 0.15% to 0.25% per trade, much more than stocks.</li></ul>
        <p class="fine">Educational project, paper trading. Not financial advice.</p>
        <label class="ack"><input type="checkbox" id="cb-ack"> I understand the bot will trade coins without asking me.</label>
        <div class="mbtns"><button type="button" class="btn" id="cb-no">Cancel</button><button type="button" class="go buy" id="cb-yes" disabled>Turn on crypto bot</button></div></div>`;
      document.body.appendChild(w);
      const done = (v) => { w.remove(); resolve(v); };
      const ack = w.querySelector('#cb-ack'), yes = w.querySelector('#cb-yes');
      ack.addEventListener('change', () => { yes.disabled = !ack.checked; });
      yes.addEventListener('click', () => done(true)); w.querySelector('#cb-no').addEventListener('click', () => done(false));
      w.addEventListener('mousedown', (ev) => { if (ev.target === w) done(false); });
    });
  }

  // ======================================================================== keyboard shortcuts
  const SHORTCUTS = [
    ['B / S', 'Prepare a Buy / Sell card for the chosen stock (you still press Yes)'], ['[ and ]', 'Previous / next stock in the watchlist'],
    ['1 – 6', 'Dashboard, Markets, AI signals, Risk, World markets, Bot activity'], ['/', 'Open the chat and start typing'],
    ['T', 'Light / dark theme'], ['F', 'Cycle graphics quality (Off, Balanced, Ultra)'], ['D', 'Start / stop the guided demo'], ['?', 'Show this list'], ['Esc', 'Close panels, stop the demo'],
  ];
  function help() {
    if ($('#help-modal')) return;
    const w = document.createElement('div'); w.className = 'modal-back'; w.id = 'help-modal';
    w.innerHTML = `<div class="modal" role="dialog" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3>
      <dl class="keys">${SHORTCUTS.map(([k, d]) => `<dt><kbd>${k}</kbd></dt><dd>${esc(d)}</dd>`).join('')}</dl>
      <div class="mbtns"><button class="btn" type="button">Close</button></div></div>`;
    w.addEventListener('click', (e) => { if (e.target === w || e.target.closest('.btn')) w.remove(); });
    document.body.appendChild(w);
  }
  function keys() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') { const h = $('#help-modal'); if (h) h.remove(); if (demoActive) stopDemo(); return; }
      if (typing || $('.modal-back')) return;
      const k = e.key;
      const views = ['dashboard', 'markets', 'signals', 'risk', 'world', 'logs'];
      if (k >= '1' && k <= '6') { const b = $(`.nav-i[data-view="${views[+k - 1]}"]`); if (b) b.click(); }
      else if (k === 'b' || k === 's') { const b = $(k === 'b' ? '#trade-buy' : '#trade-sell'); if (b && b.offsetParent) { e.preventDefault(); b.click(); } }
      else if (k === '[' || k === ']') {
        const list = (D && D.watchlist || []).map((w) => w.symbol); if (!list.length) return;
        const i = list.indexOf(D.selectedSymbol); D.selectSymbol(list[(i + (k === ']' ? 1 : -1) + list.length) % list.length]);
      }
      else if (k === '/') { e.preventDefault(); if (window.astbChat && window.astbChat.setOpen) window.astbChat.setOpen(true); setTimeout(() => { const i = $('#astb-input'); if (i) i.focus(); }, 80); }
      else if (k === 't') window.astbFX && window.astbFX.toggleTheme();
      else if (k === 'f') window.astbFX && window.astbFX.cycleQuality();
      else if (k === 'd') startDemo();
      else if (k === '?') help();
    });
  }

  // ======================================================================== boot
  function ui() {
    const wrap = $('.topbar .tbtns') || (() => { const c = $('.topbar .chips'); if (!c) return null; const w = document.createElement('div'); w.className = 'tbtns'; c.prepend(w); return w; })();
    if (!wrap) return;
    const demo = document.createElement('button');
    demo.type = 'button'; demo.className = 'tbtn demo'; demo.id = 'demo-btn'; demo.title = 'Guided demo (D)'; demo.textContent = '▶ Demo';
    demo.addEventListener('click', startDemo);
    const q = document.createElement('button');
    q.type = 'button'; q.className = 'tbtn'; q.id = 'help-btn'; q.title = 'Keyboard shortcuts (?)'; q.setAttribute('aria-label', 'Keyboard shortcuts'); q.textContent = '?';
    q.addEventListener('click', help);
    wrap.append(demo, q);
  }

  function boot() {
    D = window.dashboard;
    if (!D) { setTimeout(boot, 100); return; }
    hookApi();
    ui(); buildEquityPanel(); buildWhyPanel(); buildRiskPanel(); buildCrypto(); keys();
    const f = D.fetchSignal.bind(D);
    D.fetchSignal = async function () { if (demoActive) return; const r = await f(); loadWhy(); return r; };
    const rm = D.refreshMarkers.bind(D);          // the 8-second marker refresh must not erase the demo's pretend fill
    D.refreshMarkers = async function () { if (demoActive) return; return rm(); };
    themeChart(); window.addEventListener('astb-theme', themeChart);
    loadWhy(); loadRisk();
    setInterval(() => { if (!document.hidden) loadRisk(); }, 10000);
    setInterval(() => { if (!document.hidden) loadEquity(); }, 60000);
    setTimeout(themeChart, 800);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
})();
