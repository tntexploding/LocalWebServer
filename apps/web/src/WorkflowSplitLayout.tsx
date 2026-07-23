import React from 'react';
import {clampSplitSize, type SplitResizeBounds} from './splitSizing';
import {SplitDivider} from './SplitDivider';

const STORAGE_KEY = 'las-workflow-layout:v1';
const DIVIDER_SIZE = 12;
const MIN_REGISTRY_WIDTH = 300;
const MIN_INSPECTOR_WIDTH = 460;
const MIN_TOP_HEIGHT = 280;
const MIN_CANVAS_HEIGHT = 320;

interface WorkflowLayoutSize {
  registryWidth?: number;
  topHeight?: number;
}

type WorkflowLayoutStyle = React.CSSProperties & {
  '--workflow-registry-width'?: string;
  '--workflow-top-height'?: string;
};

interface WorkflowSplitLayoutProps {
  registry: React.ReactNode;
  inspector: React.ReactNode;
  canvas: React.ReactNode;
  resizeColumnLabel: string;
  resizeRowLabel: string;
}

/** Fixed one-column/one-row split layout for the automation editor. */
export function WorkflowSplitLayout({
  registry,
  inspector,
  canvas,
  resizeColumnLabel,
  resizeRowLabel,
}: WorkflowSplitLayoutProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const registryRef = React.useRef<HTMLDivElement>(null);
  const topRef = React.useRef<HTMLDivElement>(null);
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
        ...(current.registryWidth
          ? {
              registryWidth: clampSplitSize(
                current.registryWidth,
                MIN_REGISTRY_WIDTH,
                Math.max(
                  MIN_REGISTRY_WIDTH,
                  bounds.width - DIVIDER_SIZE - MIN_INSPECTOR_WIDTH,
                ),
              ),
            }
          : {}),
        ...(current.topHeight
          ? {
              topHeight: clampSplitSize(
                current.topHeight,
                MIN_TOP_HEIGHT,
                Math.max(
                  MIN_TOP_HEIGHT,
                  bounds.height - DIVIDER_SIZE - MIN_CANVAS_HEIGHT,
                ),
              ),
            }
          : {}),
      };
      if (
        next.registryWidth === current.registryWidth &&
        next.topHeight === current.topHeight
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
    ...(layout.registryWidth
      ? {'--workflow-registry-width': `${layout.registryWidth}px`}
      : {}),
    ...(layout.topHeight
      ? {'--workflow-top-height': `${layout.topHeight}px`}
      : {}),
  };

  function getColumnBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const registryBounds = registryRef.current?.getBoundingClientRect();
    if (!rootBounds || !registryBounds) return null;
    return {
      startCoordinate: event.clientX,
      startSize: registryBounds.width,
      minimum: MIN_REGISTRY_WIDTH,
      maximum: Math.max(
        MIN_REGISTRY_WIDTH,
        rootBounds.width - DIVIDER_SIZE - MIN_INSPECTOR_WIDTH,
      ),
    };
  }

  function getRowBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const topBounds = topRef.current?.getBoundingClientRect();
    if (!rootBounds || !topBounds) return null;
    return {
      startCoordinate: event.clientY,
      startSize: topBounds.height,
      minimum: MIN_TOP_HEIGHT,
      maximum: Math.max(
        MIN_TOP_HEIGHT,
        rootBounds.height - DIVIDER_SIZE - MIN_CANVAS_HEIGHT,
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
  }

  return (
    <div className="workflowWorkbench" ref={rootRef} style={style}>
      <div className="workflowRegistry" ref={registryRef}>
        {registry}
      </div>
      <SplitDivider
        orientation="vertical"
        className="workflowColumnDivider"
        label={resizeColumnLabel}
        onResizeStart={getColumnBounds}
        onResize={registryWidth =>
          updateLayout({...layoutRef.current, registryWidth})
        }
        onResizeEnd={() => writeLayout(layoutRef.current)}
        onReset={resetLayout}
      />
      <div className="workflowInspector" ref={topRef}>
        {inspector}
      </div>
      <SplitDivider
        orientation="horizontal"
        className="workflowRowDivider"
        label={resizeRowLabel}
        onResizeStart={getRowBounds}
        onResize={topHeight => updateLayout({...layoutRef.current, topHeight})}
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
      ...(validDimension(parsed.registryWidth)
        ? {registryWidth: parsed.registryWidth}
        : {}),
      ...(validDimension(parsed.topHeight)
        ? {topHeight: parsed.topHeight}
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
