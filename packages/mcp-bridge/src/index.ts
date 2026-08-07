import { createMcpAdapter, MCP_STATUS_EVENT, type McpStatusSnapshot } from "pi-mcp-adapter";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Thin bridge between pi-mcp-adapter and pi-desk's PiHost.
 *
 * The adapter runs inside the SDK session runtime as an extension factory —
 * the same injection point as @pi-desk/session-todo. It publishes status
 * snapshots on the per-session `pi.events` EventBus (channel
 * `MCP_STATUS_EVENT`); this factory subscribes first, then installs the
 * adapter, forwarding every snapshot to PiHost which merges them into a
 * global view for the renderer.
 *
 * No `config` option is passed to `createMcpAdapter`, so it runs in file-merge
 * mode: standard `mcp.json` files remain the single source of truth and the
 * desktop UI only reads/writes those files.
 */
export function createMcpBridgeFactory(onStatus: (snapshot: McpStatusSnapshot) => void) {
  return (pi: ExtensionAPI): void => {
    pi.events.on(MCP_STATUS_EVENT, (data) => onStatus(data as McpStatusSnapshot));
    createMcpAdapter()(pi);
  };
}

export { MCP_STATUS_EVENT, MCP_STATUS_SNAPSHOT_VERSION } from "pi-mcp-adapter";
export type {
  McpServerRuntimeStatus,
  McpServerStatusSnapshot,
  McpStatusSnapshot,
} from "pi-mcp-adapter";
export {
  importCursorMcpConfig,
  parseMcpJson,
  projectMcpOverridePath,
  readMcpConfigs,
  setMcpServerDisabled,
  standardMcpConfigPaths,
  stripJsonComments,
} from "./config.js";
export type {
  ImportMcpConfigResult,
  McpConfigFile,
  ReadMcpConfigResult,
  ServerDisabledOverrideResult,
} from "./config.js";
