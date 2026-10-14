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
