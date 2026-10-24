import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  useNodesInitialized,
  useUpdateNodeInternals,
  type Edge,
  type Viewport,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BorderAnchor, BorderSide, Point, Project, RouteLayout } from './contracts';
import { exit } from './model';
import {
  availableAnchor,
  borderPoint,
  closestBorder,
  closestRoutePoint,
  layoutMapRoutes,
  type MapRoom,
  type RoutedExit,
} from './mapLayout';

type End = 'source' | 'target';
type Edit = (f: (project: Project) => void) => void;
type Props = {
  project: Project;
  selected: string;
  select: (id: string) => void;
  edit: Edit;
  connecting: boolean;
  view?: Viewport;
  onViewChange?: (viewport: Viewport) => void;
};
type Port = { id: string; end: End; name: string; anchor: BorderAnchor; active: boolean };
type BeginPortDrag = (event: ReactPointerEvent, port: Port) => void;
type LocationNode = Node<
  {
    name: string;
    starting: boolean;
    objects: number;
    actions: number;
    ports: Port[];
    pending: boolean;
    beginPortDrag: BeginPortDrag;
  },
  'location'
>;
const positions: Record<BorderSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};
const emptyLayout = (): RouteLayout => ({ source: null, target: null, label_offset: null });

function Room({ id, data, selected }: NodeProps<LocationNode>) {
  const update = useUpdateNodeInternals();
  const signature = data.ports
    .map((p) => `${p.id}:${p.end}:${p.anchor.side}:${p.anchor.offset}`)
    .join('|');
  useEffect(() => {
    update(id);
  }, [id, signature, update]);
  return (
    <div
      className={`room-node ${selected ? 'selected' : ''} ${data.pending ? 'connection-source' : ''}`}
    >
      <strong>{data.name}</strong>
      <small>
        {data.actions} actions · {data.objects} objects
      </small>
      {data.starting && <span>★ Starting location</span>}
      {data.ports.map((port) => (
        <Handle
          key={`${port.id}:${port.end}`}
          id={`${port.id}:${port.end}`}
          type={port.end}
          position={positions[port.anchor.side]}
          isConnectable={false}
          className="exit-port"
          style={
            port.anchor.side === 'top' || port.anchor.side === 'bottom'
              ? { left: `${port.anchor.offset * 100}%` }
              : { top: `${port.anchor.offset * 100}%` }
          }
        >
          <button
            className={`exit-anchor nodrag nopan ${port.active ? 'active' : ''}`}
            aria-label={`Move ${port.end} anchor for ${port.name}`}
            title="Drag this exit point along the room border"
            onPointerDown={(event) => data.beginPortDrag(event, port)}
            onClick={(event) => event.stopPropagation()}
          />
        </Handle>
      ))}
    </div>
  );
}
const nodeTypes = { location: Room };
type RouteData = {
  geometry: RoutedExit;
  beginLabelDrag: (event: ReactPointerEvent) => void;
  select: () => void;
  resetLabel: () => void;
};
type ExitRoute = Edge<RouteData, 'exit'>;
function Route({ id, data, label, style, selected }: EdgeProps<ExitRoute>) {
  if (!data) return null;
  const { geometry } = data;
  const nearest = closestRoutePoint(geometry.points, geometry.label);
  const detached = Math.hypot(nearest.x - geometry.label.x, nearest.y - geometry.label.y) > 12;
  return (
    <>
      <defs>
        <marker
          id={`exit-arrow-${id}`}
          viewBox="0 0 10 10"
          markerWidth="10"
          markerHeight="10"
          refX="18"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
          overflow="visible"
        >
          <path d="M 0,0 L 10,5 L 0,10 Z" fill={style?.stroke ?? '#979fb5'} />
        </marker>
      </defs>
      {detached && (
        <path
          className="exit-label-leader"
          d={`M ${geometry.label.x},${geometry.label.y} L ${nearest.x},${nearest.y}`}
        />
      )}
      <BaseEdge
        id={id}
        path={geometry.path}
        markerEnd={`url(#exit-arrow-${id})`}
        style={{ ...style, strokeWidth: selected ? 2 : 1.4, strokeLinejoin: 'round' }}
      />
      <EdgeLabelRenderer>
        <button
          className={`exit-label nodrag nopan ${selected ? 'active' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${geometry.label.x}px, ${geometry.label.y}px)`,
          }}
          aria-label={`Edit exit ${label}`}
          data-exit-id={id}
          title="Drag to move this label. Double-click to reset its position."
          onPointerDown={data.beginLabelDrag}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail === 0) data.select();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            data.resetLabel();
          }}
        >
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { exit: Route };
type Pending = { roomId: string; anchor: BorderAnchor };
type Drag = { id: string; pointerId: number; start: Point; origin: Point; moved: boolean } & (
  | { kind: 'anchor'; end: End; roomId: string; value: BorderAnchor }
  | { kind: 'label'; midpoint: Point; value: Point }
);
type Preview = { id: string; end: End; anchor: BorderAnchor } | { id: string; label: Point };

