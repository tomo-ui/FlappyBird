'use strict';
// Fixed-step port of the original Flappy Bird 1.2 game loop, same as Game.swift in the iOS app.
// One tick() is one 60 Hz frame. Coordinates: 288x512, origin top-left, y grows downwards.
// Integer positions and truncating float->int conversions are kept on purpose, they shape the feel.

const GAME_W = 288, GAME_H = 512, GROUND_Y = 400, PIPE_GAP = 96;
const BIRD_W = 20, BIRD_H = 20, BIRD_DRAW_OFFSET = 14;
const f32 = Math.fround;
const trunc = Math.trunc;

// 0-2 are the original sprite sets, 3-7 are palette-remapped copies of the yellow bird.
const BIRD_STYLES = [
  { name: 'Żółty', variant: 0, swatch: [0.97, 0.8, 0.2] },
  { name: 'Niebieski', variant: 1, swatch: [0.3, 0.7, 0.9] },
  { name: 'Czerwony', variant: 2, swatch: [0.85, 0.25, 0.2] },
  { name: 'Zielony', variant: 3, swatch: [0.47, 0.78, 0.24] },
  { name: 'Fioletowy', variant: 4, swatch: [0.67, 0.43, 0.9] },
  { name: 'Różowy', variant: 5, swatch: [1, 0.55, 0.75] },
  { name: 'Czarny', variant: 6, swatch: [0.37, 0.37, 0.42] },
  { name: 'Biały', variant: 7, swatch: [0.93, 0.95, 0.98] },
];

class Tween {
  constructor() {
    this.from = 0; this.to = 0; this.value = 0;
    this.ticks = 1; this.elapsed = 0; this.done = true; this.ease = 'linear';
  }
  start(from, to, seconds, ease = 'linear') {
    this.from = from; this.to = to;
    this.ticks = Math.max(trunc(seconds * 60), 1);
    this.ease = ease; this.elapsed = 0; this.value = from; this.done = false;
  }
  step() {
    if (this.done) return;
    this.elapsed += 1;
    const t = this.elapsed / this.ticks;
    this.value = this.ease === 'linear'
      ? this.from + (this.to - this.from) * t
      : this.from + (this.to - this.from) * (1 - (1 - t) * (1 - t));
    if (this.elapsed >= this.ticks) { this.done = true; this.value = this.to; }
  }
}

const ANIM_FRAMES = [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1];

class Animation {
  constructor(frameMs, loops) {
    this.frameMs = frameMs; this.loops = loops;
    this.index = 0; this.elapsedMs = 0; this.finished = false;
  }
  get frame() { return ANIM_FRAMES[Math.min(this.index, ANIM_FRAMES.length - 1)]; }
  restart() { this.index = 0; this.elapsedMs = 0; this.finished = false; }
  tick() {
    if (this.finished) return;
    this.elapsedMs += 15;
    if (this.elapsedMs < this.frameMs) return;
    this.elapsedMs = 0;
    this.index += 1;
    if (this.index >= ANIM_FRAMES.length) {
      if (this.loops) this.index = 0; else this.finished = true;
    }
  }
}

class Bird {
  constructor() {
    this.x = 80; this.y = 246;
    this.vy = 0; this.gravity = 1;
    this.rotation = 0; this.rotationVelocity = 0; this.rotationAcceleration = f32(0.4);
    this.idle = true; this.dead = false;
    this.bobAngle = 0; this.bob = 0;
    this.style = 0;
    this.animations = [new Animation(trunc(1000 / 30), false), new Animation(trunc(1000 / 10), true)];
    this.current = 1;
  }
  reset() {
    this.x = 80; this.y = 246; this.rotation = 0; this.vy = 0; this.gravity = 1;
    this.rotationAcceleration = f32(0.4);
    this.dead = false; this.idle = true; this.bobAngle = 0;
    this.play(1, true);
  }
  play(a, restart) {
    const an = this.animations[a];
    if (restart) an.restart();
    if (!an.loops && an.finished) an.restart();
    an.finished = false;
    this.current = a;
  }
  update() {
    this.animations[this.current].tick();
    if (this.idle) {
      this.bobAngle += 8;
      if (this.bobAngle === 360) this.bobAngle = 0;
      this.bob = f32(f32(Math.sin(this.bobAngle * Math.PI / 180)) * 4);
      return;
    }
    this.bob = 0;
    this.vy = f32(Math.min(this.vy + this.gravity, 8));
    this.y = trunc(f32(this.y + this.vy));
    const floor = GROUND_Y - BIRD_H;
    if (this.y > floor) { this.y = floor; this.vy = 0; this.gravity = 0; }
    const newRotation = f32(this.rotation + this.rotationVelocity);
    this.rotation = newRotation;
    this.rotationVelocity = f32(this.rotationVelocity + this.rotationAcceleration);
    if (newRotation < -20) this.rotation = -20;
    else if (newRotation > 90) this.rotation = 90;
  }
  /** Returns true when the bird actually flapped (the caller queues the wing sound). */
  flap() {
    if (this.idle) this.idle = false;
    if (!(this.y >= 0) || this.dead) return false;
    this.play(0, true);
    this.vy = -5; this.gravity = f32(0.3);
    this.rotationVelocity = -10; this.rotationAcceleration = f32(0.4);
    return true;
  }
  get sprite() {
    const look = BIRD_STYLES[this.style];
    return {
      name: `bird${look.variant}_${this.animations[this.current].frame}`,
      x: this.x - BIRD_DRAW_OFFSET,
      y: trunc(f32((this.y - BIRD_DRAW_OFFSET) + this.bob)),
      alpha: 1,
      rotation: trunc(this.rotation),
    };
  }
}

