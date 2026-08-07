import { useEffect, useMemo, useRef, useState } from "react";
import type { PaletteCommand } from "./commandTypes";
import { Dialog } from "../ui/Dialog";

export type { PaletteCommand } from "./commandTypes";

export function filterPaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((command) => command.name.toLowerCase().includes(q) || (command.description ?? "").toLowerCase().includes(q));
}

export function CommandPalette({ open, commands, onSelect, onClose }: { open: boolean; commands: PaletteCommand[]; onSelect: (command: PaletteCommand) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return filterPaletteCommands(commands, query);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  if (!open) return null;

  const run = (command: PaletteCommand | undefined) => {
    if (command) onSelect(command);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(filtered[highlighted]);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} label="Command palette" panelClassName="command-palette">
      <input autoFocus aria-label="Search commands" placeholder="Search Pi commands..." value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} />
      <div className="palette-list" ref={listRef}>
        {filtered.length === 0 && <div className="palette-empty">No commands match "{query}"</div>}
        {filtered.map((command, index) => (
          <button key={command.id} className={index === highlighted ? "highlighted" : ""} onMouseEnter={() => setHighlighted(index)} onClick={() => run(command)}>
            <span><strong>{command.name}</strong><small>{command.description}</small></span><em>{command.source ?? "Pi"}</em>
          </button>
        ))}
      </div>
      <div className="palette-footer">Esc close · ↑↓ navigate · Enter run</div>
    </Dialog>
  );
}

export function CommandPicker({
  commands,
  query,
  highlighted,
  onHighlight,
  onSelect,
}: {
  commands: PaletteCommand[];
  query: string;
  highlighted: number;
  onHighlight: (index: number) => void;
  onSelect: (command: PaletteCommand) => void;
}) {
  const filtered = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);

  return (
    <div className="command-picker" role="listbox" aria-label="Slash commands">
      {filtered.length === 0 ? (
        <div className="command-picker-empty">No commands match “/{query}”</div>
      ) : (
        filtered.slice(0, 8).map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            className={index === highlighted ? "highlighted" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHighlight(index)}
            onClick={() => onSelect(command)}
          >
            <span className="command-picker-name">{command.name}</span>
            <span className="command-picker-description">{command.description}</span>
          </button>
        ))
      )}
    </div>
  );
}
