import { useLayoutEffect, useRef } from 'react';

/** Compact drawers stop above the rendered dock, including its live status panels. */
export function useDockLayout(active: boolean, collapsed: boolean, focused: boolean) {
  const workspace = useRef<HTMLElement>(null);
  const dock = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = workspace.current;
    const panel = dock.current;
    if (!active || !frame || !panel) return;
    const update = () => {
      const divider = panel.previousElementSibling;
      const gap = divider?.matches('.resize-handle.horizontal')
        ? divider.getBoundingClientRect().height
        : 0;
      frame.style.setProperty('--compact-dock', `${panel.getBoundingClientRect().height + gap}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [active, collapsed, focused]);
  return { workspace, dock };
}
