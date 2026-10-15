/**
 * ?spotLight defaults: light mode takes "tint" (the owner's pick), dark keeps
 * "pill". Every rule that styles tint must also match light mode with no
 * param, and no text-only rule may.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(resolve(process.cwd(), "src"), "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LIGHT_UNSET = ":root:not(.dark):not([data-spot-lit])";
const DARK_UNSET = ":root.dark:not([data-spot-lit])";

const selectors = (): string[][] => {
    const out: string[][] = [];
    const re = /([^{}]+)\{[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(CSS))) out.push(m[1].split(",").map(s => s.trim()));
    return out;
};
const strip = (sel: string, root: string) => sel.replace(root, "").trim();

describe("spotLight theme defaults", () => {
    it("light mode with no param matches every tint rule", () => {
        const groups = selectors().filter(g => g.some(s => s.startsWith(':root[data-spot-lit="tint"]')));
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
            const tint = group.filter(s => s.startsWith(':root[data-spot-lit="tint"]')).map(s => strip(s, ':root[data-spot-lit="tint"]'));
            const light = group.filter(s => s.startsWith(LIGHT_UNSET)).map(s => strip(s, LIGHT_UNSET));
            for (const rest of tint) expect(light).toContain(rest);
        }
    });

    it("light mode with no param matches no text-only rule", () => {
        for (const group of selectors()) {
            const text = group.some(s => s.startsWith(':root[data-spot-lit="text"]'));
            const tint = group.some(s => s.startsWith(':root[data-spot-lit="tint"]'));
            if (text && !tint) expect(group.some(s => s.startsWith(LIGHT_UNSET))).toBe(false);
        }
    });

    it("dark mode with no param still takes the pill geometry", () => {
        const group = selectors().find(g => g.includes(':root[data-spot-lit="pill"]'));
        expect(group).toContain(DARK_UNSET);
    });
});
