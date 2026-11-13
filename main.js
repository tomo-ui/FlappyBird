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

// A non-passive touchmove listener makes iOS wait for the main thread on every finger movement, which
// showed up as a hitch right after each flap. It is only needed while an overlay is open (to stop the
// page rubber-banding), so it is attached just then; the game canvas itself uses touch-action: none.
const blockTouchMove = (e) => {
  if (!(e.target instanceof Element && e.target.closest('.rank-list'))) e.preventDefault();
};
function setOverlay(open) {
  overlayOpen = open;
  if (open) document.addEventListener('touchmove', blockTouchMove, { passive: false });
  else document.removeEventListener('touchmove', blockTouchMove);
}

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
    if (!this.keepAlive) {
      // A looping silent source keeps the audio session/engine active, so the first sound after a quiet
      // moment does not have to spin it up (that stall was visible as a hitch on every flap).
      this.keepAlive = this.ctx.createBufferSource();
      this.keepAlive.buffer = this.ctx.createBuffer(1, 22050, 22050);
      this.keepAlive.loop = true;
      this.keepAlive.connect(this.ctx.destination);
      this.keepAlive.start(0);
    }
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

function drawSprite(s, x, y, rotation) {
  const r = rects[s.name];
  if (!r) return;
  ctx.globalAlpha = s.alpha;
  if (rotation !== null) {
    const a = rotation * Math.PI / 180, cos = Math.cos(a) * layout.S, sin = Math.sin(a) * layout.S;
    // Same as translate(centre) + rotate(), set directly on top of the base transform (no save/restore).
    const cx = x + r.w / 2 + game.shakeX, cy = y + r.h / 2 + game.shakeY;
    ctx.setTransform(cos, sin, -sin, cos, layout.ox + cx * layout.S, layout.oy + cy * layout.S);
    ctx.drawImage(atlasImg, r.px, r.py, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.setTransform(layout.S, 0, 0, layout.S, layout.ox, layout.oy);
    ctx.translate(game.shakeX, game.shakeY);
  } else {
    ctx.drawImage(atlasImg, r.px, r.py, r.w, r.h, x, y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
}

/** Period (in game units) of the scrolling ground pattern; the game wraps landX by 22 + 2 each lap. */
const LAND_PERIOD = 24;

/**
 * Draws the game state between the previous and the current tick. The game itself steps at a fixed 60 Hz
 * like the original; interpolating the picture by the leftover time (`alpha`) keeps motion smooth when a
 * frame arrives late (e.g. right after a touch) or when the display runs at 120 Hz.
 */
function render(alpha = 1) {
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
  const k = layout.S;
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i], p = prevSprites[i];
    let x = s.x, y = s.y, rot = s.rotation;
    if (p && p.name === s.name && alpha < 1) {
      let dx = s.x - p.x;
      const dy = s.y - p.y;
      if (s.name === 'land' && dx > LAND_PERIOD / 2) dx -= LAND_PERIOD;
      if (Math.abs(dx) <= 12 && Math.abs(dy) <= 12) {
        // Snap to the buffer's pixel grid so interpolated sprites stay crisp.
        x = Math.round((p.x + dx * alpha) * k) / k;
        y = Math.round((p.y + dy * alpha) * k) / k;
        if (rot !== null && p.rotation !== null) rot = p.rotation + (s.rotation - p.rotation) * alpha;
      }
    }
    drawSprite(s, x, y, rot);
  }
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
let prevSprites = [];
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
  accumulator = Math.min(accumulator + dt, 0.25);
  while (accumulator >= step) {
    prevSprites = game.sprites;
    game.tick();
    accumulator -= step;
  }
  const alpha = accumulator / step;

  // Start sounds after this frame's drawing so audio work never delays a frame.
  const sounds = game.drainSounds();
  if (sounds.length) setTimeout(() => sounds.forEach((s) => audio.play(s)), 0);
  if (game.savedBest !== null) {
    Store.set('bestScore', String(game.savedBest));
    game.savedBest = null;
  }
  syncUI();
  const r0 = performance.now();
  render(alpha);
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

function openRanking() { if (!overlayOpen) { setOverlay(true); Screens.ranking(); } }
function openColors() {
  if (overlayOpen) return;
  setOverlay(true);
  Screens.colors(uiBirdStyle, (i) => { uiBirdStyle = i; Ranking.birdStyle = i; swatchEl.style.background = swatchColor(i); });
}
function openName(score) {
  if (overlayOpen) Screens.close();
  setOverlay(true);
  Screens.name(score, (saved) => { if (saved) setTimeout(openRanking, 0); });
}

Screens.onClose = () => { setOverlay(false); };

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
for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) document.addEventListener(ev, () => audio.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => {
  lastTime = null;
  if (document.hidden) { if (audio.ctx && audio.ctx.state === 'running') audio.ctx.suspend().catch(() => {}); }
  else { audio.unlock(); resize(); }
});
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
