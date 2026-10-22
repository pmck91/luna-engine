import { describe, expect, it } from 'vitest';
import { exitLabelHeight, layoutExitLabels, type MapRoom, type MapRoute } from './mapLayout';

function expectClear(rooms: MapRoom[], routes: MapRoute[]) {
  const positions = layoutExitLabels(rooms, routes);
  const occupied = rooms.map((room) => ({ ...room }));
  for (const route of routes) {
    const position = positions.get(route.id)!;
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
    const positions = layoutExitLabels(rooms, routes);
    expect(positions.has('missing')).toBe(false);
    expect(layoutExitLabels([...rooms].reverse(), [...routes].reverse())).toEqual(positions);
  });
});
