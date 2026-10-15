// The physical pointing renderer: one shared WebGL2 context draws every ball and
// touchpad on the page into its own 2D canvas. Ported from the round 5 design
// prototype (pointing-review-5/app.js). Without WebGL2 (or if the shader fails),
// a still 2D stand-in is drawn and nothing is said about it.

import { FS, VS } from "./shader";
import { BALLS, bodyAt, coatAt, GLASS, GROUND, spkAt, type BallId } from "./materials";

export type Theme = "light" | "dark";
const GLSIZE = 1024;

/** One device to draw: a ball (mat, orientation) or a touchpad (glass extents). */
export interface DrawSpec {
    kind: "ball" | "pad";
    mat: BallId;
    /** Ball orientation, object to world, row-major 3x3. */
    M: Float32Array;
    /** Half-extent of the drawn square in device units: a ball's radius is 1; the pad's glass is w x h. */
    view: number;
    w?: number;
    h?: number;
    corner?: number;
    gloss: number;
    sparkle: number;
    /** TEMPORARY "Ball lightness" (removable): the body color's lightness; omitted = as designed. */
    lightness?: number;
}

type U = Record<string, WebGLUniformLocation | null>;
interface GLState {
    gl: WebGL2RenderingContext;
    canvas: HTMLCanvasElement;
    U: U;
    blank: WebGLTexture;
    pearl: Partial<Record<BallId, WebGLTexture>>;
    matcap: Partial<Record<Theme, WebGLTexture[]>>;
}

let glState: GLState | null | undefined;
/** Test hook: force the still fallback, or reset to try WebGL again. */
let forceFallback = false;

export function _setWebGLDisabledForTest(disabled: boolean) {
    forceFallback = disabled;
    glState = undefined;
}

function setup(): GLState | null {
    if (forceFallback || typeof document === "undefined") return null;
    try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = GLSIZE;
        const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
        if (!gl) return null;
        const sh = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
            return s;
        };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "aPos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const U: U = {};
        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
        for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); if (info) U[info.name] = gl.getUniformLocation(prog, info.name); }
        ["uPat", "uPhoto", "uMcD", "uMcS", "uMcR", "uGlassTex"].forEach((k, i) => { if (U[k]) gl.uniform1i(U[k], i); });
        const state: GLState = { gl, canvas, U, blank: null as unknown as WebGLTexture, pearl: {}, matcap: {} };
        state.blank = makeTex(state, 1, 1, new Uint8Array([128, 128, 128, 255]));
        for (let i = 0; i < 6; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, state.blank); }
        canvas.addEventListener("webglcontextlost", () => { glState = undefined; });
        return state;
    } catch (e) {
        if (import.meta.env?.DEV) console.warn("Pointing renderer: WebGL setup failed", e);
        return null;
    }
}

function getGL(): GLState | null {
    if (glState === undefined) glState = setup();
    return glState;
}

/** Whether the physical renderer is available (false: the still stand-in is drawn). */
export function webglAvailable(): boolean {
    return getGL() !== null;
}

function makeTex(s: GLState, w: number, h: number, data: Uint8Array | null): WebGLTexture {
    const { gl } = s;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}

const lin = (hex: string) => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
};

function renderTo(s: GLState, tex: WebGLTexture, w: number, h: number) {
    const { gl } = s;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
}

/** The pearl pattern, baked once per pearl into a 2:1 map. */
function pearlTex(s: GLState, mat: BallId): WebGLTexture {
    const cached = s.pearl[mat];
    if (cached) return cached;
    const { gl, U } = s;
    const ball = BALLS[mat];
    const W = 2048, H = 1024;
    const tex = makeTex(s, W, H, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.blank);
    gl.uniform1i(U.uKind, 3);
    gl.uniform2fv(U.uBakeSize, [W, H]);
    if (ball.type === "pearl") gl.uniform3fv(U.uSeed, ball.seed);
    renderTo(s, tex, W, H);
    return (s.pearl[mat] = tex);
}

function matcaps(s: GLState, theme: Theme): WebGLTexture[] {
    const cached = s.matcap[theme];
    if (cached) return cached;
    const { gl, U } = s;
    const out: WebGLTexture[] = [];
    gl.uniform1i(U.uKind, 4);
    gl.uniform2fv(U.uBakeSize, [256, 256]);
    gl.uniform3fv(U.uGround, lin(GROUND[theme]));
    gl.uniform1f(U.uRoomLift, 0.5 * (theme === "dark" ? 0.6 : 1));
    for (let b = 0; b < 3; b++) { const t = makeTex(s, 256, 256, null); gl.uniform1i(U.uBake, b); renderTo(s, t, 256, 256); out.push(t); }
    return (s.matcap[theme] = out);
}

/**
 * Draws one device into `canvas` (square, px x px device pixels). Returns false
 * when it drew the still stand-in instead of the physical render.
 */
