import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { HttpWorkbenchStore } from "./store.js";

function result(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: {} as const,
    ...(isError ? { isError: true } : {}),
  };
}
function treeText(nodes: Awaited<ReturnType<HttpWorkbenchStore["workspace"]>>["tree"], prefix = ""): string[] {
  return nodes.flatMap((node) => [
    `${prefix}${node.kind}: ${node.name}${node.relativePath ? ` (${node.relativePath})` : ""}`,
    ...(node.children ? treeText(node.children, `${prefix}  `) : []),
  ]);
}

const SYSTEM_GUIDANCE = `
# HTTP Workbench
HTTP tests are application-owned assets, not project source files.
- Every HTTP Workbench operation must use the current project context (ctx.cwd).
- Create ordinary user-named folders under the project for smoke, regression, debugging, release checks, or any other purpose.
- Project environments live under the project's Environments directory; choose the environment explicitly when running.
- Use curl or Bash only for a one-off probe. Save a repeatable check as a .http file through the HTTP Workbench tools.
- Never write .http files into the project repository unless the user explicitly asks for an export; HTTP Workbench paths are resolved by the application.
- Run history is owned by the test file's parent folder and should be inspected through http_list_run_history.
`.trim();

export function registerHttpWorkbenchTools(pi: ExtensionAPI, store: HttpWorkbenchStore): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt ? `${event.systemPrompt}\n\n${SYSTEM_GUIDANCE}` : SYSTEM_GUIDANCE,
  }));

  pi.registerTool({
    name: "http_workspace_info",
    label: "HTTP Workspace Info",
    description: "Show the application-owned HTTP test tree and project environments for the current project",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const workspace = await store.workspace(ctx.cwd);
        return result([
          `Project: ${workspace.projectName}`,
          `Project path: ${workspace.projectPath}`,
          "Application-owned test assets:",
          ...treeText(workspace.tree, "  "),
          workspace.environments.length ? `Environments: ${workspace.environments.map((item) => item.name).join(", ")}` : "Environments: none",
        ].join("\n"));
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "http_create_folder",
    label: "HTTP Create Folder",
    description: "Create a user-named HTTP test folder inside the current project's application-owned test space",
    parameters: Type.Object({
      parentPath: Type.Optional(Type.String({ description: "Existing test folder path relative to the HTTP project space" })),
      name: Type.String({ description: "New folder name, such as auth-regression or debug-login" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        await store.createFolder(ctx.cwd, params.parentPath ?? "", params.name);
        return result(`Created HTTP test folder ${params.parentPath ? `${params.parentPath}/` : ""}${params.name}`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "http_create_test",
    label: "HTTP Create Test",
    description: "Create a .http test file in a current-project HTTP test folder",
    parameters: Type.Object({
      parentPath: Type.Optional(Type.String({ description: "Existing test folder path relative to the HTTP project space" })),
      name: Type.String({ description: "HTTP test name; .http is added when omitted" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const created = await store.createFile(ctx.cwd, params.parentPath ?? "", params.name);
        return result(`Created ${created.path}\n\n${created.content}`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "http_read_test",
    label: "HTTP Read Test",
    description: "Read a .http test from the current project's application-owned test space",
    parameters: Type.Object({ path: Type.String({ description: "Relative .http path inside the HTTP project space" }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const file = await store.readFile(ctx.cwd, params.path);
        return result(`${file.path}\n\n${file.content}`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "http_update_test",
    label: "HTTP Update Test",
    description: "Replace a .http test in the application-owned HTTP project space",
    parameters: Type.Object({
      path: Type.String({ description: "Relative .http path inside the HTTP project space" }),
      content: Type.String({ description: "Complete replacement content" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        await store.saveFile(ctx.cwd, params.path, params.content);
        return result(`Updated ${params.path} in the PI Desk application data space`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "http_run_test",
    label: "HTTP Run Test",
    description: "Run one .http file or a test folder against an explicit project environment",
    parameters: Type.Object({
      path: Type.String({ description: "Relative .http file or test folder path" }),
      environment: Type.Optional(Type.String({ description: "Project environment name, such as local, dev, staging, or production" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const record = await store.run(ctx.cwd, params.path, params.environment);
        return result([
          `${record.status.toUpperCase()}: ${record.scopePath}`,
          `Environment: ${record.environment}`,
          `Requests: ${record.passedCount}/${record.requestCount} passed`,
          ...record.requests.map((request) => `  ${request.ok ? "PASS" : "FAIL"} ${request.method} ${request.url}${request.error ? ` — ${request.error}` : ""}`),
        ].join("\n"));
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "http_list_run_history",
    label: "HTTP Run History",
    description: "List run history stored beside a .http file or test folder",
    parameters: Type.Object({ path: Type.String({ description: "Relative .http file or test folder path" }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const records = await store.listRuns(ctx.cwd, params.path);
        if (!records.length) return result(`No run history for ${params.path}`);
        return result(records.map((record) => `${record.status.toUpperCase()} ${record.startedAt} · ${record.environment} · ${record.passedCount}/${record.requestCount} · ${record.id}`).join("\n"));
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });
}
