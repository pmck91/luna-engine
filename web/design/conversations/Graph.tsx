// N0 graph adapter: reuse Luna's obstacle/label routing rather than unconstrained
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
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  closestRoutePoint,
  layoutMapRoutes,
  type RoutedExit,
  type MapRoom,
} from '../../src/mapLayout';
import type { BorderAnchor } from '../../src/contracts';
import type { Conversation } from './fixture';
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
      className={`n0-dialogue-card ${selected ? 'selected' : ''} ${data.draft ? 'draft' : ''} ${data.ending ? 'end-badge' : ''} ${data.terminal ? 'terminal' : ''}`}
    >
      {!data.ending && (
        <small className="n0-node-drag">
          {data.draft ? 'Construction draft' : data.entry || 'Keeper'} · Drag
        </small>
      )}
      <button className="nodrag" onClick={data.onSelect} aria-label={data.selectLabel}>
        <strong>{data.name}</strong>
        <span>{data.line || (data.ending ? '' : 'Write the character’s dialogue…')}</span>
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
type ReplyEdge = Edge<{ geometry: RoutedExit; select: () => void; text: string }, 'reply'>;
function Connection({ id, data, label, style, selected }: EdgeProps<ReplyEdge>) {
  if (!data) return null;
  const { geometry } = data;
  const closest = closestRoutePoint(geometry.points, geometry.label);
  const detached = Math.hypot(closest.x - geometry.label.x, closest.y - geometry.label.y) > 12;
  return (
    <>
      <defs>
        <marker
          id={`n0-arrow-${id}`}
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
          className="n0-label-leader"
          d={`M ${geometry.label.x},${geometry.label.y} L ${closest.x},${closest.y}`}
        />
      )}
      <BaseEdge
        id={id}
        path={geometry.path}
        markerEnd={`url(#n0-arrow-${id})`}
        style={{ ...style, strokeWidth: selected ? 2.5 : 1.5, strokeLinejoin: 'round' }}
      />
      <EdgeLabelRenderer>
        <button
          className={`n0-edge-label nodrag nopan ${selected ? 'selected' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${geometry.label.x}px, ${geometry.label.y}px)`,
          }}
          aria-label={`Edit reply connection ${data.text}`}
          title={data.text}
          onClick={data.select}
        >
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
// Prefer labels on a clear segment, so a displaced label's leader does not
// obscure a terminal card. Dense graphs still need the full production review.
function placeConnectionLabels(rooms: MapRoom[], geometry: Map<string, RoutedExit>) {
  type Rect = { x: number; y: number; width: number; height: number };
  const occupied: Rect[] = [];
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + 5 &&
    a.x + a.width + 5 > b.x &&
    a.y < b.y + b.height + 5 &&
    a.y + a.height + 5 > b.y;
  for (const drawn of geometry.values()) {
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
    const point =
      [...candidates, drawn.label].find((candidate) => {
        const rect = { x: candidate.x - 41, y: candidate.y - 11, width: 82, height: 22 };
        return ![...rooms, ...occupied].some((obstacle) => overlaps(rect, obstacle));
      }) ?? drawn.label;
    drawn.label = point;
    occupied.push({ x: point.x - 41, y: point.y - 11, width: 82, height: 22 });
  }
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
}: {
  conversation: Conversation;
  selected: string;
  reply: string | null;
  selectNode: (id: string) => void;
  selectReply: (nodeId: string, replyId: string) => void;
  move: (id: string, position: { x: number; y: number }) => void;
}) {
  const callbacks = useRef({ selectNode, selectReply });
  callbacks.current = { selectNode, selectReply };
  const mapNodes = (previous: GraphNode[]): GraphNode[] =>
    conversation.nodes.flatMap((node) => {
      const entry = Object.entries(conversation.entries)
        .filter(([, id]) => id === node.id)
        .map(
          ([kind]) =>
            ({ first: 'First entry', active: 'Quest active', completed: 'On return' })[kind],
        )
        .join(' / ');
      const card: GraphNode = {
        ...previous.find((n) => n.id === node.id),
        id: node.id,
        type: 'dialogue',
        position: node.position,
        selected: node.id === selected,
        data: {
          name: node.name,
          line: node.line,
          count: node.replies.length,
          draft: node.draft,
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
            .filter((r) => r.destination === 'end')
            .map((r, index) => ({
              ...previous.find((n) => n.id === `end:${r.id}`),
              id: `end:${r.id}`,
              type: 'dialogue',
              draggable: false,
              position: { x: node.position.x + 32 + index * 175, y: node.position.y + 225 },
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
  }, [conversation, selected, reply]);
  const routes = useMemo(
    () =>
      conversation.nodes.flatMap((node) =>
        node.terminal
          ? []
          : node.replies.map((r, index) => ({
              id: r.id,
              source: node.id,
              target: r.destination === 'end' ? `end:${r.id}` : r.destination,
              labelWidth: 82,
              reply: r,
              number: index + 1,
            })),
      ),
    [conversation],
  );
  const rooms = baseNodes.map((node) => ({
    id: node.id,
    ...node.position,
    width: node.measured?.width ?? (node.data.ending ? 154 : 215),
    height: node.measured?.height ?? (node.data.ending ? 58 : 150),
  }));
  const geometry = layoutMapRoutes(rooms, routes);
  placeConnectionLabels(rooms, geometry);
  const nodes: GraphNode[] = baseNodes.map((node) => ({
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
        label: `Reply ${route.number}${route.reply.gate === 'always' ? '' : ' ◇'}`,
        selected: reply === route.id,
        data: {
          geometry: drawn,
          text: route.reply.text,
          select: () => selectReply(route.source, route.id),
        },
        style: { stroke: route.reply.gate === 'always' ? '#a093c6' : '#d0b56f' },
      },
    ];
  });
  return (
    <div className="n0-graph" role="region" aria-label="Conversation graph">
      <ReactFlow<GraphNode, ReplyEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodesChange={(changes) => setBaseNodes((old) => applyNodeChanges(changes, old))}
        onNodeDragStop={(_, node) => {
          if (!node.data.ending) move(node.id, node.position);
        }}
      >
        <Background gap={24} color="#373a49" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <span className="n0-map-key">
        Gold: conditional · ■: ends encounter · Start/return entries are separate
      </span>
    </div>
  );
}
