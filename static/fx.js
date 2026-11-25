// ASTB visual engine: a real-time WebGL shader background (runs on the GPU), glass panels, light/dark theme.
// Quality levels: Off (static gradient, no GPU work) / Balanced (adaptive) / Ultra (full resolution, heavy shader).
// Pauses automatically when the tab is hidden, so it never burns GPU in the background.
(function () {
  'use strict';
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } },
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = {
    quality: store.get('astb-fx', reduced ? 'off' : 'balanced'),
    theme: store.get('astb-theme', 'dark'),
    fps: 0, scale: 1, gpu: 'unknown', webgl: false, listeners: [],
  };
  window.astbFX = fx;

  // ---------------------------------------------------------------- shader
  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const frag = (oct, warp) => `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uLight; uniform float uScroll;
#define OCT ${oct}
#define WARP ${warp}
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < OCT; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p.y += uScroll * 0.0004;
  float t = uTime * 0.045;
  vec2 q = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 + vec2(5.2, 1.3) - t));
  float f = fbm(p * 1.5 + 2.0 * q);
  #if WARP
    vec2 r = vec2(fbm(p * 1.8 + 2.4 * q + vec2(1.7, 9.2) + 0.9 * t), fbm(p * 1.8 + 2.4 * q + vec2(8.3, 2.8) - 0.7 * t));
    f = fbm(p * 1.6 + 2.6 * r);
    float ridge = 1.0 - abs(2.0 * fbm(p * 2.2 + r * 2.0 + t) - 1.0);
  #else
    float ridge = 1.0 - abs(2.0 * f - 1.0);
  #endif
  vec3 deep = mix(vec3(0.020, 0.032, 0.058), vec3(0.030, 0.050, 0.090), uv.y);
  vec3 cyan = vec3(0.05, 0.62, 0.78);
  vec3 violet = vec3(0.34, 0.20, 0.74);
  vec3 mint = vec3(0.10, 0.70, 0.50);
  vec3 col = deep;
  col += cyan * smoothstep(0.35, 0.95, f) * 0.34;
  col += violet * smoothstep(0.30, 0.90, q.x) * 0.26;
  col += mint * pow(ridge, 6.0) * 0.10 * smoothstep(0.4, 0.8, f);
  // faint perspective grid fading upward
  vec2 g = vec2(uv.x * uRes.x / uRes.y * 14.0, uv.y * 8.0 - uTime * 0.02);
  vec2 gl = abs(fract(g) - 0.5);
  float grid = smoothstep(0.495, 0.5, max(gl.x, gl.y)) * 0.5;
  col += vec3(0.20, 0.55, 0.70) * grid * 0.045 * (1.0 - uv.y);
  // cursor light
  vec2 m = (uMouse - 0.5 * uRes) / uRes.y;
  col += vec3(0.08, 0.34, 0.46) * exp(-length(p - m) * 2.8) * 0.55;
  // vignette + grain
  col *= 1.0 - 0.55 * dot(uv - 0.5, uv - 0.5) * 2.0;
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;
  col *= 0.78;
  // light theme: soft pastel wash instead
  vec3 lt = mix(vec3(0.93, 0.95, 0.98), vec3(0.88, 0.93, 0.99), uv.y);
  lt = mix(lt, vec3(0.62, 0.88, 0.96), smoothstep(0.45, 0.95, f) * 0.40);
  lt = mix(lt, vec3(0.80, 0.76, 0.97), smoothstep(0.40, 0.90, q.x) * 0.30);
  lt += vec3(0.0, 0.12, 0.16) * exp(-length(p - m) * 2.8) * 0.25;
  gl_FragColor = vec4(mix(col, lt, uLight), 1.0);
}`;

  let canvas = null, gl = null, prog = null, loc = {}, raf = 0, lastT = 0, frames = 0, fpsT = 0, slow = 0;
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  const lightOn = () => (fx.theme === 'light' ? 1 : 0);

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
    return s;
  }

  function build() {
    teardown();
    if (fx.quality === 'off') { document.body.classList.remove('fx-on'); notify(); return; }
    try {
      canvas = document.createElement('canvas');
      canvas.id = 'fx-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL unavailable');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      fx.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl.getParameter(gl.RENDERER) || 'unknown');
      const ultra = fx.quality === 'ultra';
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag(ultra ? 7 : 4, ultra ? 1 : 0)));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link failed');
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['uRes', 'uTime', 'uMouse', 'uLight', 'uScroll']) loc[n] = gl.getUniformLocation(prog, n);
      fx.webgl = true;
      fx.scale = ultra ? Math.min(window.devicePixelRatio || 1, 2) : 0.6;
      slow = 0;
      document.body.prepend(canvas);
      document.body.classList.add('fx-on');
      document.body.classList.toggle('fx-ultra', ultra);
      resize();
      raf = requestAnimationFrame(frame);
    } catch (e) {
      console.warn('ASTB FX disabled:', e.message);
      fx.webgl = false; fx.quality = 'off';
      teardown();
      document.body.classList.remove('fx-on', 'fx-ultra');
    }
    notify();
  }

  function teardown() {
    cancelAnimationFrame(raf); raf = 0;
    if (gl) { const l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); }
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; gl = null; prog = null; fx.fps = 0;
  }

  function resize() {
    if (!canvas) return;
    const w = Math.max(2, Math.floor(window.innerWidth * fx.scale)), h = Math.max(2, Math.floor(window.innerHeight * fx.scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const ultra = fx.quality === 'ultra';
    if (!ultra && now - lastT < 33) return;                 // balanced: 30 fps cap keeps laptops cool
    const dt = now - lastT; lastT = now;
    // balanced mode adapts: if frames take too long, render fewer pixels
    if (!ultra && dt > 50) { if (++slow > 20 && fx.scale > 0.35) { fx.scale -= 0.1; slow = 0; resize(); } } else slow = Math.max(0, slow - 1);
    mouse.x += (mouse.tx - mouse.x) * 0.06; mouse.y += (mouse.ty - mouse.y) * 0.06;
    resize();
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uTime, now / 1000);
    gl.uniform2f(loc.uMouse, mouse.x * canvas.width, (1 - mouse.y) * canvas.height);
    gl.uniform1f(loc.uLight, lightOn());
    gl.uniform1f(loc.uScroll, window.scrollY || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frames++;
    if (now - fpsT >= 1000) { fx.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; notify(); }
  }

  function notify() { fx.listeners.forEach((f) => { try { f(fx); } catch (e) { /* ignore */ } }); }
  fx.onChange = (f) => { fx.listeners.push(f); };

  fx.setQuality = (q) => {
    if (!['off', 'balanced', 'ultra'].includes(q)) return;
    fx.quality = q; store.set('astb-fx', q); build();
  };
  fx.cycleQuality = () => { const o = ['off', 'balanced', 'ultra']; fx.setQuality(o[(o.indexOf(fx.quality) + 1) % 3]); };
  fx.setTheme = (t) => {
    fx.theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = fx.theme;
    store.set('astb-theme', fx.theme);
    window.dispatchEvent(new CustomEvent('astb-theme', { detail: fx.theme }));
    notify();
  };
  fx.toggleTheme = () => fx.setTheme(fx.theme === 'light' ? 'dark' : 'light');

  // ---------------------------------------------------------------- pointer: shader glow + panel spotlight
  let pend = false, pe = null;
  window.addEventListener('pointermove', (e) => {
    mouse.tx = e.clientX / window.innerWidth; mouse.ty = e.clientY / window.innerHeight;
    pe = e;
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => {
      pend = false;
      const el = pe && pe.target && pe.target.closest ? pe.target.closest('.panel, .cell') : null;
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (pe.clientX - r.left) + 'px');
        el.style.setProperty('--my', (pe.clientY - r.top) + 'px');
      }
    });
  }, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastT = 0; fpsT = performance.now(); frames = 0; });

  // ---------------------------------------------------------------- UI: topbar buttons + FX popover
  const ICON_FX = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>';
  const ICON_THEME = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  function ui() {
    const chips = document.querySelector('.topbar .chips');
    if (!chips || document.getElementById('fx-btn')) return;
    const wrap = document.createElement('div');
    wrap.className = 'tbtns';
    wrap.innerHTML = `
      <button type="button" id="fx-btn" class="tbtn" title="Visual effects (F)" aria-haspopup="true" aria-expanded="false">${ICON_FX}<span id="fx-fps">FX</span></button>
      <button type="button" id="theme-btn" class="tbtn" title="Light / dark (T)" aria-label="Toggle light or dark theme">${ICON_THEME}</button>`;
    chips.prepend(wrap);

    const pop = document.createElement('div');
    pop.id = 'fx-pop'; pop.className = 'fxpop hidden'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Visual effects');
    pop.innerHTML = `
      <div class="fxrow"><b>Graphics quality</b>
        <div class="seg" id="fx-q"><button type="button" data-q="off">Off</button><button type="button" data-q="balanced">Balanced</button><button type="button" data-q="ultra">Ultra</button></div></div>
      <div class="fxrow"><b>Theme</b>
        <div class="seg" id="fx-t"><button type="button" data-t="dark">Dark</button><button type="button" data-t="light">Light</button></div></div>
      <dl class="fxstats">
        <dt>Frame rate</dt><dd id="fxs-fps">–</dd>
        <dt>Rendering on</dt><dd id="fxs-gpu">–</dd>
        <dt>Resolution</dt><dd id="fxs-res">–</dd>
      </dl>
      <p class="fxtip"><b>Ultra</b> draws a full-resolution animated shader plus glass blur on every panel: it is meant for a presentation on a gaming GPU.
      If "Rendering on" shows Intel/UHD graphics instead of your NVIDIA card, open <i>Windows Settings → System → Display → Graphics</i>, add Chrome or Edge, and choose <i>High performance</i>.</p>`;
    document.body.appendChild(pop);

    const open = (v) => { pop.classList.toggle('hidden', !v); document.getElementById('fx-btn').setAttribute('aria-expanded', String(v)); };
    document.getElementById('fx-btn').addEventListener('click', (e) => { e.stopPropagation(); open(pop.classList.contains('hidden')); });
    document.getElementById('theme-btn').addEventListener('click', () => fx.toggleTheme());
    pop.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]'); if (q) fx.setQuality(q.dataset.q);
      const t = e.target.closest('[data-t]'); if (t) fx.setTheme(t.dataset.t);
    });
    document.addEventListener('click', (e) => { if (!pop.contains(e.target)) open(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
    fx.openPanel = open;

    const paint = () => {
      document.querySelectorAll('#fx-q [data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === fx.quality));
      document.querySelectorAll('#fx-t [data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === fx.theme));
      const f = document.getElementById('fx-fps');
      if (f) f.textContent = fx.quality === 'off' ? 'FX off' : fx.fps ? fx.fps + ' fps' : 'FX';
      const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
      set('fxs-fps', fx.quality === 'off' ? 'effects off' : fx.fps ? fx.fps + ' fps' : 'measuring…');
      set('fxs-gpu', fx.webgl ? String(fx.gpu).replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 70) : 'not using the GPU');
      set('fxs-res', fx.webgl && canvas ? `${canvas.width}×${canvas.height}  (${Math.round(fx.scale * 100)}%)` : '–');
    };
    fx.onChange(paint); paint();
  }

  document.documentElement.dataset.theme = fx.theme;
  const start = () => { build(); ui(); };
  // dashboard.js builds the page from a window-level DOMContentLoaded handler, which runs after document-level ones
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start); else start();
})();
