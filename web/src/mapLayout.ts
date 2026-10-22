import type { BorderAnchor, BorderSide, Point, RouteLayout } from './contracts';

export type MapRoom = Point & { id: string; width: number; height: number };
export type MapRoute = {
  id: string;
  source: string;
  target: string;
  labelWidth: number;
  layout?: RouteLayout;
};
export type Endpoint = { anchor: BorderAnchor; point: Point; room: MapRoom };
export type RoutedExit = {
  source: Endpoint;
  target: Endpoint;
  points: Point[];
  path: string;
  midpoint: Point;
  label: Point;
};
type Rect = Point & { width: number; height: number };
type Label = { id: string; labelWidth: number; preferred: Point; manual: boolean };

export const exitLabelHeight = 22;
const gap = 8;
const sides: BorderSide[] = ['top', 'right', 'bottom', 'left'];
const normals: Record<BorderSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const sideLength = (room: MapRoom, side: BorderSide) =>
  side === 'top' || side === 'bottom' ? room.width : room.height;

export function borderPoint(room: MapRoom, anchor: BorderAnchor): Point {
  const margin = Math.min(0.2, 10 / sideLength(room, anchor.side));
  const offset = Math.max(margin, Math.min(1 - margin, anchor.offset));
  switch (anchor.side) {
    case 'top':
      return { x: room.x + room.width * offset, y: room.y };
    case 'right':
      return { x: room.x + room.width, y: room.y + room.height * offset };
    case 'bottom':
      return { x: room.x + room.width * offset, y: room.y + room.height };
    case 'left':
      return { x: room.x, y: room.y + room.height * offset };
  }
}

export function closestBorder(room: MapRoom, point: Point): BorderAnchor {
  return sides
    .map((side) => {
      const horizontal = side === 'top' || side === 'bottom';
      const offset = horizontal
        ? (point.x - room.x) / room.width
        : (point.y - room.y) / room.height;
      const position = borderPoint(room, { side, offset });
      return {
        side,
        offset: horizontal
          ? (position.x - room.x) / room.width
          : (position.y - room.y) / room.height,
      };
    })
    .sort(
      (a, b) => distance(borderPoint(room, a), point) - distance(borderPoint(room, b), point),
    )[0];
}

// Keep each exit's endpoint usable even when several exits share a room border.
export function availableAnchor(
  room: MapRoom,
  preferred: BorderAnchor,
  occupied: BorderAnchor[],
): BorderAnchor {
  const desired = borderPoint(room, preferred);
  const points = occupied.map((anchor) => borderPoint(room, anchor));
  const candidates = sides.flatMap((side) => {
    const size = sideLength(room, side);
    const projected =
      side === 'top' || side === 'bottom'
        ? (desired.x - room.x) / room.width
        : (desired.y - room.y) / room.height;
    return [
      projected,
      10 / size,
      1 - 10 / size,
      ...occupied
        .filter((anchor) => anchor.side === side)
        .flatMap((anchor) => [anchor.offset - 18 / size, anchor.offset + 18 / size]),
    ].map((offset) => closestBorder(room, borderPoint(room, { side, offset })));
  });
  return (
    candidates
      .sort(
        (a, b) => distance(borderPoint(room, a), desired) - distance(borderPoint(room, b), desired),
      )
      .find((anchor) =>
        points.every((point) => distance(borderPoint(room, anchor), point) >= 16),
      ) ?? closestBorder(room, desired)
  );
}

function facingAnchor(room: MapRoom, other: MapRoom, end: 'source' | 'target'): BorderAnchor {
  if (room.id === other.id)
    return end === 'source' ? { side: 'right', offset: 0.35 } : { side: 'top', offset: 0.7 };
  const dx = other.x + other.width / 2 - room.x - room.width / 2;
  const dy = other.y + other.height / 2 - room.y - room.height / 2;
  return {
    side:
      Math.abs(dx) / room.width >= Math.abs(dy) / room.height
        ? dx >= 0
          ? 'right'
          : 'left'
        : dy >= 0
          ? 'bottom'
          : 'top',
    offset: 0.5,
  };
}

