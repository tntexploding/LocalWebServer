import React from 'react';
import {clampSplitSize, type SplitResizeBounds} from './splitSizing';
import {SplitDivider} from './SplitDivider';

const STORAGE_KEY = 'las-endpoint-layout:v1';
const DIVIDER_SIZE = 12;
const MIN_REGISTRY_WIDTH = 300;
const MIN_INSPECTOR_WIDTH = 360;
const MIN_LOG_WIDTH = 300;

interface EndpointLayoutSize {
  registryWidth?: number;
  inspectorWidth?: number;
}

type EndpointLayoutStyle = React.CSSProperties & {
  '--endpoint-registry-width'?: string;
  '--endpoint-inspector-width'?: string;
};

interface EndpointSplitLayoutProps {
  registry: React.ReactNode;
  inspector: React.ReactNode;
  logs: React.ReactNode;
  resizeRegistryLabel: string;
  resizeInspectorLabel: string;
}

/** Fixed two-column-divider layout for endpoint list, editor, and logs. */
export function EndpointSplitLayout({
  registry,
  inspector,
  logs,
  resizeRegistryLabel,
  resizeInspectorLabel,
}: EndpointSplitLayoutProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const registryRef = React.useRef<HTMLDivElement>(null);
  const inspectorRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<EndpointLayoutSize>(() =>
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
      const rootBounds = root.getBoundingClientRect();
      const registryBounds = registryRef.current?.getBoundingClientRect();
      const inspectorBounds = inspectorRef.current?.getBoundingClientRect();
      if (!registryBounds || !inspectorBounds) return;
      const available = rootBounds.width - DIVIDER_SIZE * 2;
      const registryWidth = current.registryWidth
        ? clampSplitSize(
            current.registryWidth,
            MIN_REGISTRY_WIDTH,
            Math.max(
              MIN_REGISTRY_WIDTH,
              available - MIN_INSPECTOR_WIDTH - MIN_LOG_WIDTH,
            ),
          )
        : undefined;
      const effectiveRegistryWidth = registryWidth ?? registryBounds.width;
      const inspectorWidth = current.inspectorWidth
        ? clampSplitSize(
            current.inspectorWidth,
            MIN_INSPECTOR_WIDTH,
            Math.max(
              MIN_INSPECTOR_WIDTH,
              available - effectiveRegistryWidth - MIN_LOG_WIDTH,
            ),
          )
        : undefined;
      const next = {
        ...(registryWidth ? {registryWidth} : {}),
        ...(inspectorWidth ? {inspectorWidth} : {}),
      };
      if (
        next.registryWidth === current.registryWidth &&
        next.inspectorWidth === current.inspectorWidth
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

  const style: EndpointLayoutStyle = {
    ...(layout.registryWidth
      ? {'--endpoint-registry-width': `${layout.registryWidth}px`}
      : {}),
    ...(layout.inspectorWidth
      ? {'--endpoint-inspector-width': `${layout.inspectorWidth}px`}
      : {}),
  };

  function getRegistryBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const registryBounds = registryRef.current?.getBoundingClientRect();
    const inspectorBounds = inspectorRef.current?.getBoundingClientRect();
    if (!rootBounds || !registryBounds || !inspectorBounds) return null;
    return {
      startCoordinate: event.clientX,
      startSize: registryBounds.width,
      minimum: MIN_REGISTRY_WIDTH,
      maximum: Math.max(
        MIN_REGISTRY_WIDTH,
        rootBounds.width -
          DIVIDER_SIZE * 2 -
          inspectorBounds.width -
          MIN_LOG_WIDTH,
      ),
    };
  }

  function getInspectorBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const registryBounds = registryRef.current?.getBoundingClientRect();
    const inspectorBounds = inspectorRef.current?.getBoundingClientRect();
    if (!rootBounds || !registryBounds || !inspectorBounds) return null;
    return {
      startCoordinate: event.clientX,
      startSize: inspectorBounds.width,
      minimum: MIN_INSPECTOR_WIDTH,
      maximum: Math.max(
        MIN_INSPECTOR_WIDTH,
        rootBounds.width -
          DIVIDER_SIZE * 2 -
          registryBounds.width -
          MIN_LOG_WIDTH,
      ),
    };
  }

  function updateLayout(next: EndpointLayoutSize, persist = false) {
    layoutRef.current = next;
    setLayout(next);
    if (persist) writeLayout(next);
  }

  function resetLayout() {
    updateLayout({});
    removeStoredValue(STORAGE_KEY);
  }

  return (
    <div className="endpointWorkbench" ref={rootRef} style={style}>
      <div className="endpointCenter" ref={registryRef}>
        {registry}
      </div>
      <SplitDivider
        orientation="vertical"
        className="endpointRegistryDivider"
        label={resizeRegistryLabel}
        onResizeStart={getRegistryBounds}
        onResize={registryWidth =>
          updateLayout({...layoutRef.current, registryWidth})
        }
        onResizeEnd={() => writeLayout(layoutRef.current)}
        onReset={resetLayout}
      />
      <div className="endpointInspector" ref={inspectorRef}>
        {inspector}
      </div>
      <SplitDivider
        orientation="vertical"
        className="endpointInspectorDivider"
        label={resizeInspectorLabel}
        onResizeStart={getInspectorBounds}
        onResize={inspectorWidth =>
          updateLayout({...layoutRef.current, inspectorWidth})
        }
        onResizeEnd={() => writeLayout(layoutRef.current)}
        onReset={resetLayout}
      />
      <div className="endpointSelectedLogs">{logs}</div>
    </div>
  );
}

function readLayout(): EndpointLayoutSize {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as EndpointLayoutSize;
    return {
      ...(validDimension(parsed.registryWidth)
        ? {registryWidth: parsed.registryWidth}
        : {}),
      ...(validDimension(parsed.inspectorWidth)
        ? {inspectorWidth: parsed.inspectorWidth}
        : {}),
    };
  } catch {
    return {};
  }
}

function writeLayout(layout: EndpointLayoutSize) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Endpoint controls remain usable when browser storage is unavailable.
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
      'endpoints-registry',
      'endpoints-inspector',
      'endpoints-logs',
    ]) {
      removeStoredValue(`${prefix}${key}`);
    }
  }
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
