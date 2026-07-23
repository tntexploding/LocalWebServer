export interface ActionLayoutSize {
  registryWidth?: number;
  inspectorHeight?: number;
}

export interface SplitResizeBounds {
  startCoordinate: number;
  startSize: number;
  minimum: number;
  maximum: number;
}

export function calculateSplitSize(
  bounds: SplitResizeBounds,
  coordinate: number,
) {
  return clampSplitSize(
    bounds.startSize + coordinate - bounds.startCoordinate,
    bounds.minimum,
    bounds.maximum,
  );
}

export function clampSplitSize(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function parseActionLayout(value: string | null): ActionLayoutSize {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as ActionLayoutSize;
    return {
      ...(validDimension(parsed.registryWidth)
        ? {registryWidth: parsed.registryWidth}
        : {}),
      ...(validDimension(parsed.inspectorHeight)
        ? {inspectorHeight: parsed.inspectorHeight}
        : {}),
    };
  } catch {
    return {};
  }
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
