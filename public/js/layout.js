/*
 * Fence layout drawing tool.
 *
 * Works on a photo / scanned drawing / screenshot of a site plan, or on a blank grid.
 * - Scale: tap two points a known distance apart and type the real length.
 * - Draw: tap to add posts along the fence line; tap the first point to close a shape.
 * - Gate: tap a fence line to put a gate there.
 * - Drag a point to move it; drag empty space to pan; pinch or the +/- buttons to zoom.
 *
 * Data lives on the estimate object passed in:
 *   est.layout = { image, imgW, imgH, scale (px per unit), lines: [{ points: [[x,y]...], closed }], lengths: { "li-si": override } }
 *   est.gates[i].pos = { line, seg, t }
 */
(function (root) {
  'use strict';

  const GRID_W = 1200, GRID_H = 900, GRID_SCALE = 10; // blank grid: 10px = 1 unit
  const HIT = 16; // touch hit radius in screen px

  function runLabel(i) {
    // A, B, ... Z, AA, AB ...
    let s = '';
    i += 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function segments(line) {
    const pts = line.points;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
    if (line.closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
    return out;
  }

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  function emptyLayout() {
    return { image: null, imgW: GRID_W, imgH: GRID_H, scale: GRID_SCALE, lines: [], lengths: {} };
  }

  /**
   * Turn the drawing into fence runs for the calculator.
   * Every drawn segment becomes one run. Gates get their run index from their position.
   */
  function deriveRuns(layout, gates) {
    const runs = [];
    const index = {};
    if (!layout) return runs;
    (layout.lines || []).forEach((line, li) => {
      const segs = segments(line);
      segs.forEach((s, si) => {
        const key = li + '-' + si;
        const measured = layout.scale ? dist(s[0], s[1]) / layout.scale : 0;
        const override = layout.lengths && layout.lengths[key];
        index[key] = runs.length;
        runs.push({
          key,
          label: runLabel(runs.length),
          measured: Math.round(measured * 10) / 10,
          length: override !== undefined && override !== null && override !== '' ? Number(override) : Math.round(measured * 10) / 10,
          overridden: override !== undefined && override !== null && override !== '',
          joinPrev: si > 0,
          closes: !!line.closed && si === segs.length - 1 && segs.length > 1,
        });
      });
    });
    (gates || []).forEach(g => {
      if (g.pos) {
        const k = g.pos.line + '-' + g.pos.seg;
        g.run = index[k] !== undefined ? index[k] : -1;
      }
    });
    return runs;
  }

  class FenceLayout {
    constructor(container, opts) {
      this.el = container;
      this.est = opts.estimate;
      this.unit = opts.unit || 'ft';
      this.onChange = opts.onChange || function () {};
      this.upload = opts.upload; // async (file) => { url, w, h }
      this.notify = opts.notify || (m => alert(m));
      if (!this.est.layout) this.est.layout = emptyLayout();
      this.L = this.est.layout;
      if (!this.L.lengths) this.L.lengths = {};
      this.mode = 'draw';
      this.active = -1; // line currently being drawn
      this.scalePts = [];
      this.view = { zoom: 1, x: 0, y: 0 };
      this.pointers = new Map();
      this.img = null;
      this.build();
      this.loadImage();
    }

    build() {
      this.el.innerHTML = `
        <div class="layout-tool">
          <div class="layout-toolbar">
            <button type="button" data-act="upload">Upload drawing / photo</button>
            <button type="button" data-mode="draw">Draw fence</button>
            <button type="button" data-mode="gate">Add gate</button>
            <button type="button" data-mode="scale">Set scale</button>
            <button type="button" data-act="finish">Finish line</button>
            <button type="button" data-act="undo">Undo</button>
            <button type="button" data-act="zoomin" aria-label="Zoom in">+</button>
            <button type="button" data-act="zoomout" aria-label="Zoom out">&minus;</button>
            <button type="button" data-act="fit">Fit</button>
            <button type="button" data-act="clear">Clear</button>
            <button type="button" data-act="noimage">Remove image</button>
            <input type="file" accept="image/*" hidden>
          </div>
          <div class="layout-canvas-wrap"><canvas></canvas></div>
          <div class="layout-hint"></div>
        </div>`;
      this.canvas = this.el.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.hint = this.el.querySelector('.layout-hint');
      this.fileInput = this.el.querySelector('input[type=file]');

      this.el.querySelector('.layout-toolbar').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.mode) this.setMode(b.dataset.mode);
        else this.action(b.dataset.act);
      });
      this.fileInput.addEventListener('change', () => this.handleFile());

      const c = this.canvas;
      c.addEventListener('pointerdown', e => this.down(e));
      c.addEventListener('pointermove', e => this.move(e));
      c.addEventListener('pointerup', e => this.up(e));
      c.addEventListener('pointercancel', e => this.up(e, true));
      c.addEventListener('wheel', e => {
        e.preventDefault();
        const p = this.screenPt(e);
        this.zoomAt(p, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }, { passive: false });

      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.el);
      this.setMode('draw');
    }

    destroy() { if (this.resizeObs) this.resizeObs.disconnect(); }

    loadImage() {
      this.img = null;
      if (!this.L.image) { this.fit(); return; }
      const img = new Image();
      img.onload = () => { this.img = img; this.fit(); };
      img.onerror = () => { this.notify('Could not load the drawing image.'); this.fit(); };
      img.src = this.L.image;
    }

    resize() {
      const w = this.el.clientWidth;
      if (!w) return;
      // Tall enough to work on with a finger; you can pan/zoom to see the rest.
      const h = Math.round(Math.max(300, Math.min(window.innerHeight * 0.55, w * 1.1, 720)));
      const dpr = window.devicePixelRatio || 1;
      this.cssW = w; this.cssH = h;
      this.canvas.style.height = h + 'px';
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
      if (!this.fitted) this.fit(); else this.draw();
    }

    fit() {
      if (!this.cssW) return;
      const z = Math.min(this.cssW / this.L.imgW, this.cssH / this.L.imgH);
      this.view.zoom = z;
      this.view.x = (this.cssW - this.L.imgW * z) / 2;
      this.view.y = (this.cssH - this.L.imgH * z) / 2;
      this.fitted = true;
      this.draw();
    }

    zoomAt(p, f) {
      const v = this.view;
      const nz = Math.max(0.05, Math.min(40, v.zoom * f));
      v.x = p[0] - (p[0] - v.x) * (nz / v.zoom);
      v.y = p[1] - (p[1] - v.y) * (nz / v.zoom);
      v.zoom = nz;
      this.draw();
    }

    toWorld(p) { return [(p[0] - this.view.x) / this.view.zoom, (p[1] - this.view.y) / this.view.zoom]; }
    toScreen(p) { return [p[0] * this.view.zoom + this.view.x, p[1] * this.view.zoom + this.view.y]; }
    screenPt(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    setMode(m) {
      this.mode = m;
      this.scalePts = [];
      this.el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
      this.updateHint();
      this.draw();
    }

    updateHint() {
      const unit = this.unit;
      const msgs = {
        draw: this.active >= 0
          ? 'Tap to add the next post/corner. Tap the first point to close the shape, or press Finish line.'
          : 'Tap where the fence starts, then tap each corner. Drag points to adjust. Drag to pan, pinch to zoom.',
        gate: 'Tap on a fence line where a gate goes. Set gate width in the Gates list below.',
        scale: this.scalePts.length
          ? 'Now tap the second point.'
          : `Tap two points that are a known distance apart (e.g. a dimension on the drawing). You will be asked for the real length in ${unit}.`,
      };
      let txt = msgs[this.mode] || '';
      if (this.L.image && !this.L.scaleSet) txt = 'Scale not set yet: lengths are guesses until you use Set scale (or type lengths in the list below). ' + txt;
      this.hint.textContent = txt;
    }

    async handleFile() {
      const file = this.fileInput.files[0];
      this.fileInput.value = '';
      if (!file || !this.upload) return;
      this.hint.textContent = 'Uploading drawing...';
      try {
        const r = await this.upload(file);
        this.L.image = r.url;
        this.L.imgW = r.w;
        this.L.imgH = r.h;
        this.L.scaleSet = false;
        // Default scale guess: image width = 100 units
        this.L.scale = r.w / 100;
        this.fitted = false;
        this.resize();
        this.loadImage();
        this.changed();
        this.setMode('scale');
      } catch (err) {
        this.notify('Upload failed: ' + err.message);
        this.updateHint();
      }
    }

    action(a) {
      switch (a) {
        case 'upload': this.fileInput.click(); break;
        case 'finish': this.active = -1; this.updateHint(); this.draw(); break;
        case 'undo': this.undo(); break;
        case 'zoomin': this.zoomAt([this.cssW / 2, this.cssH / 2], 1.3); break;
        case 'zoomout': this.zoomAt([this.cssW / 2, this.cssH / 2], 1 / 1.3); break;
        case 'fit': this.fit(); break;
        case 'clear':
          if (!this.L.lines.length || confirm('Remove all drawn fence lines and drawn gates?')) {
            this.L.lines = [];
            this.L.lengths = {};
            this.est.gates = (this.est.gates || []).filter(g => !g.pos);
            this.active = -1;
            this.changed();
          }
          break;
        case 'noimage':
          if (!this.L.image) return;
          if (confirm('Remove the background image? Your fence lines stay.')) {
            this.L.image = null;
            this.img = null;
            this.draw();
            this.changed();
          }
          break;
      }
    }

    undo() {
      const lines = this.L.lines;
      if (!lines.length) return;
      const li = this.active >= 0 ? this.active : lines.length - 1;
      const line = lines[li];
      if (line.closed) {
        line.closed = false;
        this.dropGates(g => g.pos.line === li && g.pos.seg >= line.points.length - 1);
      } else {
        line.points.pop();
        this.dropGates(g => g.pos.line === li && g.pos.seg >= line.points.length - 1);
        if (line.points.length === 0) {
          lines.splice(li, 1);
          this.shiftLines(li);
          this.active = -1;
        } else {
          this.active = li;
        }
      }
      this.cleanLengths();
      this.changed();
    }

    dropGates(fn) {
      this.est.gates = (this.est.gates || []).filter(g => !(g.pos && fn(g)));
    }

    shiftLines(removed) {
      (this.est.gates || []).forEach(g => { if (g.pos && g.pos.line > removed) g.pos.line--; });
      const next = {};
      Object.keys(this.L.lengths).forEach(k => {
        const [li, si] = k.split('-').map(Number);
        if (li < removed) next[k] = this.L.lengths[k];
        else if (li > removed) next[(li - 1) + '-' + si] = this.L.lengths[k];
      });
      this.L.lengths = next;
    }

    cleanLengths() {
      const valid = new Set();
      this.L.lines.forEach((l, li) => segments(l).forEach((s, si) => valid.add(li + '-' + si)));
      Object.keys(this.L.lengths).forEach(k => { if (!valid.has(k)) delete this.L.lengths[k]; });
    }

    changed() {
      this.updateHint();
      this.draw();
      this.onChange();
    }

    // ----- pointer handling -----
    down(e) {
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.screenPt(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: dist(a, b), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom: this.view.zoom, x: this.view.x, y: this.view.y };
        this.gesture = 'pinch';
        this.dragPt = null;
        return;
      }
      this.start = p;
      this.gesture = 'tap';
      this.dragPt = this.mode === 'draw' ? this.hitPoint(p) : null;
      this.panStart = { x: this.view.x, y: this.view.y };
    }

    move(e) {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this.screenPt(e);
      this.pointers.set(e.pointerId, p);
      if (this.gesture === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = dist(a, b);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const pz = this.pinch;
        const nz = Math.max(0.05, Math.min(40, pz.zoom * d / pz.d));
        this.view.zoom = nz;
        this.view.x = mid[0] - (pz.mid[0] - pz.x) * (nz / pz.zoom);
        this.view.y = mid[1] - (pz.mid[1] - pz.y) * (nz / pz.zoom);
        this.draw();
        return;
      }
      if (this.gesture === 'tap' && dist(p, this.start) > 6) this.gesture = this.dragPt ? 'movept' : 'pan';
      if (this.gesture === 'pan') {
        this.view.x = this.panStart.x + p[0] - this.start[0];
        this.view.y = this.panStart.y + p[1] - this.start[1];
        this.draw();
      } else if (this.gesture === 'movept') {
        const w = this.toWorld(p);
        this.L.lines[this.dragPt[0]].points[this.dragPt[1]] = [Math.round(w[0]), Math.round(w[1])];
        this.draw();
      }
    }

    up(e, cancelled) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.gesture === 'pinch') {
        if (this.pointers.size === 0) this.gesture = null;
        return;
      }
      if (cancelled) { this.gesture = null; return; }
      if (this.gesture === 'tap') this.tap(this.start);
      else if (this.gesture === 'movept') this.changed();
      this.gesture = null;
      this.dragPt = null;
    }

    hitPoint(p) {
      let best = null, bd = HIT;
      this.L.lines.forEach((l, li) => l.points.forEach((pt, pi) => {
        const d = dist(this.toScreen(pt), p);
        if (d < bd) { bd = d; best = [li, pi]; }
      }));
      return best;
    }

    hitSegment(p) {
      let best = null, bd = HIT * 1.5;
      this.L.lines.forEach((l, li) => segments(l).forEach((s, si) => {
        const a = this.toScreen(s[0]), b = this.toScreen(s[1]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
        const d = dist(p, [a[0] + t * dx, a[1] + t * dy]);
        if (d < bd) { bd = d; best = { line: li, seg: si, t: Math.round(t * 1000) / 1000 }; }
      }));
      return best;
    }

    tap(p) {
      const w = this.toWorld(p).map(Math.round);
      if (this.mode === 'draw') {
        const lines = this.L.lines;
        if (this.active >= 0 && lines[this.active]) {
          const line = lines[this.active];
          if (line.points.length >= 3 && dist(this.toScreen(line.points[0]), p) < HIT) {
            line.closed = true;
            this.active = -1;
          } else {
            line.points.push(w);
          }
        } else {
          const hit = this.hitPoint(p);
          // Tapping the end of an open line continues it
          if (hit) {
            const l = lines[hit[0]];
            if (!l.closed && hit[1] === l.points.length - 1) { this.active = hit[0]; this.changed(); return; }
          }
          lines.push({ points: [w], closed: false });
          this.active = lines.length - 1;
        }
        this.changed();
      } else if (this.mode === 'gate') {
        const s = this.hitSegment(p);
        if (!s) { this.notify('Tap closer to a fence line to place a gate.'); return; }
        this.est.gates = this.est.gates || [];
        this.est.gates.push({ width: 4, leaves: 1, pos: s, label: 'Gate ' + (this.est.gates.length + 1) });
        this.changed();
      } else if (this.mode === 'scale') {
        this.scalePts.push(w);
        if (this.scalePts.length === 2) {
          const px = dist(this.scalePts[0], this.scalePts[1]);
          this.draw();
          setTimeout(() => {
            const ans = prompt(`Real distance between the two points (${this.unit})? You can type 12'6" style too.`);
            const len = root.FenceCalc ? root.FenceCalc.parseLength(ans) : parseFloat(ans);
            if (len > 0 && px > 0) {
              this.L.scale = px / len;
              this.L.scaleSet = true;
              this.scalePts = [];
              this.setMode('draw');
              this.changed();
            } else {
              this.scalePts = [];
              this.updateHint();
              this.draw();
            }
          }, 30);
        } else {
          this.updateHint();
          this.draw();
        }
      }
    }

    // ----- rendering -----
    draw() {
      if (!this.ctx || !this.cssW) return;
      FenceLayout.paint(this.ctx, {
        layout: this.L, gates: this.est.gates || [], img: this.img, view: this.view,
        w: this.cssW, h: this.cssH, dpr: this.dpr, unit: this.unit,
        active: this.active, scalePts: this.scalePts, interactive: true,
      });
    }

    static paint(ctx, o) {
      const L = o.layout, v = o.view, dpr = o.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, o.w, o.h);
      ctx.fillStyle = '#f7f6f2';
      ctx.fillRect(0, 0, o.w, o.h);
      const S = p => [p[0] * v.zoom + v.x, p[1] * v.zoom + v.y];

      if (o.img) {
        ctx.drawImage(o.img, v.x, v.y, L.imgW * v.zoom, L.imgH * v.zoom);
      } else {
        // grid every 1 unit (faint) and 10 units (strong) when zoomed in enough
        const step = L.scale || GRID_SCALE;
        ctx.lineWidth = 1;
        [[1, '#ebe8e1'], [10, '#d6d1c6']].forEach(([mult, col]) => {
          const s = step * mult * v.zoom;
          if (s < 6) return;
          ctx.strokeStyle = col;
          ctx.beginPath();
          for (let x = 0; x <= L.imgW; x += step * mult) { const sx = x * v.zoom + v.x; ctx.moveTo(sx, v.y); ctx.lineTo(sx, L.imgH * v.zoom + v.y); }
          for (let y = 0; y <= L.imgH; y += step * mult) { const sy = y * v.zoom + v.y; ctx.moveTo(v.x, sy); ctx.lineTo(L.imgW * v.zoom + v.x, sy); }
          ctx.stroke();
        });
      }

      const runs = deriveRuns(L, []);
      let r = 0;
      const labels = [];
      L.lines.forEach((line, li) => {
        const segs = segments(line);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // outline for contrast on photos
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        segs.forEach(s => { const a = S(s[0]), b = S(s[1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
        ctx.stroke();
        ctx.strokeStyle = li === o.active ? '#c8741e' : '#1d5c3f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        segs.forEach(s => { const a = S(s[0]), b = S(s[1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
        ctx.stroke();
        segs.forEach(s => {
          const run = runs[r++];
          const a = S(s[0]), b = S(s[1]);
          labels.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, text: `${run.label}: ${fmt(run.length)} ${o.unit}${run.overridden ? '*' : ''}` });
        });
        line.points.forEach((pt, pi) => {
          const p = S(pt);
          ctx.beginPath();
          ctx.arc(p[0], p[1], o.interactive ? 6 : 4, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = (li === o.active && pi === 0 && line.points.length >= 3) ? '#c8741e' : '#1d5c3f';
          ctx.stroke();
        });
      });

      // gates
      (o.gates || []).forEach((g, gi) => {
        if (!g.pos) return;
        const line = L.lines[g.pos.line];
        if (!line) return;
        const s = segments(line)[g.pos.seg];
        if (!s) return;
        const segLenPx = dist(s[0], s[1]) || 1;
        const half = Math.min(0.5, ((Number(g.width) || 4) * (L.scale || GRID_SCALE)) / segLenPx / 2);
        const t0 = Math.max(0, g.pos.t - half), t1 = Math.min(1, g.pos.t + half);
        const P = t => S([s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t]);
        const a = P(t0), b = P(t1);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = '#d0451b';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const m = P(g.pos.t);
        labels.push({ x: m[0], y: m[1] - 18, text: 'G' + (gi + 1), gate: true });
      });

      // scale reference
      if (o.scalePts && o.scalePts.length) {
        ctx.strokeStyle = '#2563eb';
        ctx.fillStyle = '#2563eb';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        o.scalePts.forEach((pt, i) => { const p = S(pt); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.stroke();
        ctx.setLineDash([]);
        o.scalePts.forEach(pt => { const p = S(pt); ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.fill(); });
      }

      ctx.font = '600 12px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      labels.forEach(l => {
        const w = ctx.measureText(l.text).width + 10;
        ctx.fillStyle = l.gate ? 'rgba(208,69,27,.95)' : 'rgba(29,92,63,.92)';
        roundRect(ctx, l.x - w / 2, l.y - 10, w, 20, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(l.text, l.x, l.y + 0.5);
      });
    }

    /** Render a non-interactive picture of the layout into a canvas (used on quotes). */
    static renderStatic(canvas, est, unit, maxW) {
      const L = est.layout;
      if (!L || !L.lines || !L.lines.length) return Promise.resolve(false);
      return new Promise(resolve => {
        const go = img => {
          // Crop to the drawn area (plus margin) unless there's a background image.
          let bx0 = 0, by0 = 0, bx1 = L.imgW, by1 = L.imgH;
          if (!img) {
            const pts = L.lines.flatMap(l => l.points);
            const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
            const pad = 6 * (L.scale || GRID_SCALE);
            bx0 = Math.min(...xs) - pad; bx1 = Math.max(...xs) + pad;
            by0 = Math.min(...ys) - pad; by1 = Math.max(...ys) + pad;
          }
          const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
          const w = Math.min(maxW || 700, 900);
          const zoom = w / bw;
          const h = Math.min(bh * zoom, 700);
          const z = Math.min(zoom, h / bh);
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          canvas.style.width = w + 'px';
          canvas.style.maxWidth = '100%';
          const ctx = canvas.getContext('2d');
          FenceLayout.paint(ctx, {
            layout: L, gates: est.gates || [], img, w, h, dpr, unit,
            view: { zoom: z, x: (w - bw * z) / 2 - bx0 * z, y: (h - bh * z) / 2 - by0 * z },
            active: -1, scalePts: [], interactive: false,
          });
          resolve(true);
        };
        if (L.image) {
          const img = new Image();
          img.onload = () => go(img);
          img.onerror = () => go(null);
          img.src = L.image;
        } else go(null);
      });
    }
  }

  function fmt(n) {
    const v = Math.round((Number(n) || 0) * 10) / 10;
    return String(v);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  FenceLayout.deriveRuns = deriveRuns;
  FenceLayout.emptyLayout = emptyLayout;
  FenceLayout.runLabel = runLabel;
  root.FenceLayout = FenceLayout;
})(typeof self !== 'undefined' ? self : this);