function segmentClear(a: Point, b: Point, obstacles: Rect[]): boolean {
  return obstacles.every((r) =>
    a.x === b.x
      ? a.x <= r.x ||
        a.x >= r.x + r.width ||
        Math.max(a.y, b.y) <= r.y ||
        Math.min(a.y, b.y) >= r.y + r.height
      : a.y <= r.y ||
        a.y >= r.y + r.height ||
        Math.max(a.x, b.x) <= r.x ||
        Math.min(a.x, b.x) >= r.x + r.width,
  );
}

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1)!, point) < 0.001) continue;
    while (result.length > 1) {
      const a = result.at(-2)!;
      const b = result.at(-1)!;
      if (
        ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)) &&
        (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) >= 0
      )
        result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}
const length = (points: Point[]) =>
  points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);

// Use a visibility grid only when simpler routes cannot pass the location cards.
function gridRoute(source: Point, target: Point, obstacles: Rect[]): Point[] | null {
  const xs = [
    ...new Set([source.x, target.x, ...obstacles.flatMap((r) => [r.x, r.x + r.width])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([source.y, target.y, ...obstacles.flatMap((r) => [r.y, r.y + r.height])]),
  ].sort((a, b) => a - b);
  const point = (id: number) => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const id = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  const start = id(source);
  const finish = id(target);
  const open = new Set([start]);
  const costs = new Map([[start, 0]]);
  const previous = new Map<number, number>();
  while (open.size) {
    let current = -1;
    let best = Infinity;
    for (const candidate of open) {
      const score = costs.get(candidate)! + distance(point(candidate), target);
      if (score < best) {
        best = score;
        current = candidate;
      }
    }
    if (current === finish) {
      const path = [target];
      while (previous.has(current)) {
        current = previous.get(current)!;
        path.unshift(point(current));
      }
      return simplify(path);
    }
    open.delete(current);
    const column = current % xs.length;
    const row = Math.floor(current / xs.length);
    const neighbors = [
      ...(column ? [current - 1] : []),
      ...(column < xs.length - 1 ? [current + 1] : []),
      ...(row ? [current - xs.length] : []),
      ...(row < ys.length - 1 ? [current + xs.length] : []),
    ];
    for (const neighbor of neighbors) {
      if (!segmentClear(point(current), point(neighbor), obstacles)) continue;
      const cost = costs.get(current)! + distance(point(current), point(neighbor));
      if (cost >= (costs.get(neighbor) ?? Infinity)) continue;
      costs.set(neighbor, cost);
      previous.set(neighbor, current);
      open.add(neighbor);
    }
  }
  return null;
}

function routePoints(source: Endpoint, target: Endpoint, rooms: MapRoom[]): Point[] {
  const clearance = (end: Endpoint) => {
    const normal = normals[end.anchor.side];
    let amount = 24;
    for (const room of rooms) {
      if (room.id === end.room.id) continue;
      if (normal.x && end.point.y >= room.y && end.point.y <= room.y + room.height) {
        const distance = normal.x > 0 ? room.x - end.point.x : end.point.x - room.x - room.width;
        if (distance >= 0) amount = Math.min(amount, distance / 3);
      }
      if (normal.y && end.point.x >= room.x && end.point.x <= room.x + room.width) {
        const distance = normal.y > 0 ? room.y - end.point.y : end.point.y - room.y - room.height;
        if (distance >= 0) amount = Math.min(amount, distance / 3);
      }
    }
    return Math.max(0.5, amount);
  };
  const sourceClearance = clearance(source);
  const targetClearance = clearance(target);
  const stub = (end: Endpoint, amount: number) => ({
    x: end.point.x + normals[end.anchor.side].x * amount,
    y: end.point.y + normals[end.anchor.side].y * amount,
  });
  const a = stub(source, sourceClearance);
  const b = stub(target, targetClearance);
  const padding = Math.min(gap, sourceClearance / 2, targetClearance / 2);
  const obstacles = rooms.map((room) => ({
    x: room.x - padding,
    y: room.y - padding,
    width: room.width + padding * 2,
    height: room.height + padding * 2,
  }));
  const candidates: Point[][] = [
    ...(a.x === b.x || a.y === b.y ? [[a, b]] : []),
    [a, { x: b.x, y: a.y }, b],
    [a, { x: a.x, y: b.y }, b],
    ...[(a.x + b.x) / 2, ...obstacles.flatMap((r) => [r.x, r.x + r.width])].map((x) => [
      a,
      { x, y: a.y },
      { x, y: b.y },
      b,
    ]),
    ...[(a.y + b.y) / 2, ...obstacles.flatMap((r) => [r.y, r.y + r.height])].map((y) => [
      a,
      { x: a.x, y },
      { x: b.x, y },
      b,
    ]),
  ];
  const clear = candidates
    .map(simplify)
    .filter((points) => points.slice(1).every((p, i) => segmentClear(points[i], p, obstacles)))
    .sort((a, b) => length(a) + a.length * 12 - length(b) - b.length * 12);
  const path = clear[0] ?? gridRoute(a, b, obstacles) ?? [a, { x: b.x, y: a.y }, b];
  return simplify([source.point, ...path, target.point]);
}

export function closestRoutePoint(points: Point[], point: Point): Point {
  let closest = points[0];
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const d = distance(point, candidate);
    if (d < best) {
      best = d;
      closest = candidate;
    }
  }
  return closest;
}

function midpoint(points: Point[]): Point {
  let remaining = length(points) / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segment = distance(a, b);
    if (remaining <= segment) {
      const t = segment ? remaining / segment : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segment;
  }
  return points[0];
}

// Labels use their own positions and never change the shape of an arrow.
export function layoutExitLabels(rooms: MapRoom[], labels: Label[]): Map<string, Point> {
  const occupied: Rect[] = [...rooms];
  const positions = new Map<string, Point>();
  for (const label of [...labels].sort(
    (a, b) => Number(b.manual) - Number(a.manual) || a.id.localeCompare(b.id),
  )) {
    const { x, y: preferredY } = label.preferred;
    const halfHeight = exitLabelHeight / 2;
    const intervals = occupied
      .filter(
        (r) =>
          x + label.labelWidth / 2 + gap > r.x && x - label.labelWidth / 2 - gap < r.x + r.width,
      )
      .map((r) => [r.y - halfHeight - gap, r.y + r.height + halfHeight + gap])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] < last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    const blocked = merged.find(([top, bottom]) => preferredY > top && preferredY < bottom);
    const y = blocked
      ? preferredY - blocked[0] <= blocked[1] - preferredY
        ? blocked[0]
        : blocked[1]
      : preferredY;
    positions.set(label.id, { x, y });
    occupied.push({
      x: x - label.labelWidth / 2,
      y: y - halfHeight,
      width: label.labelWidth,
      height: exitLabelHeight,
    });
  }
  return positions;
}

