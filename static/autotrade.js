// ASTB trading mode switch: Manual (you click Buy/Sell, then Yes) or Auto bot (the model trades by itself).
(function () {
  'use strict';

  const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  class ASTBAuto {
    constructor(dash) {
      this.dash = dash;
      this.status = null;
      this.busy = false;
      this.timer = null;
      this.seg = document.getElementById('mode-seg');
      this.panel = document.getElementById('auto-panel');
      this.seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (b) this.choose(b.dataset.mode);
      });
      this.panel.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]')) this.choose('manual');
      });
      this.poll();
      setInterval(() => this.tickClock(), 1000);
    }

    async poll() {
      clearTimeout(this.timer);
      try { this.apply(await window.astbApi('/api/autotrade/status')); } catch (e) { /* server offline */ }
      this.timer = setTimeout(() => this.poll(), this.status && this.status.mode === 'auto' ? 4000 : 15000);
    }

    async choose(mode) {
      if (this.busy || (this.status && this.status.mode === mode)) return;
      if (mode === 'auto') {
        let st = this.status;
        try { st = await window.astbApi('/api/autotrade/status'); } catch (e) { /* use last known */ }
        const ok = await this.confirmDialog(st);
        if (!ok) return;
      }
      this.busy = true;
      try {
        this.apply(await window.astbApi('/api/autotrade/mode', { mode, ack: mode === 'auto' }));
        if (mode === 'auto') this.poll();
      } catch (e) {
        this.flash(e.message);
      } finally { this.busy = false; }
    }

    flash(msg) {
      const d = document.getElementById('mode-desc');
      d.textContent = msg; d.classList.add('err');
      setTimeout(() => { d.classList.remove('err'); this.renderMode(); }, 5000);
    }

    // ------------------------------------------------------------------ confirmation dialog
    confirmDialog(st) {
      return new Promise((resolve) => {
        const l = (st && st.limits) || {};
        const wrap = document.createElement('div');
        wrap.className = 'modal-back';
        const acct = l.dry_run ? 'Rehearsal mode (DRY_RUN): orders are logged, nothing is sent to Alpaca.'
          : l.paper === false ? 'LIVE account: real money.' : 'Paper-trading account: no real money.';
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="am-title">
            <h3 id="am-title">Turn on the auto bot?</h3>
            <p>The bot will <b>place orders by itself, without asking you</b>, until you switch back to Manual.</p>
            <ul>
              <li>Every ${esc(st && st.interval || 60)}s it checks your watchlist (${esc(((st && st.symbols) || []).join(', ') || 'empty')}).</li>
              <li><b class="up">Buys</b> when the AI model's chance of a rise is at least ${Math.round((l.buy_at || 0.6) * 100)}%, about ${esc(money0(l.position_usd || 1000))} per stock, with a ${esc(l.stop_loss_pct)}% stop-loss.</li>
              <li><b class="down">Sells</b> a stock you hold when that chance falls to ${Math.round((l.sell_at || 0.4) * 100)}% or lower.</li>
              <li>At most ${esc(l.max_positions)} open positions and ${esc(l.max_trades_per_day)} bot orders a day; new buys stop after a ${esc(l.daily_loss_pct)}% daily loss.</li>
              <li class="${l.paper === false ? 'warn' : ''}">${esc(acct)}</li>
            </ul>
            <p class="fine">The model is a simple educational one and can lose money. Not financial advice.</p>
            <label class="ack"><input type="checkbox" id="am-ack"> I understand the bot trades without asking me.</label>
            <div class="mbtns"><button type="button" class="btn" id="am-no">Cancel</button><button type="button" class="go buy" id="am-yes" disabled>Turn on auto bot</button></div>
          </div>`;
        document.body.appendChild(wrap);
        const done = (v) => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
        const onKey = (e) => { if (e.key === 'Escape') done(false); };
        document.addEventListener('keydown', onKey);
        const ack = wrap.querySelector('#am-ack'), yes = wrap.querySelector('#am-yes');
        ack.addEventListener('change', () => { yes.disabled = !ack.checked; });
        yes.addEventListener('click', () => done(true));
        wrap.querySelector('#am-no').addEventListener('click', () => done(false));
        wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(false); });
        ack.focus();
      });
    }

    // ------------------------------------------------------------------ rendering
    apply(st) {
      const prev = this.dash.tradeMode;
      this.status = st;
      this.dash.tradeMode = st.mode;
      this.renderMode();
      if (prev !== st.mode) { this.dash.renderGate(this.dash.gateLimits || null); }
      this.renderPanel();
    }

    renderMode() {
      const auto = this.status && this.status.mode === 'auto';
      this.seg.querySelectorAll('[data-mode]').forEach((b) => {
        const on = (b.dataset.mode === 'auto') === !!auto;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
        b.classList.toggle('auto', on && b.dataset.mode === 'auto');
      });
      document.getElementById('mode-desc').textContent = auto
        ? 'The bot is trading by itself. Switch back to Manual at any time to stop it.'
        : 'You place every order yourself. A Yes / No card appears in the chat first.';
      document.getElementById('manual-ticket').classList.toggle('hidden', !!auto);
      this.panel.classList.toggle('hidden', !auto);
      const chip = document.getElementById('chip-mode');
      chip.className = 'chip ' + (auto ? 'warn' : 'ok');
      document.getElementById('chip-mode-txt').textContent = auto ? 'Auto bot ON: orders are placed without asking' : 'Manual: every order needs your approval';
    }

    renderPanel() {
      const st = this.status;
      if (!st || st.mode !== 'auto') { this.panel.innerHTML = ''; return; }
      const l = st.limits || {};
      const rows = (st.scan || []).map((r) => {
        const pct = r.p_up == null ? '--' : Math.round(r.p_up * 100) + '%';
        const cls = /bought|wanted to buy/.test(r.decision) ? 'up' : /sold|wanted to sell/.test(r.decision) ? 'down' : /failed|error/.test(r.decision) ? 'down' : 'flat';
        return `<tr><td>${esc(r.symbol)}</td><td>${pct}</td><td class="${cls}">${esc(r.decision)}</td><td class="why">${esc(r.why || '')}</td></tr>`;
      }).join('');
      const log = (st.log || []).map((e) =>
        `<li class="${esc(e.kind)}"><time>${clock(e.ts)}</time><span>${esc(e.text)}</span></li>`).join('');
      this.panel.innerHTML = `
        <div class="ahead">
          <span class="run"><span class="pulse"></span>Auto bot running</span>
          <span id="auto-next" class="hint"></span>
          <button type="button" class="stopbtn" data-stop>Stop bot</button>
        </div>
        ${st.halted ? `<div class="awarn">${esc(st.halted)}</div>` : ''}
        <div class="hint">Buys at ${Math.round((l.buy_at || 0.6) * 100)}%+ chance of a rise, sells holdings at ${Math.round((l.sell_at || 0.4) * 100)}% or less.
          Orders today: ${esc(st.trades_today)} / ${esc(l.max_trades_per_day)}.${l.dry_run ? ' Rehearsal mode: orders are logged, not sent.' : ''}</div>
        <table class="atable"><thead><tr><th>Stock</th><th>Chance up</th><th>Decision</th><th>Why</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="hint">Waiting for the first scan…</td></tr>'}</tbody></table>
        <div class="hint" style="margin:10px 0 4px">Activity</div>
        <ul class="alog">${log || '<li class="info"><span>No activity yet.</span></li>'}</ul>`;
      this.tickClock();
    }

    tickClock() {
      const el = document.getElementById('auto-next');
      const st = this.status;
      if (!el || !st) return;
      if (st.scanning) el.textContent = 'Scanning now…';
      else if (st.next_scan) el.textContent = `Next scan in ${Math.max(0, Math.round(st.next_scan - Date.now() / 1000))}s`;
      else el.textContent = '';
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    // dashboard is created in its own DOMContentLoaded handler (dashboard.js loads first)
    window.astbAuto = new ASTBAuto(window.dashboard);
  });
})();
