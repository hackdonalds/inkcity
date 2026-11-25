/** Photo-mode framing drawn on a 2D canvas: torn paper border, ribbon cartouche, signature. */
type RGB = [number, number, number];
export interface FrameOpts { title: string; subtitle: string; border: boolean; cartouche: boolean; paper: RGB; ink: RGB; seed: number }

const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
function rnd(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296); }
/** smooth 1D noise from a seeded table */
function noise1(r: () => number, n = 64) {
  const t = Array.from({ length: n + 1 }, r); t[n] = t[0];
  return (x: number) => { const i = Math.floor(((x % 1) + 1) % 1 * n), f = ((x % 1) + 1) % 1 * n - i, u = f * f * (3 - 2 * f); return t[i] + (t[i + 1] - t[i]) * u; };
}

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, o: FrameOpts) {
  const r = rnd(o.seed), s = Math.min(w, h);
  ctx.save();
  if (o.border) {
    const m = s * 0.045, n1 = noise1(r, 90), n2 = noise1(r, 23);
    // inner torn edge, walked clockwise round the rectangle
    const pts: [number, number][] = [];
    const per = 2 * (w + h), steps = 900;
    for (let i = 0; i < steps; i++) {
      const t = i / steps, d = t * per;
      const tear = m * (0.55 + 0.6 * n1(t * 3) + 0.35 * n2(t * 11)) + (r() - 0.5) * s * 0.002;
      let x: number, y: number;
      if (d < w) { x = d; y = tear; } else if (d < w + h) { x = w - tear; y = d - w; } else if (d < 2 * w + h) { x = w - (d - w - h); y = h - tear; } else { x = tear; y = h - (d - 2 * w - h); }
      const c = m * 1.25; // keep the tear off the corners
      x = Math.min(w - c * 0.9, Math.max(c * 0.9, x)); y = Math.min(h - c * 0.9, Math.max(c * 0.9, y));
      pts.push([x, y]);
    }
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = css(o.paper.map((c) => Math.min(1, c * 1.04)) as RGB);
    ctx.fill('evenodd');
    // paper fibres on the margin
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = css(o.ink);
    for (let i = 0; i < 2500; i++) {
      const x = r() * w, y = r() * h;
      if (x > m * 1.8 && x < w - m * 1.8 && y > m * 1.8 && y < h - m * 1.8) continue;
      ctx.fillRect(x, y, 1 + r() * 2, 1);
    }
    ctx.globalAlpha = 1;
    // ragged ink edge (two loose strokes)
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const j = pass ? (r() - 0.5) * 1.6 : 0; if (i) ctx.lineTo(x + j, y + j); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.strokeStyle = css(o.ink, pass ? 0.35 : 0.7);
      ctx.lineWidth = Math.max(1, s * (pass ? 0.0012 : 0.0018));
      ctx.stroke();
    }
  }
  if (o.cartouche && o.title) {
    const fs = s * 0.042;
    ctx.font = `italic ${fs}px Georgia, 'Times New Roman', serif`;
    const tw = Math.max(ctx.measureText(o.title).width, (ctx.font = `italic ${fs * 0.45}px Georgia, serif`, ctx.measureText(o.subtitle).width));
    ctx.font = `italic ${fs}px Georgia, 'Times New Roman', serif`;
    const bw = tw + fs * 2.4, bh = fs * (o.subtitle ? 2.0 : 1.6);
    const cx = w / 2, cy = h - s * (o.border ? 0.1 : 0.07) - bh / 2;
    const x0 = cx - bw / 2, x1 = cx + bw / 2, y0 = cy - bh / 2, y1 = cy + bh / 2, tail = fs * 1.1, dip = fs * 0.35;
    const ink = css(o.ink), fill = css(o.paper.map((c) => Math.min(1, c * 1.08)) as RGB);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.2, s * 0.0019);
    // ribbon tails (behind)
    for (const sd of [-1, 1]) {
      const ex = sd < 0 ? x0 : x1;
      ctx.beginPath();
      ctx.moveTo(ex - sd * tail * 0.2, y0 + dip);
      ctx.lineTo(ex + sd * tail, y0 + dip);
      ctx.lineTo(ex + sd * tail * 0.6, (y0 + y1) / 2 + dip);
      ctx.lineTo(ex + sd * tail, y1 + dip);
      ctx.lineTo(ex - sd * tail * 0.2, y1 + dip);
      ctx.closePath();
      ctx.fillStyle = css(o.paper.map((c) => c * 0.9) as RGB); ctx.fill(); ctx.strokeStyle = ink; ctx.stroke();
    }
    // main band with gently curved top/bottom
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, y0 - dip * 0.9, x1, y0);
    ctx.lineTo(x1, y1); ctx.quadraticCurveTo(cx, y1 - dip * 0.9, x0, y1);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ink; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + fs * 0.25, y0 + fs * 0.18); ctx.quadraticCurveTo(cx, y0 - dip * 0.9 + fs * 0.18, x1 - fs * 0.25, y0 + fs * 0.18);
    ctx.strokeStyle = css(o.ink, 0.35); ctx.lineWidth *= 0.6; ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.title, cx, cy - (o.subtitle ? fs * 0.3 : 0) - dip * 0.35);
    if (o.subtitle) { ctx.font = `italic ${fs * 0.45}px Georgia, serif`; ctx.globalAlpha = 0.75; ctx.fillText(o.subtitle, cx, cy + fs * 0.5 - dip * 0.35); ctx.globalAlpha = 1; }
  }
  // signature
  ctx.font = `italic ${s * 0.016}px Georgia, serif`;
  ctx.fillStyle = css(o.ink, 0.6); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('drawn in Inkcity', w - s * (o.border ? 0.07 : 0.03), h - s * (o.border ? 0.065 : 0.03));
  ctx.restore();
}