export function drawDevice(canvas: HTMLCanvasElement, px: number, spec: DrawSpec, theme: Theme): boolean {
    px = Math.max(2, Math.min(GLSIZE, Math.round(px)));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const s = getGL();
    if (!s) { drawStill(ctx, px, spec, theme); return false; }
    const { gl, U } = s;
    const set3 = (k: string, hex: string) => { if (U[k]) gl.uniform3fv(U[k], lin(hex)); };
    const set1 = (k: string, v: number) => { if (U[k]) gl.uniform1f(U[k], v); };
    const seti = (k: string, v: number) => { if (U[k]) gl.uniform1i(U[k], v); };
    const dark = theme === "dark";
    const mc = matcaps(s, theme);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mc[0]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, mc[1]);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, mc[2]);
    seti("uStyle", 0);
    set1("uDark", dark ? 1 : 0);
    set3("uGround", GROUND[theme]);
    set3("uGlass", GLASS[theme]);
    if (spec.kind === "ball") {
        const b = BALLS[spec.mat];
        seti("uKind", 0);
        set1("uHalf", spec.view);
        set1("uPx", px / (2 * spec.view));
        set1("uRoomLift", (b.room || 0) * (dark ? 0.6 : 1));
        seti("uMat", b.type === "pearl" ? 0 : 1);
        gl.uniformMatrix3fv(U.uRot, false, spec.M);
        const ct = coatAt(spec.mat, spec.gloss);
        if (b.type === "pearl") {
            const k = dark && !b.vein ? 0.84 : dark ? 0.86 : 1.0;
            const put = (name: string, hex: string, scale: boolean) => { if (U[name]) gl.uniform3fv(U[name], scale ? bodyAt(lin(hex).map((v) => v * k), spec.lightness) : lin(hex)); };
            put("uDeep", b.deep, true); put("uBody", b.body, true); put("uSwirl", b.swirl, true); put("uHi", b.hi, false);
            set1("uContrast", b.contrast); set1("uArea", b.area); set1("uVein", b.vein || 0);
            set1("uMetal", 0); set1("uFlake", 0);
            set1("uCoat", ct.coat); set1("uCoatRough", ct.rough); set1("uRimK", ct.rim); set1("uBox", ct.box); set1("uSheen", ct.sheen);
            const t = pearlTex(s, spec.mat);
            seti("uKind", 0);
            gl.uniform2fv(U.uBakeSize, [1, 1]);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
        } else {
            if (U.uBase) gl.uniform3fv(U.uBase, bodyAt(lin(b.base), spec.lightness)); set3("uFlakeTint", b.flakeTint || "#ffffff");
            set1("uMetal", b.metal); set1("uRough", b.rough); set1("uFlake", b.flake);
            set1("uFlakeFreq", b.freq); set1("uTilt", b.tilt); set1("uHueJit", b.hue); set1("uRimDark", b.rimDark);
            set1("uCoat", ct.coat); set1("uCoatRough", ct.rough); set1("uRimK", ct.rim); set1("uBox", ct.box); set1("uSheen", ct.sheen);
            const sp = spkAt(spec.mat, spec.sparkle);
            seti("uSpk", sp ? 1 : 0);
            if (sp) {
                const names: Record<string, string> = { F: "uSpkF", minPx: "uSpkMinPx", tilt: "uSpkTilt", cov: "uSpkCov", rough: "uSpkRough", rad: "uSpkRad", gain: "uSpkGain" };
                for (const [k, u] of Object.entries(names)) if (U[u]) gl.uniform3fv(U[u], (sp as unknown as Record<string, number[]>)[k]);
                set3("uSpkCol", sp.col); set1("uSpkHue", sp.hue); set1("uSpkMottle", sp.mottle);
                set1("uSpkLift", sp.lift * (dark && sp.studio ? 0.8 : 1)); set1("uSpkCloud", sp.cloud || 0);
                set1("uRough", sp.rough0);
                // the ball sees the light studio in both themes, only dimmed a little in dark
                if (dark && sp.studio) { set3("uGround", GROUND.light); set1("uRoomLift", b.room || 0); }
            }
        }
        seti("uKind", 0);
    } else {
        seti("uKind", 1);
        set1("uHalf", spec.view);
        set1("uPx", px / (2 * spec.view));
        set1("uRoomLift", 0);
        gl.uniform2fv(U.uSize, [spec.w ?? 1, spec.h ?? 1]);
        set1("uCorner", spec.corner ?? 0.2);
    }
    gl.viewport(0, 0, px, px);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, px, px);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    copyOut(s, ctx, px);
    return true;
}

/*
 * Copying the render into the device's 2D canvas. drawImage from the WebGL
 * canvas is the fast path where 2D canvases live on the GPU (Chrome). Where
 * they don't (Keybard Host's overlay, which composites in software so its
 * transparent window gets whole frames), Chromium copies the whole 1024 px
 * WebGL canvas for every drawImage: 50-110 ms a frame, so the ball rolled at
 * 10-15 frames a second. Reading back only the device's pixels costs about
 * 1 ms there. A slow drawImage switches this page to the readback for good.
 */
