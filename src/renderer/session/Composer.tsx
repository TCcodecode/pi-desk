import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ModelOption,
  ComposerImageAttachmentFile,
  ProjectFileEntry,
  ProjectSummary,
  SessionSummary,
  ThinkingLevel,
  AgentMode,
} from "../../shared/protocol";
import { ModelSelector } from "./ModelSelector";
import { ControlBox } from "../ui/ControlBox";
import { ComposerMenu } from "./ComposerMenu";
import { CommandPicker, filterPaletteCommands } from "../app/CommandPalette";
import type { PaletteCommand } from "../app/commandTypes";
import { AppIcon } from "../ui/icons";
import { ComposerQueuePanel } from "./ComposerQueuePanel";

const DEFAULT_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

interface ImageAttachment {
  id: string;
  name: string;
  path: string;
  previewUrl: string;
  source: "picker" | "paste";
}

type AtOption =
  | { kind: "file"; file: ProjectFileEntry }
  | { kind: "session"; session: SessionSummary };

export interface ComposerSubmitAttachment {
  name: string;
  path: string;
}

export interface ComposerSubmitPayload {
  text: string;
  attachments: ComposerSubmitAttachment[];
}

export interface ComposerProps {
  onSubmit: (payload: ComposerSubmitPayload) => Promise<boolean>;
  onAbort: () => void;
  onPickFile: () => Promise<string | undefined>;
  /** Previously submitted user messages from the active conversation. */
  history?: string[];
  /** Resets input navigation when the active conversation changes. */
  conversationId?: string;
  commands?: PaletteCommand[];
  sessions?: SessionSummary[];
  listProjectFiles?: (cwd?: string) => Promise<ProjectFileEntry[]>;
  isRunning: boolean;
  queue: { steering: string[]; followUp: string[] };
  onEditFollowUp?: (index: number, text: string) => Promise<boolean>;
  onSendFollowUpNow?: (index: number) => Promise<boolean>;
  models?: ModelOption[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  mode?: AgentMode;
  onModelSelect?: (model: string) => void;
  onThinkingLevel?: (level: ThinkingLevel) => void;
  onModeChange?: (mode: AgentMode) => void;
  workspaceName?: string;
  workspacePath?: string;
  branchName?: string;
  /** Projects available in the composer project control. */
  projects?: ProjectSummary[];
  /** Currently selected project id (cwd / catalog id). */
  projectId?: string;
  /** User picked another existing project from the composer control. */
  onProjectChange?: (projectId: string) => void;
  /** User chose “Open project…” from the composer control. */
  onOpenProject?: () => void;
  /** Optional context-specific input placeholder. */
  placeholder?: string;
}

export function Composer({
  onSubmit,
  onAbort,
  onPickFile,
  history = [],
  conversationId,
  commands = [],
  sessions = [],
  listProjectFiles,
  isRunning,
  queue,
  onEditFollowUp,
  onSendFollowUpNow,
  models = [],
  model = "",
  thinkingLevel = "medium",
  mode = "execute",
  onModelSelect,
  onThinkingLevel,
  onModeChange,
  workspaceName,
  workspacePath,
  branchName,
  projects = [],
  projectId,
  onProjectChange,
  onOpenProject,
  placeholder,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [submittedHistory, setSubmittedHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [sending, setSending] = useState(false);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState("");
  const [queueActionIndex, setQueueActionIndex] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState("");
  const [atPickerOpen, setAtPickerOpen] = useState(false);
  const [atHighlighted, setAtHighlighted] = useState(0);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandPickerOpen, setCommandPickerOpen] = useState(false);
  const [commandHighlighted, setCommandHighlighted] = useState(0);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [draggingAttachments, setDraggingAttachments] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyDraftRef = useRef("");
  const historyCaretRef = useRef<number | null>(null);
  const atCaretRef = useRef(0);
  const commandTokenRef = useRef<{ start: number; end: number; query: string } | null>(null);
  const commandCaretRef = useRef<number | null>(null);
  const attachmentIdRef = useRef(0);

  const nextAttachmentId = () => {
    attachmentIdRef.current += 1;
    return `attachment-${attachmentIdRef.current}`;
  };

  const isImagePath = (path: string) => IMAGE_PATH_RE.test(path);

  const loadPreviewUrl = async (path: string): Promise<string> => {
    const preview = await window.pi?.loadImagePreview?.(path);
    if (preview) return preview;
    if (path.startsWith("file://")) return path;
    return new URL(`file://${path}`).toString();
  };

  const buildAttachment = async (
    file: ComposerImageAttachmentFile | { path: string; name: string },
    source: ImageAttachment["source"],
  ): Promise<ImageAttachment> => ({
    id: nextAttachmentId(),
    name: file.name || file.path.split("/").pop() || "image",
    path: file.path,
    previewUrl: await loadPreviewUrl(file.path),
    source,
  });

  const addImageAttachments = async (
    files: Array<ComposerImageAttachmentFile | { path: string; name: string }>,
    source: ImageAttachment["source"],
  ) => {
    if (files.length === 0) return;
    const next = await Promise.all(files.map((file) => buildAttachment(file, source)));
    setAttachments((current) => [...current, ...next]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };

  const appendPathsToText = (paths: string[]) => {
    if (paths.length === 0) return;
    setText((current) => [current, ...paths].filter(Boolean).join(" ").trim());
  };

  const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
    if (typeof blob.arrayBuffer === "function") {
      return new Uint8Array(await blob.arrayBuffer());
    }
    return await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read clipboard image"));
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
  };

  const historyEntries = useMemo(() => {
    const persisted = history.filter((item) => item.trim().length > 0);
    if (submittedHistory.length === 0) return persisted;

    // The runtime normally echoes submitted messages into `history`. Keep the
    // local copy only until that echo arrives so Up works without a round trip.
    const echoedStart = persisted.length - submittedHistory.length;
    const echoed =
      echoedStart >= 0 &&
      submittedHistory.every((item, index) => persisted[echoedStart + index] === item);
    return echoed ? persisted : [...persisted, ...submittedHistory];
  }, [history, submittedHistory]);

  const availableModels = useMemo(() => models.filter((item) => item.available), [models]);
  const resolvedModel = useMemo(() => {
    if (availableModels.some((item) => item.id === model)) return model;
    return availableModels[0]?.id ?? "";
  }, [availableModels, model]);

  const thinkingLevels = useMemo(() => {
    const selected = availableModels.find((item) => item.id === resolvedModel);
    if (selected?.thinkingLevels?.length) return selected.thinkingLevels;
    return DEFAULT_THINKING_LEVELS;
  }, [availableModels, resolvedModel]);

  const filteredCommands = useMemo(
    () => filterPaletteCommands(commands, commandQuery).slice(0, 8),
    [commands, commandQuery],
  );

  useEffect(() => {
    if (editingQueueIndex !== null && editingQueueIndex >= queue.followUp.length) {
      setEditingQueueIndex(null);
      setEditingQueueText("");
    }
  }, [editingQueueIndex, queue.followUp.length]);

  const submit = async () => {
    const value = text.trim();
    if ((value.length === 0 && attachments.length === 0) || sending) return;
    setSending(true);
    // Clear optimistically so the box never keeps sent text while the agent
    // runs; restore only when the send is rejected before starting.
    const snapshot = text;
    setText("");
    try {
      const sent = await onSubmit({
        text: value,
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          path: attachment.path,
        })),
      });
      if (!sent) {
        setText(snapshot);
      } else {
        if (value) setSubmittedHistory((current) => [...current, value]);
        setAttachments([]);
        setHistoryIndex(-1);
        historyDraftRef.current = "";
      }
    } catch {
      setText(snapshot);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  useEffect(() => {
    setSubmittedHistory([]);
    setHistoryIndex(-1);
    historyDraftRef.current = "";
    setAttachments([]);
  }, [conversationId]);

  useEffect(() => {
    if (historyIndex >= historyEntries.length) setHistoryIndex(-1);
  }, [historyEntries.length, historyIndex]);

  useEffect(() => {
    const caret = historyCaretRef.current;
    if (caret === null) return;
    textareaRef.current?.setSelectionRange(caret, caret);
    historyCaretRef.current = null;
  }, [text]);

  const navigateHistory = (direction: "up" | "down"): boolean => {
    if (historyEntries.length === 0) return false;
    const input = textareaRef.current;
    const caret = input?.selectionStart ?? text.length;
    const isBrowsing = historyIndex >= 0;
    const atBoundary =
      text.length === 0 ||
      (direction === "up" ? caret === 0 : caret === text.length);
    if (!isBrowsing && !atBoundary) return false;

    if (direction === "up") {
      if (!isBrowsing) historyDraftRef.current = text;
      const nextIndex = isBrowsing ? Math.max(historyIndex - 1, 0) : historyEntries.length - 1;
      setHistoryIndex(nextIndex);
      const nextText = historyEntries[nextIndex] ?? "";
      historyCaretRef.current = nextText.length;
      setText(nextText);
      return true;
    }

    if (!isBrowsing) return false;
    if (historyIndex < historyEntries.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      const nextText = historyEntries[nextIndex] ?? "";
      historyCaretRef.current = nextText.length;
      setText(nextText);
      return true;
    }

    setHistoryIndex(-1);
    const draft = historyDraftRef.current;
    historyDraftRef.current = "";
    historyCaretRef.current = draft.length;
    setText(draft);
    return true;
  };

  const beginQueueEdit = (index: number) => {
    setEditingQueueIndex(index);
    setEditingQueueText(queue.followUp[index] ?? "");
  };

  const cancelQueueEdit = () => {
    setEditingQueueIndex(null);
    setEditingQueueText("");
  };

  const saveQueueEdit = async () => {
    if (editingQueueIndex === null || !onEditFollowUp || !editingQueueText.trim()) return;
    const index = editingQueueIndex;
    setQueueActionIndex(index);
    try {
      if (await onEditFollowUp(index, editingQueueText.trim())) cancelQueueEdit();
    } finally {
      setQueueActionIndex(null);
    }
  };

  const sendQueueItemNow = async (index: number) => {
    if (!onSendFollowUpNow || editingQueueIndex !== null) return;
    setQueueActionIndex(index);
    try {
      if (await onSendFollowUpNow(index)) cancelQueueEdit();
    } finally {
      setQueueActionIndex(null);
    }
  };

  const replaceAtMarker = (insert: string) => {
    setText((current) => {
      const caret = Math.min(atCaretRef.current, current.length);
      const before = current.slice(0, caret);
      const atIndex = before.lastIndexOf("@");
      if (atIndex === -1) return current;
      const prefix = before.slice(0, atIndex);
      const suffix = current.slice(caret);
      return `${prefix}${insert} ${suffix}`;
    });
    setAtPickerOpen(false);
    setAtQuery("");
    textareaRef.current?.focus();
  };

  const findCommandToken = (value: string, caret: number) => {
    const beforeCaret = value.slice(0, caret);
    const match = /(?:^|\s)\/([^\s]*)$/.exec(beforeCaret);
    if (!match) return null;
    const tokenStart = match.index + (match[0].startsWith("/") ? 0 : 1);
    return { start: tokenStart, end: caret, query: match[1] ?? "" };
  };

  useEffect(() => {
    if (commandPickerOpen || commands.length === 0 || !text) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const commandToken = findCommandToken(text, caret);
    if (!commandToken) return;
    commandTokenRef.current = commandToken;
    setCommandQuery(commandToken.query);
    setCommandHighlighted(0);
    setCommandPickerOpen(true);
    setAtPickerOpen(false);
  }, [commandPickerOpen, commands.length, text]);

  const selectCommand = (command: PaletteCommand) => {
    const token = commandTokenRef.current;
    if (!token) return;
    const insertion = `${command.name} `;
    const next = `${text.slice(0, token.start)}${insertion}${text.slice(token.end)}`;
    commandCaretRef.current = token.start + insertion.length;
    setText(next);
    commandTokenRef.current = null;
    setCommandPickerOpen(false);
    setCommandQuery("");
    textareaRef.current?.focus();
  };

  useEffect(() => {
    const caret = commandCaretRef.current;
    if (caret === null) return;
    textareaRef.current?.setSelectionRange(caret, caret);
    commandCaretRef.current = null;
  }, [text]);

  const pickSession = (session: SessionSummary) => {
    if (session.sessionFile) replaceAtMarker(`@session:${session.sessionFile}`);
  };

  const pickReferenceFile = async () => {
    const path = await onPickFile();
    if (!path) return;
    if (atPickerOpen && text.slice(0, atCaretRef.current).includes("@")) {
      replaceAtMarker(`@${path}`);
      return;
    }
    appendPathsToText([path]);
    setAtPickerOpen(false);
    setAtQuery("");
    textareaRef.current?.focus();
  };

  const pickAttachment = async () => {
    const path = await onPickFile();
    if (!path) return;
    if (isImagePath(path)) {
      await addImageAttachments([{ path, name: path.split("/").pop() ?? "image" }], "picker");
      textareaRef.current?.focus();
      return;
    }
    appendPathsToText([path]);
    textareaRef.current?.focus();
  };

  const handleAttachmentDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingAttachments(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length === 0) return;

    const paths: string[] = [];
    const imageFiles: Array<{ path: string; name: string }> = [];
    for (const file of dropped) {
      const path = (file as File & { path?: string }).path;
      if (!path) continue;
      if (file.type.startsWith("image/") || isImagePath(path)) {
        imageFiles.push({ path, name: file.name || path.split("/").pop() || "image" });
      } else {
        paths.push(path);
      }
    }
    if (imageFiles.length > 0) await addImageAttachments(imageFiles, "picker");
    appendPathsToText(paths);
    textareaRef.current?.focus();
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItems = Array.from(event.clipboardData.items).filter(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    if (imageItems.length === 0) return;

    const persistImageAttachment = window.pi?.persistImageAttachment;
    if (!persistImageAttachment) return;

    event.preventDefault();

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const saved = await persistImageAttachment({
        name: file.name || "pasted-image.png",
        mimeType: file.type || "image/png",
        bytes: await readBlobBytes(file),
      });
      await addImageAttachments([saved], "paste");
    }
  };

