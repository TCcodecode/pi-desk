import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustDialog } from "./TrustDialog";

describe("TrustDialog", () => {
  test("calls onResolve with the user's decision", () => {
    const onResolve = vi.fn();
    render(<TrustDialog open cwd="/tmp/project" hasProjectResources onResolve={onResolve} />);
    screen.getByRole("button", { name: "Trust project" }).click();
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  test("renders the project path and no-trust action", () => {
    const onResolve = vi.fn();
    const { container } = render(<TrustDialog open cwd="/tmp/project" hasProjectResources={false} onResolve={onResolve} />);
    expect(screen.getByText("/tmp/project")).toBeInTheDocument();
    expect(container.querySelector(".trust-icon svg")).toBeInTheDocument();
    expect(container.querySelector(".trust-path-icon svg")).toBeInTheDocument();
    expect(container.textContent).not.toContain("π");
    expect(container.textContent).not.toContain("▣");
    screen.getByRole("button", { name: /don't trust/i }).click();
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  test("renders nothing when closed", () => {
    const { container } = render(<TrustDialog open={false} cwd="/tmp/project" hasProjectResources={false} onResolve={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
