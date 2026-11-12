'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
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
    this.ctx = new AC();
    await Promise.all(Object.entries(this.files).map(async ([name, file]) => {
      try {
        const data = await (await fetch(`audio/${file}.wav`)).arrayBuffer();
        this.buffers[name] = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
      } catch { /* sound is optional */ }
    }));
  },
  unlock() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); },
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
  atlasImg = img;
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

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = window.innerWidth, ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  const S = Math.min(canvas.width / GAME_W, canvas.height / GAME_H);
  const extra = canvas.height / S - GAME_H;
  const top = Math.min(extra / 2, MAX_TOP_MARGIN);
  layout = { S, ox: (canvas.width - GAME_W * S) / 2, oy: top * S, top, bottom: extra - top };
}

// MARK: Render

function drawSprite(s) {
  const r = rects[s.name];
  if (!r) return;
  ctx.globalAlpha = s.alpha;
  if (s.rotation !== null) {
    ctx.save();
    ctx.translate(s.x + r.w / 2, s.y + r.h / 2);
    ctx.rotate(s.rotation * Math.PI / 180);
    ctx.drawImage(atlasImg, r.px, r.py, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.restore();
  } else {
    ctx.drawImage(atlasImg, r.px, r.py, r.w, r.h, s.x, s.y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
}

function render() {
  const { S, ox, oy, top, bottom } = layout;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  ctx.setTransform(S, 0, 0, S, ox, oy);
  const margin = 8;
  // On wide screens (desktop) keep the game in its own column instead of letting pipes spill out.
  ctx.beginPath();
  ctx.rect(-margin, -(top + margin), GAME_W + 2 * margin, GAME_H + top + bottom + 2 * margin);
  ctx.clip();
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
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (game.fade.value > 0) {
    ctx.fillStyle = `rgba(0,0,0,${game.fade.value})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// MARK: Loop

let lastTime = null;
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  const step = 1 / 60;
  if (lastTime !== null) accumulator = Math.min(accumulator + t - lastTime, 0.25);
  else accumulator = step;
  lastTime = t;
  // Round to whole ticks so display-timestamp jitter never produces a 0-then-2 tick stutter.
  const ticks = Math.round(accumulator / step);
  for (let i = 0; i < ticks; i++) game.tick();
  accumulator -= ticks * step;

  for (const s of game.drainSounds()) audio.play(s);
  if (game.savedBest !== null) {
    Store.set('bestScore', String(game.savedBest));
    game.savedBest = null;
  }
  syncUI();
  render();
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

// MARK: Input

function gamePoint(e) {
  const dpr = window.devicePixelRatio || 1;
  const { S, ox, oy } = layout;
  return [Math.floor((e.clientX * dpr - ox) / S), Math.floor((e.clientY * dpr - oy) / S)];
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
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
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
