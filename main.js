'use strict';

const canvas = document.getElementById('game');
// Two canvases: `buf` is the small off-screen game surface; `canvas` is what the user sees, at the real
// screen resolution. Each frame is a single nearest-neighbour blit buf -> canvas. (CSS upscaling with
// `image-rendering: pixelated` pushes iOS Safari onto a slow software path, which was the stutter.)
const screenCtx = canvas.getContext('2d', { alpha: false });
const buf = document.createElement('canvas');
const ctx = buf.getContext('2d', { alpha: false });
const MAX_DPR = 3;
// Internal pixels per game unit. The canvas is far smaller than the physical screen and the browser
// scales it up with nearest-neighbour, which is what keeps the pixel art sharp *and* the frame cheap
// (a full-resolution 3x canvas on an iPhone costs ~8x more fill than this).
const RENDER_SCALE = 2;
const MAX_TOP_MARGIN = 54;

let atlasImg = null;
let rects = {};   // name -> {px, py, w, h}
let sizes = {};   // name -> {w, h}
let game = null;
let layout = { S: 1, ox: 0, oy: 0, top: 0, bottom: 0 };
let uiBirdStyle = Ranking.birdStyle;
let overlayOpen = false;

// MARK: Audio (WebAudio; unlocked by the first touch)

const audio = {
  ctx: null,
  buffers: {},
  files: { wing: 'wing', point: 'point', hit: 'hit', die: 'die', swoosh: 'swooshing' },
  async load() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iOS 16.4+: play through the media channel so the ring/silent switch does not mute the game.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    this.ctx = new AC({ latencyHint: 'interactive' });
    await Promise.all(Object.entries(this.files).map(async ([name, file]) => {
      try {
        const data = await (await fetch(`audio/${file}.wav`)).arrayBuffer();
        this.buffers[name] = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
      } catch { /* sound is optional */ }
    }));
  },
  unlock() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this.primed) {
      // A silent one-sample buffer started inside the gesture fully wakes the audio engine on iOS.
      this.primed = true;
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    }
  },
  play(name) {
    const buffer = this.buffers[name];
    if (!this.ctx || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.start();
  },
};

// MARK: Loading

async function loadAtlas() {
  const [text, img] = await Promise.all([
    fetch('assets/atlas.txt').then((r) => r.text()),
    new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'assets/atlas.png'; }),
  ]);
  // Draw from a canvas, not the <img>: Safari may drop the decoded bitmap of an <img> under memory pressure
  // and re-decode it mid-game (a periodic hitch); a canvas source stays resident.
  const sheet = document.createElement('canvas');
  sheet.width = img.width; sheet.height = img.height;
  sheet.getContext('2d').drawImage(img, 0, 0);
  atlasImg = sheet;
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(' ');
    if (f.length !== 7) continue;
    const [name, w, h, u, v] = f;
    rects[name] = { px: Math.round(parseFloat(u) * img.width), py: Math.round(parseFloat(v) * img.height), w: +w, h: +h };
    sizes[name] = { w: +w, h: +h };
  }
  atlasSetup(img, rects);
}

// MARK: Layout

/** CSS size of the playfield. iPhones running a home-screen app can report an innerHeight shorter than
 *  the screen (the home-indicator strip), which left a bar at the bottom. The iPhone screen height is
 *  fixed, so in that mode it is used outright, and re-checked later because iOS changes innerHeight
 *  after launch without telling anyone. (Same approach as the Gastrownia app's viewport.ts.) */
const standaloneIOS = navigator.standalone === true;

function viewSize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!standaloneIOS) return [w, h];
  const tall = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
  return [w, Math.max(w > h ? short : tall, h)];
}

let viewW = 0, viewH = 0;

// The canvas is deliberately taller than the visible area: whatever the home-screen webview reports,
// the ground simply continues below the edge instead of showing a bar.
const BLEED = 160;
let cssW = 1, cssH = 1;

function resize() {
  const [w, vh] = viewSize();
  viewW = w; viewH = vh;
  if (standaloneIOS) {
    document.documentElement.style.setProperty('--app-height', `${vh}px`);
    document.documentElement.classList.add('fit-screen');
  }
  cssW = w;
  cssH = viewH + BLEED;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const S = Math.min(cssW / GAME_W, viewH / GAME_H); // CSS px per game unit
  const k = RENDER_SCALE;
  buf.width = Math.max(1, Math.round((cssW / S) * k));
  buf.height = Math.max(1, Math.round((cssH / S) * k));
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const extra = Math.max(viewH / S - GAME_H, 0);
  const top = Math.min(extra / 2, MAX_TOP_MARGIN);
  const bottom = Math.max(cssH / S - GAME_H - top, 0);
  layout = { S: k, ox: (buf.width - GAME_W * k) / 2, oy: top * k, top, bottom };
}

