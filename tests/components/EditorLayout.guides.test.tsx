vi.mock("@/hooks/useLayerClipboardActions", () => ({ useLayerClipboardActions: () => ({apply: vi.fn(), clearClipboardError: vi.fn()}) }));
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createContext, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorLayout from "../../src/layout/EditorLayout";
import { LEGACY_FORWARD_ENTRY_MS, SCENE_COLLAPSE_MS } from "../../src/layout/layer-scene";

const mockLayoutSettings = vi.hoisted(() => ({
  keyVariant: "default",
  layoutMode: "sidebar",
  setSecondarySidebarOpen: vi.fn(),
  setPrimarySidebarExpanded: vi.fn(),
  registerPrimarySidebarControl: vi.fn(),
  setMeasuredDimensions: vi.fn(),
  is3DMode: true,
  fingerClusterSqueeze: 0,
  isThumb3DOffsetActive: true,
}));

const mockPanels = vi.hoisted(() => ({
  isMobile: false,
  state: "collapsed",
  activePanel: null as string | null,
  itemToEdit: null,
  setItemToEdit: vi.fn(),
  handleCloseEditor: vi.fn(),
}));

const mockLayer = vi.hoisted(() => ({
  selectedLayer: 0,
  setSelectedLayer: vi.fn(),
}));


vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSidebar: () => ({
    isMobile: false,
    state: "collapsed",
    setOpen: vi.fn(),
  }),
}));

vi.mock("@/contexts/PanelsContext", () => ({
  PanelsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePanels: () => mockPanels,
}));

vi.mock("@/contexts/LayoutSettingsContext", () => ({
  LayoutSettingsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLayoutSettings: () => mockLayoutSettings,
}));

vi.mock("@/contexts/LayerContext", () => ({
  LayerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLayer: () => mockLayer,
}));

vi.mock("@/contexts/DragContext", () => ({
  DragContext: createContext({ isDragging: false }),
  DragProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useDrag: () => ({
    isDragging: false,
    draggedItem: null,
    markDropConsumed: vi.fn(),
  }),
}));

vi.mock("@/contexts/KeyboardContext", () => ({
  useKeyboard: () => ({
    keyboard: {
      rows: 1,
      cols: 1,
      layers: 2,
      keymap: [[4], [5]],
      keylayout: {
        0: { x: 0, y: 0, w: 1, h: 1, row: 0, col: 0 },
      },
      cosmetic: { layer: {}, layer_colors: {} },
    },
    setKeyboard: vi.fn(),
    updateKey: vi.fn(),
    activeLayerIndex: 0,
    isConnected: false,
  }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ getSetting: () => false }),
}));

vi.mock("@/contexts/KeyBindingContext", () => ({
  useKeyBinding: () => ({
    assignKeycodeTo: vi.fn(),
    clearSelection: vi.fn(),
  }),
}));

vi.mock("@/hooks/useChanges", () => ({
  useChanges: () => ({
    queue: vi.fn(),
  }),
}));

vi.mock("@/contexts/LayoutLibraryContext", () => ({
  useLayoutLibrary: () => ({
    layerClipboard: null,
    openPasteDialog: vi.fn(),
  }),
}));

vi.mock("@/components/DragOverlay", () => ({
  DragOverlay: () => null,
}));

vi.mock("../../src/layout/Sidebar", () => ({
  default: () => null,
}));

vi.mock("../../src/layout/SecondarySidebar/SecondarySidebar", () => ({
  default: () => null,
  DETAIL_SIDEBAR_WIDTH: "360px",
  getDetailPanelHeight: (_panel: unknown, height: number) => height,
}));

vi.mock("../../src/layout/BottomPanel", () => ({
  BottomPanel: () => null,
  BOTTOM_PANEL_HEIGHT: 200,
}));

vi.mock("../../src/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer", () => ({
  default: () => null,
}));

vi.mock("../../src/layout/SecondarySidebar/components/EditorSidePanel", () => ({
  default: () => null,
}));

