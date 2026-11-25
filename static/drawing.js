// ASTB chart drawing tools + vertical (price) scrolling.
//
//  * ChartDrawings: a canvas laid over the candlestick chart. Drawings are stored as (time, price) pairs, so they
//    stay glued to the candles when you pan or zoom, survive timeframe changes, and are remembered per stock.
//  * PriceScaleControl: lets you move the chart up/down (drag, Shift + mouse wheel, or drag the price axis to
//    stretch it). The "Auto" button snaps back to automatic fitting.
(function () {
  'use strict';

  const SAVE_PREFIX = 'astb.draw.v1.';
  const COLORS = ['#7aa7ff', '#34d399', '#fb7185', '#fbbf24', '#c084fc', '#e8edf8'];
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const FIB_COLORS = ['#8c98b8', '#fb7185', '#fbbf24', '#34d399', '#7aa7ff', '#c084fc', '#8c98b8'];
  const HIT_PX = 7;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

  const TOOLS = [
    { id: 'cursor', name: 'Select / move', key: 'V', icon: svg('<path d="M6 3l12 7.5-5.2 1.4L10.4 17z"/>') },
    { id: 'trend', name: 'Trend line', key: 'T', pts: 2, icon: svg('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>') },
    { id: 'ray', name: 'Ray (extends to the right)', key: 'Y', pts: 2, icon: svg('<path d="M5 18L21 7"/><circle cx="5" cy="18" r="1.8"/><path d="M17 6.5l4 .5-1.2 3.8"/>') },
    { id: 'hline', name: 'Horizontal line (price level)', key: 'H', pts: 1, icon: svg('<path d="M3 12h18"/><circle cx="12" cy="12" r="1.8"/>') },
    { id: 'vline', name: 'Vertical line (time)', key: 'L', pts: 1, icon: svg('<path d="M12 3v18"/><circle cx="12" cy="12" r="1.8"/>') },
    { id: 'rect', name: 'Rectangle', key: 'R', pts: 2, icon: svg('<rect x="4.5" y="6.5" width="15" height="11" rx="1"/>') },
    { id: 'fib', name: 'Fibonacci retracement', key: 'F', pts: 2, icon: svg('<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>') },
    { id: 'measure', name: 'Measure (price, % and time)', key: 'M', pts: 2, icon: svg('<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>') },
    { id: 'text', name: 'Text note', key: 'N', pts: 1, icon: svg('<path d="M5 6h14M12 6v13M9 19h6"/>') },
    { id: 'brush', name: 'Brush (freehand)', key: 'B', pts: 0, icon: svg('<path d="M3 21c3 0 5-1 6-3l9.5-12 2 2-12 9.5c-2 1-3 3-5.5 3.5z"/>') },
  ];
  const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

  const distSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  const fmtP = (p) => (Math.abs(p) >= 1000 ? p.toFixed(1) : p.toFixed(2));
  const fmtDur = (s) => {
    s = Math.abs(s);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  };

  // =================================================================================================== drawings
  class ChartDrawings {
    constructor(dash, wrap) {
      this.dash = dash;
      this.wrap = wrap;
      this.items = [];
      this.undoStack = [];
      this.tool = 'cursor';
      this.keep = false;            // stay in the same tool after each drawing
      this.magnet = true;           // snap to candle open/high/low/close
      this.hidden = false;
      this.color = COLORS[0];
      this.width = 2;
      this.selected = null;
      this.draft = null;
      this.drag = null;
      this.hover = null;
      this.sym = null;
      this.sig = '';
      this.dirty = true;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'draw-canvas';
      wrap.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.buildToolbar();
      this.bind();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    // ----------------------------------------------------------------- toolbar
    buildToolbar() {
      const bar = document.getElementById('draw-tools');
      const btn = (id, title, inner, extra = '') => `<button type="button" class="dt ${extra}" data-act="${id}" title="${title}" aria-label="${title}">${inner}</button>`;
      bar.innerHTML =
        TOOLS.map((t) => btn('tool:' + t.id, `${t.name} (${t.key})`, t.icon)).join('') +
        '<div class="dsep"></div>' +
        btn('magnet', 'Snap to candle prices (on/off)', svg('<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/><path d="M6 8h4M14 8h4"/>')) +
        btn('keep', 'Keep the tool selected after drawing', svg('<rect x="5.5" y="11" width="13" height="9" rx="1.5"/><path d="M8.5 11V8a3.5 3.5 0 017 0v3"/>')) +
        `<label class="dt colorbtn" title="Colour of new / selected drawing"><span id="draw-swatch" style="background:${this.color}"></span><input id="draw-color" type="color" value="${this.color}" aria-label="Drawing colour"></label>` +
        btn('width', 'Line thickness', svg('<path d="M4 12h16"/>'));
      const acts =
        btn('undo', 'Undo (Ctrl+Z)', svg('<path d="M9 8L5 12l4 4"/><path d="M5 12h9a5 5 0 010 10"/>')) +
        btn('delete', 'Delete selected (Del)', svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>')) +
        btn('hide', 'Show / hide all drawings', svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>')) +
        btn('clear', 'Remove all drawings on this stock', svg('<path d="M4 4l16 16M20 4L4 20"/>'));
      const bar2 = document.getElementById('draw-actions');
      if (bar2) bar2.innerHTML = acts; else bar.insertAdjacentHTML('beforeend', '<div class="dsep"></div>' + acts);
      const onClick = (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act.startsWith('tool:')) this.setTool(act.slice(5));
        else if (act === 'magnet') { this.magnet = !this.magnet; this.syncToolbar(); }
        else if (act === 'keep') { this.keep = !this.keep; this.syncToolbar(); }
        else if (act === 'width') this.cycleWidth();
        else if (act === 'undo') this.undo();
        else if (act === 'delete') this.deleteSelected();
        else if (act === 'hide') { this.hidden = !this.hidden; this.selected = null; this.cancelDraft(); this.syncToolbar(); this.dirty = true; }
        else if (act === 'clear') this.clearAll();
      };
      bar.addEventListener('click', onClick);
      if (bar2) bar2.addEventListener('click', onClick);
      const color = document.getElementById('draw-color');
      color.addEventListener('input', () => this.setColor(color.value));
      this.bar = bar;
      this.syncToolbar();
    }

    syncToolbar() {
      document.querySelectorAll('#draw-tools [data-act], #draw-actions [data-act]').forEach((b) => {
        const a = b.dataset.act;
        let on = false;
        if (a.startsWith('tool:')) on = this.tool === a.slice(5);
        else if (a === 'magnet') on = this.magnet;
        else if (a === 'keep') on = this.keep;
        else if (a === 'hide') on = this.hidden;
        b.classList.toggle('on', on);
        if (a === 'undo') b.disabled = !this.undoStack.length;
        if (a === 'delete') b.disabled = !this.selected;
        if (a === 'clear') b.disabled = !this.items.length;
      });
      this.wrap.classList.toggle('drawing-active', this.tool !== 'cursor' && !this.hidden);
      const w = this.bar.querySelector('[data-act="width"]');
      if (w) w.dataset.w = this.currentWidth();
      document.getElementById('draw-swatch').style.background = this.currentColor();
    }

    currentColor() { const s = this.sel(); return s ? s.color : this.color; }
    currentWidth() { const s = this.sel(); return s ? s.width : this.width; }
    sel() { return this.items.find((d) => d.id === this.selected) || null; }

    setTool(id) {
      if (!TOOL_BY_ID[id]) return;
      if (this.hidden && id !== 'cursor') { this.hidden = false; this.dirty = true; }
      this.cancelDraft();
      this.tool = id;
      if (id !== 'cursor') this.selected = null;
      this.syncToolbar();
      this.dirty = true;
    }

    setColor(c) {
      this.color = c;
      const s = this.sel();
      if (s) { this.pushUndo(); s.color = c; this.save(); }
      this.syncToolbar(); this.dirty = true;
    }

    cycleWidth() {
      const order = [1, 2, 3, 4];
      const s = this.sel();
      const next = order[(order.indexOf(this.currentWidth()) + 1) % order.length];
      if (s) { this.pushUndo(); s.width = next; this.save(); } else this.width = next;
      this.syncToolbar(); this.dirty = true;
    }

    // ----------------------------------------------------------------- persistence + undo
    setSymbol(sym) {
      if (sym === this.sym) return;
      this.sym = sym;
      this.items = []; this.undoStack = []; this.selected = null; this.draft = null; this.drag = null;
      try { this.items = JSON.parse(localStorage.getItem(SAVE_PREFIX + sym) || '[]') || []; } catch (e) { this.items = []; }
      this.syncToolbar(); this.dirty = true;
    }
    save() {
      try {
        if (this.items.length) localStorage.setItem(SAVE_PREFIX + this.sym, JSON.stringify(this.items));
        else localStorage.removeItem(SAVE_PREFIX + this.sym);
      } catch (e) { /* private window / storage full: drawings just won't be remembered */ }
      this.syncToolbar();
    }
    pushUndo() { this.undoStack.push(JSON.stringify(this.items)); if (this.undoStack.length > 50) this.undoStack.shift(); }
    undo() {
      const prev = this.undoStack.pop();
      if (prev === undefined) return;
      this.items = JSON.parse(prev); this.selected = null; this.save(); this.dirty = true;
    }
    deleteSelected() {
      if (!this.selected) return;
      this.pushUndo();
      this.items = this.items.filter((d) => d.id !== this.selected);
      this.selected = null; this.save(); this.dirty = true;
    }
    clearAll() {
      if (!this.items.length) return;
      if (!window.confirm(`Remove all ${this.items.length} drawing(s) on ${this.sym}?`)) return;
      this.pushUndo(); this.items = []; this.selected = null; this.save(); this.dirty = true;
    }

    // ----------------------------------------------------------------- time/price <-> screen
    get bars() { return this.dash.bars || []; }
    get bs() { return this.dash.barSeconds || 60; }

    tToL(t) {
      const b = this.bars, n = b.length;
      if (!n) return null;
      if (t <= b[0].time) return (t - b[0].time) / this.bs;
      if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / this.bs;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
      return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
    }
    lToT(l) {
      const b = this.bars, n = b.length;
      if (!n) return null;
      if (l <= 0) return b[0].time + l * this.bs;
      if (l >= n - 1) return b[n - 1].time + (l - (n - 1)) * this.bs;
      const i = Math.floor(l), f = l - i;
      return b[i].time + f * (b[i + 1].time - b[i].time);
    }
    toXY(pt) {
      const l = this.tToL(pt.t);
      if (l == null) return null;
      const x = this.dash.chart.timeScale().logicalToCoordinate(l);
      const y = this.dash.candlestickSeries.priceToCoordinate(pt.p);
      return x == null || y == null ? null : { x, y };
    }
    fromXY(x, y, snap) {
      const l = this.dash.chart.timeScale().coordinateToLogical(x);
      let p = this.dash.candlestickSeries.coordinateToPrice(y);
      if (l == null || p == null) return null;
      let t;
      if (snap && this.magnet) {
        const b = this.bars, i = Math.max(0, Math.min(b.length - 1, Math.round(l)));
        const bar = b[i];
        if (bar) {
          t = bar.time;
          let best = null, bd = 18;
          for (const v of [bar.open, bar.high, bar.low, bar.close]) {
            const vy = this.dash.candlestickSeries.priceToCoordinate(v);
            if (vy != null && Math.abs(vy - y) < bd) { bd = Math.abs(vy - y); best = v; }
          }
          if (best != null) p = best;
        }
      }
      if (t === undefined) t = this.lToT(l);
      return t == null ? null : { t, p };
    }

    plot() {
      const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
      let axisW = 56, axisH = 26;
      try { axisW = this.dash.chart.priceScale('right').width() || axisW; } catch (e) { /* older build */ }
      try { axisH = this.dash.chart.timeScale().height() || axisH; } catch (e) { /* older build */ }
      return { w: Math.max(10, w - axisW), h: Math.max(10, h - axisH), fullW: w, fullH: h };
    }

    // ----------------------------------------------------------------- input
    bind() {
      const w = this.wrap;
      w.addEventListener('mousedown', (e) => this.onDown(e), true);
      w.addEventListener('touchstart', (e) => this.onDown(e), { capture: true, passive: false });
      w.addEventListener('mousemove', (e) => this.onHover(e), true);
      w.addEventListener('dblclick', (e) => this.onDbl(e), true);
      window.addEventListener('mousemove', (e) => this.onMove(e));
      window.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
      window.addEventListener('mouseup', (e) => this.onUp(e));
      window.addEventListener('touchend', (e) => this.onUp(e));
      window.addEventListener('keydown', (e) => this.onKey(e));
    }

    pos(e) {
      const t = e.touches && e.touches.length ? e.touches[0] : e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e;
      const r = this.wrap.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    inPlot(p) { const pl = this.plot(); return p.x >= 0 && p.y >= 0 && p.x <= pl.w && p.y <= pl.h; }

    onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
      if (e.key === 'Escape') { if (this.draft) this.cancelDraft(); else if (this.tool !== 'cursor') this.setTool('cursor'); else { this.selected = null; this.syncToolbar(); this.dirty = true; } return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { e.preventDefault(); this.deleteSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) this.setTool(t.id);
    }

    onHover(e) {
      if (this.drag || this.hidden) return;
      const p = this.pos(e);
      if (this.draft) { this.draftMove(p, e); return; }
      if (this.tool !== 'cursor') return;
      const hit = this.inPlot(p) ? this.hitTest(p) : null;
      const key = hit ? hit.id : null;
      this.wrap.classList.toggle('hit-drawing', !!hit);
      if (key !== this.hover) { this.hover = key; this.dirty = true; }
    }

    onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.draw-edit')) return;
      const ae = document.activeElement;      // clicking the chart takes focus away from the chat box, so shortcut keys work
      if (ae && ae !== document.body && /INPUT|TEXTAREA/.test(ae.tagName) && !ae.classList.contains('draw-edit')) ae.blur();
      const p = this.pos(e);
      if (this.hidden || !this.inPlot(p)) return;

      if (this.draft) {                       // 2nd click of click-click drawing (or brush already running)
        e.stopPropagation(); e.preventDefault(); e.astbHandled = true;
        this.draftMove(p, e);
        this.draft.down = p;
        return;
      }
      if (this.tool !== 'cursor') {
        e.stopPropagation(); e.preventDefault(); e.astbHandled = true;
        this.startDraft(p, e);
        return;
      }
      const hit = this.hitTest(p);
      if (!hit) {
        if (this.selected) { this.selected = null; this.syncToolbar(); this.dirty = true; }
        return;                               // empty chart area: let the chart pan as usual
      }
      e.stopPropagation(); e.preventDefault(); e.astbHandled = true;
      this.selected = hit.id;
      const d = this.sel();
      const l0 = this.dash.chart.timeScale().coordinateToLogical(p.x);
      const p0 = this.dash.candlestickSeries.coordinateToPrice(p.y);
      this.pushUndo();
      this.drag = { id: hit.id, part: hit.part, moved: false, l0, p0, orig: JSON.parse(JSON.stringify(d.pts)), start: p };
      this.syncToolbar(); this.dirty = true;
    }

    onMove(e) {
      if (this.drag) {
        if (e.cancelable) e.preventDefault();
        const p = this.pos(e), d = this.sel();
        if (!d) return;
        if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 2) this.drag.moved = true;
        if (typeof this.drag.part === 'number') {
          const np = this.fromXY(p.x, p.y, true);
          if (np) d.pts[this.drag.part] = np;
        } else {
          const l = this.dash.chart.timeScale().coordinateToLogical(p.x);
          const pr = this.dash.candlestickSeries.coordinateToPrice(p.y);
          if (l != null && pr != null && this.drag.l0 != null && this.drag.p0 != null) {
            const dl = l - this.drag.l0, dp = pr - this.drag.p0;
            d.pts = this.drag.orig.map((o) => ({ t: this.lToT(this.tToL(o.t) + dl), p: o.p + dp }));
          }
        }
        this.dirty = true;
        return;
      }
      if (this.draft) { if (e.cancelable && e.touches) e.preventDefault(); this.draftMove(this.pos(e), e); }
    }

    onUp(e) {
      if (this.drag) {
        if (!this.drag.moved) this.undoStack.pop();     // a plain click should not create an undo step
        this.drag = null; this.save(); this.dirty = true;
        return;
      }
      const dr = this.draft;
      if (!dr || !dr.down) return;
      const p = this.pos(e);
      const moved = Math.hypot(p.x - dr.down.x, p.y - dr.down.y) > 6;
      if (dr.type === 'brush') { this.finishDraft(); return; }
      if (dr.mode === 'wait') {                         // this mouse-up belongs to the 2nd click
        if (dr.secondDown) this.finishDraft();
        return;
      }
      if (moved) { this.finishDraft(); return; }        // press-drag-release
      dr.mode = 'wait';                                 // plain click: wait for the 2nd click
    }

    onDbl(e) {
      if (this.hidden || this.tool !== 'cursor') return;
      const p = this.pos(e);
      if (!this.inPlot(p)) return;
      const hit = this.hitTest(p);
      if (hit) {
        const d = this.items.find((x) => x.id === hit.id);
        if (d && d.type === 'text') { e.stopPropagation(); this.editText(d); }
      }
    }

    // ----------------------------------------------------------------- creating drawings
    startDraft(p, e) {
      const type = this.tool, spec = TOOL_BY_ID[type];
      const a = this.fromXY(p.x, p.y, type !== 'brush');
      if (!a) return;
      const base = { id: uid(), type, color: this.color, width: this.width, pts: [a] };
      if (spec.pts === 1) {
        if (type === 'text') { this.editText(base, true); return; }
        this.commit(base); return;
      }
      this.draft = { ...base, pts: spec.pts === 0 ? [a] : [a, { ...a }], mode: 'drag', down: p };
      this.dirty = true;
    }

    draftMove(p, e) {
      const dr = this.draft;
      if (!dr) return;
      const snapped = this.fromXY(p.x, p.y, dr.type !== 'brush');
      if (!snapped) return;
      if (dr.type === 'brush') {
        const last = this.toXY(dr.pts[dr.pts.length - 1]);
        if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 2.5) dr.pts.push(snapped);
      } else {
        dr.pts[1] = e && e.shiftKey && dr.type === 'trend' ? this.flatten(dr.pts[0], snapped) : snapped;
      }
      if (dr.mode === 'wait' && e && (e.type === 'mousedown' || e.type === 'touchstart')) dr.secondDown = true;
      this.dirty = true;
    }

    flatten(a, b) { return { t: b.t, p: a.p }; }     // Shift while drawing a trend line = perfectly horizontal

    finishDraft() {
      const dr = this.draft;
      this.draft = null;
      if (!dr) return;
      if (dr.type === 'brush' ? dr.pts.length < 2 : dr.pts[0].t === dr.pts[1].t && dr.pts[0].p === dr.pts[1].p) { this.dirty = true; return; }
      delete dr.mode; delete dr.down; delete dr.secondDown;
      this.commit(dr);
    }

    cancelDraft() { if (this.draft) { this.draft = null; this.dirty = true; } this.closeEditor(); }

    commit(d) {
      this.pushUndo();
      this.items.push(d);
      this.selected = d.id;
      if (!this.keep) this.tool = 'cursor';
      this.save(); this.syncToolbar(); this.dirty = true;
    }

    editText(d, isNew = false) {
      this.closeEditor();
      const xy = this.toXY(d.pts[0]);
      if (!xy) return;
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'draw-edit'; input.maxLength = 80;
      input.placeholder = 'Type a note, press Enter';
      input.value = d.text || '';
      input.style.left = Math.max(4, Math.min(xy.x, this.wrap.clientWidth - 190)) + 'px';
      input.style.top = Math.max(4, xy.y - 14) + 'px';
      this.wrap.appendChild(input);
      this.editor = input;
      let done = false;
      const end = (ok) => {
        if (done) return; done = true;
        const val = input.value.trim();
        input.remove(); this.editor = null;
        if (ok && val) {
          if (isNew) { d.text = val; this.commit(d); }
          else { this.pushUndo(); d.text = val; this.save(); this.dirty = true; }
        } else if (isNew) { this.syncToolbar(); }
      };
      input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') end(true); else if (ev.key === 'Escape') end(false); });
      input.addEventListener('blur', () => end(true));
      setTimeout(() => input.focus(), 0);
    }
    closeEditor() { if (this.editor) { this.editor.blur(); } }

    // ----------------------------------------------------------------- hit testing
    screenPts(d) { return d.pts.map((pt) => this.toXY(pt)); }

    hitTest(p) {
      const sel = this.sel();
      if (sel) {                                         // handles of the selected drawing come first
        const pts = this.screenPts(sel);
        for (let i = 0; i < pts.length; i++) {
          if (pts[i] && sel.type !== 'brush' && sel.type !== 'text' && Math.hypot(pts[i].x - p.x, pts[i].y - p.y) <= HIT_PX + 2) return { id: sel.id, part: i };
        }
      }
      for (let i = this.items.length - 1; i >= 0; i--) {
        const d = this.items[i];
        if (this.hitBody(d, p)) return { id: d.id, part: 'body' };
      }
      return null;
    }

    hitBody(d, p) {
      const s = this.screenPts(d);
      if (s.some((q) => !q)) return false;
      const pl = this.plot();
      switch (d.type) {
        case 'hline': return Math.abs(s[0].y - p.y) <= HIT_PX;
        case 'vline': return Math.abs(s[0].x - p.x) <= HIT_PX;
        case 'trend': case 'measure': return distSeg(p.x, p.y, s[0].x, s[0].y, s[1].x, s[1].y) <= HIT_PX;
        case 'ray': { const e = this.rayEnd(s[0], s[1], pl); return distSeg(p.x, p.y, s[0].x, s[0].y, e.x, e.y) <= HIT_PX; }
        case 'rect': {
          const x1 = Math.min(s[0].x, s[1].x), x2 = Math.max(s[0].x, s[1].x), y1 = Math.min(s[0].y, s[1].y), y2 = Math.max(s[0].y, s[1].y);
          return p.x >= x1 - HIT_PX && p.x <= x2 + HIT_PX && p.y >= y1 - HIT_PX && p.y <= y2 + HIT_PX;
        }
        case 'fib': {
          const x1 = Math.min(s[0].x, s[1].x), x2 = Math.max(s[0].x, s[1].x);
          if (p.x < x1 - HIT_PX || p.x > x2 + HIT_PX) return false;
          return FIB.some((l) => Math.abs(this.fibY(d, l) - p.y) <= HIT_PX);
        }
        case 'text': { const b = this.textBox(d, s[0]); return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }
        case 'brush':
          for (let i = 1; i < s.length; i++) if (distSeg(p.x, p.y, s[i - 1].x, s[i - 1].y, s[i].x, s[i].y) <= HIT_PX) return true;
          return false;
        default: return false;
      }
    }

    rayEnd(a, b, pl) {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) < 0.01) return { x: a.x, y: dy >= 0 ? pl.h : 0 };
      const dirX = dx > 0 ? 1 : -1, far = dirX > 0 ? pl.w : 0;
      const t = (far - a.x) / dx;
      return { x: far, y: a.y + dy * t };
    }
    fibY(d, l) {
      const p1 = d.pts[0].p, p2 = d.pts[1].p;
      const y = this.dash.candlestickSeries.priceToCoordinate(p2 - (p2 - p1) * l);
      return y == null ? -9999 : y;
    }
    textBox(d, xy) {
      const ctx = this.ctx;
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      const w = ctx.measureText(d.text || '').width + 14;
      return { x: xy.x, y: xy.y - 11, w, h: 22 };
    }

    // ----------------------------------------------------------------- rendering
    loop() {
      requestAnimationFrame(this.loop);
      if (document.hidden) return;
      let sig = '';
      try {
        const ts = this.dash.chart.timeScale(), r = ts.getVisibleLogicalRange();
        const a = this.dash.candlestickSeries.priceToCoordinate(1), b = this.dash.candlestickSeries.priceToCoordinate(1000);
        sig = [this.wrap.clientWidth, this.wrap.clientHeight, r && r.from.toFixed(3), r && r.to.toFixed(3),
          a && a.toFixed(2), b && b.toFixed(2), this.bars.length, this.bars.length && this.bars[this.bars.length - 1].close].join('|');
      } catch (e) { return; }
      if (sig === this.sig && !this.dirty) return;
      this.sig = sig; this.dirty = false;
      this.render();
    }

    render() {
      const w = this.wrap.clientWidth, h = this.wrap.clientHeight, dpr = window.devicePixelRatio || 1;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (this.hidden) return;
      const pl = this.plot();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, pl.w, pl.h); ctx.clip();
      const all = this.draft ? [...this.items, this.draft] : this.items;
      for (const d of all) {
        try { this.drawOne(ctx, d, pl, d.id === this.selected, d.id === this.hover); } catch (e) { /* skip one bad drawing */ }
      }
      ctx.restore();
      // price labels for horizontal lines sit on the price axis
      for (const d of all) {
        if (d.type !== 'hline') continue;
        const s = this.toXY(d.pts[0]);
        if (!s || s.y < 0 || s.y > pl.h) continue;
        this.axisLabel(ctx, fmtP(d.pts[0].p), s.y, pl.w, pl.fullW - pl.w, d.color);
      }
    }

    axisLabel(ctx, text, y, x, w, color) {
      ctx.font = '600 11.5px Inter, system-ui, sans-serif';
      ctx.fillStyle = color; ctx.fillRect(x, y - 9, Math.max(w, 48), 18);
      ctx.fillStyle = '#0a0f1c'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(text, x + 6, y + 0.5);
    }

    drawOne(ctx, d, pl, selected, hover) {
      const s = this.screenPts(d);
      if (s.some((q) => !q)) return;
      ctx.lineWidth = d.width + (hover && !selected ? 0.6 : 0);
      ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
      switch (d.type) {
        case 'trend': this.line(ctx, s[0], s[1]); break;
        case 'ray': this.line(ctx, s[0], this.rayEnd(s[0], s[1], pl)); break;
        case 'hline': this.line(ctx, { x: 0, y: s[0].y }, { x: pl.w, y: s[0].y }); break;
        case 'vline': this.line(ctx, { x: s[0].x, y: 0 }, { x: s[0].x, y: pl.h }); break;
        case 'rect': {
          const x = Math.min(s[0].x, s[1].x), y = Math.min(s[0].y, s[1].y), w = Math.abs(s[1].x - s[0].x), h = Math.abs(s[1].y - s[0].y);
          ctx.globalAlpha = 0.14; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y, w, h);
          break;
        }
        case 'fib': this.drawFib(ctx, d, s); break;
        case 'measure': this.drawMeasure(ctx, d, s); break;
        case 'brush':
          ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y);
          for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
          ctx.stroke(); break;
        case 'text': {
          const b = this.textBox(d, s[0]);
          ctx.fillStyle = 'rgba(17,24,48,.92)'; ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
          ctx.fillStyle = d.color; ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          ctx.fillText(d.text || '', b.x + 7, b.y + b.h / 2 + 0.5);
          break;
        }
        default: break;
      }
      if (selected) {
        ctx.setLineDash([]); ctx.lineWidth = 2;
        const hs = d.type === 'brush' || d.type === 'text' ? [] : d.type === 'hline' || d.type === 'vline' ? [s[0]] : s;
        for (const q of hs) {
          ctx.fillStyle = '#0a0f1c'; ctx.strokeStyle = d.color; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (d.type === 'brush' || d.type === 'text') {
          ctx.strokeStyle = d.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
          const xs = s.map((q) => q.x), ys = s.map((q) => q.y);
          const x1 = Math.min(...xs) - 6, y1 = Math.min(...ys) - 12, x2 = Math.max(...xs) + (d.type === 'text' ? this.textBox(d, s[0]).w : 6), y2 = Math.max(...ys) + 12;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]);
        }
      }
    }

    line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

    drawFib(ctx, d, s) {
      const x1 = Math.min(s[0].x, s[1].x), x2 = Math.max(s[0].x, s[1].x);
      const p1 = d.pts[0].p, p2 = d.pts[1].p;
      const ys = FIB.map((l) => this.fibY(d, l));
      ctx.lineWidth = Math.max(1, d.width - 0.5);
      for (let i = 0; i < FIB.length - 1; i++) {                 // soft bands between levels
        ctx.globalAlpha = 0.07; ctx.fillStyle = FIB_COLORS[i + 1];
        ctx.fillRect(x1, Math.min(ys[i], ys[i + 1]), x2 - x1, Math.abs(ys[i + 1] - ys[i]));
      }
      ctx.globalAlpha = 1;
      ctx.font = '11.5px Inter, system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
      FIB.forEach((l, i) => {
        ctx.strokeStyle = FIB_COLORS[i]; ctx.fillStyle = FIB_COLORS[i];
        this.line(ctx, { x: x1, y: ys[i] }, { x: x2, y: ys[i] });
        ctx.fillText(`${l} (${fmtP(p2 - (p2 - p1) * l)})`, x1 + 4, ys[i] - 2);
      });
      ctx.strokeStyle = d.color; ctx.globalAlpha = 0.55; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      this.line(ctx, s[0], s[1]); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    drawMeasure(ctx, d, s) {
      const a = d.pts[0], b = d.pts[1], dp = b.p - a.p, pct = a.p ? (dp / a.p) * 100 : 0;
      const up = dp >= 0, col = up ? '#34d399' : '#fb7185';
      const x = Math.min(s[0].x, s[1].x), y = Math.min(s[0].y, s[1].y), w = Math.abs(s[1].x - s[0].x), h = Math.abs(s[1].y - s[0].y);
      ctx.fillStyle = col; ctx.globalAlpha = 0.12; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = d.width; this.line(ctx, s[0], s[1]);
      const ang = Math.atan2(s[1].y - s[0].y, s[1].x - s[0].x);          // arrow head
      ctx.beginPath(); ctx.moveTo(s[1].x, s[1].y);
      ctx.lineTo(s[1].x - 9 * Math.cos(ang - 0.4), s[1].y - 9 * Math.sin(ang - 0.4));
      ctx.lineTo(s[1].x - 9 * Math.cos(ang + 0.4), s[1].y - 9 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      const bars = Math.round(Math.abs((this.tToL(b.t) || 0) - (this.tToL(a.t) || 0)));
      const l1 = `${dp >= 0 ? '+' : '−'}${fmtP(Math.abs(dp))}  (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%)`;
      const l2 = `${bars} bars · ${fmtDur(b.t - a.t)}`;
      ctx.font = '600 12.5px Inter, system-ui, sans-serif';
      const bw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 16, bh = 40;
      let bx = (s[0].x + s[1].x) / 2 - bw / 2, by = up ? y - bh - 8 : y + h + 8;
      bx = Math.max(4, bx); by = Math.max(4, by);
      ctx.fillStyle = '#111830'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(l1, bx + 8, by + 13);
      ctx.fillStyle = '#8c98b8'; ctx.font = '12px Inter, system-ui, sans-serif'; ctx.fillText(l2, bx + 8, by + 29);
    }
  }

  // =================================================================================================== price scale
  // Lets you scroll the chart vertically. Normally the chart re-fits the price range automatically, which is why
  // dragging up/down did nothing. Here we keep our own price range ("manual") and feed it to the chart through its
  // autoscaleInfoProvider hook; the "Auto" button drops it and goes back to automatic fitting.
  class PriceScaleControl {
    constructor(dash, wrap) {
      this.dash = dash;
      this.wrap = wrap;
      this.manual = null;                       // { min, max } or null = automatic
      this.gesture = null;
      this.btn = document.getElementById('btn-auto');
      this.apply();
      wrap.addEventListener('mousedown', (e) => this.onDown(e), true);
      wrap.addEventListener('touchstart', (e) => this.onDown(e), { capture: true, passive: true });
      window.addEventListener('mousemove', (e) => this.onMove(e));
      window.addEventListener('touchmove', (e) => this.onMove(e), { passive: true });
      window.addEventListener('mouseup', () => this.end());
      window.addEventListener('touchend', () => this.end());
      wrap.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
      wrap.addEventListener('dblclick', (e) => this.onDbl(e), true);
      if (this.btn) this.btn.addEventListener('click', () => this.reset());
      const fit = document.getElementById('btn-fit');
      if (fit) fit.addEventListener('click', () => { this.reset(); this.dash.chart.timeScale().fitContent(); });
    }

    // the price range as it is on screen right now
    visible() {
      const pl = this.dash.drawings ? this.dash.drawings.plot() : { h: this.wrap.clientHeight - 26 };
      const s = this.dash.candlestickSeries;
      const top = s.coordinateToPrice(0), bot = s.coordinateToPrice(pl.h);
      if (top == null || bot == null || top === bot) return null;
      return { min: Math.min(top, bot), max: Math.max(top, bot), h: pl.h };
    }

    apply() {
      const provider = (orig) => {
        if (!this.manual) return orig();
        return { priceRange: { minValue: this.manual.min, maxValue: this.manual.max } };
      };
      try { this.dash.candlestickSeries.applyOptions({ autoscaleInfoProvider: provider }); } catch (e) { /* chart not ready */ }
      try { this.dash.chart.priceScale('right').applyOptions({ autoScale: true }); } catch (e) { /* ignore */ }
      if (this.btn) { this.btn.classList.toggle('on', !this.manual); this.btn.title = this.manual ? 'Price scale is manual. Click to auto-fit.' : 'Price scale: auto-fit'; }
    }

    reset() { this.manual = null; this.apply(); }

    enterManual() {
      if (this.manual) return true;
      const v = this.visible();
      if (!v) return false;
      this.manual = { min: v.min, max: v.max };
      return true;
    }

    panBy(dyPx, base) {
      const h = base.h || (this.visible() || {}).h || 400;
      const k = (base.max - base.min) / h;
      this.manual = { min: base.min + dyPx * k, max: base.max + dyPx * k };
      this.apply();
    }
    zoomBy(factor, base, anchor = 0.5) {
      const range = (base.max - base.min) * factor;
      const pivot = base.min + (base.max - base.min) * anchor;
      this.manual = { min: pivot - range * anchor, max: pivot + range * (1 - anchor) };
      this.apply();
    }

    onDown(e) {
      if (e.astbHandled || (e.button !== undefined && e.button !== 0)) return;
      const t = e.touches ? e.touches[0] : e;
      if (e.touches && e.touches.length > 1) { this.gesture = null; return; }       // pinch: leave it to the chart
      const r = this.wrap.getBoundingClientRect();
      const x = t.clientX - r.left, y = t.clientY - r.top;
      const pl = this.dash.drawings ? this.dash.drawings.plot() : { w: r.width - 56, h: r.height - 26 };
      if (y > pl.h) return;                                    // time axis: chart handles it
      const axis = x > pl.w;
      this.gesture = { axis, x0: x, y0: y, active: false, base: null, h: pl.h };
    }

    onMove(e) {
      const g = this.gesture;
      if (!g) return;
      const t = e.touches ? e.touches[0] : e;
      if (!t) return;
      const r = this.wrap.getBoundingClientRect();
      const dy = t.clientY - r.top - g.y0, dx = t.clientX - r.left - g.x0;
      if (!g.active) {
        // axis drags start at once; chart drags need to be mostly vertical, so normal sideways panning is untouched
        if (g.axis ? Math.abs(dy) < 3 : (Math.abs(dy) < 5 || Math.abs(dy) < Math.abs(dx) * 0.6)) return;
        const hadManual = !!this.manual;
        if (!this.enterManual()) { this.gesture = null; return; }
        g.active = true; g.base = { ...this.manual, h: g.h };
        if (!hadManual) this.apply();
      }
      if (g.axis) this.zoomBy(Math.exp(dy * 0.004), g.base);          // drag down = zoom out, up = zoom in
      else this.panBy(dy, g.base);
    }

    end() { this.gesture = null; }

    onWheel(e) {
      if (e.astbHandled) return;
      const r = this.wrap.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const pl = this.dash.drawings ? this.dash.drawings.plot() : { w: r.width - 56, h: r.height - 26 };
      const overAxis = x > pl.w && y <= pl.h;
      if (!(e.shiftKey || e.altKey || overAxis)) return;               // plain wheel keeps zooming time, as before
      e.preventDefault(); e.stopPropagation();
      if (!this.enterManual()) return;
      const v = this.manual, h = pl.h;
      const base = { min: v.min, max: v.max, h };
      const delta = e.deltaY || e.deltaX;
      if (e.shiftKey && !e.altKey && !overAxis) this.panBy(-delta * 0.6, base);
      else this.zoomBy(Math.exp(delta * 0.0015), base, Math.max(0, Math.min(1, 1 - y / h)));
      this.apply();
    }

    onDbl(e) {
      const r = this.wrap.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const pl = this.dash.drawings ? this.dash.drawings.plot() : { w: r.width - 56, h: r.height - 26 };
      if (x > pl.w && y <= pl.h) { this.reset(); }                      // double-click the price axis = auto-fit
      else if (y > pl.h) this.dash.chart.timeScale().fitContent();      // double-click the time axis = show everything
    }
  }

  window.ASTBChartDrawings = ChartDrawings;
  window.ASTBPriceScaleControl = PriceScaleControl;
})();
