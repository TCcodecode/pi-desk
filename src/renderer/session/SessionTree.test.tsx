import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionTree } from "./SessionTree";

describe("SessionTree", () => {
  it("uses the shared line icon system for every tree node", () => {
    const { container } = render(
      <SessionTree
        nodes={[
          { id: "user", label: "User message", kind: "user" },
          { id: "assistant", label: "Assistant message", kind: "assistant" },
          { id: "tool", label: "Tool call", kind: "tool" },
        ]}
        onSelect={() => undefined}
      />,
    );

    expect(container.querySelectorAll(".tree-node > button svg")).toHaveLength(3);
    expect(container.textContent).not.toContain("π");
    expect(container.textContent).not.toContain("·");
  });
});
