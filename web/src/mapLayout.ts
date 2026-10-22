import type { Point } from './contracts';

export type MapRoom = Point & { id: string; width: number; height: number };
export type MapRoute = { id: string; source: string; target: string; labelWidth: number };
type Rect = Point & { width: number; height: number };

export const exitLabelHeight = 22;
const gap = 8;

// Place labels in world coordinates so the spacing survives both panning and zooming.
export function layoutExitLabels(rooms: MapRoom[], routes: MapRoute[]): Map<string, Point> {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const occupied: Rect[] = [...rooms];
  const labels = new Map<string, Point>();
  for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = byId.get(route.source);
    const target = byId.get(route.target);
    if (!source || !target) continue;
    const x = (source.x + source.width + target.x) / 2;
    const preferredY =
      source === target
        ? source.y - exitLabelHeight - gap
        : (source.y + source.height / 2 + target.y + target.height / 2) / 2;
    const halfHeight = exitLabelHeight / 2;
    // Each horizontally overlapping rectangle forbids an interval of label centres.
    const intervals = occupied
      .filter(
        (rect) =>
          x + route.labelWidth / 2 + gap > rect.x &&
          x - route.labelWidth / 2 - gap < rect.x + rect.width,
      )
      .map((rect) => [rect.y - halfHeight - gap, rect.y + rect.height + halfHeight + gap])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] < last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    let y = preferredY;
    const blocked = merged.find(([top, bottom]) => y > top && y < bottom);
    if (blocked) {
      const [top, bottom] = blocked;
      y = preferredY - top <= bottom - preferredY ? top : bottom;
    }
    labels.set(route.id, { x, y });
    occupied.push({
      x: x - route.labelWidth / 2,
      y: y - halfHeight,
      width: route.labelWidth,
      height: exitLabelHeight,
    });
  }
  return labels;
}

// Pass each route through its label, giving parallel and return exits distinct curves.
export function exitPath(source: Point, target: Point, label: Point, loop: boolean): string {
  const distance = target.x - source.x;
  const bend = Math.max(40, distance >= 0 ? distance / 2 : 6.25 * Math.sqrt(-distance));
  if (loop) {
    return (
      `M ${source.x},${source.y} ` +
      `C ${source.x + bend},${source.y} ${source.x + bend},${label.y} ${label.x},${label.y} ` +
      `C ${target.x - bend},${label.y} ${target.x - bend},${target.y} ${target.x},${target.y}`
    );
  }
  const offsetX = (label.x - (source.x + target.x) / 2) * (4 / 3);
  const offsetY = (label.y - (source.y + target.y) / 2) * (4 / 3);
  return (
    `M ${source.x},${source.y} ` +
    `C ${source.x + bend + offsetX},${source.y + offsetY} ` +
    `${target.x - bend + offsetX},${target.y + offsetY} ${target.x},${target.y}`
  );
}
