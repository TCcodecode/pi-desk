// Type-level companion to the build-time transform in electron.vite.config.ts.
//
// pi-mcp-adapter imports `complete` from the pi-ai ROOT entry, but that entry
// only exports it via the /compat subpath (verified in 0.83.0 and 0.84.1).
// electron.vite.config.ts rewrites the import to @earendil-works/pi-ai/compat
// at bundle time; this augmentation makes the same member (with the exact
// /compat signature) visible to tsc so the adapter's source typechecks as
// part of tsconfig.node.json.
import type { Api, AssistantMessage, Context, Model, ProviderStreamOptions } from "@earendil-works/pi-ai";

declare module "@earendil-works/pi-ai" {
  export function complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): Promise<AssistantMessage>;
}
