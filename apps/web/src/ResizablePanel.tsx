import React from 'react';
import {MoveDiagonal2, RotateCcw} from 'lucide-react';
import {translate, type Locale} from './i18n';
import {
  calculatePanelSize,
  legacyPanelSizeStorageKey,
  panelSizeStorageKey,
  parsePanelSize,
  type PanelResizeBounds,
  type PanelSize,
} from './panelSizing';

interface PanelResizeSession extends PanelResizeBounds {
  pointerId: number;
}

export const LocaleContext = React.createContext<Locale>('zh-CN');

/** A content panel whose user-selected dimensions persist locally. */
export function ResizablePanel({
  storageKey,
  className,
  children,
  resetLabel,
}: React.PropsWithChildren<{
  storageKey: string;
  className: string;
  resetLabel: string;
}>) {
  const panelRef = React.useRef<HTMLElement>(null);
  const resizeSession = React.useRef<PanelResizeSession | null>(null);
  const locale = React.useContext(LocaleContext);
  const resizeLabel = translate(locale, 'common.resizePanel');
  const [isResizing, setIsResizing] = React.useState(false);
  const [size, setSize] = React.useState<PanelSize | null>(() =>
    readPanelSize(storageKey),
  );

  React.useEffect(() => {
    resizeSession.current = null;
    setIsResizing(false);
    setSize(readPanelSize(storageKey));
    removeStoredPanelSize(legacyPanelSizeStorageKey(storageKey));
  }, [storageKey]);

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const computed = window.getComputedStyle(panel);
    const boundary =
      panel.closest<HTMLElement>('.content') ?? panel.parentElement;
    const boundaryRight =
      boundary?.getBoundingClientRect().right ?? window.innerWidth;
    const minWidth = cssPixels(computed.minWidth, 240);
    const maxWidth = cssPixels(computed.maxWidth, Number.POSITIVE_INFINITY);
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeSession.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      width: rect.width,
      height: rect.height,
      minWidth,
      minHeight: cssPixels(computed.minHeight, 120),
      maxWidth: Math.max(
        minWidth,
        Math.min(maxWidth, boundaryRight - rect.left),
      ),
    };
    setIsResizing(true);
  }

  function updateResize(event: React.PointerEvent<HTMLButtonElement>) {
    const session = resizeSession.current;
    const panel = panelRef.current;
    if (!session || !panel || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const {width, height} = calculatePanelSize(
      session,
      event.clientX,
      event.clientY,
    );
    panel.style.width = `${Math.round(width)}px`;
    panel.style.height = `${Math.round(height)}px`;
  }

  function finishResize(event: React.PointerEvent<HTMLButtonElement>) {
    const session = resizeSession.current;
    const panel = panelRef.current;
    if (!session || !panel || session.pointerId !== event.pointerId) return;
    resizeSession.current = null;
    setIsResizing(false);
    const rect = panel.getBoundingClientRect();
    const next = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    setSize(next);
    writePanelSize(storageKey, next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetSize() {
    resizeSession.current = null;
    setIsResizing(false);
    removeStoredPanelSize(panelSizeStorageKey(storageKey));
    removeStoredPanelSize(legacyPanelSizeStorageKey(storageKey));
    panelRef.current?.style.removeProperty('width');
    panelRef.current?.style.removeProperty('height');
    setSize(null);
  }

  return (
    <section
      ref={panelRef}
      className={`resizablePanel ${className}`}
      data-panel-key={storageKey}
      data-resizing={isResizing ? 'true' : 'false'}
      data-user-sized={size ? 'true' : 'false'}
      style={size ?? undefined}
    >
      {children}
      {size && (
        <button
          className="panelResizeReset"
          onPointerDown={event => event.stopPropagation()}
          onClick={resetSize}
          title={resetLabel}
        >
          <RotateCcw size={13} />
        </button>
      )}
      <button
        type="button"
        className="panelResizeHandle"
        onPointerDown={beginResize}
        onPointerMove={updateResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
        onDoubleClick={resetSize}
        title={resizeLabel}
        aria-label={resizeLabel}
      >
        <MoveDiagonal2 size={14} />
      </button>
    </section>
  );
}

function readPanelSize(storageKey: string): PanelSize | null {
  try {
    return parsePanelSize(
      localStorage.getItem(panelSizeStorageKey(storageKey)),
    );
  } catch {
    return null;
  }
}

function writePanelSize(storageKey: string, size: PanelSize) {
  try {
    localStorage.setItem(panelSizeStorageKey(storageKey), JSON.stringify(size));
  } catch {
    // Resizing remains available when browser storage is disabled.
  }
}

function removeStoredPanelSize(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function cssPixels(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
