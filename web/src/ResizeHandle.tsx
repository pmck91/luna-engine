import { useRef } from 'react';
export default function ResizeHandle({
  label,
  value,
  min,
  max,
  orientation = 'vertical',
  reverse = false,
  change,
  reset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  orientation?: 'vertical' | 'horizontal';
  reverse?: boolean;
  change: (value: number) => void;
  reset: () => void;
}) {
  const drag = useRef<{ pointer: number; at: number; value: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));
  return (
    <div
      className={`resize-handle ${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      title={`${label} · Arrow keys resize · Home/End limits · double-click resets`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          at: orientation === 'vertical' ? event.clientX : event.clientY,
          value,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointer !== event.pointerId) return;
        change(
          clamp(
            current.value +
              ((orientation === 'vertical' ? event.clientX : event.clientY) - current.at) *
                (reverse ? -1 : 1),
          ),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        const previous = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
        const next = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
        if (![previous, next, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        change(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : clamp(
                  value +
                    (event.key === next ? 1 : -1) * (reverse ? -1 : 1) * (event.shiftKey ? 40 : 10),
                ),
        );
      }}
    />
  );
}