class PadButton {
  constructor(name, size) {
    this.name = name; this.w = size.w; this.h = size.h;
    this.x = 0; this.y = 0; this.visible = false; this.pressed = false; this.clicked = false;
  }
  contains(px, py) { return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h; }
  place(x, y) { this.x = x; this.y = y; this.visible = true; this.pressed = false; this.clicked = false; }
}

class Game {
  constructor(sizes, best, birdStyle = 0) {
    this.sizes = sizes;
    this.sprites = [];
    this.sounds = [];
    this.fade = new Tween();
    this.flash = new Tween();
    this.shakeX = 0; this.shakeY = 0;
    this.shakeAmplitude = 0; this.shakeFrames = 0;
    this.fadeEvent = 0;
    this.best = best;
    /** Set when the stored high score should be written. */
    this.savedBest = null;
    /** Set once the score panel has finished counting up a non-zero score. */
    this.finishedScore = null;
    /** Set when the leaderboard button was tapped. */
    this.rankingRequested = false;

    this.menu = true;
    this.background = null;
    this.landX = 0;
    this.speed = 2;
    this.pipeX = [0, 0, 0];
    this.pipeY = [274, 274, 274];
    this.countdown = 1;
    this.score = 0;
    this.bird = new Bird();
    this.ready = { visible: false, state: 0, alpha: new Tween() };
    this.gameOver = { visible: false, alpha: new Tween(), offset: 0, velocity: 0, acceleration: 0, state: 0 };
    this.panel = {
      visible: false, x: (GAME_W - 238) >> 1, y: 504, state: 0, score: 0, shown: 0, best: 0,
      newBest: false, thresholds: [10, 20, 30, 40], medal: null, tween: new Tween(),
      sparkleFrame: 0, sparkleTick: 0, sparkleX: 0, sparkleY: 0,
    };
    this.play = new PadButton('button_play', sizes.button_play);
    this.leaderboard = new PadButton('button_score', sizes.button_score);
    this.rate = new PadButton('button_rate', sizes.button_rate);
    this.scheduled = [];

    // Multiply-with-carry generator used for pipe heights and shake.
    this.mwcZ = 1 + Math.floor(Math.random() * 0x7fffffff);
    this.mwcW = 1 + Math.floor(Math.random() * 0x7fffffff);

    this.pipeW = sizes.pipe_up.w;
    this.pipeH = sizes.pipe_up.h;
    this.landH = sizes.land.h;

    // FUN_000105dc: initial pipe layout.
    this.pipeSpacing = trunc((GAME_W - trunc(this.pipeW * 3 / 2)) / 2);
    this.pipeX[0] = this.pipeSpacing - (this.pipeW >> 1);
    this.pipeX[1] = this.pipeX[0] + this.pipeSpacing + this.pipeW;
    this.pipeX[2] = this.pipeX[1] + this.pipeSpacing + this.pipeW;

    this.birdStyle = birdStyle;
    this.fade.value = 1;
    this.schedule(6, 1);
  }

  get birdStyle() { return this.bird.style; }
  set birdStyle(v) { this.bird.style = Math.min(Math.max(v | 0, 0), BIRD_STYLES.length - 1); }
  get inMenu() { return this.menu; }
  /** The colour can be changed on the title screen, on "Get Ready" and on the game-over buttons screen. */
  get canPickColor() { return this.menu || this.bird.idle || this.play.visible; }

