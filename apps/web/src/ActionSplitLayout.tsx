import React from 'react';
import {
  type ActionLayoutSize,
  clampSplitSize,
  parseActionLayout,
  type SplitResizeBounds,
} from './splitSizing';
import {SplitDivider} from './SplitDivider';

const STORAGE_KEY = 'las-action-layout:v1';
const LEGACY_STORAGE_KEY = 'las-schedule-layout:v1';
const DIVIDER_SIZE = 12;
const MIN_REGISTRY_WIDTH = 320;
const MIN_DETAILS_WIDTH = 520;
const MIN_INSPECTOR_HEIGHT = 220;
const MIN_RUNTIME_HEIGHT = 220;

type ActionLayoutStyle = React.CSSProperties & {
  '--action-registry-width'?: string;
  '--action-inspector-height'?: string;
};

interface ActionSplitLayoutProps {
  registry: React.ReactNode;
  inspector: React.ReactNode;
  runtime: React.ReactNode;
  resizeColumnLabel: string;
  resizeRowLabel: string;
}

/** Fixed split controls for the action workspace's three scroll regions. */
export function ActionSplitLayout({
  registry,
  inspector,
  runtime,
  resizeColumnLabel,
  resizeRowLabel,
}: ActionSplitLayoutProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const registryRef = React.useRef<HTMLDivElement>(null);
  const detailsRef = React.useRef<HTMLDivElement>(null);
  const inspectorRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<ActionLayoutSize>(() =>
    readLayout(),
  );
  const layoutRef = React.useRef(layout);

  React.useEffect(() => {
    removeLegacyPanelSizes();
  }, []);

  React.useEffect(() => {
    const root = rootRef.current;
    const details = detailsRef.current;
    if (!root || !details || typeof ResizeObserver === 'undefined') return;
    const normalizeLayout = () => {
      if (window.matchMedia('(max-width: 900px)').matches) return;
      const current = layoutRef.current;
      const rootBounds = root.getBoundingClientRect();
      const detailsBounds = details.getBoundingClientRect();
      const next = {
        ...(current.registryWidth
          ? {
              registryWidth: clampSplitSize(
                current.registryWidth,
                MIN_REGISTRY_WIDTH,
                Math.max(
                  MIN_REGISTRY_WIDTH,
                  rootBounds.width - DIVIDER_SIZE - MIN_DETAILS_WIDTH,
                ),
              ),
            }
          : {}),
        ...(current.inspectorHeight
          ? {
              inspectorHeight: clampSplitSize(
                current.inspectorHeight,
                MIN_INSPECTOR_HEIGHT,
                Math.max(
                  MIN_INSPECTOR_HEIGHT,
                  detailsBounds.height - DIVIDER_SIZE - MIN_RUNTIME_HEIGHT,
                ),
              ),
            }
          : {}),
      };
      if (
        next.registryWidth === current.registryWidth &&
        next.inspectorHeight === current.inspectorHeight
      ) {
        return;
      }
      layoutRef.current = next;
      setLayout(next);
      writeLayout(next);
    };
    const observer = new ResizeObserver(normalizeLayout);
    observer.observe(root);
    observer.observe(details);
    normalizeLayout();
    return () => observer.disconnect();
  }, []);

  const style: ActionLayoutStyle = {
    ...(layout.registryWidth
      ? {'--action-registry-width': `${layout.registryWidth}px`}
      : {}),
    ...(layout.inspectorHeight
      ? {'--action-inspector-height': `${layout.inspectorHeight}px`}
      : {}),
  };

  function getColumnResizeBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const root = rootRef.current?.getBoundingClientRect();
    const registryBounds = registryRef.current?.getBoundingClientRect();
    if (!root || !registryBounds) return null;
    return {
      startCoordinate: event.clientX,
      startSize: registryBounds.width,
      minimum: MIN_REGISTRY_WIDTH,
      maximum: Math.max(
        MIN_REGISTRY_WIDTH,
        root.width - DIVIDER_SIZE - MIN_DETAILS_WIDTH,
      ),
    };
  }

  function getRowResizeBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const details = detailsRef.current?.getBoundingClientRect();
    const inspectorBounds = inspectorRef.current?.getBoundingClientRect();
    if (!details || !inspectorBounds) return null;
    return {
      startCoordinate: event.clientY,
      startSize: inspectorBounds.height,
      minimum: MIN_INSPECTOR_HEIGHT,
      maximum: Math.max(
        MIN_INSPECTOR_HEIGHT,
        details.height - DIVIDER_SIZE - MIN_RUNTIME_HEIGHT,
      ),
    };
  }

  function updateRegistryWidth(registryWidth: number) {
    const next = {...layoutRef.current, registryWidth};
    layoutRef.current = next;
    setLayout(next);
  }

  function updateInspectorHeight(inspectorHeight: number) {
    const next = {...layoutRef.current, inspectorHeight};
    layoutRef.current = next;
    setLayout(next);
  }

  function finishResize() {
    writeLayout(layoutRef.current);
  }

  function resetLayout() {
    layoutRef.current = {};
    setLayout({});
    removeStoredValue(STORAGE_KEY);
    removeStoredValue(LEGACY_STORAGE_KEY);
  }

  return (
    <div className="actionResourceWorkbench" ref={rootRef} style={style}>
      <div className="actionRegistrySlot" ref={registryRef}>
        {registry}
      </div>
      <SplitDivider
        orientation="vertical"
        className="actionColumnDivider"
        label={resizeColumnLabel}
        onResizeStart={getColumnResizeBounds}
        onResize={updateRegistryWidth}
        onResizeEnd={finishResize}
        onReset={resetLayout}
      />
      <div className="actionLibraryDetails" ref={detailsRef}>
        <div className="actionInspectorSlot" ref={inspectorRef}>
          {inspector}
        </div>
        <SplitDivider
          orientation="horizontal"
          className="actionRowDivider"
          label={resizeRowLabel}
          onResizeStart={getRowResizeBounds}
          onResize={updateInspectorHeight}
          onResizeEnd={finishResize}
          onReset={resetLayout}
        />
        <div className="actionRuntimeSlot">{runtime}</div>
      </div>
    </div>
  );
}

function readLayout() {
  try {
    return parseActionLayout(
      localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function writeLayout(layout: ActionLayoutSize) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // The split controls remain usable when browser storage is unavailable.
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
      'actions-registry',
      'actions-runtime',
      'actions-inspector',
      'schedule-registry',
      'schedule-runtime',
      'schedule-inspector',
    ]) {
      removeStoredValue(`${prefix}${key}`);
    }
  }
}
