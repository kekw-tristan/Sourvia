import { useEffect, useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, useReactFlow, useStore, type NodeProps, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Directory, ProjectNode } from '../../shared/types';

type FileNode = Node<{ entry: ProjectNode; center: boolean }, 'entry'>;
function EntryNode({ data }: NodeProps<FileNode>) {
  return <div className={`graph-node ${data.entry.type} ${data.center ? 'center' : ''}`} title={data.entry.path}>
    <Handle type="target" position={Position.Left} />
    <span className="node-icon">{data.entry.type === 'folder' ? '▱' : '⌘'}</span>
    <span className="node-label">{data.entry.name}<small>{data.center ? 'CURRENT FOLDER' : data.entry.type === 'folder' ? 'FOLDER' : data.entry.name.split('.').pop()?.toUpperCase()}</small></span>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { entry: EntryNode };
function CenterFolder({ nodes }: { nodes: FileNode[] }) {
  const { fitBounds, viewportInitialized } = useReactFlow();
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  useEffect(() => {
    if (!viewportInitialized || !width || !height) return;
    const radiusX = Math.max(0, ...nodes.map(node => Math.abs(node.position.x))) + 110;
    const radiusY = Math.max(0, ...nodes.map(node => Math.abs(node.position.y))) + 60;
    void fitBounds({ x: 87 - radiusX, y: 29 - radiusY, width: radiusX * 2, height: radiusY * 2 }, { padding: 0.1 });
  }, [viewportInitialized, width, height, nodes, fitBounds]);
  return null;
}
export function ProjectGraph({ directory, onSelect }: { directory: Directory; onSelect(node: ProjectNode): void }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: FileNode[] = [{ id: directory.current.id, type: 'entry', position: { x: 0, y: 0 }, data: { entry: directory.current, center: true } }];
    const edges: Edge[] = [];
    // Eight children per ring; later rings gain capacity and keep readable spacing.
    let offset = 0;
    let ring = 1;
    while (offset < directory.children.length) {
      const count = Math.min(ring * 8, directory.children.length - offset);
      for (let i = 0; i < count; i++) {
        const entry = directory.children[offset + i];
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        nodes.push({ id: entry.id, type: 'entry', position: { x: Math.cos(angle) * 320 * ring, y: Math.sin(angle) * 210 * ring }, data: { entry, center: false } });
        edges.push({ id: entry.id, source: directory.current.id, target: entry.id, type: 'straight' });
      }
      offset += count;
      ring++;
    }
    return { nodes, edges };
  }, [directory]);
  return <ReactFlow key={directory.current.path} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
    onNodeClick={(_event, node) => { if (!node.data.center) onSelect(node.data.entry); }}
    nodesDraggable={false} nodesConnectable={false}
    minZoom={0.08} maxZoom={2} colorMode="dark" proOptions={{ hideAttribution: true }}>
    <CenterFolder nodes={nodes} /><Background gap={24} size={1} color="#303642" /><Controls showInteractive={false} />
  </ReactFlow>;
}
