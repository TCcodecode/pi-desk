import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { HelpDialog } from "./HelpDialog";

describe("HelpDialog", () => {
  test("shows shortcuts when open", () => {
    render(<HelpDialog open onClose={() => undefined} />);
    expect(screen.getAllByText("Keyboard shortcuts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Open command suggestions")).toBeInTheDocument();
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("Toggle inspector")).toBeInTheDocument();
  });

  test("returns null when closed", () => {
    const { container } = render(<HelpDialog open={false} onClose={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders runtime diagnostics when provided", () => {
    render(
      <HelpDialog
        open
        onClose={() => undefined}
        diagnostics={{ piVersion: "1.2.3", sdkSessionId: "sess-1", sequence: 42, messages: [], errors: ["boom"] }}
      />,
    );
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  test("closes when backdrop clicked", () => {
    const onClose = vi.fn();
    render(<HelpDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  test("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<HelpDialog open onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
