// Canvas drawing over a pointing device: the fingertip contact on the touchpad,
// the sniper reticle, and the sniper, boost and Velocity Scroll pills.
// Ported from the round 5 design prototype. Coordinates are CSS px with the
// device's center at the origin.

export interface PillColors { bg: string; fg: string; shadow?: boolean }

export const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export type PillKind = "sniper" | "boost" | "velocity";

/** What a pill says; sniper and boost add their multiplier. */
export const PILL_LABEL: Record<PillKind, string> = { sniper: "SNIPER", boost: "BOOST", velocity: "VEL SCROLL" };

const ICON: Record<PillKind, (ctx: CanvasRenderingContext2D) => void> = {
    sniper: (ctx) => { ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.moveTo(22, 12); ctx.lineTo(18, 12); ctx.moveTo(6, 12); ctx.lineTo(2, 12); ctx.moveTo(12, 6); ctx.lineTo(12, 2); ctx.moveTo(12, 22); ctx.lineTo(12, 18); ctx.stroke(); },
    boost: (ctx) => {
        if (typeof Path2D === "undefined") return;
        ctx.stroke(new Path2D("M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"));
    },
    // the autoscroll mark: an anchor dot with a chevron above and below
    velocity: (ctx) => {
        ctx.beginPath(); ctx.arc(12, 12, 2.2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        ctx.beginPath(); ctx.moveTo(7, 7.5); ctx.lineTo(12, 2.5); ctx.lineTo(17, 7.5); ctx.moveTo(7, 16.5); ctx.lineTo(12, 21.5); ctx.lineTo(17, 16.5); ctx.stroke();
    },
};

/** A 10 mm fingertip on the glass. x, y in pad half-extents (-1..1); press 0..1. */
export function drawContact(ctx: CanvasRenderingContext2D, hw: number, hh: number, x: number, y: number, press: number, unitPx: number, k: number) {
    if (press < 0.02 || typeof ctx.createRadialGradient !== "function") return;
    const cx = x * hw, cy = y * hh;
    const rx = 0.43 * unitPx;
    const s = 0.85 + 0.15 * ease(press);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(s, s);
    let g = ctx.createRadialGradient(rx * 0.25, rx * 0.3, 0, rx * 0.25, rx * 0.3, rx * 1.5);
    g.addColorStop(0, `rgba(0,0,0,${0.22 * press})`); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(rx * 0.25, rx * 0.3, rx * 1.5, rx * 1.5, 0, 0, Math.PI * 2); ctx.fill();
    g = ctx.createRadialGradient(-rx * 0.12, -rx * 0.15, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(255,255,255,${0.30 * press})`);
    g.addColorStop(0.75, `rgba(255,255,255,${0.16 * press})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.28 * press})`; ctx.lineWidth = 1.2 / k;
    ctx.beginPath(); ctx.arc(0, 0, rx * 0.86, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
}

// an etched hairline: a soft dark bed under a fine white line, readable on silver and on black pearl
export function strokeHair(ctx: CanvasRenderingContext2D, a: number, w: number) {
    ctx.strokeStyle = `rgba(0,0,0,${0.42 * a})`; ctx.lineWidth = w * 2.8; ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * a})`; ctx.lineWidth = w; ctx.stroke();
}

/** The sniper reticle on a ball of radius r; s is how far it has come in (0..1). */
export function drawReticle(ctx: CanvasRenderingContext2D, r: number, s: number, k: number) {
    if (s <= 0.001) return;
    const e = ease(s), a = Math.min(1, s * 1.4), w = Math.max(1.2 / k, r * 0.011);
    ctx.save();
    ctx.lineCap = "round";
    const gap = 0.22 * r, rim = 0.94 * r;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const end = rim - (rim - gap) * e;
        ctx.moveTo(dx * rim, dy * rim); ctx.lineTo(dx * end, dy * end);
        for (const t of [0.5, 0.74]) {
            const d = t * r; if (d < end) continue;
            const tl = 0.045 * r;
            ctx.moveTo(dx * d - dy * tl, dy * d - dx * tl); ctx.lineTo(dx * d + dy * tl, dy * d + dx * tl);
        }
    }
    strokeHair(ctx, a, w);
    ctx.globalAlpha = e;
    ctx.beginPath(); ctx.arc(0, 0, 0.13 * r * (1.5 - 0.5 * e), 0, Math.PI * 2); strokeHair(ctx, a, w);
    ctx.restore();
}

