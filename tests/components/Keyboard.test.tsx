import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../src/components/Keyboard";

const mockLayoutSettings = vi.hoisted(() => ({
  internationalLayout: "US",
  keyVariant: "default",
  fingerClusterSqueeze: 0,
  is3DMode: true,
  isThumb3DOffsetActive: true,
  backdropOpacity: 0.45,
}));

vi.mock("@/contexts/LayoutSettingsContext", () => ({
  useLayoutSettings: () => mockLayoutSettings,
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({
    getSetting: vi.fn(() => false),
  }),
}));

vi.mock("@/contexts/KeyBindingContext", () => ({
  useKeyBinding: () => ({
    selectKeyboardKey: vi.fn(),
    selectedTarget: null,
    clearSelection: vi.fn(),
    assignKeycode: vi.fn(),
  }),
}));

vi.mock("@/contexts/PanelsContext", () => ({
  usePanels: () => ({
    activePanel: null,
    itemToEdit: null,
  }),
}));

vi.mock("@/hooks/useChanges", () => ({
  useChanges: () => ({
    hasPendingChangeForKey: vi.fn(() => false),
  }),
}));

vi.mock("@/components/Key", () => ({
  Key: () => <div data-testid="mock-key" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mockPointingSlots = vi.hoisted(() => ({ slots: [] as any[] }));
vi.mock("@/hooks/usePointingSlots", () => ({
  usePointingSlots: () => mockPointingSlots.slots,
}));
vi.mock("../../src/components/pointing-viz/PointingSlot", () => ({
  PointingSlot: ({ slot, unitPx, style }: { slot: { side: string; w: number }; unitPx: number; style: Record<string, unknown> }) => (
    <div data-testid={`slot-${slot.side}`} data-unit={unitPx} style={style as any} />
  ),
}));

vi.mock("@/services/sval.service", () => ({
  svalService: {
    getLayerName: (_keyboard: unknown, layer: number) => `Layer ${layer}`,
  },
}));

const keyboardFixture = {
  rows: 1,
  cols: 14,
  layers: 2,
  keymap: [[], []],
  cosmetic: { layer: {}, layer_colors: {} },
};

describe("Keyboard thumb backdrop toggle behavior", () => {
  beforeEach(() => {
    mockPointingSlots.slots = [];
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockLayoutSettings.is3DMode = true;
    mockLayoutSettings.isThumb3DOffsetActive = true;
  });

  it("keeps thumb backdrop in 3D offset during 3D->2D toggle window and removes it after settle", () => {
    const { container, rerender } = render(
      <Keyboard
        keyboard={keyboardFixture as any}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        show3DBackdrop={true}
        isToggling3D={false}
      />
    );

    const firstThumbBackdrop = Array.from(container.querySelectorAll('[data-layer-backdrop="true"]'))
      .find((node) => (node as HTMLElement).style.transform.includes("translateY(900px)")) as HTMLElement | undefined;

    expect(firstThumbBackdrop).toBeDefined();
    expect(firstThumbBackdrop?.style.transform).toBe("translateY(900px)");

    mockLayoutSettings.is3DMode = false;

    rerender(
      <Keyboard
        keyboard={keyboardFixture as any}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        show3DBackdrop={false}
        isToggling3D={true}
      />
    );

    const togglingThumbBackdrop = Array.from(container.querySelectorAll('[data-layer-backdrop="true"]'))
      .find((node) => (node as HTMLElement).style.transform.includes("translateY(900px)")) as HTMLElement | undefined;

    expect(togglingThumbBackdrop).toBeDefined();
    expect(togglingThumbBackdrop?.style.transform).toBe("translateY(900px)");

    rerender(
      <Keyboard
        keyboard={keyboardFixture as any}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        show3DBackdrop={false}
        isToggling3D={false}
      />
    );

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(container.querySelectorAll('[data-layer-backdrop="true"]').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelectorAll('[data-layer-backdrop="true"]').length).toBe(0);
  });
});

describe("Keyboard pointing slots", () => {
  const slot = (side: "left" | "right", x: number) => ({
    instanceIdx: side === "left" ? 10 : 11, instanceId: `${side}_pointing`, side,
    fragmentName: null, widget: null, x, y: 4.75, w: 2.5, h: 2.5, kind: "pending",
  });
  // Two keys so the layout has a midline and nothing sits at negative x.
  const keyboard = {
    ...keyboardFixture,
    keylayout: {
      0: { x: 0, y: 0, w: 1, h: 1, row: 0, col: 0 },
      1: { x: 24, y: 0, w: 1, h: 1, row: 0, col: 1 },
    },
  };
  const renderKb = (props: Record<string, unknown> = {}) => render(
    <Keyboard keyboard={keyboard as any} selectedLayer={0} setSelectedLayer={vi.fn()} {...props} />
  );

  beforeEach(() => {
    mockPointingSlots.slots = [slot("left", 4.5), slot("right", 18)];
    mockLayoutSettings.is3DMode = false;
    mockLayoutSettings.isThumb3DOffsetActive = false;
    mockLayoutSettings.fingerClusterSqueeze = 0;
    mockLayoutSettings.keyVariant = "default";
  });

  it("places each slot in key units, like thumb keys", () => {
    const { getByTestId } = renderKb();
    expect(getByTestId("slot-left").style.left).toBe(`${4.5 * 60}px`);
    expect(getByTestId("slot-left").style.top).toBe(`${4.75 * 60}px`);
    expect(getByTestId("slot-right").style.left).toBe(`${18 * 60}px`);
    expect(getByTestId("slot-left").dataset.unit).toBe("60");
  });

  it("follows the key size setting", () => {
    mockLayoutSettings.keyVariant = "small";
    const { getByTestId } = renderKb();
    expect(getByTestId("slot-right").style.left).toBe(`${18 * 30}px`);
    expect(getByTestId("slot-right").dataset.unit).toBe("30");
  });

  it("keeps clear of the thumb when the finger clusters squeeze toward it", () => {
    mockLayoutSettings.fingerClusterSqueeze = 0.5;
    const { getByTestId } = renderKb();
    // Left: the fingers stay and the thumb moves left by the squeeze, so the slot keeps its left
    // edge and gives up the squeeze on its right. Right: the slot's right edge moves with the
    // fingers (twice the squeeze), its left edge with the thumb (once).
    expect(getByTestId("slot-left").style.left).toBe(`${4.5 * 60}px`);
    expect(getByTestId("slot-right").style.left).toBe(`${(18 - 0.5) * 60}px`);
  });

  it("is hidden for thumbnails and print (showPointingSlots=false)", () => {
    const { queryByTestId } = renderKb({ showPointingSlots: false });
    expect(queryByTestId("slot-left")).toBeNull();
  });

  it("hides with the thumbs in 2D when the thumb offset is active, and moves with them in 3D", () => {
    mockLayoutSettings.isThumb3DOffsetActive = true;
    const hidden = renderKb();
    expect(hidden.queryByTestId("slot-left")).toBeNull();
    hidden.unmount();

    mockLayoutSettings.is3DMode = true;
    const { getByTestId } = renderKb();
    expect(getByTestId("slot-left").style.transform).toBe("translateY(900px)");
  });
});
