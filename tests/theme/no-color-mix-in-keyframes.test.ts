/**
 * The CSS build rewrites color-mix() into a solid fallback plus a nested
 * @supports block. Inside @keyframes the nested block is dropped, so a
 * translucent color-mix() turns into the solid color mid-animation (the back
 * arrow's nudge filled solid and hid the arrow). Keyframes use plain token
 * values instead, such as --kb-back-highlight-soft.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function keyframeBlocks(css: string): { name: string; body: string }[] {
    const blocks: { name: string; body: string }[] = [];
    const re = /@keyframes\s+([\w-]+)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
        let depth = 1;
        let i = re.lastIndex;
        while (i < css.length && depth > 0) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
            i++;
        }
        blocks.push({ name: m[1], body: css.slice(re.lastIndex, i) });
    }
    return blocks;
}

describe("keyframes colors", () => {
    const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf-8");

    it("finds the back arrow pulse keyframes", () => {
        const names = keyframeBlocks(css).map(b => b.name);
        expect(names).toEqual(expect.arrayContaining(["bindingBackRing", "bindingBackGlow", "bindingBackNudgeBg"]));
    });

    it("uses no color-mix() inside any @keyframes", () => {
        const offenders = keyframeBlocks(css).filter(b => b.body.includes("color-mix(")).map(b => b.name);
        expect(offenders).toEqual([]);
    });
});
