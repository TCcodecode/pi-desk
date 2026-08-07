import { AppIcon, type AppIconName } from "../ui/icons";

export interface SessionTreeNode { id: string; label: string; kind: string; children?: SessionTreeNode[]; }

export function SessionTree({ nodes, activeId, onSelect }: { nodes: SessionTreeNode[]; activeId?: string; onSelect: (id: string) => void }) {
  return <div className="session-tree" aria-label="Session tree">{nodes.map((node) => <TreeNode key={node.id} node={node} activeId={activeId} onSelect={onSelect} />)}</div>;
}

function TreeNode({ node, activeId, onSelect }: { node: SessionTreeNode; activeId?: string; onSelect: (id: string) => void }) {
  const iconName: AppIconName = node.kind === "user" ? "user" : node.kind === "assistant" ? "brain" : "circleDot";
  return (
    <div className="tree-node">
      <button className={node.id === activeId ? "active" : ""} onClick={() => onSelect(node.id)}>
        <span className="tree-node-icon" aria-hidden><AppIcon name={iconName} size="sm" /></span>
        {node.label}
      </button>
      {node.children?.map((child) => <div className="tree-children" key={child.id}><TreeNode node={child} activeId={activeId} onSelect={onSelect} /></div>)}
    </div>
  );
}
