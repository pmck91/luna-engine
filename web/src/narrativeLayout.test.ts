import { expect, it } from 'vitest';
import { layoutMapRoutes, type MapRoom, type MapRoute, type RoutedExit } from './mapLayout';
import { placeConnectionLabels } from './narrativeLayout';
function clear(rooms: MapRoom[], geometry: Map<string, RoutedExit>) {
  const labels = [...geometry.values()].map((route) => ({
    x: route.label.x - 41,
    y: route.label.y - 11,
    width: 82,
    height: 22,
  }));
  const overlaps = (a: MapRoom | (typeof labels)[number], b: MapRoom | (typeof labels)[number]) =>
    a.x < b.x + b.width - 1 &&
    a.x + a.width > b.x + 1 &&
    a.y < b.y + b.height - 1 &&
    a.y + a.height > b.y + 1;
  labels.forEach((label, index) => {
    expect(
      rooms.some((room) => overlaps(label, room)),
      `label ${index} overlaps a card`,
    ).toBe(false);
    expect(
      labels.slice(index + 1).some((other) => overlaps(label, other)),
      `label ${index} overlaps another label`,
    ).toBe(false);
  });
  for (const [id, route] of geometry)
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      for (let step = 1; step < 30; step++) {
        const point = { x: a.x + ((b.x - a.x) * step) / 30, y: a.y + ((b.y - a.y) * step) / 30 };
        expect(
          rooms.some(
            (room) =>
              point.x > room.x + 1 &&
              point.x < room.x + room.width - 1 &&
              point.y > room.y + 1 &&
              point.y < room.y + room.height - 1,
          ),
          `${id} crosses a card`,
        ).toBe(false);
      }
    }
}
it('routes a dense dialogue graph with loops, reciprocal paths and merges before and after moving a card', () => {
  const rooms: MapRoom[] = Array.from({ length: 14 }, (_, i) => ({
    id: `node-${i}`,
    x: (i % 4) * 400,
    y: Math.floor(i / 4) * 360,
    width: 215,
    height: 150,
  }));
  const routes: MapRoute[] = rooms.flatMap((room, i) =>
    [0, 1, 4, 13].map((delta) => ({
      id: `${i}-${delta}`,
      source: room.id,
      target: rooms[(i + delta) % rooms.length].id,
      labelWidth: 82,
    })),
  );
  for (const moved of [false, true]) {
    if (moved) {
      rooms[5].x += 65;
      rooms[5].y -= 40;
    }
    const geometry = layoutMapRoutes(rooms, routes);
    placeConnectionLabels(rooms, geometry);
    expect(geometry.size).toBe(56);
    clear(rooms, geometry);
  }
});
it('reserves manual labels before placing every automatic label, regardless of authored order', () => {
  const rooms: MapRoom[] = [
    { id: 'a', x: 0, y: 0, width: 215, height: 150 },
    { id: 'b', x: 500, y: 0, width: 215, height: 150 },
  ];
  const routes: MapRoute[] = [
    { id: 'auto-first', source: 'a', target: 'b', labelWidth: 82 },
    {
      id: 'manual-last',
      source: 'b',
      target: 'a',
      labelWidth: 82,
      layout: { source: null, target: null, label_offset: { x: 0, y: -70 } },
    },
  ];
  const geometry = layoutMapRoutes(rooms, routes);
  const manual = { ...geometry.get('manual-last')!.label };
  placeConnectionLabels(rooms, geometry, new Set(['manual-last']));
  expect(geometry.get('manual-last')!.label).toEqual(manual);
  clear(rooms, geometry);
});