const SLOW_COPY_MS = 12;
let copyMode: "draw" | "read" = "draw";
let slowCopies = 0;
let readBuf: { px: number; raw: Uint8Array; img: ImageData } | null = null;

/** Test hook: start over with drawImage. */
export function _resetCopyModeForTest() { copyMode = "draw"; slowCopies = 0; readBuf = null; }
export function copyModeForTest() { return copyMode; }

function copyOut(s: GLState, ctx: CanvasRenderingContext2D, px: number) {
    if (copyMode === "read" && typeof ImageData !== "undefined") {
        const { gl } = s;
        if (!readBuf || readBuf.px !== px) readBuf = { px, raw: new Uint8Array(px * px * 4), img: new ImageData(px, px) };
        gl.readPixels(0, 0, px, px, gl.RGBA, gl.UNSIGNED_BYTE, readBuf.raw);
        unpremultiplyFlipped(readBuf.raw, readBuf.img.data, px);
        ctx.putImageData(readBuf.img, 0, 0);
        return;
    }
    const t0 = performance.now();
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(s.canvas, 0, GLSIZE - px, px, px, 0, 0, px, px);
    // Two slow copies in a row, not one: the first frame also pays for shader warm-up.
    if (performance.now() - t0 > SLOW_COPY_MS) { if (++slowCopies >= 2) copyMode = "read"; }
    else slowCopies = 0;
}

/**
 * WebGL's bottom-up, premultiplied pixels to ImageData's top-down, straight
 * alpha (what putImageData expects).
 */
export function unpremultiplyFlipped(src: Uint8Array, dst: Uint8ClampedArray, px: number) {
    const row = px * 4;
    for (let y = 0; y < px; y++) {
        let i = (px - 1 - y) * row, o = y * row;
        for (let x = 0; x < px; x++, i += 4, o += 4) {
            const a = src[i + 3];
            if (a === 255 || a === 0) { dst[o] = src[i]; dst[o + 1] = src[i + 1]; dst[o + 2] = src[i + 2]; }
            else { const k = 255 / a; dst[o] = src[i] * k; dst[o + 1] = src[i + 1] * k; dst[o + 2] = src[i + 2] * k; }
            dst[o + 3] = a;
        }
    }
}

/** The still stand-in: a shaded disc in the ball's swatch, or the pad's glass. */
export function drawStill(ctx: CanvasRenderingContext2D, px: number, spec: DrawSpec, theme: Theme) {
    ctx.clearRect(0, 0, px, px);
    const c = px / 2, r = px / 2 / spec.view;
    if (spec.kind === "ball") {
        const b = BALLS[spec.mat];
        if (typeof ctx.createRadialGradient === "function") {
            const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.05, c, c, r);
            g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, b.swatch); g.addColorStop(1, "#000000");
            ctx.fillStyle = g;
        } else ctx.fillStyle = b.swatch;
        ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.fillStyle = GLASS[theme];
        const w = (spec.w ?? 1) * r, h = (spec.h ?? 1) * r, rad = (spec.corner ?? 0.2) * r;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(c - w / 2, c - h / 2, w, h, rad);
        else ctx.rect(c - w / 2, c - h / 2, w, h);
        ctx.fill();
    }
}

/* ------------------------------------------------------------------ */
/* Rotation                                                             */
/* ------------------------------------------------------------------ */
function rotate(M: Float32Array | number[], ax: [number, number, number], ang: number) {
    const [x, y, z] = ax; const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const Rm = [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
                t * x * y + s * z, t * y * y + c, t * y * z - s * x,
                t * x * z - s * y, t * y * z + s * x, t * z * z + c];
    const o = new Array<number>(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[r * 3 + k] = Rm[r * 3] * M[k] + Rm[r * 3 + 1] * M[3 + k] + Rm[r * 3 + 2] * M[6 + k];
    for (let i = 0; i < 9; i++) M[i] = o[i];
}
export function rotFromEuler(a: number, b: number, c: number): Float32Array {
    const M = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    rotate(M, [1, 0, 0], a); rotate(M, [0, 1, 0], b); rotate(M, [0, 0, 1], c);
    return M;
}
function ortho(M: Float32Array) {
    const c0 = [M[0], M[3], M[6]], c1 = [M[1], M[4], M[7]];
    const n = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const a = n(c0); const d = a[0] * c1[0] + a[1] * c1[1] + a[2] * c1[2];
    const b = n(c1.map((x, i) => x - d * a[i]));
    const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    M[0] = a[0]; M[3] = a[1]; M[6] = a[2]; M[1] = b[0]; M[4] = b[1]; M[7] = b[2]; M[2] = c[0]; M[5] = c[1]; M[8] = c[2];
}
let rolls = 0;
/** Rolls the ball by a surface displacement (dx, dy) in ball radii (+x right, +y down). */
export function roll(M: Float32Array, dx: number, dy: number) {
    const vx = dx, vy = -dy;
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) return;
    rotate(M, [-vy / d, vx / d, 0], d);
    if (++rolls % 60 === 0) ortho(M);
}
