import { describe, expect, it } from 'vitest';
import {
  availableAnchor,
  borderPoint,
  closestBorder,
  closestRoutePoint,
  exitLabelHeight,
  layoutMapRoutes,
  type MapRoom,
  type MapRoute,
} from './mapLayout';

function expectClear(rooms: MapRoom[], routes: MapRoute[]) {
  const positions = layoutMapRoutes(rooms, routes);
  const occupied = rooms.map((room) => ({ ...room }));
  for (const route of routes) {
    const position = positions.get(route.id)!.label;
    expect(position).toBeDefined();
    const rect = {
      x: position.x - route.labelWidth / 2,
      y: position.y - exitLabelHeight / 2,
      width: route.labelWidth,
      height: exitLabelHeight,
    };
    for (const other of occupied) {
      const overlaps =
        rect.x < other.x + other.width &&
        rect.x + rect.width > other.x &&
        rect.y < other.y + other.height &&
        rect.y + rect.height > other.y;
      expect(overlaps, `Exit ${route.id} overlaps another label or room`).toBe(false);
    }
    occupied.push({ id: route.id, ...rect });
  }
}

describe('map exit label placement', () => {
  it('keeps parallel, return, and self-loop labels apart for horizontal and vertical rooms', () => {
    for (const target of [
      { x: 400, y: 0 },
      { x: 0, y: 300 },
      { x: -300, y: -180 },
    ]) {
      const rooms = [
        { id: 'a', x: 0, y: 0, width: 210, height: 108 },
        { id: 'b', ...target, width: 260, height: 80 },
      ];
      const routes = Array.from({ length: 12 }, (_, i) => ({
        id: `exit-${i}`,
        source: i % 2 ? 'b' : 'a',
        target: i % 3 ? 'b' : 'a',
        labelWidth: i === 3 ? 500 : 90,
      }));
      expectClear(rooms, routes);
    }
  });

  it('separates labels on crossing connections between different pairs of rooms', () => {
    const rooms = [
      { id: 'a', x: 0, y: 0, width: 210, height: 80 },
      { id: 'b', x: 500, y: 300, width: 210, height: 80 },
      { id: 'c', x: 0, y: 300, width: 210, height: 80 },
      { id: 'd', x: 500, y: 0, width: 210, height: 80 },
    ];
    expectClear(rooms, [
      { id: 'east', source: 'a', target: 'b', labelWidth: 150 },
      { id: 'west', source: 'c', target: 'd', labelWidth: 200 },
    ]);
  });

  it('keeps placement stable when content is reordered and ignores missing destinations', () => {
    const rooms = [
      { id: 'a', x: 0, y: 0, width: 210, height: 80 },
      { id: 'b', x: 400, y: 0, width: 210, height: 80 },
    ];
    const routes = [
      { id: 'east', source: 'a', target: 'b', labelWidth: 90 },
      { id: 'west', source: 'b', target: 'a', labelWidth: 90 },
      { id: 'missing', source: 'a', target: 'deleted', labelWidth: 90 },
    ];
    const positions = layoutMapRoutes(rooms, routes);
    expect(positions.has('missing')).toBe(false);
    expect(layoutMapRoutes([...rooms].reverse(), [...routes].reverse())).toEqual(positions);
  });

  it('snaps to all four borders and keeps several exit points separate', () => {
    const room = { id: 'a', x: 100, y: 100, width: 210, height: 100 };
    for (const [point, side] of [
      [{ x: 150, y: 105 }, 'top'],
      [{ x: 305, y: 140 }, 'right'],
      [{ x: 180, y: 195 }, 'bottom'],
      [{ x: 105, y: 160 }, 'left'],
    ] as const)
      expect(closestBorder(room, point).side).toBe(side);
    const first = closestBorder(room, { x: 305, y: 140 });
    const second = availableAnchor(room, first, [first]);
    const a = borderPoint(room, first);
    const b = borderPoint(room, second);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(16);
    expect(borderPoint({ ...room, x: 200, y: 300 }, first)).toEqual({ x: a.x + 100, y: a.y + 200 });
  });

  it('routes both directions and self loops outside room interiors for every border pair', () => {
    const rooms = [
      { id: 'a', x: 0, y: 0, width: 210, height: 108 },
      { id: 'b', x: 450, y: 80, width: 210, height: 80 },
      { id: 'obstacle', x: 280, y: 40, width: 100, height: 140 },
    ];
    for (const source of ['top', 'right', 'bottom', 'left'] as const) {
      for (const target of ['top', 'right', 'bottom', 'left'] as const) {
        for (const destination of ['a', 'b']) {
          const drawn = layoutMapRoutes(rooms, [
            {
              id: 'route',
              source: 'a',
              target: destination,
              labelWidth: 90,
              layout: {
                source: { side: source, offset: 0.3 },
                target: { side: target, offset: 0.7 },
                label_offset: null,
              },
            },
          ]).get('route')!;
          expect(drawn.points[0]).toEqual(drawn.source.point);
          expect(drawn.points.at(-1)).toEqual(drawn.target.point);
          for (let i = 1; i < drawn.points.length; i++) {
            const a = drawn.points[i - 1];
            const b = drawn.points[i];
            expect(a.x === b.x || a.y === b.y).toBe(true);
            for (let step = 1; step < 20; step++) {
              const x = a.x + ((b.x - a.x) * step) / 20;
              const y = a.y + ((b.y - a.y) * step) / 20;
              expect(
                rooms.some((r) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height),
                `${source} to ${target} intersects a room`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it('moves labels independently and finds the closest point for the leader line', () => {
    const rooms = [
      { id: 'a', x: 0, y: 0, width: 210, height: 80 },
      { id: 'b', x: 450, y: 0, width: 210, height: 80 },
    ];
    const route = { id: 'east', source: 'a', target: 'b', labelWidth: 90 };
    const before = layoutMapRoutes(rooms, [route]).get('east')!;
    const after = layoutMapRoutes(rooms, [
      { ...route, layout: { source: null, target: null, label_offset: { x: 0, y: -60 } } },
    ]).get('east')!;
    expect(after.path).toBe(before.path);
    expect(after.label.y).toBe(before.label.y - 60);
    expect(closestRoutePoint(after.points, after.label)).toEqual(before.midpoint);
    expect(
      closestRoutePoint(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        { x: 120, y: 75 },
      ),
    ).toEqual({ x: 100, y: 75 });
  });

  it('keeps arrows between closely spaced rooms from doubling back', () => {
    const drawn = layoutMapRoutes(
      [
        { id: 'a', x: 0, y: 0, width: 210, height: 80 },
        { id: 'b', x: 225, y: 0, width: 210, height: 80 },
      ],
      [{ id: 'east', source: 'a', target: 'b', labelWidth: 40 }],
    ).get('east')!;
    expect(drawn.points.every((point) => point.x >= 210 && point.x <= 225)).toBe(true);
    expect(
      drawn.points.every((point, index) => !index || point.x >= drawn.points[index - 1].x),
    ).toBe(true);
  });
});
