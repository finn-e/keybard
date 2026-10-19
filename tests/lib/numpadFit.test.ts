import { describe, expect, it } from "vitest";
import { NUMPAD_MIN_CELL_PX, numpadCellSize, numpadVariantFor } from "@/lib/numpadFit";

describe("numpad fit", () => {
    it("keeps the canvas key size when the column has room", () => {
        // 7 x 60 + 6 x 4 = 444
        expect(numpadCellSize(444, 60)).toBe(60);
        expect(numpadCellSize(900, 45)).toBe(45);
    });

    it("shrinks to the column, never wider than it", () => {
        // A 300px column with Normal keys (the 2560-wide case): 7 x 39 + 24 = 297.
        const cell = numpadCellSize(300, 60);
        expect(cell).toBe(39);
        expect(7 * cell + 6 * 4).toBeLessThanOrEqual(300);
    });

    it("stops at the floor", () => {
        expect(numpadCellSize(100, 60)).toBe(NUMPAD_MIN_CELL_PX);
    });

    it("uses the key size until measured", () => {
        expect(numpadCellSize(null, 60)).toBe(60);
        expect(numpadCellSize(0, 30)).toBe(30);
    });

    it("draws keys no larger than their cell or the canvas size", () => {
        expect(numpadVariantFor(60, "default")).toBe("default");
        expect(numpadVariantFor(50, "default")).toBe("medium");
        expect(numpadVariantFor(39, "default")).toBe("small");
        expect(numpadVariantFor(60, "small")).toBe("small");
        expect(numpadVariantFor(45, "medium")).toBe("medium");
    });
});
