import { useEffect, useRef, useState } from 'react';

/** Navigation is intentionally independent of project undo and player command history. */
export function useNavigation<T>(
  scope: string,
  key: string,
  snapshot: T,
  restore: (snapshot: T) => void,
) {
  const timeline = useRef<{
    scope: string;
    entries: Array<{ key: string; snapshot: T }>;
    at: number;
    restoring: string | null;
  }>({ scope: '', entries: [], at: -1, restoring: null });
  const live = useRef({ key, snapshot, restore });
  live.current = { key, snapshot, restore };
  const [, render] = useState(0);
  useEffect(
    () => () => {
      const entry = timeline.current.entries.find((entry) => entry.key === key);
      if (entry) entry.snapshot = snapshot;
    },
    [key, snapshot],
  );
  useEffect(() => {
    const history = timeline.current;
    if (history.scope !== scope) {
      Object.assign(history, { scope, entries: [], at: -1, restoring: null });
    }
    if (!scope) return;
    if (history.restoring === key) history.restoring = null;
    else if (history.entries[history.at]?.key !== key) {
      history.entries.splice(history.at + 1);
      history.entries.push({ key, snapshot: live.current.snapshot });
      if (history.entries.length > 100) history.entries.shift();
      history.at = history.entries.length - 1;
    }
    if (history.entries[history.at]) history.entries[history.at].snapshot = live.current.snapshot;
    render((n) => n + 1);
  }, [scope, key]);
  const go = (direction: number) => {
    const history = timeline.current;
    const target = history.at + direction;
    if (target < 0 || target >= history.entries.length) return;
    history.entries[history.at].snapshot = live.current.snapshot;
    history.at = target;
    const entry = history.entries[target];
    history.restoring = entry.key;
    live.current.restore(entry.snapshot);
    render((n) => n + 1);
  };
  return {
    back: () => go(-1),
    forward: () => go(1),
    canBack: timeline.current.at > 0,
    canForward: timeline.current.at < timeline.current.entries.length - 1,
  };
}
