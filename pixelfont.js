'use strict';
// Chunky game-style text for the DOM screens (port of PixelFont.swift / PixelText).
// The atlas only ships digit sprites, so letters are built from 5x7 skeletons: every cell is blown
// up to 2x2 units and dilated by one unit, then drawn with the layers of the game's titles:
// dark outline, optional white border, fill and a darker bottom edge.

const GAME_DARK = '#543847';
const HEAD_FILL = '#ffa140';
const HEAD_SHADE = '#e86100';

const PF_BASE = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  'Ł': ['10000', '10000', '10100', '11000', '10000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00000', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  _: ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  ':': ['00000', '00100', '00000', '00000', '00000', '00100', '00000'],
};
const PF_ACUTE = ['00010', '00100', '00000'];
const PF_DOT = ['00000', '00100', '00000'];
const PF_TAIL = '00001';
const PF_MARKS = {
  'Ą': ['A', null, PF_TAIL], 'Ę': ['E', null, PF_TAIL],
  'Ć': ['C', PF_ACUTE, null], 'Ń': ['N', PF_ACUTE, null], 'Ó': ['O', PF_ACUTE, null],
  'Ś': ['S', PF_ACUTE, null], 'Ź': ['Z', PF_ACUTE, null], 'Ż': ['Z', PF_DOT, null],
};
const PF_ADVANCE = 12;

function pfGlyph(ch) {
  if (PF_BASE[ch]) return { top: null, rows: PF_BASE[ch], bottom: null };
  const m = PF_MARKS[ch];
  if (m) return { top: m[1], rows: PF_BASE[m[0]], bottom: m[2] };
  return null;
}

/**
 * Renders `text` into a new <canvas>. `scale` is CSS px per unit (cap height is 15 units).
 * options: color, shade (darker bottom edge), border (white ring, for headers), outlined.
 */
function pixelText(text, { scale = 1.5, color = '#fff', shade = null, border = false, outlined = true } = {}) {
  text = text.toUpperCase();
  const chars = [...text];
  const topCells = chars.some((c) => PF_MARKS[c] && PF_MARKS[c][1]) ? 3 : 0;
  const bottomCells = chars.some((c) => PF_MARKS[c] && PF_MARKS[c][2]) ? 1 : 0;
  const pad = outlined ? (border ? 3 : 2) : 0;
  const unitsW = Math.max(chars.length, 1) * PF_ADVANCE - 1 + 2 * pad;
  const unitsH = (7 + topCells + bottomCells) * 2 + 1 + 2 * pad + (outlined ? 1 : 0);

  const dpr = window.devicePixelRatio || 1;
  const k = scale * dpr;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(unitsW * k);
  canvas.height = Math.ceil(unitsH * k);
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', text);
  const ctx = canvas.getContext('2d');

  const lit = new Set();
  const key = (x, y) => y * 100000 + x;
  chars.forEach((ch, index) => {
    const g = pfGlyph(ch);
    if (!g) return;
    const cells = [];
    if (g.top) g.top.forEach((row, r) => [...row].forEach((v, c) => { if (v === '1') cells.push([c, r]); }));
    g.rows.forEach((row, r) => [...row].forEach((v, c) => { if (v === '1') cells.push([c, r + topCells]); }));
    if (g.bottom) [...g.bottom].forEach((v, c) => { if (v === '1') cells.push([c, 7 + topCells]); });
    for (const [c, r] of cells) {
      for (let dx = 0; dx <= 2; dx++) for (let dy = 0; dy <= 2; dy++) lit.add(key(index * PF_ADVANCE + c * 2 + dx, r * 2 + dy));
    }
  });

  const rect = (x, y, grow, down, fill) => {
    const x0 = Math.round((x + pad - grow) * k), x1 = Math.round((x + pad + 1 + grow) * k);
    const y0 = Math.round((y + pad - grow) * k), y1 = Math.round((y + pad + 1 + grow + down) * k);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const cells = [...lit].map((v) => [v % 100000, Math.floor(v / 100000)]);
  if (outlined) {
    for (const [x, y] of cells) rect(x, y, border ? 2 : 1, 1, GAME_DARK);
    if (border) for (const [x, y] of cells) rect(x, y, 1, 0, '#fff');
  }
  for (const [x, y] of cells) {
    const bottomEdge = shade && !lit.has(key(x, y + 2));
    rect(x, y, 0, 0, bottomEdge ? shade : color);
  }
  return canvas;
}

// MARK: Atlas sprites as DOM images

let ATLAS_IMG = null;
let ATLAS_RECTS = {};

function atlasSetup(img, rects) { ATLAS_IMG = img; ATLAS_RECTS = rects; }

/** A sprite from the atlas as a crisp <canvas>, `scale` CSS px per art pixel. */
function spriteCanvas(name, scale = 1) {
  const r = ATLAS_RECTS[name];
  const canvas = document.createElement('canvas');
  if (!r) return canvas;
  canvas.width = r.w; canvas.height = r.h;
  canvas.getContext('2d').drawImage(ATLAS_IMG, r.px, r.py, r.w, r.h, 0, 0, r.w, r.h);
  canvas.style.width = `${r.w * scale}px`;
  canvas.style.height = `${r.h * scale}px`;
  canvas.style.imageRendering = 'pixelated';
  return canvas;
}

/** Number drawn with the game's own digit sprites (big score font or small panel font). */
function spriteNumber(value, { big = false, scale = 1 } = {}) {
  const wrap = document.createElement('span');
  wrap.className = 'num';
  wrap.style.display = 'inline-flex';
  [...String(Math.max(value, 0))].forEach((d, i) => {
    const c = spriteCanvas(big ? `font_0${48 + Number(d)}` : `number_score_0${d}`, scale);
    if (big && i > 0) c.style.marginLeft = `${-4 * scale}px`;
    wrap.appendChild(c);
  });
  return wrap;
}