  // MARK: Input

  touchBegan(x, y) {
    for (const b of [this.play, this.leaderboard, this.rate]) {
      if (b.visible && b.contains(x, y)) b.pressed = true;
    }
    if (this.menu) return;
    if (this.bird.idle) {
      if (!(this.ready.visible && this.ready.state === 1)) return;
      this.ready.state = 2;
      this.ready.alpha.start(1, 0, 0.5);
      this.bird.idle = false;
    } else if (this.speed < 1) {
      return;
    }
    if (this.bird.flap()) this.schedule(4, 5);
  }

  touchEnded(x, y) {
    for (const b of [this.play, this.leaderboard, this.rate]) {
      if (b.pressed && b.visible && b.contains(x, y)) b.clicked = true;
      b.pressed = false;
    }
  }

  drainSounds() { const s = this.sounds; this.sounds = []; return s; }

  // MARK: Frame (FUN_0000dba0)

  tick() {
    this.sprites = [];

    const fired = [];
    for (const s of this.scheduled) {
      if (s.delay > 0) {
        s.delay -= 30;
        if (s.delay < 1) fired.push(s.id);
      }
    }
    this.scheduled = this.scheduled.filter((s) => s.delay >= 1);
    fired.forEach((id) => this.dispatch(id));

    this.update();

    if (!this.fade.done || this.fade.value !== 0) {
      this.fade.step();
      if (this.fade.done) this.dispatch(this.fadeEvent);
    }
    this.flash.step();

    if (this.shakeFrames < 1) {
      this.shakeX = 0; this.shakeY = 0;
    } else {
      this.shakeFrames -= 1;
      this.shakeX = (this.mwc() % (this.shakeAmplitude * 2)) - this.shakeAmplitude;
      this.shakeY = (this.mwc() % (this.shakeAmplitude * 2)) - this.shakeAmplitude;
    }
  }

  // MARK: Game update (FUN_00010b18)

  update() {
    const { sizes, bird, pipeX, pipeY, pipeW, pipeH } = this;
    if (this.background) this.draw(this.background, 0, 0);

    this.landX -= this.speed;
    if (this.landX < -23) this.landX = 0;

    if (!bird.idle) {
      for (let i = 0; i < 3; i++) pipeX[i] -= this.speed;
      if (this.speed > 0 && this.countdown < 1 && (pipeX[0] === bird.x || pipeX[0] === bird.x - 1)) {
        this.score += 1;
        this.sounds.push('point');
      }
      if (pipeX[0] < -pipeW) {
        pipeX[0] = pipeX[1]; pipeY[0] = pipeY[1];
        pipeX[1] = pipeX[2]; pipeY[1] = pipeY[2];
        pipeX[2] += this.pipeSpacing + pipeW;
        pipeY[2] = (this.mwc() % 180) + 180;
        if (this.countdown > 0) {
          this.countdown -= 1;
          if (this.countdown === 0) { pipeX[1] = -pipeW; pipeX[0] = -pipeW; }
        }
      }
    }

    bird.update();

    if (this.menu) {
      const title = sizes.title;
      this.draw('title', (GAME_W - title.w) >> 1, 150);
      bird.x = (GAME_W - BIRD_W) >> 1;
      bird.y = title.h + 170;
      this.sprites.push(bird.sprite);
    } else {
      if (bird.y >= GROUND_Y - BIRD_H && this.speed > 0) this.die(false);
      if (!bird.dead && this.countdown < 1 && this.speed > 0) {
        for (let i = 0; i < 2; i++) {
          if (this.hitsPipe(i)) { bird.dead = true; this.die(true); }
        }
      }
      if (this.countdown < 1) {
        for (let i = 0; i < 3; i++) {
          if (i < 2 || pipeX[2] < GAME_W) {
            this.draw('pipe_up', pipeX[i], pipeY[i]);
            this.draw('pipe_down', pipeX[i], pipeY[i] - PIPE_GAP - pipeH);
          }
        }
      }
      if (this.panel.visible && this.panel.state === 2 && !this.play.visible) {
        this.play.place((272 - this.play.w - this.leaderboard.w) >> 1, 340);
        this.leaderboard.place(this.play.x + this.play.w + 16, 340);
      }
      if (this.gameOver.visible) {
        this.updateGameOver();
        this.updatePanel();
      } else {
        this.drawScore(this.score);
      }
      this.sprites.push(bird.sprite);
    }
    this.draw('land', this.landX, GAME_H - this.landH);

    if (this.ready.visible) {
      this.updateReady();
      const text = sizes.text_ready, tutorial = sizes.tutorial;
      this.draw('text_ready', (GAME_W - text.w) >> 1, 146, this.ready.alpha.value);
      this.draw('tutorial', (GAME_W - tutorial.w) >> 1, 220, this.ready.alpha.value);
    }
    if (this.menu) {
      const c = sizes.brand_copyright;
      this.draw('brand_copyright', (GAME_W - c.w) >> 1, 432 - c.h);
    }

    if (this.play.visible) {
      this.draw(this.play.name, this.play.x, this.play.y);
      this.draw(this.leaderboard.name, this.leaderboard.x, this.leaderboard.y);
      if (this.play.clicked) {
        this.play.clicked = false;
        this.startFade(true, 5, 0.5);
        this.sounds.push('swoosh');
      }
      if (this.leaderboard.clicked) {
        // Game Center leaderboard in the original; here it opens the local ranking.
        this.leaderboard.clicked = false;
        this.rankingRequested = true;
        this.sounds.push('swoosh');
      }
      if (this.rate.visible) {
        this.draw(this.rate.name, this.rate.x, this.rate.y);
        if (this.rate.clicked) this.rate.clicked = false;
      }
    }
  }

