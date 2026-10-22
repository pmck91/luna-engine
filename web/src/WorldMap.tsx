import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  applyNodeChanges,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Point, Project } from './contracts';
import { exit } from './model';
import { exitPath, layoutExitLabels } from './mapLayout';
type LocationNode = Node<
  { name: string; starting: boolean; objects: number; actions: number },
  'location'
>;
function Room({ data, selected }: NodeProps<LocationNode>) {
  return (
    <div className={`room-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <strong>{data.name}</strong>
      <small>
        {data.actions} actions · {data.objects} objects
      </small>
      {data.starting && <span>★ Starting location</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { location: Room };
type ExitRoute = Edge<{ labelPosition: Point; onSelect: () => void }, 'exit'>;
function Route({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  markerEnd,
  style,
  selected,
}: EdgeProps<ExitRoute>) {
  const labelPosition = data?.labelPosition ?? {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };
  return (
    <>
      <BaseEdge
        id={id}
        path={exitPath(
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
          labelPosition,
          source === target,
        )}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: selected ? 2.5 : 1 }}
      />
      <EdgeLabelRenderer>
        <button
          className={`exit-label nodrag nopan ${selected ? 'active' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
          }}
          aria-label={`Edit exit ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            data?.onSelect();
          }}
        >
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { exit: Route };
export default function WorldMap({
  project: p,
  selected,
  select,
  edit,
  connecting,
}: {
  project: Project;
  selected: string;
  select: (id: string) => void;
  edit: (f: (p: Project) => void) => void;
  connecting: boolean;
}) {
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const labelContext = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '11px system-ui';
    return context;
  }, []);
  useEffect(() => {
    setNodes((previous) =>
      p.locations.map((l, i) => ({
        id: l.id,
        type: 'location',
        position: p.editor.positions[l.id] ?? {
          x: (i % 3) * 300 + 60,
          y: Math.floor(i / 3) * 170 + 80,
        },
        selected: selected === l.id,
        measured: previous.find((node) => node.id === l.id)?.measured,
        data: {
          name: l.name,
          starting: l.id === p.game.starting_location,
          actions: l.actions.length,
          objects: p.objects.filter(
            (o) => o.placement.type === 'location' && o.placement.location === l.id,
          ).length,
        },
      })),
    );
  }, [p, selected]);
  const edges = useMemo<ExitRoute[]>(() => {
    const routes = p.locations.flatMap((location) =>
      location.exits.map((route) => ({
        id: route.id,
        source: location.id,
        target: route.destination,
        labelWidth: labelContext.measureText(route.name).width + 12,
        route,
      })),
    );
    const labels = layoutExitLabels(
      nodes.map((node) => ({
        id: node.id,
        ...node.position,
        width: node.measured?.width ?? 210,
        height: node.measured?.height ?? (node.data.starting ? 108 : 80),
      })),
      routes,
    );
    return routes
      .filter((route) => labels.has(route.id))
      .map(({ id, source, target, route }) => ({
        id,
        source,
        target,
        type: 'exit',
        label: route.name,
        data: { labelPosition: labels.get(id)!, onSelect: () => select(id) },
        selected: selected === id,
        style: {
          stroke: route.visible.type === 'true' ? '#979fb5' : '#a995ef',
          strokeDasharray: route.visible.type === 'true' ? undefined : '6 5',
        },
        markerEnd: { type: 'arrowclosed' as const, color: '#979fb5' },
      }));
  }, [p.locations, nodes, selected, labelContext, select]);
  const connect = ({ source, target }: Connection) => {
    if (!source || !target) return;
    edit((n) => {
      const e = exit(target);
      e.name = n.locations.find((l) => l.id === target)?.name ?? 'route';
      n.locations.find((l) => l.id === source)!.exits.push(e);
      select(e.id);
    });
  };
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={(changes) => setNodes((n) => applyNodeChanges(changes, n))}
      onNodeClick={(_, node) => select(node.id)}
      onEdgeClick={(_, edge) => select(edge.id)}
      onNodeDragStop={(_, node) =>
        edit((n) => {
          n.editor.positions[node.id] = node.position;
        })
      }
      onConnect={connect}
      nodesConnectable={connecting}
      fitView
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
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
