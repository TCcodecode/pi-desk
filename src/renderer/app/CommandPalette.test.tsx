import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CommandPalette, CommandPicker } from "./CommandPalette";

const commands = [
  { id: "compact", name: "/compact", description: "Summarize context" },
  { id: "reload", name: "/reload", description: "Reload runtime" },
];

describe("CommandPalette", () => {
  test("lists commands and returns the selected command", () => {
    const onSelect = vi.fn();
    render(<CommandPalette open commands={commands} onSelect={onSelect} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /compact/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "compact" }));
  });

  test("filters commands by search query", () => {
    render(<CommandPalette open commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /search commands/i }), { target: { value: "reload" } });
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compact/i })).not.toBeInTheDocument();
  });

  test("runs the highlighted command on Enter", () => {
    const onSelect = vi.fn();
    render(<CommandPalette open commands={commands} onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: /search commands/i }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /search commands/i }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "reload" }));
  });

  test("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onSelect={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: /search commands/i }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders a compact picker for slash commands", () => {
    const onSelect = vi.fn();
    render(
      <CommandPicker
        commands={commands}
        query="com"
        highlighted={0}
        onHighlight={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("listbox", { name: /slash commands/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /compact/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /reload/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /compact/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "compact" }));
  });
});
