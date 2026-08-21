import { describe, expect, test } from "vitest";
import {
  COMPANION_ALLOWED_METHODS,
  COMPANION_PORT,
  isCompanionMethodAllowed,
  parseCompanionClientMessage,
} from "./companion.js";

describe("companion protocol", () => {
  test("uses the reserved LAN port", () => {
    expect(COMPANION_PORT).toBe(17890);
  });

  test("allows session steering methods and rejects secret-bearing ones", () => {
    expect(isCompanionMethodAllowed("prompt")).toBe(true);
    expect(isCompanionMethodAllowed("getSnapshot")).toBe(true);
    expect(isCompanionMethodAllowed("selectProject")).toBe(true);
    expect(isCompanionMethodAllowed("undoFileChange")).toBe(true);
    expect(isCompanionMethodAllowed("loginWithApiKey")).toBe(false);
    expect(isCompanionMethodAllowed("addProject")).toBe(false);
    expect(isCompanionMethodAllowed("chooseWorkspace")).toBe(false);
    expect(COMPANION_ALLOWED_METHODS).not.toContain("http");
  });

  test("parses a request and rejects junk", () => {
    expect(parseCompanionClientMessage(JSON.stringify({ type: "req", id: "1", method: "prompt", args: ["hi"] }))).toEqual({
      type: "req",
      id: "1",
      method: "prompt",
      args: ["hi"],
    });
    expect(parseCompanionClientMessage("{")).toEqual({ error: "invalid json" });
    expect(parseCompanionClientMessage(JSON.stringify({ type: "req", method: "prompt" }))).toEqual({ error: "invalid request" });
  });
});