export function layoutMapRoutes(rooms: MapRoom[], routes: MapRoute[]): Map<string, RoutedExit> {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const occupied = new Map<string, BorderAnchor[]>();
  const endpoints = routes
    .flatMap((route) =>
      (['source', 'target'] as const).map((end) => ({
        route,
        end,
        room: byId.get(route[end]),
        other: byId.get(route[end === 'source' ? 'target' : 'source']),
        saved: route.layout?.[end],
      })),
    )
    .filter((end) => end.room && end.other)
    .sort(
      (a, b) =>
        Number(!!b.saved) - Number(!!a.saved) ||
        a.route.id.localeCompare(b.route.id) ||
        a.end.localeCompare(b.end),
    );
  const anchors = new Map<string, Endpoint>();
  for (const endpoint of endpoints) {
    const room = endpoint.room!;
    const used = occupied.get(room.id) ?? [];
    const anchor = endpoint.saved
      ? closestBorder(room, borderPoint(room, endpoint.saved))
      : availableAnchor(room, facingAnchor(room, endpoint.other!, endpoint.end), used);
    used.push(anchor);
    occupied.set(room.id, used);
    anchors.set(`${endpoint.route.id}:${endpoint.end}`, {
      anchor,
      point: borderPoint(room, anchor),
      room,
    });
  }
  const result = new Map<string, RoutedExit>();
  const labels: Label[] = [];
  for (const route of routes) {
    const source = anchors.get(`${route.id}:source`);
    const target = anchors.get(`${route.id}:target`);
    if (!source || !target) continue;
    const points = routePoints(source, target, rooms);
    const centre = midpoint(points);
    result.set(route.id, {
      source,
      target,
      points,
      path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x},${p.y}`).join(' '),
      midpoint: centre,
      label: centre,
    });
    labels.push({
      id: route.id,
      labelWidth: route.labelWidth,
      manual: !!route.layout?.label_offset,
      preferred: {
        x: centre.x + (route.layout?.label_offset?.x ?? 0),
        y: centre.y + (route.layout?.label_offset?.y ?? 0),
      },
    });
  }
  for (const [id, position] of layoutExitLabels(rooms, labels)) result.get(id)!.label = position;
  return result;
}