/** The sniper crosshair on the touchpad, following the fingertip at (cx, cy) px. */
export function drawPadReticle(ctx: CanvasRenderingContext2D, hw: number, hh: number, corner: number, cx: number, cy: number, s: number, unitPx: number, k: number) {
    if (s <= 0.001) return;
    const e = ease(s);
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(-hw, -hh, hw * 2, hh * 2, corner); else ctx.rect(-hw, -hh, hw * 2, hh * 2);
    ctx.clip();
    ctx.beginPath();
    const gap = 0.55 * unitPx;
    ctx.moveTo(-hw + (cx + hw) * (1 - e), cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(hw - (hw - cx) * (1 - e), cy); ctx.lineTo(cx + gap, cy);
    ctx.moveTo(cx, -hh + (cy + hh) * (1 - e)); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, hh - (hh - cy) * (1 - e)); ctx.lineTo(cx, cy + gap);
    const step = 0.5 * unitPx, tl = 0.07 * unitPx;
    for (let d = step; d < 4 * unitPx; d += step) {
        for (const sg of [-1, 1]) {
            const x = cx + sg * d; if (Math.abs(x) < hw - 2 && d > gap) { ctx.moveTo(x, cy - tl); ctx.lineTo(x, cy + tl); }
            const y = cy + sg * d; if (Math.abs(y) < hh - 2 && d > gap) { ctx.moveTo(cx - tl, y); ctx.lineTo(cx + tl, y); }
        }
    }
    strokeHair(ctx, Math.min(1, s * 1.4), 1.2 / k);
    ctx.restore();
}

export interface PillItem { kind: PillKind; amount: number; mult: string }

/** Pill size for a font size; the layout code uses it to keep the pills clear of keys. */
export function pillFont(unitPx: number, host: boolean) { return host ? 10.5 : unitPx >= 45 ? 11.5 : 10; }

/**
 * The pills: at the device's lower outer side (r = how far out from the center),
 * or centered on the device when it is hidden (centered = true).
 */
export function drawPills(ctx: CanvasRenderingContext2D, items: PillItem[], opts: { side: "left" | "right"; r: number; unitPx: number; centered: boolean; host: boolean; colors: PillColors }) {
    const shown = items.filter((i) => i.amount > 0.001);
    if (!shown.length) return;
    const fs = pillFont(opts.unitPx, opts.host);
    const gap = 4;
    ctx.save();
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    const ls = (v: string) => { try { (ctx as unknown as { letterSpacing: string }).letterSpacing = v; } catch { /* older canvas */ } };
    const dims = shown.map((it) => {
        ls("0.04em"); const tw = ctx.measureText(PILL_LABEL[it.kind]).width;
        ls("0em"); const mw = it.mult ? ctx.measureText(it.mult).width : 0;
        return { tw, mw, w: tw + mw + fs * (it.mult ? 3.6 : 2.85), h: fs * 2.0 };
    });
    const totalH = dims.reduce((a, d) => a + d.h, 0) + gap * (dims.length - 1);
    let x0: number, y0: number;
    if (opts.centered) { x0 = 0; y0 = -totalH / 2; }
    else {
        const ang = (opts.side === "left" ? 222 : 318) * Math.PI / 180;
        const out = opts.r + 0.32 * opts.unitPx;
        x0 = Math.cos(ang) * out; y0 = -Math.sin(ang) * out - dims[0].h / 2;
    }
    let y = y0;
    shown.forEach((it, i) => {
        const { tw, w, h } = dims[i];
        const e = ease(it.amount);
        const x = opts.centered ? x0 - w / 2 : opts.side === "left" ? x0 - w * 0.75 : x0 - w * 0.25;
        const yy = y + (1 - e) * 4;
        ctx.globalAlpha = Math.min(1, it.amount * 1.2);
        if (opts.colors.shadow) { ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 6; }
        ctx.fillStyle = opts.colors.bg;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, yy, w, h, h / 2); else ctx.rect(x, yy, w, h);
        ctx.fill();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
        ctx.fillStyle = opts.colors.fg; ctx.strokeStyle = opts.colors.fg;
        ctx.save(); ctx.translate(x + fs * 0.75, yy + h / 2 - fs * 0.6); const sc = (fs * 1.2) / 24; ctx.scale(sc, sc); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ICON[it.kind](ctx); ctx.restore();
        ctx.textBaseline = "middle";
        ls("0.04em");
        ctx.fillText(PILL_LABEL[it.kind], x + fs * 2.2, yy + h / 2 + 0.5);
        if (it.mult) {
            ctx.globalAlpha *= 0.8; ls("0em");
            ctx.fillText(it.mult, x + fs * 2.2 + tw + fs * 0.75, yy + h / 2 + 0.5);
        }
        y += h + gap;
    });
    ctx.restore();
}