  updateReady() {
    const r = this.ready;
    r.alpha.step();
    if (r.state === 2) {
      if (r.alpha.done) r.visible = false;
    } else if (r.state === 0 && r.alpha.done) {
      r.state = 1;
    }
  }

  hitsPipe(i) {
    const px = this.pipeX[i], py = this.pipeY[i];
    const bx = this.bird.x, by = this.bird.y;
    if (!(px <= bx + BIRD_W)) return false;
    const topBottom = py - PIPE_GAP;
    if (this.pipeW + px >= bx) {
      const clearsTop = by + BIRD_H < topBottom - this.pipeH || topBottom < by;
      if (!clearsTop) return true;
    }
    const clearsBottom = this.pipeW + px < bx || by + BIRD_H < py || this.pipeH + py < by;
    return !clearsBottom;
  }

  die(fromPipe) {
    this.startFlash();
    this.shakeAmplitude = 2;
    this.shakeFrames = 30;
    this.speed = 0;
    this.sounds.push('hit');
    if (fromPipe) this.schedule(3, 500);
    this.schedule(2, 1000);
  }

  // MARK: Events (FUN_00010a18)

  schedule(id, delay) { this.scheduled.push({ id, delay }); }

  dispatch(id) {
    switch (id) {
      case 2:
        if (this.score > (this.savedBest ?? this.best)) this.savedBest = this.score;
        this.showGameOver();
        break;
      case 3: this.sounds.push('die'); break;
      case 4: this.sounds.push('wing'); break;
      case 5:
        this.resetToMenu();
        this.play.visible = false;
        this.leaderboard.visible = false;
        this.rate.visible = false;
        this.menu = false;
        this.startFade(false, 0, 0.5);
        this.ready.visible = true;
        this.ready.alpha.start(0, 1, 0.5);
        this.ready.state = 0;
        break;
      case 6:
        this.resetToMenu();
        this.startFade(false, 0, 0.5);
        break;
      default: break;
    }
  }

  /** FUN_00010918 */
  resetToMenu() {
    this.background = Math.floor(Math.random() * 10) < 6 ? 'bg_day' : 'bg_night';
    this.play.place((272 - this.play.w - this.leaderboard.w) >> 1, 340);
    this.leaderboard.place(this.play.x + this.play.w + 16, 340);
    this.rate.place((GAME_W - this.rate.w) >> 1, 270);
    this.ready.visible = false;
    this.gameOver.visible = false;
    this.panel.visible = false;
    this.menu = true;
    this.landX = 0;
    this.bird.reset();
    this.speed = 2;
    this.countdown = 1;
    this.score = 0;
  }

  startFade(toBlack, event, seconds) {
    if (!this.fade.done) return;
    this.fade.start(toBlack ? 0 : 1, toBlack ? 1 : 0, seconds);
    this.fadeEvent = event;
  }

  startFlash() {
    if (!this.flash.done) return;
    this.flash.start(1, 0, 1, 'easeOut');
  }

  // MARK: Game over

  showGameOver() {
    const g = this.gameOver;
    g.visible = true;
    g.alpha.start(0, 1, 1, 'easeOut');
    g.offset = -1; g.velocity = -2; g.acceleration = 0.25; g.state = 0;
    this.sounds.push('swoosh');
  }

