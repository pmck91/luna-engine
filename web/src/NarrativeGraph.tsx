// Conversation graph: reuse Luna's obstacle/label routing rather than unconstrained
// Bezier edges. End badges are editor decorations, not executable dialogue nodes.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  applyNodeChanges,
  useUpdateNodeInternals,
  useReactFlow,
  type Node,
  type Viewport,
  type NodeProps,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { closestRoutePoint, layoutMapRoutes, type RoutedExit, type MapRoom } from './mapLayout';
import type { BorderAnchor, Point } from './contracts';
import type { Conversation, Project } from './contracts';
import { construction } from './narrativeAuthoring';
import { placeConnectionLabels } from './narrativeLayout';
type Port = { id: string; type: 'source' | 'target'; anchor: BorderAnchor };
type GraphNode = Node<
  {
    name: string;
    line: string;
    count: number;
    draft: boolean;
    terminal: boolean;
    ending: boolean;
    entry: string;
    selectLabel: string;
    onSelect: () => void;
    ports: Port[];
  },
  'dialogue'
>;
const side = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};
function DialogueCard({ id, data, selected }: NodeProps<GraphNode>) {
  const update = useUpdateNodeInternals();
  const signature = data.ports.map((p) => `${p.id}:${p.anchor.side}:${p.anchor.offset}`).join('|');
  useEffect(() => {
    update(id);
  }, [id, signature, update]);
  return (
    <div
      className={`narrative-dialogue-card ${selected ? 'selected' : ''} ${data.draft ? 'draft' : ''} ${data.ending ? 'end-badge' : ''} ${data.terminal ? 'terminal' : ''}`}
    >
      {!data.ending && (
        <small className="narrative-node-drag">
          {data.draft ? 'Construction draft' : data.entry || 'Dialogue'} · Drag
        </small>
      )}
      <button className="nodrag" onClick={data.onSelect} aria-label={data.selectLabel}>
        <strong>{data.name}</strong>
        <span>
          {data.line ||
            (data.ending
              ? ''
              : data.draft
                ? 'Write the dialogue shown on this visit.'
                : 'No dialogue text')}
        </span>
        {!data.ending && (
          <small>
            {data.terminal
              ? '■ Ends after dialogue'
              : `${data.count} ${data.count === 1 ? 'reply' : 'replies'}`}
          </small>
        )}
      </button>
      {data.ports.map((port) => (
        <Handle
          key={`${port.id}:${port.type}`}
          id={`${port.id}:${port.type}`}
          type={port.type}
          position={side[port.anchor.side]}
          isConnectable={false}
          style={
            port.anchor.side === 'top' || port.anchor.side === 'bottom'
              ? { left: `${port.anchor.offset * 100}%` }
              : { top: `${port.anchor.offset * 100}%` }
          }
        />
      ))}
    </div>
  );
}
type ReplyEdge = Edge<
  {
    geometry: RoutedExit;
    select: () => void;
    text: string;
    previewLabel: (point: Point | null) => void;
    moveLabel: (point: Point) => void;
  },
  'reply'
