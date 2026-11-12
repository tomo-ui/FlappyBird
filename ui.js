'use strict';
// Game-styled DOM screens: ranking, name entry, bird colour. Port of Screens.swift / Ranking.swift.

const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const Ranking = {
  limit: 50,
  lastAddedID: null,
  get lastName() { return Store.get('playerName', ''); },
  get birdStyle() { return parseInt(Store.get('birdStyle', '0'), 10) || 0; },
  set birdStyle(v) { Store.set('birdStyle', String(v)); },
  load() {
    try {
      const list = JSON.parse(Store.get('localRanking', '[]'));
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  },
  add(name, score) {
    const trimmed = name.trim();
    const finalName = (trimmed || 'Gracz').slice(0, 16);
    Store.set('playerName', finalName);
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: finalName, score, date: Date.now() };
    this.lastAddedID = entry.id;
    const entries = this.load();
    entries.push(entry);
    entries.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.date - b.date));
    Store.set('localRanking', JSON.stringify(entries.slice(0, this.limit)));
  },
  clear() { Store.remove('localRanking'); },
};

function medalIndex(score) {
  if (score >= 40) return 0;
  if (score >= 30) return 1;
  if (score >= 20) return 2;
  if (score >= 10) return 3;
  return null;
}

function el(tag, cls, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function medalView(score, size) {
  const m = medalIndex(score);
  const box = el('span', 'medal');
  box.style.width = box.style.height = `${size}px`;
  if (m !== null) {
    const c = spriteCanvas(`medals_${m}`, size / 44);
    box.appendChild(c);
  }
  return box;
}

function spriteButton(name, scale, onClick) {
  const b = el('button', 'sprite-btn', spriteCanvas(name, scale));
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function textButton(title, bg, onClick) {
  const b = el('button', 'text-btn', pixelText(title, { scale: 1.2 }));
  b.type = 'button';
  b.style.background = bg;
  b.addEventListener('click', onClick);
  return b;
}

function headerText(text, scale) {
  return pixelText(text, { scale, color: HEAD_FILL, shade: HEAD_SHADE, border: true });
}

const Screens = {
  root: null,
  onClose: null,

  init(root) { this.root = root; },

  isOpen() { return this.root.childElementCount > 0; },

  close() {
    this.root.replaceChildren();
    if (this.onClose) this.onClose();
  },

  show(panel, align = 'top') {
    const backdrop = el('div', 'backdrop');
    const wrap = el('div', `panel-wrap ${align}`, panel);
    this.root.replaceChildren(backdrop, wrap);
  },

  ranking() {
    let entries = Ranking.load();
    const panel = el('div', 'panel');
    const render = (confirming = false) => {
      panel.replaceChildren();
      panel.appendChild(el('div', 'center', headerText('RANKING', 3)));
      if (entries.length === 0) {
        panel.appendChild(el('div', 'empty',
          pixelText('BRAK WYNIKÓW', { scale: 1.8 }), pixelText('ZAGRAJ I ZAPISZ WYNIK', { scale: 1 })));
      } else {
        const list = el('div', 'rank-list');
        entries.slice(0, 20).forEach((entry, i) => {
          const rank = el('span', 'rank', spriteNumber(i + 1, { scale: 0.9 }));
          const row = el('div', 'rank-row', rank, medalView(entry.score, 28),
            el('span', 'rank-name', pixelText(entry.name, { scale: 1.25 })),
            el('span', 'rank-score', spriteNumber(entry.score, { scale: 1.1 })));
          if (entry.id === Ranking.lastAddedID) row.classList.add('latest');
          list.appendChild(row);
        });
        panel.appendChild(list);
      }
      const buttons = el('div', 'buttons');
      if (confirming) {
        buttons.append(
          pixelText('USUNĄĆ?', { scale: 1.4 }),
          textButton('TAK', '#cc3326', () => { Ranking.clear(); entries = []; render(); }),
          textButton('NIE', '#73bf2e', () => render()));
      } else {
        buttons.appendChild(spriteButton('button_ok', 1.6, () => this.close()));
        if (entries.length) buttons.appendChild(textButton('WYCZYŚĆ', '#cc3326', () => render(true)));
      }
      panel.appendChild(buttons);
    };
    render();
    this.show(panel, 'top');
  },

  name(score, done) {
    const panel = el('div', 'panel');
    const medal = medalView(score, 44);
    panel.appendChild(el('div', 'center', headerText('TWÓJ WYNIK', 2.4)));
    panel.appendChild(el('div', 'center score-row', medal, spriteNumber(score, { big: true })));
    panel.appendChild(el('div', 'center', pixelText('WPISZ IMIĘ', { scale: 1.3 })));

    const box = el('div', 'name-box');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.value = Ranking.lastName.slice(0, 12);
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('enterkeyhint', 'done');
    const shown = el('div', 'name-shown');
    const paint = () => {
      shown.replaceChildren(pixelText(`${input.value}_`, { scale: 2, color: GAME_DARK, outlined: false }));
    };
    input.addEventListener('input', paint);
    paint();
    box.append(shown, input);
    panel.appendChild(box);

    const save = () => { Ranking.add(input.value, score); this.close(); done(true); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    panel.appendChild(el('div', 'buttons',
      spriteButton('button_ok', 1.6, save),
      textButton('POMIŃ', 'rgba(84,56,71,.35)', () => { this.close(); done(false); })));
    this.show(panel, 'upper');
    setTimeout(() => input.focus(), 50);
  },

  colors(selected, onSelect) {
    const panel = el('div', 'panel');
    panel.appendChild(el('div', 'center', headerText('KOLOR PTAKA', 2.2)));
    const grid = el('div', 'color-grid');
    const cells = BIRD_STYLES.map((style, i) => {
      const cell = el('button', 'color-cell', spriteCanvas(`bird${style.variant}_1`, 1));
      cell.type = 'button';
      cell.setAttribute('aria-label', style.name);
      cell.addEventListener('click', () => { selected = i; onSelect(i); mark(); });
      grid.appendChild(cell);
      return cell;
    });
    const mark = () => cells.forEach((c, i) => c.classList.toggle('selected', i === selected));
    mark();
    panel.appendChild(grid);
    panel.appendChild(el('div', 'buttons', spriteButton('button_ok', 1.6, () => this.close())));
    this.show(panel, 'center');
  },
};