// MARK: Render

function drawSprite(s) {
  const r = rects[s.name];
  if (!r) return;
  ctx.globalAlpha = s.alpha;
  if (s.rotation !== null) {
    const a = s.rotation * Math.PI / 180, cos = Math.cos(a) * layout.S, sin = Math.sin(a) * layout.S;
    // Same as translate(centre) + rotate(), set directly on top of the base transform (no save/restore).
    const cx = s.x + r.w / 2 + game.shakeX, cy = s.y + r.h / 2 + game.shakeY;
    ctx.setTransform(cos, sin, -sin, cos, layout.ox + cx * layout.S, layout.oy + cy * layout.S);
    ctx.drawImage(atlasImg, r.px, r.py, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.setTransform(layout.S, 0, 0, layout.S, layout.ox, layout.oy);
    ctx.translate(game.shakeX, game.shakeY);
  } else {
    ctx.drawImage(atlasImg, r.px, r.py, r.w, r.h, s.x, s.y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
}

function render() {
  const { S, ox, oy, top, bottom } = layout;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, buf.width, buf.height);
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  ctx.setTransform(S, 0, 0, S, ox, oy);
  const margin = 8;
  // On wide screens (desktop) keep the game in its own column instead of letting pipes spill out.
  // (Clipping is skipped on phones, where the game fills the width: it slows down the canvas.)
  if (ox > 2) {
    ctx.beginPath();
    ctx.rect(-margin, -(top + margin), GAME_W + 2 * margin, GAME_H + top + bottom + 2 * margin);
    ctx.clip();
  }
  ctx.translate(game.shakeX, game.shakeY);

  const sprites = game.sprites;
  const bg = sprites.length && sprites[0].name.startsWith('bg_') ? sprites[0].name : null;
  if (bg) {
    // Stretch the top row of the sky over the extra height above the game area.
    const r = rects[bg];
    ctx.drawImage(atlasImg, r.px + 1, r.py + 1, r.w - 2, 1, -margin, -(top + margin), GAME_W + 2 * margin, top + margin);
  }
  for (const s of sprites) drawSprite(s);
  {
    // Ground row stretched below the game area; also hides the panel's slide-in from below the screen.
    const r = rects.land;
    ctx.drawImage(atlasImg, r.px + 1, r.py + r.h - 2, r.w - 2, 1, -margin, GAME_H, GAME_W + 2 * margin, bottom + margin);
  }

  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (game.flash.value > 0 && !game.flash.done) {
    ctx.fillStyle = `rgba(255,255,255,${game.flash.value})`;
    ctx.fillRect(0, 0, buf.width, buf.height);
  }
  if (game.fade.value > 0) {
    ctx.fillStyle = `rgba(0,0,0,${game.fade.value})`;
    ctx.fillRect(0, 0, buf.width, buf.height);
  }

  screenCtx.imageSmoothingEnabled = false;
  screenCtx.drawImage(buf, 0, 0, canvas.width, canvas.height);
}

// MARK: Loop

let lastTime = null;
let accumulator = 0;
const stats = { frames: 0, slow: 0, maxDt: 0, renderMax: 0, renderSum: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  const step = 1 / 60;
  let dt = lastTime === null ? step : t - lastTime;
  lastTime = t;
  if (stats.frames++ > 5) {
    if (dt > stats.maxDt) stats.maxDt = dt;
    if (dt > step * 1.5) stats.slow++;
  }
  // Display timestamps jitter a little around the vsync period; snap them to exact multiples of half a
  // tick (60 / 120 / 30 Hz) so a late frame never turns into a 0-then-2 tick hitch.
  const half = step / 2, m = Math.round(dt / half);
  if (m > 0 && Math.abs(dt - m * half) < 0.002) dt = m * half;
  accumulator = Math.min(accumulator + dt, 0.25);
  const ticks = Math.floor(accumulator / step + 0.5);
  for (let i = 0; i < ticks; i++) game.tick();
  accumulator -= ticks * step;

  for (const s of game.drainSounds()) audio.play(s);
  if (game.savedBest !== null) {
    Store.set('bestScore', String(game.savedBest));
    game.savedBest = null;
  }
  syncUI();
  const r0 = performance.now();
  render();
  const rd = performance.now() - r0;
  stats.renderSum += rd;
  if (rd > stats.renderMax) stats.renderMax = rd;
}

// MARK: UI bridge

const cornerEl = document.getElementById('corner');
const swatchEl = document.getElementById('swatch');

function swatchColor(style) {
  const [r, g, b] = BIRD_STYLES[style].swatch;
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function syncUI() {
  if (game.birdStyle !== uiBirdStyle) game.birdStyle = uiBirdStyle;
  const show = game.canPickColor && !overlayOpen;
  if (cornerEl.hidden === show) cornerEl.hidden = !show;
  if (game.finishedScore !== null) {
    const score = game.finishedScore;
    game.finishedScore = null;
    // Let the player see the medal / new-best banner before the name panel slides up.
    if (score > 0) setTimeout(() => openName(score), 1200);
  }
  if (game.rankingRequested) {
    game.rankingRequested = false;
    openRanking();
  }
}

function openRanking() { if (!overlayOpen) { overlayOpen = true; Screens.ranking(); } }
function openColors() {
  if (overlayOpen) return;
  overlayOpen = true;
  Screens.colors(uiBirdStyle, (i) => { uiBirdStyle = i; Ranking.birdStyle = i; swatchEl.style.background = swatchColor(i); });
}
function openName(score) {
  if (overlayOpen) Screens.close();
  overlayOpen = true;
  Screens.name(score, (saved) => { if (saved) setTimeout(openRanking, 0); });
}

Screens.onClose = () => { overlayOpen = false; };

document.getElementById('btn-rank').addEventListener('click', openRanking);
document.getElementById('btn-color').addEventListener('click', openColors);

// Long-press the colour button for a screen diagnostics report (handy when a device misbehaves).
{
  let timer = null;
  const btn = document.getElementById('btn-color');
  btn.addEventListener('pointerdown', () => {
    timer = setTimeout(() => {
      timer = null;
      const vv = window.visualViewport;
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;height:100%;width:1px;pointer-events:none';
      document.body.appendChild(probe);
      const fixedH = probe.getBoundingClientRect().height;
      probe.remove();
      const cs = getComputedStyle(document.documentElement);
      alert(JSON.stringify({
        inner: [innerWidth, innerHeight], screen: [screen.width, screen.height],
        client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
        fixed100: fixedH, visual: vv ? [vv.width, vv.height] : null, standalone: navigator.standalone,
        dpr: devicePixelRatio, canvas: [canvas.width, canvas.height], buf: [buf.width, buf.height],
        frames: stats.frames, slowFrames: stats.slow, maxFrameMs: +(stats.maxDt * 1000).toFixed(1),
        renderAvgMs: +(stats.renderSum / Math.max(stats.frames, 1)).toFixed(2), renderMaxMs: +stats.renderMax.toFixed(1), css: [cssW, cssH],
        safe: ['top', 'bottom'].map((s) => cs.getPropertyValue(`--sa-${s}`)),
      }));
    }, 900);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => { if (timer) clearTimeout(timer); });
}

// MARK: Input

function gamePoint(e) {
  const { S, ox, oy } = layout;
  const px = e.clientX * (buf.width / cssW), py = e.clientY * (buf.height / cssH);
  return [Math.floor((px - ox) / S), Math.floor((py - oy) / S)];
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.unlock();
  if (overlayOpen) return;
  const [x, y] = gamePoint(e);
  game.touchBegan(x, y);
});
canvas.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (overlayOpen) return;
  const [x, y] = gamePoint(e);
  game.touchEnded(x, y);
});
canvas.addEventListener('pointercancel', () => { if (game) game.touchEnded(-1000, -1000); });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (!(e.target instanceof Element && e.target.closest('.rank-list'))) e.preventDefault();
}, { passive: false });
for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) document.addEventListener(ev, () => audio.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => { lastTime = null; if (!document.hidden) { audio.unlock(); resize(); } });
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('resize', resize);
window.addEventListener('pageshow', resize);
// iOS never scrolls this page: undo any shift it leaves after the keyboard closes.
const resetScroll = () => { if (scrollX || scrollY) scrollTo(0, 0); };
window.addEventListener('scroll', resetScroll, { passive: true });
document.addEventListener('focusout', () => setTimeout(resetScroll, 60));
// Safety net for size changes the system does not announce (home-screen iPhone); the check is cheap.
if (standaloneIOS) setInterval(() => { const [w, h] = viewSize(); if (w !== viewW || h !== viewH) resize(); }, 1000);
window.addEventListener('orientationchange', () => { setTimeout(resize, 100); setTimeout(resize, 400); });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !overlayOpen && game) { e.preventDefault(); audio.unlock(); game.touchBegan(-1, -1); }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !overlayOpen && game) game.touchEnded(-1, -1);
});

// MARK: Start

(async function start() {
  try {
    await loadAtlas();
  } catch (e) {
    document.getElementById('loading').textContent = 'Nie udało się wczytać gry';
    return;
  }
  Screens.init(document.getElementById('screens'));
  game = new Game(sizes, parseInt(Store.get('bestScore', '0'), 10) || 0, uiBirdStyle);
  swatchEl.style.background = swatchColor(uiBirdStyle);
  resize();
  document.getElementById('loading').remove();
  audio.load();
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