vi.mock("../../src/layout/EditorControls", () => ({
  EditorControls: () => null,
}));

vi.mock("@/components/PasteLayerDialog", () => ({
  PasteLayerDialog: () => null,
}));

vi.mock("@/components/DragReplaceLayerDialog", () => ({
  DragReplaceLayerDialog: () => null,
}));

vi.mock("@/components/InfoPanelWidget", () => ({
  InfoPanelWidget: () => null,
}));

vi.mock("@/components/MatrixTester", () => ({
  MatrixTester: () => null,
}));

vi.mock("@/utils/layer-drop-target", () => ({
  getBackdropLayerFromElements: () => null,
}));

vi.mock("@/services/sval.service", () => ({
  svalService: {
    getLayerName: (_keyboard: unknown, layer: number) => `Layer ${layer}`,
    getLayerNameNoLabel: (_keyboard: unknown, layer: number) => `${layer}`,
  },
}));

vi.mock("../../src/layout/LayerSelector", () => ({
  default: ({ onToggleMultiLayers }: { onToggleMultiLayers: () => void }) => (
    <button data-testid="toggle-multi" onClick={onToggleMultiLayers}>
      toggle multi
    </button>
  ),
}));

vi.mock("../../src/layout/KeyboardViewInstance", () => ({
  default: ({
    instanceId,
    scenePose,
    legacyForwardEntryActive,
  }: {
    instanceId: string;
    scenePose: { opacity: number; rootTranslateY: number };
    legacyForwardEntryActive?: boolean;
  }) => (
    <div
      data-testid={`view-${instanceId}`}
      data-keyboard-instance={instanceId}
      data-opacity={scenePose.opacity}
      data-root-translate-y={scenePose.rootTranslateY}
      data-legacy-forward-entry={legacyForwardEntryActive ? "true" : "false"}
    >
      {instanceId}
    </div>
  ),
}));

describe("EditorLayout 3D guide sequencing", () => {
  const queuedRafs: FrameRequestCallback[] = [];

  beforeEach(() => {
    mockPanels.activePanel = null;
    vi.useFakeTimers();
    vi.stubGlobal("__GIT_BRANCH__", "test");
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      queuedRafs.push(cb);
      return queuedRafs.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ branch: "test" }),
      })
    );
  });

  afterEach(() => {
    queuedRafs.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const flushRaf = async () => {
    const callbacks = queuedRafs.splice(0, queuedRafs.length);
    await act(async () => {
      callbacks.forEach((cb) => cb(0));
    });
  };

  it("keeps guides hidden during legacy forward entry and only shows them once settled", async () => {
    const { queryByTestId } = render(<EditorLayout />);

    expect(queryByTestId("multi-layer-guides")).not.toBeInTheDocument();
    expect(queryByTestId("view-multi-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-multi"));

    expect(queryByTestId("view-multi-1")).toBeInTheDocument();
    // Initial check: legacy entry should be active
    const multiView = queryByTestId("view-multi-1");
    expect(multiView).toHaveAttribute("data-legacy-forward-entry", "true");
    expect(queryByTestId("multi-layer-guides")).not.toBeInTheDocument();

    // Force all timers to run, ensuring the safety timeout in the component fires
    await act(async () => {
      vi.runAllTimers();
    });

    expect(queryByTestId("view-multi-1")).toHaveAttribute("data-legacy-forward-entry", "false");
    expect(queryByTestId("multi-layer-guides")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-multi"));

    expect(queryByTestId("view-multi-1")).toBeInTheDocument();
    expect(queryByTestId("view-multi-1")).toHaveAttribute("data-opacity", "1");
    expect(queryByTestId("multi-layer-guides")).not.toBeInTheDocument();

    await flushRaf();

    expect(queryByTestId("view-multi-1")).toHaveAttribute("data-opacity", "0");
    expect(queryByTestId("multi-layer-guides")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(SCENE_COLLAPSE_MS - 1);
    });
    expect(queryByTestId("view-multi-1")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(queryByTestId("view-multi-1")).not.toBeInTheDocument();
  });
});
