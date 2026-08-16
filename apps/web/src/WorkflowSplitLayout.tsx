import React from 'react';
import {clampSplitSize, type SplitResizeBounds} from './splitSizing';
import {SplitDivider} from './SplitDivider';

const STORAGE_KEY = 'las-workflow-layout:v2';
const LEGACY_STORAGE_KEY = 'las-workflow-layout:v1';
const DIVIDER_SIZE = 12;
const MIN_SIDEBAR_WIDTH = 420;
const MIN_CANVAS_WIDTH = 520;
const MIN_REGISTRY_HEIGHT = 180;
const MIN_INSPECTOR_HEIGHT = 260;

interface WorkflowLayoutSize {
  sidebarWidth?: number;
  registryHeight?: number;
}

type WorkflowLayoutStyle = React.CSSProperties & {
  '--workflow-sidebar-width'?: string;
  '--workflow-registry-height'?: string;
};

interface WorkflowSplitLayoutProps {
  registry: React.ReactNode;
  inspector: React.ReactNode;
  canvas: React.ReactNode;
  resizeColumnLabel: string;
  resizeRowLabel: string;
}

/** Places the task list and inspector beside an independent workflow canvas. */
export function WorkflowSplitLayout({
  registry,
  inspector,
  canvas,
  resizeColumnLabel,
  resizeRowLabel,
}: WorkflowSplitLayoutProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const registryRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<WorkflowLayoutSize>(() =>
    readLayout(),
  );
  const layoutRef = React.useRef(layout);

  React.useEffect(() => {
    removeLegacyPanelSizes();
  }, []);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const normalizeLayout = () => {
      if (window.matchMedia('(max-width: 1100px)').matches) return;
      const current = layoutRef.current;
      const bounds = root.getBoundingClientRect();
      const next = {
        ...(current.sidebarWidth
          ? {
              sidebarWidth: clampSplitSize(
                current.sidebarWidth,
                MIN_SIDEBAR_WIDTH,
                Math.max(
                  MIN_SIDEBAR_WIDTH,
                  bounds.width - DIVIDER_SIZE - MIN_CANVAS_WIDTH,
                ),
              ),
            }
          : {}),
        ...(current.registryHeight
          ? {
              registryHeight: clampSplitSize(
                current.registryHeight,
                MIN_REGISTRY_HEIGHT,
                Math.max(
                  MIN_REGISTRY_HEIGHT,
                  bounds.height - DIVIDER_SIZE - MIN_INSPECTOR_HEIGHT,
                ),
              ),
            }
          : {}),
      };
      if (
        next.sidebarWidth === current.sidebarWidth &&
        next.registryHeight === current.registryHeight
      ) {
        return;
      }
      updateLayout(next, true);
    };
    const observer = new ResizeObserver(normalizeLayout);
    observer.observe(root);
    normalizeLayout();
    return () => observer.disconnect();
  }, []);

  const style: WorkflowLayoutStyle = {
    ...(layout.sidebarWidth
      ? {'--workflow-sidebar-width': `${layout.sidebarWidth}px`}
      : {}),
    ...(layout.registryHeight
      ? {'--workflow-registry-height': `${layout.registryHeight}px`}
      : {}),
  };

  function getColumnBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const sidebarBounds = sidebarRef.current?.getBoundingClientRect();
    if (!rootBounds || !sidebarBounds) return null;
    return {
      startCoordinate: event.clientX,
      startSize: sidebarBounds.width,
      minimum: MIN_SIDEBAR_WIDTH,
      maximum: Math.max(
        MIN_SIDEBAR_WIDTH,
        rootBounds.width - DIVIDER_SIZE - MIN_CANVAS_WIDTH,
      ),
    };
  }

  function getRowBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const registryBounds = registryRef.current?.getBoundingClientRect();
    if (!rootBounds || !registryBounds) return null;
    return {
      startCoordinate: event.clientY,
      startSize: registryBounds.height,
      minimum: MIN_REGISTRY_HEIGHT,
      maximum: Math.max(
        MIN_REGISTRY_HEIGHT,
        rootBounds.height - DIVIDER_SIZE - MIN_INSPECTOR_HEIGHT,
      ),
    };
  }

  function updateLayout(next: WorkflowLayoutSize, persist = false) {
    layoutRef.current = next;
    setLayout(next);
    if (persist) writeLayout(next);
  }

  function resetLayout() {
    updateLayout({});
    removeStoredValue(STORAGE_KEY);
    removeStoredValue(LEGACY_STORAGE_KEY);
  }

  return (
    <div className="workflowWorkbench" ref={rootRef} style={style}>
      <div className="workflowSidebar" ref={sidebarRef}>
        <div className="workflowRegistry" ref={registryRef}>
          {registry}
        </div>
        <SplitDivider
          orientation="horizontal"
          className="workflowRowDivider"
          label={resizeRowLabel}
          onResizeStart={getRowBounds}
          onResize={registryHeight =>
            updateLayout({...layoutRef.current, registryHeight})
          }
          onResizeEnd={() => writeLayout(layoutRef.current)}
          onReset={resetLayout}
        />
        <div className="workflowInspector">{inspector}</div>
      </div>
      <SplitDivider
        orientation="vertical"
        className="workflowColumnDivider"
        label={resizeColumnLabel}
        onResizeStart={getColumnBounds}
        onResize={sidebarWidth =>
          updateLayout({...layoutRef.current, sidebarWidth})
        }
        onResizeEnd={() => writeLayout(layoutRef.current)}
        onReset={resetLayout}
      />
      <div className="workflowCanvasPanel">{canvas}</div>
    </div>
  );
}

function readLayout(): WorkflowLayoutSize {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as WorkflowLayoutSize;
    return {
      ...(validDimension(parsed.sidebarWidth)
        ? {sidebarWidth: parsed.sidebarWidth}
        : {}),
      ...(validDimension(parsed.registryHeight)
        ? {registryHeight: parsed.registryHeight}
        : {}),
    };
  } catch {
    return {};
  }
}

function writeLayout(layout: WorkflowLayoutSize) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
}

function removeStoredValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function removeLegacyPanelSizes() {
  for (const prefix of ['las-panel-size:', 'las-panel-size:v2:']) {
    for (const key of [
      'workflow-registry',
      'workflow-inspector',
      'workflow-canvas',
    ]) {
      removeStoredValue(`${prefix}${key}`);
    }
  }
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
