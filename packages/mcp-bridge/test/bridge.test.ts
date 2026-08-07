import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onStatus: vi.fn<(snapshot: unknown) => void>(),
  installed: vi.fn<(pi: unknown) => void>(),
  capture: { handler: undefined as ((data: unknown) => void) | undefined },
}));

vi.mock("pi-mcp-adapter", () => ({
  MCP_STATUS_EVENT: "pi-mcp-adapter/status/v1",
  MCP_STATUS_SNAPSHOT_VERSION: 1,
  createMcpAdapter: () => (pi: unknown) => {
    mocks.installed(pi);
  },
}));

import { createMcpBridgeFactory, MCP_STATUS_EVENT } from "../src/index.js";

const snapshot = {
  version: 1,
  servers: [{ name: "github", status: "connected", toolCount: 5, disabled: false }],
  totalTools: 5,
  connectedCount: 1,
  disabledCount: 0,
};

function makeFakePi() {
  return {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        expect(channel).toBe(MCP_STATUS_EVENT);
        mocks.capture.handler = handler;
      },
    },
  };
}

describe("createMcpBridgeFactory", () => {
  test("subscribes to status events before installing the adapter and forwards snapshots", () => {
    mocks.onStatus.mockClear();
    mocks.installed.mockClear();

    const pi = makeFakePi();
    const factory = createMcpBridgeFactory(mocks.onStatus);
    factory(pi as never);

    // The adapter was installed with the same extension API.
    expect(mocks.installed).toHaveBeenCalledWith(pi);

    // A status snapshot published by the adapter reaches the callback.
    expect(mocks.capture.handler).toBeTypeOf("function");
    mocks.capture.handler?.(snapshot);
    expect(mocks.onStatus).toHaveBeenCalledWith(snapshot);
  });
});
