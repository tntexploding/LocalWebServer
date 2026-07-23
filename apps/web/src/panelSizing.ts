export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelResizeBounds extends PanelSize {
  clientX: number;
  clientY: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
}

const PANEL_SIZE_NAMESPACE = 'las-panel-size:v2:';
const LEGACY_PANEL_SIZE_NAMESPACE = 'las-panel-size:';

export function calculatePanelSize(
  bounds: PanelResizeBounds,
  clientX: number,
  clientY: number,
): PanelSize {
  return {
    width: clamp(
      bounds.width + clientX - bounds.clientX,
      bounds.minWidth,
      bounds.maxWidth,
    ),
    height: Math.max(
      bounds.minHeight,
      bounds.height + clientY - bounds.clientY,
    ),
  };
}

export function panelSizeStorageKey(storageKey: string) {
  return `${PANEL_SIZE_NAMESPACE}${storageKey}`;
}

export function legacyPanelSizeStorageKey(storageKey: string) {
  return `${LEGACY_PANEL_SIZE_NAMESPACE}${storageKey}`;
}

export function parsePanelSize(value: string | null): PanelSize | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PanelSize>;
    if (
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number' ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height) ||
      parsed.width < 240 ||
      parsed.height < 120
    ) {
      return null;
    }
    return {width: parsed.width, height: parsed.height};
  } catch {
    return null;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
