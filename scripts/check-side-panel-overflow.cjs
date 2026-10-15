/**
 * Headless check for the side panel: no element in it may scroll sideways
 * (scrollWidth > clientWidth), in any picker category, with every binding
 * editor open as the compact bar. Also reports each bar's height and rows.
 *
 * Needs a running dev server and playwright-core with a Chromium build:
 *   npm run dev -- --port 5247
 *   node scripts/check-side-panel-overflow.cjs 5247
 * Options: [check|shots] [shapes=panel,L] [widths=1440,1280] [themes=light,dark]
 * Set PLAYWRIGHT_CORE to playwright-core's path if it is not installed here,
 * CHROME_PATH to a Chrome binary, and SHOTS_DIR to save bar screenshots.
 * Exits 1 when any element overflows or an editor fails to open.
 *
 * A keycap clipping its own label is not counted: that is the key, not the panel.
 */
const path = require("path"), fs = require("fs");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().reverse())
    for (const s of ["chrome-win64", "chrome-win"]) { const e = path.join(root, d, s, "chrome.exe"); if (fs.existsSync(e)) return e; }
  return undefined;
}
const port = process.argv[2] || "5247";
const mode = process.argv[3] || "check";
const shapes = (process.argv[4] || "panel,L").split(",");
const widths = (process.argv[5] || "1440,1280").split(",").map(Number);
const themes = (process.argv[6] || "light,dark").split(",");
const shotDir = process.env.SHOTS_DIR || path.resolve(__dirname, "../.side-panel-shots");
if (mode === "shots") fs.mkdirSync(shotDir, { recursive: true });

const svil = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../src/default-layouts/sval-default.svil"), "utf8"));
svil.combo[0] = { on: true, keys: ["KC_F", "KC_D", "KC_NO", "KC_NO"], output: "KC_ESCAPE", combo_term: 0 };
svil.combo[1] = { on: true, keys: ["KC_J", "KC_K", "KC_NO", "KC_NO"], output: "KC_ENTER", combo_term: 0 };
svil.tap_dance[0] = { on: true, on_tap: "KC_A", on_hold: "KC_LCTRL", on_double_tap: "KC_NO", on_tap_hold: "KC_NO", tapping_term: 200 };
svil.macro[0] = [["tap", "KC_A"]];
svil.macro[1] = [["tap", "KC_H", "KC_I"], ["text", "hello world"], ["delay", 100], ["down", "KC_LSHIFT"], ["tap", "KC_A", "KC_B", "KC_C"], ["up", "KC_LSHIFT"]];
svil.key_override[0] = { on: true, trigger: "KC_BSPACE", replacement: "KC_DELETE", layers: 65535, trigger_mods: 2, negative_mod_mask: 0, suppressed_mods: 2, options: 7 };
svil.alt_repeat_key[0] = { on: true, keycode: "KC_LEFT", alt_keycode: "KC_RIGHT", allowed_mods: 0, options: 0 };
svil.leader[0] = { on: true, sequence: ["KC_A", "KC_B"], output: "KC_ESCAPE", options: 0 };
svil.leader[1] = { on: true, sequence: ["KC_A", "KC_B", "KC_C", "KC_D", "KC_E"], output: "KC_ESCAPE", options: 0 };

const KINDS = [
  { kind: "combo", nav: /^Combos/, row: 0 },
  { kind: "tapdance", nav: /^Tap Dance Keys/, row: 0 },
  { kind: "macro", nav: /^Macro Keys/, row: 0 },
  { kind: "override", nav: /^Overrides/, row: 0 },
  { kind: "altrepeat", nav: /^Alt-Repeat/, row: 0 },
  { kind: "leader", nav: /^Leaders/, row: 0 },
];
const EXTRAS = [
  { kind: "leader-5key", nav: /^Leaders/, row: 1 },
  { kind: "macro-long", nav: /^Macro Keys/, row: 1 },
  { kind: "override-options", nav: /^Overrides/, row: 0, openOptions: true },
];

