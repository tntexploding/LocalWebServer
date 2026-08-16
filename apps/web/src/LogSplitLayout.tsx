import React from 'react';
import {clampSplitSize, type SplitResizeBounds} from './splitSizing';
import {SplitDivider} from './SplitDivider';

const STORAGE_KEY = 'las-log-layout:v1';
const DIVIDER_SIZE = 12;
const MIN_STREAM_WIDTH = 520;
const MIN_TRACE_WIDTH = 300;

interface LogLayoutSize {
  streamWidth?: number;
}

type LogLayoutStyle = React.CSSProperties & {
  '--log-stream-width'?: string;
};

interface LogSplitLayoutProps {
  stream: React.ReactNode;
  trace: React.ReactNode;
  resizeColumnLabel: string;
}

/** Keeps the live stream and trace inspector in two bounded scroll regions. */
export function LogSplitLayout({
  stream,
  trace,
  resizeColumnLabel,
}: LogSplitLayoutProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const streamRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<LogLayoutSize>(() => readLayout());
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
      if (!current.streamWidth) return;
      const bounds = root.getBoundingClientRect();
      const streamWidth = clampSplitSize(
        current.streamWidth,
        MIN_STREAM_WIDTH,
        Math.max(
          MIN_STREAM_WIDTH,
          bounds.width - DIVIDER_SIZE - MIN_TRACE_WIDTH,
        ),
      );
      if (streamWidth === current.streamWidth) return;
      updateLayout({streamWidth}, true);
    };
    const observer = new ResizeObserver(normalizeLayout);
    observer.observe(root);
    normalizeLayout();
    return () => observer.disconnect();
  }, []);

  const style: LogLayoutStyle = layout.streamWidth
    ? {'--log-stream-width': `${layout.streamWidth}px`}
    : {};

  function getColumnBounds(
    event: React.PointerEvent<HTMLButtonElement>,
  ): SplitResizeBounds | null {
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const streamBounds = streamRef.current?.getBoundingClientRect();
    if (!rootBounds || !streamBounds) return null;
    return {
      startCoordinate: event.clientX,
      startSize: streamBounds.width,
      minimum: MIN_STREAM_WIDTH,
      maximum: Math.max(
        MIN_STREAM_WIDTH,
        rootBounds.width - DIVIDER_SIZE - MIN_TRACE_WIDTH,
      ),
    };
  }

  function updateLayout(next: LogLayoutSize, persist = false) {
    layoutRef.current = next;
    setLayout(next);
    if (persist) writeLayout(next);
  }

  function resetLayout() {
    updateLayout({});
    removeStoredValue(STORAGE_KEY);
  }

  return (
    <div className="logWorkbench" ref={rootRef} style={style}>
      <div className="logStreamSlot" ref={streamRef}>
        {stream}
      </div>
      <SplitDivider
        orientation="vertical"
        className="logColumnDivider"
        label={resizeColumnLabel}
        onResizeStart={getColumnBounds}
        onResize={streamWidth => updateLayout({streamWidth})}
        onResizeEnd={() => writeLayout(layoutRef.current)}
        onReset={resetLayout}
      />
      <div className="logTraceSlot">{trace}</div>
    </div>
  );
}

function readLayout(): LogLayoutSize {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as LogLayoutSize;
    return validDimension(parsed.streamWidth)
      ? {streamWidth: parsed.streamWidth}
      : {};
  } catch {
    return {};
  }
}

function writeLayout(layout: LogLayoutSize) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // The log workspace remains usable when browser storage is unavailable.
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
    for (const key of ['logs-stream', 'logs-trace']) {
      removeStoredValue(`${prefix}${key}`);
    }
  }
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
