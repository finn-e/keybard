/**
 * Binding editor spotlight guard: one scrim, one lit-surface treatment.
 *
 * - The scrim color is used in one place: the SpotlightScrim component
 *   (src/layout/BindingSpotlight.tsx), with its tokens defined in index.css.
 * - Every spotlight rule in index.css takes its colors, shadows, radii and
 *   filters from the spotlight tokens (var(--kb-...)), never from literals.
 * - Components never style themselves for the spotlight with their own
 *   utilities (a shadow, an opacity, a fill or a radius switched on while
 *   editing); they mark themselves with a data attribute the rules read.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");
const CSS = readFileSync(join(SRC, "index.css"), "utf8");

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
    });
}
const sources = walk(SRC).map(path => ({ file: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

/** Top-level rules of a stylesheet, with nested @media blocks flattened. */
function rules(css: string): { selector: string; body: string }[] {
    const out: { selector: string; body: string }[] = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const walkBlock = (text: string) => {
        let i = 0;
        while (i < text.length) {
            const open = text.indexOf("{", i);
            if (open < 0) break;
            const selector = text.slice(i, open).trim();
            let depth = 1;
            let j = open + 1;
            while (j < text.length && depth > 0) {
                if (text[j] === "{") depth++;
                else if (text[j] === "}") depth--;
                j++;
            }
            const body = text.slice(open + 1, j - 1);
            if (selector.startsWith("@media") || selector.startsWith("@supports")) walkBlock(body);
            else out.push({ selector, body });
            i = j;
        }
    };
    walkBlock(clean);
    return out;
}

const SPOTLIGHT_SELECTOR = /data-binding-spotlight|data-spotlight|data-spot=/;
const VISUAL_PROPERTY = /^(background(-color)?|color|border(-[a-z]+)*-color|border-color|box-shadow|border(-[a-z]+)*-radius|border-radius|filter|opacity|outline-color|fill|stroke)$/;
/** A value built only from tokens and neutral keywords. */
const tokenOnly = (value: string) => value
    .replace(/var\(--kb-[a-z0-9-]+(,\s*[^)]*)?\)/g, "")
    .replace(/\b(transparent|none|inherit|currentColor|in srgb|color-mix|calc|brightness|rgb)\b/g, "")
    .replace(/[\s(),/%+-]|\b0\b|\b1\b|\b\d+%/g, "") === "";

describe("binding editor spotlight tokens", () => {
    it("draws the scrim color only in SpotlightScrim", () => {
        const users = sources
            .filter(s => /kb-scrim(?!-alpha|-rgb)/.test(s.text))
            .map(s => s.file)
            .sort();
        expect(users).toEqual(["index.css", "layout/BindingSpotlight.tsx"]);
        const spotlight = sources.find(s => s.file === "layout/BindingSpotlight.tsx")!.text;
        expect(spotlight.match(/bg-kb-scrim/g)).toHaveLength(1);
    });

    it("takes every spotlight color, shadow, radius and filter from a token", () => {
        const offenders: string[] = [];
        for (const { selector, body } of rules(CSS)) {
            if (!SPOTLIGHT_SELECTOR.test(selector)) continue;
            for (const declaration of body.split(";")) {
                const [property, ...rest] = declaration.split(":");
                const name = property?.trim();
                const value = rest.join(":").trim();
                if (!name || !value || name.startsWith("--")) continue;
                if (VISUAL_PROPERTY.test(name) && !tokenOnly(value)) offenders.push(`${selector} { ${name}: ${value} }`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("defines the spotlight tokens for both themes", () => {
        const light = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf(".dark {"));
        const dark = CSS.slice(CSS.indexOf(".dark {"));
        for (const token of ["--kb-scrim-rgb", "--kb-scrim-alpha", "--kb-spot-rail-fg"]) {
            expect(light).toContain(`${token}:`);
            expect(dark).toContain(`${token}:`);
        }
        for (const token of ["--kb-scrim:", "--kb-spot-radius:", "--kb-spot-pill-radius:", "--kb-pick-accent:"]) expect(light).toContain(token);
    });

    it("never switches a component's own look on with the spotlight", () => {
        const switched = /\b(spotlight|editing)\s*(&&|\?)\s*["'`][^"'`]*\b(shadow|opacity-|bg-|border-|rounded|ring-)/;
        const offenders = sources
            .filter(s => s.file.endsWith(".tsx"))
            .flatMap(s => s.text.split("\n").map((line, i) => ({ file: s.file, line: i + 1, text: line })))
            .filter(l => switched.test(l.text))
            .map(l => `${l.file}:${l.line} ${l.text.trim()}`);
        expect(offenders).toEqual([]);
    });
});
