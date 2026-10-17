/**
 * Review deep links (?demo, ?theme, ?edit) wired into the app: the start
 * screen loads the example, ThemeSync and the head script force the theme,
 * and DeepLinkEditor opens the named editor once a layout is loaded.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConnectKeyboard from "@/components/ConnectKeyboard";
import ThemeSync from "@/components/ThemeSync";
import { SettingsProvider } from "@/contexts/SettingsContext";
import DeepLinkEditor from "@/layout/DeepLinkEditor";
import { resetDeepLinksForTests } from "@/lib/deepLinks";

const DEMO = readFileSync(resolve(process.cwd(), "src/default-layouts/sval-default.svil"), "utf8");
const HTML = readFileSync(resolve(process.cwd(), "src/index.html"), "utf8");

const keyboardContext = {
    isConnected: false,
    isWebHIDSupported: true,
    connect: vi.fn(),
    connectDevice: vi.fn(),
    disconnect: vi.fn(),
    loadFromFile: vi.fn(async (_file: File, _source?: string) => true),
    connectionError: null,
    connectionFix: null,
    connectionFirmware: null,
    keyboard: null as unknown,
};
vi.mock("@/contexts/KeyboardContext", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/contexts/KeyboardContext")>();
    return { ...actual, useKeyboard: () => keyboardContext };
});

const panels = {
    setActivePanel: vi.fn(),
    setItemToEdit: vi.fn(),
    setBindingTypeToEdit: vi.fn(),
    setAlternativeHeader: vi.fn(),
    setPanelToGoBack: vi.fn(),
    setInitialEditorSlot: vi.fn(),
};
vi.mock("@/contexts/PanelsContext", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/contexts/PanelsContext")>();
    return { ...actual, usePanels: () => panels };
});

/** jsdom's File has no text(). */
const readFile = (file: Blob) => new Promise<string>((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsText(file);
});
const at = (search: string) => window.history.replaceState({}, "", `/${search}`);

beforeEach(() => {
    vi.clearAllMocks();
    resetDeepLinksForTests();
    keyboardContext.keyboard = null;
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(DEMO, { status: 200 })));
});
afterEach(() => {
    at("");
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark");
});

describe("?demo", () => {
    it("loads the QWERTY Example on start, once", async () => {
        at("?demo&railMode=modal");
        const { unmount } = render(<ConnectKeyboard />);
        await waitFor(() => expect(keyboardContext.loadFromFile).toHaveBeenCalledTimes(1));
        const [file, source] = keyboardContext.loadFromFile.mock.calls[0];
        expect(source).toBe("demo");
        expect(await readFile(file)).toBe(DEMO);
        unmount();
        render(<ConnectKeyboard />);
        await new Promise(r => setTimeout(r, 20));
        expect(keyboardContext.loadFromFile).toHaveBeenCalledTimes(1);
    });

    it("?demo=combos loads the example with combos, tap dances and macros", async () => {
        at("?demo=combos");
        render(<ConnectKeyboard />);
        await waitFor(() => expect(keyboardContext.loadFromFile).toHaveBeenCalledTimes(1));
        const js = JSON.parse(await readFile(keyboardContext.loadFromFile.mock.calls[0][0]));
        expect(js.combo[0].output).toBe("KC_ESCAPE");
        expect(js.tap_dance[0].on_tap).toBe("KC_A");
        expect(js.macro[1].length).toBeGreaterThan(0);
    });

    it("does nothing without the param", async () => {
        at("");
        render(<ConnectKeyboard />);
        await new Promise(r => setTimeout(r, 20));
        expect(keyboardContext.loadFromFile).not.toHaveBeenCalled();
    });
});

describe("?theme", () => {
    const runHeadScript = () => new Function(/<script>([\s\S]*?)<\/script>/.exec(HTML)?.[1] ?? "")();

    it("the head script forces dark over a stored light setting", () => {
        window.localStorage.setItem("keyboard-settings", JSON.stringify({ theme: "light" }));
        at("?theme=dark");
        runHeadScript();
        expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("ThemeSync forces light over a stored dark setting and leaves the setting alone", async () => {
        window.localStorage.setItem("keyboard-settings", JSON.stringify({ theme: "dark" }));
        document.documentElement.classList.add("dark");
        at("?theme=light&spotLight=pill");
        render(createElement(SettingsProvider, null, createElement(ThemeSync)));
        await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
        expect(JSON.parse(window.localStorage.getItem("keyboard-settings") ?? "{}").theme).toBe("dark");
    });

    it("ThemeSync forces dark over the light default", async () => {
        at("?theme=dark");
        render(createElement(SettingsProvider, null, createElement(ThemeSync)));
        await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    });
});

describe("?edit", () => {
    const layout = { combos: new Array(50).fill({}), tapdances: new Array(50).fill({}), macros: new Array(2).fill({}) };

    it.each([
        ["combo:3", "combos", 3],
        ["tapdance:0", "tapdances", 0],
        ["macro:1", "macros", 1],
    ])("?edit=%s opens that editor once loaded", (value, panel, index) => {
        at(`?demo=combos&edit=${value}&comboEditor=panel`);
        const { rerender } = render(<DeepLinkEditor />);
        expect(panels.setActivePanel).not.toHaveBeenCalled();
        keyboardContext.keyboard = layout;
        rerender(<DeepLinkEditor />);
        expect(panels.setActivePanel).toHaveBeenCalledWith(panel);
        expect(panels.setBindingTypeToEdit).toHaveBeenCalledWith(panel);
        expect(panels.setPanelToGoBack).toHaveBeenCalledWith(panel);
        expect(panels.setItemToEdit).toHaveBeenCalledWith(index);
        expect(panels.setAlternativeHeader).toHaveBeenCalledWith(true);
    });

    it("ignores an entry the layout does not have, and opens only once", () => {
        keyboardContext.keyboard = layout;
        at("?edit=macro:5");
        render(<DeepLinkEditor />);
        expect(panels.setActivePanel).not.toHaveBeenCalled();
        at("?edit=macro:0");
        const first = render(<DeepLinkEditor />);
        expect(panels.setItemToEdit).toHaveBeenCalledTimes(1);
        first.unmount();
        render(<DeepLinkEditor />);
        expect(panels.setItemToEdit).toHaveBeenCalledTimes(1);
    });
});