const overflowScan = () => {
  const roots = [...document.querySelectorAll("aside.detail-panel")];
  const bad = [];
  const label = el => {
    const bits = [el.tagName.toLowerCase()];
    for (const a of el.getAttributeNames()) if (a.startsWith("data-") || a === "aria-label") bits.push(`[${a}=${el.getAttribute(a)}]`);
    const cls = (el.getAttribute("class") || "").split(/\s+/).slice(0, 4).join(".");
    if (cls) bits.push("." + cls);
    return bits.join("");
  };
  for (const root of roots) for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.closest("[data-editor-ghost]")) continue;
    // A keycap clips its own label by design; that is not the panel scrolling.
    if (el.closest("[data-keycap]")) continue;
    if (!(el instanceof HTMLElement)) continue;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) bad.push(`${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  return bad;
};

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: chromePath() });
  const results = [];
  for (const shape of shapes) for (const width of widths) for (const theme of themes) {
    const ctx = await b.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: "reduce" });
    // Alt-Repeat is off by default; the theme is the app's own setting, not the system's.
    await ctx.addInitScript(t => { try { localStorage.setItem("keyboard-settings", JSON.stringify({ "show-alt-repeat": true, theme: t })); } catch {} }, theme);
    await ctx.route(/sval-default.svil/, r => r.request().resourceType() !== "fetch" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(svil) }));
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    const q = shape === "panel" ? "?comboEditor=panel" : `?comboEditor=panel&pickerShape=${shape}`;
    await p.goto(`http://localhost:${port}/keybard-ng/${q}`);
    await p.waitForTimeout(800);
    await p.getByText("QWERTY Example").click();
    await p.waitForTimeout(2000);
    const list = mode === "shots" ? [...KINDS, ...EXTRAS] : [...KINDS, ...EXTRAS];
    for (const k of list) {
      const rec = { shape, width, theme, kind: k.kind };
      try {
        // Clicking the open panel's nav entry would close it.
        const title = await p.locator("aside.detail-panel h2").first().textContent().catch(() => "");
        const navName = k.nav.source.replace("^", "");
        if (!(await p.locator(`[data-binding-row="${k.row}"]`).first().isVisible().catch(() => false)) || !title.startsWith(navName.slice(0, 5))) {
          await p.getByRole("button", { name: k.nav }).first().click();
          await p.waitForTimeout(500);
        }
        await p.locator(`[data-binding-row="${k.row}"]`).first().click({ timeout: 5000 });
        await p.waitForTimeout(700);
        if (k.openOptions) { await p.locator("[data-editor-bar-options]").first().click(); await p.waitForTimeout(500); }
        const bar = p.locator(".binding-workspace[data-editor-placement='panel']").first();
        const box = await bar.boundingBox();
        rec.barHeight = box ? Math.round(box.height) : null;
        rec.hasX = await bar.locator("button[aria-label='Close binding editor']").count();
        rec.rows = await p.evaluate(() => { const r = document.querySelector("[data-editor-bar-row]"); if (!r) return null; const tops = new Set([...r.children].map(c => Math.round(c.getBoundingClientRect().top))); return tops.size; });
        if (mode === "shots" && (width === 1440 && shape === "panel")) {
          await bar.screenshot({ path: path.join(shotDir, `${k.kind}-${theme}.png`) });
        }
        if (mode === "shots" && width === 1440 && theme === "light" && k.kind === "combo") {
          await p.screenshot({ path: path.join(shotDir, `full-${shape}.png`) });
        }
        // Each picker category.
        const cats = await p.locator("[data-picker-overlay] [data-picker-rail] button[aria-pressed]").all();
        rec.overflow = {};
        const initial = await p.evaluate(overflowScan);
        if (initial.length) rec.overflow.initial = initial;
        if (k.kind === "combo" || k.kind === "macro" || mode === "check") {
          for (const c of cats) {
            const name = await c.getAttribute("aria-label");
            await c.click(); await p.waitForTimeout(350);
            const bad = await p.evaluate(overflowScan);
            if (bad.length) rec.overflow[name] = bad;
          }
        }
        rec.categories = cats.length;
        await p.locator("[data-picker-overlay] [data-binding-editor-back]").first().click();
        await p.waitForTimeout(500);
      } catch (e) { rec.error = String(e.message || e).split("\n")[0]; await p.keyboard.press("Escape").catch(() => {}); }
      results.push(rec);
      console.log(JSON.stringify(rec));
    }
    // Plain categories with no editor open (the side panel as a list).
    for (const nav of [/^Standard Keys/, /^Special Keys/, /^Layer Keys/, /^Mouse Keys/, /^Pointing Devices/]) {
      try {
        await p.getByRole("button", { name: nav }).first().click(); await p.waitForTimeout(500);
        const bad = await p.evaluate(overflowScan);
        const rec = { shape, width, theme, kind: "panel:" + nav.source, overflow: bad.length ? { list: bad } : {} };
        results.push(rec); console.log(JSON.stringify(rec));
      } catch (e) { console.log(JSON.stringify({ shape, width, theme, kind: "panel:" + nav.source, error: String(e.message).split("\n")[0] })); }
    }
    if (errs.length) console.log("PAGEERRORS", shape, width, theme, errs.join(" | "));
    await ctx.close();
  }
  const fails = results.filter(r => r.error || (r.overflow && Object.keys(r.overflow).length));
  console.log("SUMMARY", JSON.stringify({ total: results.length, fails: fails.length }));
  await b.close();
  if (fails.length) process.exitCode = 1;
})();
