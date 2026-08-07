import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppIcon } from "./icons";

describe("AppIcon", () => {
  it("renders decorative icons with the sanctioned size and stroke", () => {
    const { container } = render(<AppIcon name="search" size="sm" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("height", "14");
    expect(svg).toHaveAttribute("stroke-width", "1.5");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a semantic label available for non-decorative use", () => {
    const { container } = render(<AppIcon name="info" size="md" aria-label="Information" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-label", "Information");
    expect(svg).not.toHaveAttribute("aria-hidden", "true");
  });

  it("supports numeric sizes for the rare standalone case", () => {
    const { container } = render(<AppIcon name="pin" size={12} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "12");
  });
});