>;
function Connection({ id, data, label, style, selected }: EdgeProps<ReplyEdge>) {
  const flow = useReactFlow();
  const drag = useRef<{ screen: Point; label: Point; moved: boolean } | null>(null);
  if (!data) return null;
  const { geometry } = data;
  const closest = closestRoutePoint(geometry.points, geometry.label);
  const detached = Math.hypot(closest.x - geometry.label.x, closest.y - geometry.label.y) > 12;
  return (
    <>
      <defs>
        <marker
          id={`narrative-arrow-${id}`}
          viewBox="0 0 10 10"
          markerWidth="9"
          markerHeight="9"
          refX="12"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0,0 L 10,5 L 0,10 Z" fill={style?.stroke ?? '#b6a5d9'} />
        </marker>
      </defs>
      {detached && (
        <path
          className="narrative-label-leader"
          d={`M ${geometry.label.x},${geometry.label.y} L ${closest.x},${closest.y}`}
        />
      )}
      <BaseEdge
        id={id}
        path={geometry.path}
        markerEnd={`url(#narrative-arrow-${id})`}
        style={{ ...style, strokeWidth: selected ? 2.5 : 1.5, strokeLinejoin: 'round' }}
      />
      <EdgeLabelRenderer>
        <button
          className={`narrative-edge-label nodrag nopan ${selected ? 'selected' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${geometry.label.x}px, ${geometry.label.y}px)`,
          }}
          aria-label={`Edit reply connection ${data.text}`}
          title={data.text}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              screen: { x: event.clientX, y: event.clientY },
              label: geometry.label,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const zoom = flow.getViewport().zoom;
            const dx = (event.clientX - start.screen.x) / zoom,
              dy = (event.clientY - start.screen.y) / zoom;
            if (Math.hypot(dx, dy) > 4) start.moved = true;
            if (start.moved) data.previewLabel({ x: start.label.x + dx, y: start.label.y + dy });
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            drag.current = null;
            if (start?.moved) {
              const zoom = flow.getViewport().zoom;
              data.moveLabel({
                x: start.label.x + (event.clientX - start.screen.x) / zoom - geometry.midpoint.x,
                y: start.label.y + (event.clientY - start.screen.y) / zoom - geometry.midpoint.y,
              });
            }
            data.previewLabel(null);
          }}
          onPointerCancel={() => {
            drag.current = null;
            data.previewLabel(null);
          }}
          onClick={data.select}
        >
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const nodeTypes = { dialogue: DialogueCard };
const edgeTypes = { reply: Connection };
export default function Graph({
  conversation,
  selected,
  reply,
  selectNode,
  selectReply,
  move,
  project,
  moveLabel,
  view,
  onViewChange,
}: {
  conversation: Conversation;
  view?: Viewport;
  onViewChange?: (view: Viewport) => void;
  project: Project;
  moveLabel: (id: string, offset: Point) => void;
  selected: string;
  reply: string | null;
  selectNode: (id: string) => void;
  selectReply: (nodeId: string, replyId: string) => void;
  move: (id: string, position: { x: number; y: number }) => void;
}) {
  const [labelPreview, setLabelPreview] = useState<{ id: string; point: Point } | null>(null);
  const callbacks = useRef({ selectNode, selectReply });
  callbacks.current = { selectNode, selectReply };
  const mapNodes = (previous: GraphNode[]): GraphNode[] =>
    conversation.nodes.flatMap((node) => {
      const entry = [
        conversation.default_entry === node.id ? 'Default entry' : '',
        ...conversation.entries.flatMap((e, index) =>
          e.node === node.id ? [`Return rule ${index + 1}`] : [],
        ),
      ]
        .filter(Boolean)
        .join(' / ');
      const position = project.editor.positions[node.id] ?? {
        x: (conversation.nodes.indexOf(node) % 3) * 380,
        y: Math.floor(conversation.nodes.indexOf(node) / 3) * 380,
      };
      const card: GraphNode = {
        ...previous.find((n) => n.id === node.id),
        id: node.id,
        type: 'dialogue',
        position,
        selected: node.id === selected,
        data: {
          name: node.name,
          line: node.text,
          count: node.replies.length,
          draft: !!construction(project, node.id),
          terminal: node.terminal,
          ending: false,
          entry,
          ports: [],
          selectLabel: `Select node ${node.name}`,
          onSelect: () => callbacks.current.selectNode(node.id),
        },
      };
      const endings: GraphNode[] = node.terminal
        ? []
        : node.replies
            .filter((r) => r.destination === null)
            .map((r, index) => ({
              ...previous.find((n) => n.id === `end:${r.id}`),
              id: `end:${r.id}`,
              type: 'dialogue',
              draggable: false,
              position: { x: position.x + 32 + index * 175, y: position.y + 225 },
              selected: reply === r.id,
              data: {
                name: '■ End conversation',
                line: `Reply ${node.replies.indexOf(r) + 1}`,
                count: 0,
                draft: false,
                terminal: false,
                ending: true,
                entry: '',
                ports: [],
                selectLabel: `Edit ending for reply ${r.text}`,
                onSelect: () => callbacks.current.selectReply(node.id, r.id),
              },
            }));
      return [card, ...endings];
    });
  const [baseNodes, setBaseNodes] = useState<GraphNode[]>(() => mapNodes([]));
  useEffect(() => {
    setBaseNodes((old) => mapNodes(old));
  }, [conversation, selected, reply, project.editor.positions, project.editor.narrative_drafts]);
  const routes = useMemo(
    () =>
      conversation.nodes.flatMap((node) =>
        node.terminal
          ? []
          : node.replies.map((r, index) => ({
              id: r.id,
              source: node.id,
              target: r.destination === null ? `end:${r.id}` : r.destination,
              layout: project.editor.routes[r.id],
              labelWidth: 82,
              reply: r,
              number: index + 1,
            })),
      ),
    [conversation, project.editor.routes],
  );
  const dialogueRooms = baseNodes
    .filter((node) => !node.data.ending)
    .map((node) => ({
      id: node.id,
      ...node.position,
      width: node.measured?.width ?? 215,
      height: node.measured?.height ?? 150,
    }));
  const occupied = [...dialogueRooms];
  const arrangedNodes = baseNodes.map((node) => {
    if (!node.data.ending) return node;
    const source = routes.find((route) => route.target === node.id)?.source;
    const parent = dialogueRooms.find((room) => room.id === source);
    if (!parent) return node;
    const rect = {
      id: node.id,
      x: parent.x + 32,
      y: parent.y + parent.height + 75,
      width: node.measured?.width ?? 154,
      height: node.measured?.height ?? 58,
    };
    while (
      occupied.some(
        (other) =>
          rect.x < other.x + other.width + 12 &&
          rect.x + rect.width + 12 > other.x &&
          rect.y < other.y + other.height + 12 &&
          rect.y + rect.height + 12 > other.y,
      )
    )
      rect.y += 100;
    occupied.push(rect);
    return { ...node, position: { x: rect.x, y: rect.y } };
  });
  const rooms = arrangedNodes.map((node) => ({
    id: node.id,
    ...node.position,
    width: node.measured?.width ?? (node.data.ending ? 154 : 215),
    height: node.measured?.height ?? (node.data.ending ? 58 : 150),
  }));
  const geometry = layoutMapRoutes(rooms, routes);
  placeConnectionLabels(
    rooms,
    geometry,
    new Set(routes.filter((r) => r.layout?.label_offset).map((r) => r.id)),
  );
  if (labelPreview && geometry.has(labelPreview.id))
    geometry.get(labelPreview.id)!.label = labelPreview.point;
  const nodes: GraphNode[] = arrangedNodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      ports: routes.flatMap((route) => {
        const drawn = geometry.get(route.id);
        if (!drawn) return [];
        const ports: Port[] = [];
        if (route.source === node.id)
          ports.push({ id: route.id, type: 'source', anchor: drawn.source.anchor });
        if (route.target === node.id)
          ports.push({ id: route.id, type: 'target', anchor: drawn.target.anchor });
        return ports;
      }),
    },
  }));
  const edges: ReplyEdge[] = routes.flatMap((route) => {
    const drawn = geometry.get(route.id);
    if (!drawn) return [];
    return [
      {
        id: route.id,
        type: 'reply',
        source: route.source,
        target: route.target,
        sourceHandle: `${route.id}:source`,
        targetHandle: `${route.id}:target`,
        label: `Reply ${route.number}${route.reply.condition.type === 'true' ? '' : ' ◇'}`,
        selected: reply === route.id,
        data: {
          geometry: drawn,
          text: route.reply.text,
          previewLabel: (point) => setLabelPreview(point ? { id: route.id, point } : null),
          moveLabel: (point) => moveLabel(route.id, point),
          select: () => selectReply(route.source, route.id),
        },
        style: { stroke: route.reply.condition.type === 'true' ? '#a093c6' : '#d0b56f' },
      },
    ];
  });
  return (
    <div className="narrative-graph" role="region" aria-label="Conversation graph">
      <ReactFlow<GraphNode, ReplyEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={view}
        onMoveEnd={(_, viewport) => onViewChange?.(viewport)}
        fitView={!view}
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodesChange={(changes) => {
          setBaseNodes((old) => applyNodeChanges(changes, old));
          for (const change of changes)
            if (
              change.type === 'position' &&
              change.position &&
              !change.dragging &&
              !change.id.startsWith('end:')
            )
              move(change.id, change.position);
        }}
      >
        <Background gap={24} color="#373a49" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <span className="narrative-map-key">
        Gold: conditional · ■: ends encounter · Drag labels to move · Select a reply for border
        settings
      </span>
    </div>
  );
}
