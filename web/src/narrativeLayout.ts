import type { MapRoom, RoutedExit } from './mapLayout';

// Prefer labels on a clear segment, so a displaced label's leader does not
// obscure a terminal card. Dense routes use clear off-line positions and leaders.
export function placeConnectionLabels(
  rooms: MapRoom[],
  geometry: Map<string, RoutedExit>,
  manual = new Set<string>(),
) {
  type Rect = { x: number; y: number; width: number; height: number };
  const occupied: Rect[] = [...geometry].flatMap(([id, route]) =>
    manual.has(id) ? [{ x: route.label.x - 41, y: route.label.y - 11, width: 82, height: 22 }] : [],
  );
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + 5 &&
    a.x + a.width + 5 > b.x &&
    a.y < b.y + b.height + 5 &&
    a.y + a.height + 5 > b.y;
  for (const [id, drawn] of geometry) {
    if (manual.has(id)) continue;
    const candidates = drawn.points
      .slice(1)
      .flatMap((end, index) => {
        const start = drawn.points[index];
        return [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92].map((fraction) => ({
          x: start.x + (end.x - start.x) * fraction,
          y: start.y + (end.y - start.y) * fraction,
        }));
      })
      .sort(
        (a, b) =>
          Math.hypot(a.x - drawn.midpoint.x, a.y - drawn.midpoint.y) -
          Math.hypot(b.x - drawn.midpoint.x, b.y - drawn.midpoint.y),
      );
    const clear = (candidate: { x: number; y: number }) => {
      const rect = { x: candidate.x - 41, y: candidate.y - 11, width: 82, height: 22 };
      return ![...rooms, ...occupied].some((obstacle) => overlaps(rect, obstacle));
    };
    let point = [...candidates, drawn.label].find(clear);
    // Dense merges can fill every segment. Move the label into nearby free
    // space and let the renderer draw its leader back to the closest segment.
    for (let radius = 1; !point && radius <= rooms.length + geometry.size + 2; radius++) {
      const ring: Array<{ x: number; y: number }> = [];
      for (let dx = -radius; dx <= radius; dx++)
        for (let dy = -radius; dy <= radius; dy++)
          if (Math.abs(dx) === radius || Math.abs(dy) === radius)
            ring.push({ x: drawn.label.x + dx * 92, y: drawn.label.y + dy * 32 });
      point = ring
        .sort(
          (a, b) =>
            Math.hypot(a.x - drawn.label.x, a.y - drawn.label.y) -
            Math.hypot(b.x - drawn.label.x, b.y - drawn.label.y),
        )
        .find(clear);
    }
    point ??= {
      x: drawn.label.x,
      y:
        Math.max(0, ...rooms.map((r) => r.y + r.height), ...occupied.map((r) => r.y + r.height)) +
        32,
    };
    drawn.label = point;
    occupied.push({ x: point.x - 41, y: point.y - 11, width: 82, height: 22 });
  }
}
