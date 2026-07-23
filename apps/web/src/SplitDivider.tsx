import React from 'react';
import {GripHorizontal, GripVertical} from 'lucide-react';
import {calculateSplitSize, type SplitResizeBounds} from './splitSizing';

interface ResizeSession extends SplitResizeBounds {
  pointerId: number;
}

interface SplitDividerProps {
  orientation: 'horizontal' | 'vertical';
  className?: string;
  label: string;
  onResizeStart: (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => SplitResizeBounds | null;
  onResize: (size: number) => void;
  onResizeEnd: () => void;
  onReset?: () => void;
}

/** A fixed grid divider whose handle never participates in panel scrolling. */
export function SplitDivider({
  orientation,
  className = '',
  label,
  onResizeStart,
  onResize,
  onResizeEnd,
  onReset,
}: SplitDividerProps) {
  const sessionRef = React.useRef<ResizeSession | null>(null);
  const Icon = orientation === 'vertical' ? GripVertical : GripHorizontal;

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    const bounds = onResizeStart(event);
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {...bounds, pointerId: event.pointerId};
  }

  function updateResize(event: React.PointerEvent<HTMLButtonElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coordinate =
      orientation === 'vertical' ? event.clientX : event.clientY;
    onResize(Math.round(calculateSplitSize(session, coordinate)));
  }

  function finishResize(event: React.PointerEvent<HTMLButtonElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    sessionRef.current = null;
    onResizeEnd();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className={`splitDivider ${orientation} ${className}`.trim()}>
      <button
        type="button"
        className="splitDragHandle"
        aria-label={label}
        title={label}
        onPointerDown={beginResize}
        onPointerMove={updateResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
        onDoubleClick={onReset}
      >
        <Icon size={15} />
      </button>
    </div>
  );
}