  const pickFileEntry = (file: ProjectFileEntry) => {
    replaceAtMarker(`@${file.path}`);
  };

  const filteredSessions = useMemo(() => {
    const q = atQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => session.name.toLowerCase().includes(q));
  }, [sessions, atQuery]);

  useEffect(() => {
    if (!atPickerOpen || !listProjectFiles || projectFiles.length > 0) return;
    let active = true;
    setFilesLoading(true);
    void listProjectFiles().then((files) => {
      if (active) setProjectFiles(files);
    }).finally(() => {
      if (active) setFilesLoading(false);
    });
    return () => { active = false; };
  }, [atPickerOpen, listProjectFiles, projectFiles.length]);

  const filteredFiles = useMemo(() => {
    const q = atQuery.trim().toLowerCase();
    if (!q) return projectFiles.slice(0, 30);
    return projectFiles.filter((file) => {
      const name = file.path.split("/").pop()?.toLowerCase() ?? "";
      return name.includes(q) || file.path.toLowerCase().includes(q);
    }).slice(0, 30);
  }, [projectFiles, atQuery]);

  const atOptions = useMemo<AtOption[]>(() => [
    ...filteredFiles.map((file) => ({ kind: "file" as const, file })),
    ...filteredSessions.map((session) => ({ kind: "session" as const, session })),
  ], [filteredFiles, filteredSessions]);

  const selectAtOption = (index: number) => {
    const option = atOptions[index];
    if (!option) return;
    if (option.kind === "file") pickFileEntry(option.file);
    else pickSession(option.session);
  };

  useEffect(() => {
    setAtHighlighted(0);
  }, [atPickerOpen, atQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isRunning) onAbort();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        textareaRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, onAbort]);

  useEffect(() => {
    if (!onThinkingLevel) return;
    if (!thinkingLevels.includes(thinkingLevel) && thinkingLevels[0]) {
      onThinkingLevel(thinkingLevels[0]);
    }
  }, [thinkingLevel, thinkingLevels, onThinkingLevel]);

  const contextTitle = [workspacePath, branchName].filter(Boolean).join(" · ");

  const resolvedProjectId = useMemo(() => {
    if (projectId && projects.some((item) => item.id === projectId)) return projectId;
    if (workspacePath) {
      const match = projects.find((item) => item.path === workspacePath || item.id === workspacePath);
      if (match) return match.id;
    }
    return projects[0]?.id ?? "";
  }, [projectId, projects, workspacePath]);
  const resolvedProjectName = projects.find((project) => project.id === resolvedProjectId)?.name ?? workspaceName ?? "Project";
  const commandPickerId = "composer-command-picker";
  const atPickerId = "composer-reference-picker";
  const activePickerId = commandPickerOpen ? commandPickerId : atPickerOpen ? atPickerId : undefined;
  const activeDescendant = commandPickerOpen
    ? `${commandPickerId}-option-${commandHighlighted}`
    : atPickerOpen && atOptions[atHighlighted]
      ? `${atPickerId}-option-${atHighlighted}`
      : undefined;

  return (
    <div className="composer-area live-composer">
      {queue.followUp.length > 0 && (
        <ComposerQueuePanel
          messages={queue.followUp}
          editingIndex={editingQueueIndex}
          editingText={editingQueueText}
          actingIndex={queueActionIndex}
          canAct={Boolean(onEditFollowUp && onSendFollowUpNow)}
          onBeginEdit={beginQueueEdit}
          onCancelEdit={cancelQueueEdit}
          onSaveEdit={() => void saveQueueEdit()}
          onSendNow={(index) => void sendQueueItemNow(index)}
          onEditingTextChange={setEditingQueueText}
        />
      )}
      <div
        className={`composer-card${draggingAttachments ? " is-dragging" : ""}`}
        aria-busy={sending}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDraggingAttachments(true);
          }
        }}
        onDragLeave={(event) => {
          const relatedTarget = event.relatedTarget;
          if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) setDraggingAttachments(false);
        }}
        onDrop={(event) => void handleAttachmentDrop(event)}
      >
        {draggingAttachments && <div className="composer-drop-hint" role="status">Drop files to attach</div>}
        <textarea
          className="composer-input"
          ref={textareaRef}
          aria-label="Message"
          aria-autocomplete="list"
          aria-controls={activePickerId}
          aria-expanded={Boolean(activePickerId)}
          aria-activedescendant={activeDescendant}
          value={text}
          placeholder={isRunning ? "Queue a follow-up..." : placeholder ?? "Ask Pi anything about this workspace..."}
          onPaste={(event) => {
            void handlePaste(event);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (historyIndex >= 0) {
              setHistoryIndex(-1);
              historyDraftRef.current = "";
            }
            const caret = event.target.selectionStart ?? next.length;
            const beforeCaret = next.slice(0, caret);

            const commandToken = findCommandToken(next, caret);
            if (commandToken && commands.length > 0) {
              commandTokenRef.current = commandToken;
              setCommandQuery(commandToken.query);
              setCommandHighlighted(0);
              setCommandPickerOpen(true);
              setAtPickerOpen(false);
              return;
            }
            commandTokenRef.current = null;
            setCommandPickerOpen(false);

            const atIndex = beforeCaret.lastIndexOf("@");
            const prevChar = atIndex > 0 ? beforeCaret[atIndex - 1] : "";
            if (atIndex !== -1 && !/\w/.test(prevChar)) {
              atCaretRef.current = caret;
              setAtQuery(beforeCaret.slice(atIndex + 1));
              setAtHighlighted(0);
              setAtPickerOpen(true);
            } else if (atIndex === -1) {
              setAtPickerOpen(false);
            }
          }}
          onKeyDown={(event) => {
            // Let IMEs consume Enter while choosing/committing a candidate.
            // WebKit can end composition before it dispatches that Enter, but
            // reports the legacy 229 key code for the IME-owned event.
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (commandPickerOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCommandHighlighted((current) => Math.min(current + 1, Math.max(filteredCommands.length - 1, 0)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCommandHighlighted((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setCommandPickerOpen(false);
                commandTokenRef.current = null;
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                const command = filteredCommands[commandHighlighted];
                if (command) {
                  event.preventDefault();
                  selectCommand(command);
                  return;
                }
              }
            }
            if (atPickerOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setAtHighlighted((current) => Math.min(current + 1, Math.max(atOptions.length - 1, 0)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setAtHighlighted((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                selectAtOption(atHighlighted);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setAtPickerOpen(false);
                return;
              }
            }
            if (
              (event.key === "ArrowUp" || event.key === "ArrowDown") &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              navigateHistory(event.key === "ArrowUp" ? "up" : "down")
            ) {
              event.preventDefault();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !atPickerOpen) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape" && atPickerOpen) {
              event.preventDefault();
              setAtPickerOpen(false);
            }
          }}
        />
        {commandPickerOpen && (
          <CommandPicker
            id={commandPickerId}
            commands={commands}
            query={commandQuery}
            highlighted={commandHighlighted}
            onHighlight={setCommandHighlighted}
            onSelect={selectCommand}
          />
        )}
        {atPickerOpen && (
          <div id={atPickerId} className="at-picker" role="listbox" aria-label="Reference picker">
            <div className="at-picker-group">
              <div className="at-picker-label">Files</div>
              {filesLoading ? (
                <div className="at-picker-empty">Loading files…</div>
              ) : filteredFiles.length === 0 ? (
                <button type="button" className="at-picker-item" onClick={() => void pickReferenceFile()}>
                  <span className="at-picker-icon" aria-hidden>
                    <AppIcon name="folder" size="sm" />
                  </span>
                  <span className="at-picker-name">Browse file…</span>
                </button>
              ) : (
                filteredFiles.map((file) => (
                  <div
                    key={file.path}
                    id={`${atPickerId}-option-${atOptions.findIndex((option) => option.kind === "file" && option.file.path === file.path)}`}
                    role="option"
                    aria-selected={atHighlighted === atOptions.findIndex((option) => option.kind === "file" && option.file.path === file.path)}
                  >
                    <button
                      type="button"
                      className="at-picker-item"
                      onMouseEnter={() => setAtHighlighted(atOptions.findIndex((option) => option.kind === "file" && option.file.path === file.path))}
                      onClick={() => pickFileEntry(file)}
                    >
                      <span className="at-picker-icon" aria-hidden>
                        <AppIcon name={file.isDir ? "folder" : "file"} size="sm" />
                      </span>
                      <span className="at-picker-name">{file.path}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="at-picker-group">
              <div className="at-picker-label">Sessions</div>
              {filteredSessions.length === 0 ? (
                <div className="at-picker-empty">No matching sessions</div>
              ) : (
                filteredSessions.map((session) => (
                  <div
                    key={session.sessionId}
                    id={`${atPickerId}-option-${atOptions.findIndex((option) => option.kind === "session" && option.session.sessionId === session.sessionId)}`}
                    role="option"
                    aria-selected={atHighlighted === atOptions.findIndex((option) => option.kind === "session" && option.session.sessionId === session.sessionId)}
                  >
                    <button
                      type="button"
                      className="at-picker-item"
                      onMouseEnter={() => setAtHighlighted(atOptions.findIndex((option) => option.kind === "session" && option.session.sessionId === session.sessionId))}
                      onClick={() => pickSession(session)}
                    >
                      <span className="at-picker-icon" aria-hidden>
                        <AppIcon name="messageSquare" size="sm" />
                      </span>
                      <span className="at-picker-name">{session.name}</span>
                      <span className="at-picker-meta">{new Date(session.updatedAt).toLocaleDateString()}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments" role="list" aria-label="Selected image attachments">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="composer-attachment-card"
                role="listitem"
                aria-label={`Attachment preview ${attachment.name}`}
              >
                <img src={attachment.previewUrl} alt={attachment.name} />
                <div className="composer-attachment-meta">
                  <span className="composer-attachment-name">{attachment.name}</span>
                  <span className="composer-attachment-source">{attachment.source}</span>
                </div>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label={`Remove attachment ${attachment.name}`}
                  onClick={() => removeAttachment(attachment.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-primary-tools composer-tools">
            <ControlBox
              as="button"
              className="ctrl-box"
              ariaLabel="Attach file"
              buttonProps={{ onClick: () => void pickAttachment() }}
            >
              <AppIcon name="plus" size="sm" />
            </ControlBox>
          </div>

          <div className="composer-context-tools composer-meta">
            {onModeChange && (
              <div className="composer-mode-switch" role="group" aria-label="Agent mode">
                <button
                  type="button"
                  className={`composer-mode-option ${mode === "plan" ? "active" : ""}`}
                  aria-pressed={mode === "plan"}
                  disabled={isRunning}
                  title="Plan mode — project changes locked"
                  onClick={() => onModeChange("plan")}
                >
                  Plan
                </button>
                <button
                  type="button"
                  className={`composer-mode-option ${mode === "execute" ? "active" : ""}`}
                  aria-pressed={mode === "execute"}
                  disabled={isRunning}
                  title="Execute mode — tools can modify the project"
                  onClick={() => onModeChange("execute")}
                >
                  Execute
                </button>
              </div>
            )}
            {((onProjectChange || onOpenProject) || workspaceName || branchName) && (
              (onProjectChange || onOpenProject) ? (
                <ComposerMenu
                  className="composer-context-control"
                  title={contextTitle || workspacePath || resolvedProjectName}
                  ariaLabel="Project"
                  value={resolvedProjectId}
                  valueLabel={resolvedProjectName}
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                  onChange={(next) => onProjectChange?.(next)}
                  actions={onOpenProject ? [{ id: "open-project", label: "Open project…", onSelect: onOpenProject }] : undefined}
                  suffix={branchName ? (
                    <>
                      <span className="composer-context-sep" aria-hidden>·</span>
                      <span className="composer-context-branch">{branchName}</span>
                    </>
                  ) : undefined}
                />
              ) : (
                <div className="composer-context-control" aria-label="Workspace context" title={contextTitle || undefined}>
                  {workspaceName && <span className="composer-context-workspace">{workspaceName}</span>}
                  {branchName && (
                    <>
                      <span className="composer-context-sep" aria-hidden>·</span>
                      <span className="composer-context-branch">{branchName}</span>
                    </>
                  )}
                </div>
              )
            )}
            {onModelSelect && (
              <ModelSelector
                variant="pill"
                className="composer-model"
                models={availableModels}
                current={resolvedModel}
                onSelect={onModelSelect}
              />
            )}
            {onThinkingLevel && (
              <ComposerMenu
                className="composer-thinking"
                ariaLabel="Thinking level"
                title="Thinking level"
                value={thinkingLevels.includes(thinkingLevel) ? thinkingLevel : thinkingLevels[0]}
                valueLabel={thinkingLevels.includes(thinkingLevel) ? thinkingLevel : thinkingLevels[0]}
                options={thinkingLevels.map((level) => ({ value: level, label: level }))}
                onChange={(level) => onThinkingLevel(level as ThinkingLevel)}
              />
            )}
          </div>

          <div className="composer-action-tools">
            {isRunning && (
              <button className="send-button stop" aria-label="Stop agent" onClick={onAbort}>
                ■
              </button>
            )}
            <button className="send-button" aria-label={isRunning ? "Queue follow-up" : "Send message"} onClick={() => void submit()}>
              ↑
            </button>
          </div>
        </div>
      </div>
      <div className="composer-hints">
        {queue.followUp.length === 0 && (
          <>
            <span>Enter to send</span>
            <span>Shift+Enter for newline</span>
          </>
        )}
        <span>Type / for commands</span>
      </div>
    </div>
  );
}
