import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ProjectSummary } from "../../shared/workspace";
import { ProjectPickerDialog } from "./ProjectPicker";

const projects: ProjectSummary[] = [
  { id: "cowinx", name: "Cowinx", path: "/Users/test/work/cowinx", updatedAt: "2026-08-22" },
  { id: "pi", name: "PI Desk", path: "/Users/test/work/pi-workspace", updatedAt: "2026-08-21" },
];

describe("ProjectPickerDialog", () => {
  test("filters projects and keeps the active project accessible", () => {
    render(
      <ProjectPickerDialog
        projects={projects}
        activeProjectId="cowinx"
        open
        onClose={vi.fn()}
        onSelect={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("option", { name: /Cowinx/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "desk" } });

    expect(screen.queryByRole("option", { name: /Cowinx/ })).toBeNull();
    expect(screen.getByRole("option", { name: /PI Desk/ })).toBeInTheDocument();
  });

  test("selects a project, closes the sheet, and exposes selection errors", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn(async () => undefined);
    render(
      <ProjectPickerDialog
        projects={projects}
        activeProjectId="cowinx"
        open
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("option", { name: /PI Desk/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("pi"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
