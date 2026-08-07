import type { PiCommand } from "../../shared/protocol.js";

// Desktop whitelist: only commands that (a) are implemented in PiHost.executeCommand
// and (b) have no dedicated GUI flow. Everything else lives in native UI:
// fork → Session tree dialog, clone → context menu, new/name/session/tree →
// sidebar + timeline, settings/login/logout/trust/hotkeys → dialogs.
export const BUILTIN_PI_COMMANDS: PiCommand[] = [
  ["compact", "Compact the current context"],
  ["export", "Export the current session"],
  ["copy", "Copy the last assistant response"],
  ["reload", "Reload Pi resources"],
].map(([name, description]) => ({ id: name, name: `/${name}`, description, source: "builtin" }));

const HIDDEN_COMMAND_IDS = new Set(["quit", "exit"]);

export type MergedPiCommand = { name: string; description?: string; source?: PiCommand["source"] };

/**
 * Merge built-in, extension, skill, and prompt-template commands into the
 * desktop slash-command list.
 *
 * Skill commands surface as /skill:<name> and prompt templates as /<template>
 * (the exact syntax AgentSession.prompt expands via _expandSkillCommand and
 * expandPromptTemplate). Both are executed by the Pi session itself when the
 * text is submitted as a prompt, so the desktop only needs to list them —
 * PiHost.executeCommand is not involved.
 */
export function mergePiCommands(commands: MergedPiCommand[]): PiCommand[] {
  const merged = commands
    .map((command) => ({
      id: command.name.replace(/^\//, ""),
      name: command.name.startsWith("/") ? command.name : `/${command.name}`,
      description: command.description ?? "Pi command",
      source: command.source ?? "extension",
    }))
    .filter((command) => !HIDDEN_COMMAND_IDS.has(command.id) && !BUILTIN_PI_COMMANDS.some((builtin) => builtin.id === command.id));
  return [...BUILTIN_PI_COMMANDS, ...merged];
}