function MapCanvas({ project: p, selected, select, edit, connecting, view, onViewChange }: Props) {
  const { screenToFlowPosition, fitBounds } = useReactFlow();
  const initialized = useNodesInitialized();
  const fitted = useRef(new Set<string>());
  const restoringView = useRef(!!view);
  const [baseNodes, setBaseNodes] = useState<LocationNode[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const dragging = useRef<Drag | null>(null);
  useEffect(() => {
    fitted.current = new Set();
    dragging.current = null;
    setPending(null);
    setPreview(null);
  }, [p.game.id]);
  const live = useRef({
    rooms: [] as MapRoom[],
    geometry: new Map<string, RoutedExit>(),
    edit,
    select,
  });
  const labelContext = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '11px system-ui';
    return context;
  }, []);
  useEffect(() => {
    setBaseNodes((previous) =>
      p.locations.map((location, i) => ({
        id: location.id,
        type: 'location',
        position: p.editor.positions[location.id] ?? {
          x: (i % 3) * 300 + 60,
          y: Math.floor(i / 3) * 170 + 80,
        },
        selected: selected === location.id,
        measured: previous.find((node) => node.id === location.id)?.measured,
        data: {
          name: location.name,
          starting: location.id === p.game.starting_location,
          actions: location.actions.length,
          objects: p.objects.filter(
            (o) => o.placement.type === 'location' && o.placement.location === location.id,
          ).length,
          ports: [],
          pending: false,
          beginPortDrag: () => {},
        },
      })),
    );
  }, [p, selected]);
  useEffect(() => {
    if (!connecting) {
      setPending(null);
      setPointer(null);
    }
  }, [connecting]);
  const rooms = useMemo<MapRoom[]>(
    () =>
      baseNodes.map((node) => ({
        id: node.id,
        ...node.position,
        width: node.measured?.width ?? 210,
        height: node.measured?.height ?? (node.data.starting ? 108 : 80),
      })),
    [baseNodes],
  );
  const routes = useMemo(
    () =>
      p.locations.flatMap((location) =>
        location.exits.map((route) => {
          const layout = { ...(p.editor.routes[route.id] ?? emptyLayout()) };
          if (preview?.id === route.id) {
            if ('anchor' in preview) layout[preview.end] = preview.anchor;
          }
          return {
            id: route.id,
            source: location.id,
            target: route.destination,
            labelWidth: labelContext.measureText(route.name).width + 12,
            layout,
            route,
          };
        }),
      ),
    [p.locations, p.editor.routes, labelContext, preview],
  );
  const geometry = useMemo(() => {
    const drawn = layoutMapRoutes(rooms, routes);
    // A drag previews exactly where the pointer puts the label; normal placement resumes on drop.
    if (preview && 'label' in preview && drawn.has(preview.id))
      drawn.get(preview.id)!.label = preview.label;
    return drawn;
  }, [rooms, routes, preview]);
  live.current = { rooms, geometry, edit, select };
  const fitMap = () => {
    if (!rooms.length) return;
    const bounds = rooms.map((room) => ({ ...room }));
    for (const route of routes) {
      const drawn = geometry.get(route.id);
      if (!drawn) continue;
      bounds.push({
        id: route.id,
        x: drawn.label.x - route.labelWidth / 2,
        y: drawn.label.y - 11,
        width: route.labelWidth,
        height: 22,
      });
      bounds.push(
        ...drawn.points.map((point) => ({ id: route.id, ...point, width: 0, height: 0 })),
      );
    }
    const x = Math.min(...bounds.map((rect) => rect.x));
    const y = Math.min(...bounds.map((rect) => rect.y));
    void fitBounds(
      {
        x,
        y,
        width: Math.max(...bounds.map((rect) => rect.x + rect.width)) - x,
        height: Math.max(...bounds.map((rect) => rect.y + rect.height)) - y,
      },
      { padding: 0.15 },
    );
  };
  useEffect(() => {
    if (
      initialized &&
      baseNodes.length === p.locations.length &&
      baseNodes.every((node) => node.measured?.width && node.measured?.height)
    ) {
      if (!restoringView.current && baseNodes.some((node) => !fitted.current.has(node.id)))
        fitMap();
      restoringView.current = false;
      fitted.current = new Set(baseNodes.map((node) => node.id));
    }
  }, [baseNodes, initialized, p.locations.length, fitBounds, geometry]);
  const occupied = (roomId: string, except?: { id: string; end: End }) =>
    [...live.current.geometry].flatMap(([id, route]) =>
      (['source', 'target'] as const)
        .filter(
          (end) => route[end].room.id === roomId && !(except?.id === id && except.end === end),
        )
        .map((end) => route[end].anchor),
    );
  const begin = (event: ReactPointerEvent, descriptor: Drag) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = descriptor;
  };
  const beginPortDrag: BeginPortDrag = (event, port) => {
    const route = geometry.get(port.id)!;
    begin(event, {
      kind: 'anchor',
      id: port.id,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      moved: false,
      end: port.end,
      roomId: route[port.end].room.id,
      value: port.anchor,
    });
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 3 && !drag.moved)
        return;
      drag.moved = true;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (drag.kind === 'anchor') {
        const room = live.current.rooms.find((room) => room.id === drag.roomId)!;
        const used = [...live.current.geometry].flatMap(([id, route]) =>
          (['source', 'target'] as const)
            .filter(
              (end) => route[end].room.id === drag.roomId && !(id === drag.id && end === drag.end),
            )
            .map((end) => route[end].anchor),
        );
        drag.value = availableAnchor(room, closestBorder(room, point), used);
        setPreview({ id: drag.id, end: drag.end, anchor: drag.value });
      } else {
        drag.value = {
          x: drag.origin.x + point.x - screenToFlowPosition(drag.start).x,
          y: drag.origin.y + point.y - screenToFlowPosition(drag.start).y,
        };
        setPreview({ id: drag.id, label: drag.value });
      }
    };
    const finish = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragging.current = null;
      if (drag.moved)
        live.current.edit((project) => {
          const layout = (project.editor.routes[drag.id] ??= emptyLayout());
          if (drag.kind === 'anchor') layout[drag.end] = drag.value;
          else
            layout.label_offset = {
              x: drag.value.x - drag.midpoint.x,
              y: drag.value.y - drag.midpoint.y,
            };
        });
      else live.current.select(drag.id);
      setPreview(null);
    };
    const cancel = () => {
      dragging.current = null;
      setPreview(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancel();
        setPending(null);
        setPointer(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [screenToFlowPosition]);
  const nodes = baseNodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      pending: pending?.roomId === node.id,
      beginPortDrag,
      ports: routes.flatMap((route) => {
        const drawn = geometry.get(route.id);
        return drawn
          ? (['source', 'target'] as const)
              .filter((end) => drawn[end].room.id === node.id)
              .map((end) => ({
                id: route.id,
                end,
                name: route.route.name,
                anchor: drawn[end].anchor,
                active: selected === route.id,
              }))
          : [];
      }),
    },
  }));
  const edges: ExitRoute[] = routes
    .filter((route) => geometry.has(route.id))
    .map(({ id, source, target, route }) => ({
      id,
      source,
      target,
      sourceHandle: `${id}:source`,
      targetHandle: `${id}:target`,
      type: 'exit',
      label: route.name,
      selected: selected === id,
      data: {
        geometry: geometry.get(id)!,
        select: () => select(id),
        beginLabelDrag: (event) => {
          const drawn = geometry.get(id)!;
          begin(event, {
            kind: 'label',
            id,
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            origin: drawn.label,
            midpoint: drawn.midpoint,
            value: drawn.label,
            moved: false,
          });
        },
        resetLabel: () =>
          edit((project) => {
            const layout = project.editor.routes[id];
            if (layout) layout.label_offset = null;
          }),
      },
      style: {
        stroke: route.visible.type === 'true' ? '#979fb5' : '#a995ef',
        strokeDasharray: route.visible.type === 'true' ? undefined : '6 5',
      },
    }));
  const pendingRoom = rooms.find((room) => room.id === pending?.roomId);
  const pendingPoint = pendingRoom && pending ? borderPoint(pendingRoom, pending.anchor) : null;
  return (
    <div
      className={`world-map ${connecting ? 'connecting' : ''}`}
      onPointerMove={(event) => {
        if (pending) setPointer(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
    >
      {connecting && (
        <div className="map-connection-hint" role="status">
          {pending
            ? 'Choose the target point · Esc cancels'
            : 'Choose the source point on a room border'}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        defaultViewport={view}
        onMoveEnd={(_, viewport) => onViewChange?.(viewport)}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes) => setBaseNodes((nodes) => applyNodeChanges(changes, nodes))}
        onNodeClick={(event, node) => {
          if (!connecting) {
            select(node.id);
            return;
          }
          const room = rooms.find((room) => room.id === node.id)!;
          const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          const used = occupied(room.id);
          if (pending?.roomId === room.id) used.push(pending.anchor);
          const anchor = availableAnchor(room, closestBorder(room, point), used);
          if (!pending) {
            setPending({ roomId: node.id, anchor });
            setPointer(point);
            return;
          }
          edit((project) => {
            const route = exit(node.id);
            route.name = node.data.name;
            project.locations.find((location) => location.id === pending.roomId)!.exits.push(route);
            project.editor.routes[route.id] = {
              source: pending.anchor,
              target: anchor,
              label_offset: null,
            };
            select(route.id);
          });
          setPending(null);
          setPointer(null);
        }}
        onPaneClick={() => {
          setPending(null);
          setPointer(null);
        }}
        onEdgeClick={(_, edge) => select(edge.id)}
        onNodeDragStop={(_, node) =>
          edit((project) => {
            project.editor.positions[node.id] = node.position;
          })
        }
        nodesDraggable={!connecting}
        nodesConnectable={false}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panActivationKeyCode={null}
        zoomActivationKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#3c455a" />
        <Controls showInteractive={false} showFitView={false}>
          <ControlButton aria-label="Fit View" title="Fit View" onClick={fitMap}>
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M 6 2 H 2 V 6 M 10 2 H 14 V 6 M 14 10 V 14 H 10 M 6 14 H 2 V 10"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </ControlButton>
        </Controls>
        {pendingPoint && (
          <ViewportPortal>
            <svg className="connection-preview">
              {pointer && (
                <path d={`M ${pendingPoint.x},${pendingPoint.y} L ${pointer.x},${pointer.y}`} />
              )}
              <circle cx={pendingPoint.x} cy={pendingPoint.y} r={5} />
            </svg>
          </ViewportPortal>
        )}
      </ReactFlow>
    </div>
  );
}

export default function WorldMap(props: Props) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}
