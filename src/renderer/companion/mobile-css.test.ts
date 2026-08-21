import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const dir = import.meta.dirname;

describe("companion mobile shell", () => {
  test("does not import the desktop stylesheet that locks min-width 900px", () => {
    const source = readFileSync(join(dir, "main.tsx"), "utf8");
    expect(source).not.toMatch(/app\/styles\.css/);
  });

  test("lets the phone viewport scroll instead of clipping a 900px desktop shell", () => {
    const css = readFileSync(join(dir, "styles.css"), "utf8");
    // Responsive `@media (min-width: ...)` breakpoints are fine. What breaks
    // phones is a hard `min-width: 900px` on an element (a desktop shell lock),
    // so assert the element rules outside media queries never do that.
    const outsideMedia = css.replace(/@media[^{]*\{[^}]*\}/g, "");
    expect(outsideMedia).not.toMatch(/min-width:\s*900px/);
    expect(css).toMatch(/min-width:\s*0/);
    expect(css).toMatch(/overflow:\s*auto/);
  });
});