  updateGameOver() {
    const g = this.gameOver;
    g.alpha.step();
    if (g.offset < 0) {
      g.offset = trunc(f32(g.offset + g.velocity));
      g.velocity = f32(g.velocity + g.acceleration);
    } else {
      g.offset = 0;
    }
    if (g.state === 1) {
      if (this.panel.state === 2) g.state = 2;
    } else if (g.state === 0 && g.alpha.done) {
      g.state = 1;
      this.startPanel();
      this.sounds.push('swoosh');
    }
    const title = this.sizes.text_game_over;
    this.draw('text_game_over', (GAME_W - title.w) >> 1, g.offset + 130, g.alpha.value);
  }

  startPanel() {
    const p = this.panel;
    p.visible = true;
    p.score = this.score; p.best = this.best; p.shown = 0;
    p.newBest = false; p.medal = null; p.y = 504; p.state = 0;
    p.tween.start(504, (GAME_H - 126) >> 1, 0.5, 'easeOut');
  }

  updatePanel() {
    const p = this.panel;
    if (!p.visible) return;
    p.tween.step();
    if (p.state === 0) {
      p.y = trunc(p.tween.value);
      if (p.tween.done) {
        if (p.score > 0) {
          p.state = 1;
          p.tween.start(0, p.score, 0.5);
        } else {
          p.state = 2;
        }
      }
    } else if (p.state === 1) {
      p.shown = trunc(p.tween.value);
      if (p.tween.done) {
        p.state = 2;
        this.finishedScore = p.score;
        if (p.best < p.shown) {
          p.best = p.shown;
          p.newBest = true;
          this.best = p.shown;
        }
        const t = p.thresholds;
        if (p.shown >= t[3]) p.medal = 0;
        else if (p.shown >= t[2]) p.medal = 1;
        else if (p.shown >= t[1]) p.medal = 2;
        else if (p.shown >= t[0]) p.medal = 3;
      }
    }

    this.draw('score_panel', p.x, p.y);
    this.drawDigits(p.shown, p.x + 210, p.y + 36);
    this.drawDigits(p.best, p.x + 210, p.y + 78);
    if (p.newBest) this.draw('new', p.x + 142, p.y + 60);
    if (p.medal !== null) {
      const mx = p.x + 32, my = p.y + 44;
      this.draw(`medals_${p.medal}`, mx, my);
      this.drawSparkle(mx, my);
    }
  }

  drawSparkle(medalX, medalY) {
    const p = this.panel;
    const frames = [0, 1, 2, 1, 0];
    if (p.sparkleTick === 0 && p.sparkleFrame === 0) {
      p.sparkleX = medalX + Math.floor(Math.random() * (44 - 10));
      p.sparkleY = medalY + Math.floor(Math.random() * (44 - 10));
    }
    this.draw(`blink_0${frames[p.sparkleFrame]}`, p.sparkleX, p.sparkleY);
    p.sparkleTick += 1;
    if (p.sparkleTick >= 6) {
      p.sparkleTick = 0;
      p.sparkleFrame = (p.sparkleFrame + 1) % frames.length;
    }
  }

  // MARK: Drawing helpers

  draw(name, x, y, alpha = 1) { this.sprites.push({ name, x, y, alpha, rotation: null }); }

  /** Big in-game score, FUN_0000cdc0 with centre alignment and 4 px kerning. */
  drawScore(value) {
    const glyphs = [...String(value)].map((c) => `font_0${c.charCodeAt(0)}`);
    const widths = glyphs.map((g) => this.sizes[g].w);
    const total = widths.reduce((a, w) => a + w - 4, 0) + 2;
    let x = 144 - trunc(total / 2);
    const y = 100 - 44 / 2;
    glyphs.forEach((g, i) => { this.draw(g, x, y); x += widths[i] - 4; });
  }

  /** Right-aligned panel number, FUN_0000f930. */
  drawDigits(value, rightX, y) {
    const advance = 16;
    let v = value;
    let x = rightX - advance;
    do {
      this.draw(`number_score_${String(v % 10).padStart(2, '0')}`, x, y);
      x -= advance;
      v = trunc(v / 10);
    } while (v >= 1);
  }

  mwc() {
    this.mwcZ = (Math.imul(this.mwcZ & 0xffff, 36969) + (this.mwcZ >> 16)) | 0;
    this.mwcW = (Math.imul(this.mwcW & 0xffff, 18000) + (this.mwcW >> 16)) | 0;
    const r = (this.mwcW + Math.imul(this.mwcZ, 0x10000)) | 0;
    return r < 0 ? (r === -2147483648 ? 2147483647 : -r) : r;
  }
}
