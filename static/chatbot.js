// ASTB floating AI chat window: draggable, resizable, minimizable, with explicit buy/sell confirmation.
(function () {
  'use strict';

  const GEOM_KEY = 'astb.chat.geom.v1';
  const MIN_W = 300, MIN_H = 320;
  const YES_RE = /^(y|yes|yep|yeah|yup|confirm|confirmed|approve|approved|go ahead|do it|place it|place the order|yes please|yes,? (buy|sell))[.!\s]*$/i;
  const NO_RE = /^(n|no|nope|cancel|stop|decline|don'?t|do not|never ?mind|no thanks|abort|reject)[.!\s]*$/i;

  // ---------------------------------------------------------------- safe markdown (escapes HTML first)
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inline(t) {
    const codes = [];
    t = t.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `\u0000C${codes.length - 1}\u0000`; });
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>');
    t = t.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
    return t.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<code>${codes[+i]}</code>`);
  }

  function renderMarkdown(src) {
    const blocks = [];
    let text = esc(String(src).replace(/\u0000/g, ''));
    text = text.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (m, code) => { blocks.push(code.replace(/\n$/, '')); return `\u0000B${blocks.length - 1}\u0000`; });
    const out = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const line of text.split('\n')) {
      let m;
      if (/^\u0000B\d+\u0000$/.test(line.trim())) { flushPara(); flushList(); out.push(line.trim()); }
      else if ((m = line.match(/^\s*#{1,4}\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h4>${inline(m[1])}</h4>`); }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
      else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(inline(line)); }
    }
    flushPara(); flushList();
    return out.join('').replace(/\u0000B(\d+)\u0000/g, (m, i) => `<pre><code>${blocks[+i]}</code></pre>`);
  }
  window.astbRenderMarkdown = renderMarkdown;

  // ---------------------------------------------------------------- chat window
  class ASTBChat {
    constructor() {
      this.history = [];
      this.seen = new Set();
      this.cards = new Map();
      this.busy = false;
      this.unread = 0;
      this.geom = this.loadGeom();
      this.build();
      this.applyGeom();
      this.bind();
      this.welcome();
      this.loadProvider();
      this.pollPending();
      setInterval(() => this.pollPending(), 5000);
    }

    // ---- DOM
    build() {
      const launcher = document.createElement('button');
      launcher.id = 'astb-launcher';
      launcher.title = 'Open ASTB AI chat';
      launcher.innerHTML = '💬<span id="astb-badge"></span>';
      const win = document.createElement('div');
      win.id = 'astb-chat';
      win.setAttribute('role', 'dialog');
      win.setAttribute('aria-label', 'ASTB AI chat');
      const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => `<div class="rz" data-dir="${d}"></div>`).join('');
      win.innerHTML = `${handles}
        <div id="astb-head">
          <span class="t">ASTB assistant</span><span class="p" id="astb-provider">drag to move, resize from any edge</span>
          <button id="astb-clear" title="Clear chat" aria-label="Clear chat">🗑</button>
          <button id="astb-min" title="Minimize" aria-label="Minimize">–</button>
        </div>
        <div id="astb-msgs" aria-live="polite"></div>
        <div id="astb-chips"></div>
        <div id="astb-inputrow">
          <textarea id="astb-input" rows="1" placeholder="Ask anything…  (try: buy 5 NVDA)"></textarea>
          <button id="astb-send" title="Send">➤</button>
        </div>`;
      document.body.appendChild(launcher);
      document.body.appendChild(win);
      this.launcher = launcher; this.win = win;
      this.msgs = win.querySelector('#astb-msgs');
      this.input = win.querySelector('#astb-input');
      this.sendBtn = win.querySelector('#astb-send');
      this.badge = launcher.querySelector('#astb-badge');
      this.renderChips();
      this.setOpen(this.geom.open !== false);   // starts closed on a fresh browser (it used to cover the sidebar); remembers your last choice
    }

    renderChips() {
      const sym = () => (window.dashboard && window.dashboard.selectedSymbol) || 'NVDA';
      const chips = [
        ['🔥 Top sectors', () => 'Which sectors are currently profitable?'],
        ['📰 News', () => `What is the latest news for ${sym()}?`],
        ['🏛️ Fed & rates', () => 'How are Federal Reserve rates affecting tech stocks?'],
        ['🕯️ Candlesticks', () => 'Explain how to read candlestick charts.'],
        ['🎲 Any topic', () => 'Tell me something fascinating I probably don\'t know.'],
      ];
      const wrap = this.win.querySelector('#astb-chips');
      chips.forEach(([label, fn]) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => this.send(fn()));
        wrap.appendChild(b);
      });
    }

    welcome() {
      this.addMsg('bot', "Hi! I'm **ASTB AI**. Ask me about **anything** - markets, coding, science, writing, you name it.\n\n" +
        "Trading: type *buy 5 NVDA* or *sell 2 AAPL* and I'll ask for your **Yes / No** before anything is placed. " +
        "Add stocks with *add TSLA to watchlist*.");
    }

    // ---- geometry (drag / resize / persist)
    defaultGeom() {
      const w = Math.min(380, window.innerWidth - 24), h = Math.min(520, window.innerHeight - 24);
      return { x: 16, y: Math.max(8, window.innerHeight - h - 16), w, h, open: false };
    }
    loadGeom() {
      try { const g = JSON.parse(localStorage.getItem(GEOM_KEY)); if (g && g.w && g.h) return Object.assign(this.defaultGeom(), g); } catch (e) {}
      return this.defaultGeom();
    }
    saveGeom() { try { localStorage.setItem(GEOM_KEY, JSON.stringify(this.geom)); } catch (e) {} }
    clampGeom(g) {
      const vw = window.innerWidth, vh = window.innerHeight;
      g.w = Math.max(Math.min(MIN_W, vw - 8), Math.min(g.w, vw - 8));
      g.h = Math.max(Math.min(MIN_H, vh - 8), Math.min(g.h, vh - 8));
      g.x = Math.min(Math.max(0, g.x), vw - g.w);
      g.y = Math.min(Math.max(0, g.y), vh - g.h);
      return g;
    }
    applyGeom() {
      const g = this.clampGeom(this.geom);
      Object.assign(this.win.style, { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px' });
    }
    setOpen(open) {
      this.geom.open = open;
      this.win.classList.toggle('open', open);
      this.launcher.classList.toggle('show', !open);
      if (open) { this.unread = 0; this.updateBadge(); this.applyGeom(); this.scrollDown(); setTimeout(() => this.input.focus(), 0); }
      this.saveGeom();
    }
    updateBadge() {
      this.badge.textContent = this.unread;
      this.badge.classList.toggle('show', this.unread > 0);
      this.launcher.classList.toggle('pulse', this.unread > 0);
    }

    startPointer(e, mode, dir) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const target = e.currentTarget;
      const start = { px: e.clientX, py: e.clientY, g: Object.assign({}, this.geom) };
      document.body.classList.add('astb-dragging');
      try { target.setPointerCapture(e.pointerId); } catch (err) {}
      const move = (ev) => {
        const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
        let { x, y, w, h } = start.g;
        if (mode === 'drag') { x += dx; y += dy; }
        else {
          if (dir.includes('e')) w += dx;
          if (dir.includes('s')) h += dy;
          if (dir.includes('w')) { w -= dx; x += dx; }
          if (dir.includes('n')) { h -= dy; y += dy; }
          if (w < MIN_W) { if (dir.includes('w')) x -= (MIN_W - w); w = MIN_W; }
          if (h < MIN_H) { if (dir.includes('n')) y -= (MIN_H - h); h = MIN_H; }
          if (x < 0) { if (dir.includes('w')) w += x; x = 0; }
          if (y < 0) { if (dir.includes('n')) h += y; y = 0; }
          w = Math.min(w, window.innerWidth - x); h = Math.min(h, window.innerHeight - y);
        }
        Object.assign(this.geom, { x, y, w, h });
        this.applyGeom();
      };
      const up = () => {
        document.body.classList.remove('astb-dragging');
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        this.saveGeom();
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    }

    bind() {
      this.win.querySelector('#astb-head').addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        this.startPointer(e, 'drag');
      });
      this.win.querySelectorAll('.rz').forEach((h) => h.addEventListener('pointerdown', (e) => this.startPointer(e, 'resize', h.dataset.dir)));
      this.win.querySelector('#astb-head').addEventListener('dblclick', (e) => {
        if (!e.target.closest('button')) { this.geom = Object.assign(this.geom, this.defaultGeom(), { open: true }); this.applyGeom(); this.saveGeom(); }
      });
      window.addEventListener('resize', () => this.applyGeom());
      this.win.querySelector('#astb-min').addEventListener('click', () => this.setOpen(false));
      this.launcher.addEventListener('click', () => this.setOpen(true));
      this.win.querySelector('#astb-clear').addEventListener('click', () => this.clear());
      this.sendBtn.addEventListener('click', () => this.send(this.input.value));
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(this.input.value); }
      });
      this.input.addEventListener('input', () => {
        this.input.style.height = 'auto';
        this.input.style.height = Math.min(this.input.scrollHeight, 110) + 'px';
      });
    }

    // ---- messages
    scrollDown() { this.msgs.scrollTop = this.msgs.scrollHeight; }

    addMsg(role, text) {
      const el = document.createElement('div');
      el.className = 'astb-m ' + (role === 'user' ? 'user' : role === 'err' ? 'err' : 'bot');
      if (role === 'bot') el.innerHTML = renderMarkdown(text); else el.textContent = text;
      this.msgs.appendChild(el);
      this.scrollDown();
      return el;
    }

    clear() {
      this.history = [];
      this.cards.forEach((c) => { if (c.state === 'pending' && c.source !== 'bot') this.decide(c, false, true); });
      this.msgs.innerHTML = '';
      this.cards.forEach((c) => c.el.remove && c.el.remove());
      this.welcome();
      // keep any still-pending bot proposals visible
      this.cards.forEach((c) => { if (c.state === 'pending') this.msgs.appendChild(c.el); });
    }

    async loadProvider() {
      const p = this.win.querySelector('#astb-provider');
      try {
        const s = await window.astbApi('/api/chat/status');
        const names = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };
        p.textContent = s.provider ? `AI: ${names[s.provider] || s.provider}` : 'AI not connected (add an API key)';
      } catch (e) { p.textContent = 'server offline'; }
    }

    // ---- sending
    activeCard() {
      const last = this.msgs.lastElementChild;
      for (const c of this.cards.values()) if (c.el === last && c.state === 'pending' && c.source !== 'bot') return c;
      return null;
    }

    async send(raw) {
      const text = (raw || '').trim();
      if (!text || this.busy) return;
      this.input.value = ''; this.input.style.height = 'auto';
      if (!this.win.classList.contains('open')) this.setOpen(true);

      const card = this.activeCard();
      this.addMsg('user', text);
      if (card) {
        if (YES_RE.test(text)) { this.decide(card, true); return; }
        if (NO_RE.test(text)) { this.decide(card, false); return; }
        this.decide(card, false, true);          // user moved on: the safe default is "don't buy"
      }
      // any other still-open chat/manual order is cancelled too
      this.cards.forEach((c) => { if (c.state === 'pending' && c.source !== 'bot' && c !== card) this.decide(c, false, true); });

      this.history.push({ role: 'user', content: text });
      this.busy = true; this.sendBtn.disabled = true;
      const typing = this.addMsg('bot', '');
      typing.innerHTML = '<span class="astb-typing"><span></span><span></span><span></span></span>';
      try {
        const sym = (window.dashboard && window.dashboard.selectedSymbol) || 'NVDA';
        const data = await window.astbApi('/api/chat', { message: text, symbol: sym, history: this.history.slice(-12) });
        typing.remove();
        this.addMsg('bot', data.reply);
        this.history.push({ role: 'assistant', content: data.reply });
        if (data.provider) this.win.querySelector('#astb-provider').textContent = 'AI: ' + ({ gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' }[data.provider] || data.provider);
        if (data.action && data.action.type === 'confirm_trade') this.addCard(data.action.proposal);
        if (data.watchlist_changed && window.dashboard) {
          await window.dashboard.fetchWatchlist();
          if (data.select) window.dashboard.selectSymbol(data.select);
        }
      } catch (e) {
        typing.remove();
        this.addMsg('err', 'Connection problem: ' + e.message);
        this.history.pop();
      } finally {
        this.busy = false; this.sendBtn.disabled = false; this.input.focus();
      }
    }

    // ---- trading confirmation
    async proposeTrade(symbol, side, qty) {
      this.setOpen(true);
      try {
        const data = await window.astbApi('/api/trade/propose', { symbol, side, qty, source: 'manual' });
        this.addMsg('bot', 'I\'ve prepared this order. **Nothing is placed unless you confirm.**');
        this.addCard(data.proposal);
      } catch (e) { this.addMsg('err', "Can't prepare that order: " + e.message); }
    }

    addCard(p) {
      if (this.seen.has(p.id)) return;
      this.seen.add(p.id);
      const buy = p.side === 'buy';
      const el = document.createElement('div');
      el.className = 'astb-card' + (buy ? '' : ' sell');
      const money = (n) => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: Number(n) > 0 && Number(n) < 1 ? 6 : 2 });
      const warns = [];
      if (p.dry_run) warns.push('DRY RUN is on: approving will NOT send an order.');
      else if (p.paper) warns.push('Paper-trading account (no real money).');
      else warns.push('⚠ LIVE account: real money.');
      if (p.market_open === false) warns.push('Market is closed: the order will wait until the next open.');
      if (p.price_source === 'simulated') warns.push('Price shown is simulated: the real fill price will differ.');
      el.innerHTML = `
        <div class="ct">CONFIRM ORDER · ${buy ? 'BUY' : 'SELL'}</div>
        <div class="big">${buy ? 'BUY' : 'SELL'} ${esc(p.qty)} × ${esc(p.symbol)}</div>
        <div class="rows">Est. price: ${money(p.est_price)}<br>Est. total: <b>${money(p.est_cost)}</b>
          ${buy && p.stop_price ? `<br>Stop-loss: ${money(p.stop_price)} (${esc(p.stop_pct.toFixed(1))}% below)` : ''}</div>
        ${(p.notes || []).map((n) => `<div class="warn">${esc(n)}</div>`).join('')}
        ${warns.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
        ${p.source === 'bot' ? `<div class="from">🤖 Proposed by the trading bot${p.note ? ': ' + esc(p.note) : ''}</div>` : ''}
        <div class="q">Do you want me to place this order?</div>
        <div class="btns"><button class="yes">Yes, ${buy ? 'buy' : 'sell'}</button><button class="no">No, cancel</button></div>
        <div class="timer"></div><div class="result"></div>`;
      const card = { id: p.id, el, state: 'pending', source: p.source, expires: Date.now() + p.seconds_left * 1000 };
      this.cards.set(p.id, card);
      el.querySelector('.yes').addEventListener('click', () => this.decide(card, true));
      el.querySelector('.no').addEventListener('click', () => this.decide(card, false));
      card.timerEl = el.querySelector('.timer');
      const tickFn = () => {
        const left = Math.max(0, Math.round((card.expires - Date.now()) / 1000));
        card.timerEl.textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0 && card.state === 'pending') this.finish(card, 'expired', 'Expired. No order was placed.');
      };
      card.tick = setInterval(tickFn, 1000);
      tickFn();
      this.msgs.appendChild(el);
      this.scrollDown();
      if (!this.win.classList.contains('open')) { this.unread++; this.updateBadge(); }
    }

    finish(card, state, text) {
      card.state = state;
      clearInterval(card.tick);
      card.el.classList.add('done');
      card.el.querySelectorAll('button').forEach((b) => (b.disabled = true));
      card.timerEl.textContent = '';
      const r = card.el.querySelector('.result');
      r.textContent = text;
      r.className = 'result ' + (state === 'executed' ? 'ok' : state === 'failed' ? 'bad' : 'muted');
      this.scrollDown();
    }

    async decide(card, approve, silent = false) {
      if (card.state !== 'pending') return;
      card.state = 'sending';                                     // blocks double clicks
      card.el.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        const data = await window.astbApi('/api/trade/confirm', { proposal_id: card.id, approve });
        const p = data.proposal;
        if (p.status === 'executed') this.finish(card, 'executed', '✔ ' + p.result);
        else if (p.status === 'failed') this.finish(card, 'failed', '✖ ' + p.result);
        else if (p.status === 'declined') this.finish(card, 'declined', silent ? 'Cancelled. No order was placed.' : 'You declined. No order was placed.');
        else if (p.status === 'expired') this.finish(card, 'expired', 'Expired. No order was placed.');
        else this.finish(card, p.status, p.result || p.status);
        if (p.status === 'executed' && window.dashboard) { window.dashboard.fetchHoldings(); window.dashboard.fetchMetrics(); window.dashboard.refreshMarkers(); }
      } catch (e) {
        this.finish(card, 'failed', '✖ ' + e.message + (approve ? ' (No order was placed.)' : ''));
      }
    }

    // proposals created by the bot appear here for approval
    async pollPending() {
      try {
        const data = await window.astbApi('/api/trade/pending');
        data.pending.forEach((p) => { if (!this.seen.has(p.id)) this.addCard(p); });
      } catch (e) { /* server offline */ }
    }
  }

  window.addEventListener('DOMContentLoaded', () => { window.astbChat = new ASTBChat(); });
})();
