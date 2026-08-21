import { afterEach, describe, expect, test, vi } from "vitest";
import { requestId } from "./client.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("requestId", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    vi.restoreAllMocks();
    // Best effort restore when crypto was deleted.
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    } catch {
      // Some runtimes report crypto as non-configurable; ignore.
    }
  });

  test("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000000");
    vi.stubGlobal("crypto", { randomUUID });
    expect(requestId()).toBe("00000000-0000-4000-8000-000000000000");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  test("falls back to a v4 UUID when crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", { randomUUID: undefined });
    expect(requestId()).toMatch(UUID_RE);
  });

  test("emits unique ids across many calls", () => {
    vi.stubGlobal("crypto", { randomUUID: undefined });
    const ids = new Set(Array.from({ length: 100 }, () => requestId()));
    expect(ids.size).toBe(100);
  });

  test("survives a fully absent crypto global", () => {
    delete (globalThis as { crypto?: unknown }).crypto;
    for (let i = 0; i < 20; i++) {
      expect(requestId()).toMatch(UUID_RE);
    }
  });
});
