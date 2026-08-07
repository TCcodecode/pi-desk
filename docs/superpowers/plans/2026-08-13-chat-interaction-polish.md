# Chat Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interrupted-message `Copy / Edit` and image attachment preview for pasted or selected images without changing existing rollback, queue, runtime, or normal file-reference behavior.

**Architecture:** Keep the change localized to the current chat surface. `Timeline` only exposes message actions, `Composer` owns draft/edit/attachment UI state, `App` wires those UI events into the existing session send flow, and Electron adds the minimum IPC needed to select multiple attachment files and persist pasted clipboard images as temporary attachments.

**Tech Stack:** React, TypeScript, Electron IPC (`ipcMain` / `contextBridge`), Vitest, Testing Library

---

**Product source of truth:** `docs/superpowers/specs/2026-08-13-chat-interaction-polish-design.md`

**Execution note:** Do not add new rollback or queueing features. Do not create git commits unless the user explicitly asks for them.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/protocol.ts` | Define attachment DTOs and the new Pi API methods for attachment-file selection / pasted-image persistence. |
| `electron/main.ts` | Register new IPC handlers for image picking and pasted-image persistence. |
| `electron/preload.ts` | Expose the new attachment APIs to `window.pi`. |
| `electron/composerAttachments.ts` | Small helper for temp attachment writes and filename normalization. |
| `electron/composerAttachments.test.ts` | Unit tests for temp image persistence behavior. |
| `src/renderer/components/Composer.tsx` | Own draft-edit mode, attachment tray UI, paste handling, and submit payload creation. |
| `src/renderer/components/Composer.test.tsx` | Verify attachment tray, image paste, delete, and interrupted-edit banner behavior. |
| `src/renderer/components/Timeline.tsx` | Show hover `Copy / Edit` only for the interrupted user message. |
| `src/renderer/components/Timeline.test.tsx` | Verify the hover actions appear only on the intended user turn and fire callbacks. |
| `src/renderer/App.tsx` | Compute the editable interrupted message, wire timeline actions into composer state, and translate attachments into internal prompt references. |
| `src/renderer/app.send-flow.test.tsx` | End-to-end renderer tests for edit-resend and attachment-aware prompt submission. |
| `src/renderer/styles.css` | Add minimal styles for message hover actions, edit banner, and image attachment tray. |

## Task 1: Add the image attachment IPC surface

**Files:**
- Create: `electron/composerAttachments.ts`
- Test: `electron/composerAttachments.test.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Write the failing helper tests for persisted pasted images**

```ts
// electron/composerAttachments.test.ts
import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistComposerImage } from "./composerAttachments";

describe("persistComposerImage", () => {
  test("writes png bytes under the attachment temp directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-attachments-"));
    const saved = await persistComposerImage({
      rootDir: root,
      name: "clipboard.png",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    expect(saved.name).toBe("clipboard.png");
    expect(saved.path.endsWith(".png")).toBe(true);
    expect(readFileSync(saved.path)).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  test("normalizes unsafe filenames and preserves extension", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-attachments-"));
    const saved = await persistComposerImage({
      rootDir: root,
      name: "../../Screen Shot 2026-08-13.PNG",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(saved.name).toBe("screen-shot-2026-08-13.png");
    expect(saved.path.endsWith("screen-shot-2026-08-13.png")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new helper test and confirm it fails**

Run:

```bash
npx vitest run electron/composerAttachments.test.ts
```

Expected: FAIL with `Cannot find module './composerAttachments'` or `persistComposerImage is not defined`.

- [ ] **Step 3: Implement the helper and extend the API contracts**

```ts
// src/shared/protocol.ts
export interface ComposerImageAttachmentInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ComposerImageAttachmentFile {
  path: string;
  name: string;
}

export interface PiApi {
  chooseAttachmentFiles(): Promise<string[]>;
  persistImageAttachment(input: ComposerImageAttachmentInput): Promise<ComposerImageAttachmentFile>;
  // existing methods...
}
```

```ts
// electron/composerAttachments.ts
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

function slugifyFileName(input: string, fallbackExt: string): string {
  const safeBase = basename(input).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = extname(safeBase) || fallbackExt;
  const stem = (safeBase.slice(0, safeBase.length - ext.length) || "pasted-image").replace(/\.+$/g, "");
  return `${stem}${ext.toLowerCase()}`;
}

export async function persistComposerImage({
  rootDir,
  name,
  mimeType,
  bytes,
}: {
  rootDir: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ path: string; name: string }> {
  const ext = mimeType === "image/jpeg" ? ".jpg" : ".png";
  const fileName = slugifyFileName(name, ext);
  await mkdir(rootDir, { recursive: true });
  const filePath = join(rootDir, fileName);
  await writeFile(filePath, bytes);
  return { path: filePath, name: fileName };
}
```

```ts
// electron/main.ts
import { app } from "electron";
import { join } from "node:path";
import { persistComposerImage } from "./composerAttachments.js";

ipcMain.handle("pi:chooseAttachmentFiles", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("pi:persistImageAttachment", async (_event, input) => {
  const rootDir = join(app.getPath("temp"), "pi-desk", "composer-attachments");
  return persistComposerImage({ rootDir, ...input });
});
```

```ts
// electron/preload.ts
const api: PiApi = {
  chooseAttachmentFiles: () => ipcRenderer.invoke("pi:chooseAttachmentFiles"),
  persistImageAttachment: (input) => ipcRenderer.invoke("pi:persistImageAttachment", input),
  // existing methods...
};
```

- [ ] **Step 4: Run the helper test and confirm it passes**

Run:

```bash
npx vitest run electron/composerAttachments.test.ts
```

Expected: PASS with `2 passed`.

## Task 2: Add attachment tray UI and image paste handling in Composer

**Files:**
- Modify: `src/renderer/components/Composer.tsx`
- Modify: `src/renderer/components/Composer.test.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Write the failing Composer tests for pasted and selected images**

```ts
// src/renderer/components/Composer.test.tsx
test("shows pasted images in an attachment tray instead of writing file paths into the textarea", async () => {
  const persistImageAttachment = vi.fn(async () => ({ path: "/tmp/pasted-1.png", name: "pasted-1.png" }));
  Object.defineProperty(window, "pi", {
    configurable: true,
    value: { ...window.pi, persistImageAttachment },
  });

  renderComposer();
  const input = screen.getByRole("textbox", { name: /message/i });
  const file = new File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
  fireEvent.paste(input, {
    clipboardData: {
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
    },
  });

  expect(await screen.findByLabelText(/attachment preview pasted-1\.png/i)).toBeInTheDocument();
  expect((input as HTMLTextAreaElement).value).toBe("");
});

test("adds selected image files to the attachment tray and lets the user remove one", async () => {
  const chooseAttachmentFiles = vi.fn(async () => ["/tmp/a.png", "/tmp/b.jpg"]);
  Object.defineProperty(window, "pi", {
    configurable: true,
    value: { ...window.pi, chooseAttachmentFiles },
  });

  renderComposer();
  fireEvent.click(screen.getByRole("button", { name: /attach file/i }));

  expect(await screen.findByLabelText(/attachment preview a\.png/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /remove attachment a\.png/i }));
  expect(screen.queryByLabelText(/attachment preview a\.png/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/attachment preview b\.jpg/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the Composer test file and confirm these new tests fail**

Run:

```bash
npx vitest run src/renderer/components/Composer.test.tsx
```

Expected: FAIL because `chooseAttachmentFiles` / `persistImageAttachment` do not participate in `Composer`, and no attachment tray markup exists yet.

- [ ] **Step 3: Implement attachment state, tray rendering, and paste handling**

```ts
// src/renderer/components/Composer.tsx
type ImageAttachment = {
  id: string;
  name: string;
  path: string;
  previewUrl: string;
  source: "picker" | "paste";
};

export interface ComposerSubmitPayload {
  text: string;
  attachments: ImageAttachment[];
}

export interface ComposerProps {
  onSubmit: (payload: ComposerSubmitPayload) => Promise<boolean>;
  // existing props...
}

const [attachments, setAttachments] = useState<ImageAttachment[]>([]);

const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);

const addImagePaths = (paths: string[]) => {
  setAttachments((current) => [
    ...current,
    ...paths.map((path, index) => ({
      id: `${path}-${index}`,
      name: path.split("/").pop() ?? "image",
      path,
      previewUrl: `file://${path}`,
      source: "picker" as const,
    })),
  ]);
};

const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const imageItems = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (imageItems.length === 0) return;
  event.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await window.pi?.persistImageAttachment({
      name: file.name || "pasted-image.png",
      mimeType: file.type || "image/png",
      bytes,
    });
    if (!saved) continue;
    setAttachments((current) => [...current, {
      id: `${saved.path}-${current.length}`,
      name: saved.name,
      path: saved.path,
      previewUrl: URL.createObjectURL(file),
      source: "paste",
    }]);
  }
};

const pickAttachmentFiles = async () => {
  const paths = await window.pi?.chooseAttachmentFiles?.();
  if (!paths?.length) return;
  const imagePaths = paths.filter(isImagePath);
  const referencePaths = paths.filter((path) => !isImagePath(path));
  if (imagePaths.length > 0) addImagePaths(imagePaths);
  if (referencePaths.length > 0) {
    setText((current) => [current, ...referencePaths].filter(Boolean).join(" ").trim());
  }
};

// inside submit()
const sent = await onSubmit({ text: value, attachments });
if (sent) setAttachments([]);
```

```tsx
// src/renderer/components/Composer.tsx
{attachments.length > 0 && (
  <div className="composer-attachments" aria-label="Selected image attachments">
    {attachments.map((attachment) => (
      <div key={attachment.id} className="composer-attachment-card" aria-label={`Attachment preview ${attachment.name}`}>
        <img src={attachment.previewUrl} alt={attachment.name} />
        <button
          type="button"
          className="composer-attachment-remove"
          aria-label={`Remove attachment ${attachment.name}`}
          onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
        >
          ×
        </button>
      </div>
    ))}
  </div>
)}

<textarea
  aria-label="Message"
  value={text}
  onPaste={(event) => void handlePaste(event)}
  // existing props...
/>
```

```css
/* src/renderer/styles.css */
.composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.composer-attachment-card {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #30333b;
}

.composer-attachment-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.composer-attachment-remove {
  position: absolute;
  top: 4px;
  right: 4px;
}
```

- [ ] **Step 4: Re-run the Composer tests and confirm they pass**

Run:

```bash
npx vitest run src/renderer/components/Composer.test.tsx
```

Expected: PASS with the new attachment tray tests green and no regressions in existing queue / slash-command tests.

## Task 3: Add interrupted-message hover actions in Timeline

**Files:**
- Modify: `src/renderer/components/Timeline.tsx`
- Modify: `src/renderer/components/Timeline.test.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Write the failing Timeline tests for interrupted-message actions**

```ts
// src/renderer/components/Timeline.test.tsx
test("shows copy and edit only for the active interrupted user message", () => {
  const onCopyUserMessage = vi.fn();
  const onEditInterruptedMessage = vi.fn();
  const items: TimelineItem[] = [
    { id: "user-1", kind: "user", content: "old prompt", status: "completed" },
    { id: "assistant-1", kind: "assistant", content: "done", status: "completed" },
    { id: "user-2", kind: "user", content: "interrupted prompt", status: "completed" },
  ];

  render(
    <Timeline
      items={items}
      editableInterruptedMessageId="user-2"
      onCopyUserMessage={onCopyUserMessage}
      onEditInterruptedMessage={onEditInterruptedMessage}
    />,
  );

  expect(screen.queryByRole("button", { name: /copy old prompt/i })).not.toBeInTheDocument();
  fireEvent.mouseEnter(screen.getByText("interrupted prompt"));
  fireEvent.click(screen.getByRole("button", { name: /copy interrupted prompt/i }));
  fireEvent.click(screen.getByRole("button", { name: /edit interrupted prompt/i }));

  expect(onCopyUserMessage).toHaveBeenCalledWith("user-2", "interrupted prompt");
  expect(onEditInterruptedMessage).toHaveBeenCalledWith("user-2", "interrupted prompt");
});
```

- [ ] **Step 2: Run the Timeline tests and confirm this new test fails**

Run:

```bash
npx vitest run src/renderer/components/Timeline.test.tsx
```

Expected: FAIL because `Timeline` does not yet accept interrupted-message action props or render hover controls for user messages.

- [ ] **Step 3: Implement the hover action row**

```ts
// src/renderer/components/Timeline.tsx
export interface TimelineProps {
  editableInterruptedMessageId?: string;
  onCopyUserMessage?: (messageId: string, content: string) => void;
  onEditInterruptedMessage?: (messageId: string, content: string) => void;
  // existing props...
}
```

```tsx
// inside the user-message branch
const isInterruptedTarget = item.id === editableInterruptedMessageId;
return (
  <article className={`timeline-item message-item user ${isInterruptedTarget ? "is-editable" : ""}`}>
    <div className="timeline-item-heading">
      <span className="timeline-icon user"><AppIcon name="user" size="sm" /></span>
      <strong>You</strong>
      {isInterruptedTarget && (
        <div className="timeline-message-actions">
          <button type="button" aria-label={`Copy ${item.content}`} onClick={() => onCopyUserMessage?.(item.id, item.content)}>
            <AppIcon name="copy" size="xs" />
          </button>
          <button type="button" aria-label={`Edit ${item.content}`} onClick={() => onEditInterruptedMessage?.(item.id, item.content)}>
            <AppIcon name="pencil" size="xs" />
          </button>
        </div>
      )}
    </div>
    <div className="message-content"><Markdown content={item.content} /></div>
  </article>
);
```

```css
/* src/renderer/styles.css */
.timeline-message-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.timeline-item.user.is-editable:hover .timeline-message-actions,
.timeline-item.user.is-editable:focus-within .timeline-message-actions {
  opacity: 1;
}
```

- [ ] **Step 4: Re-run the Timeline tests and confirm they pass**

Run:

```bash
npx vitest run src/renderer/components/Timeline.test.tsx
```

Expected: PASS with the new interrupted-message action test green and the existing change-summary tests still passing.

## Task 4: Wire edit-resend and attachment-aware submission through App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/app.send-flow.test.tsx`
- Modify: `src/renderer/components/Composer.tsx`

- [ ] **Step 1: Write the failing integration tests for edit-resend and hidden attachment refs**

```ts
// src/renderer/app.send-flow.test.tsx
test("fills the composer with the interrupted user message and resubmits it in the same session", async () => {
  const { api } = makeFakeApi();
  (window as unknown as { pi: PiApi }).pi = api;
  useAppStore.setState({
    ...createInitialState(),
    session: { ...createInitialState().session, sessionId: "s1", cwd: "/tmp/project", status: "idle" },
    projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
    activeProjectId: "/tmp/project",
    timeline: [
      { id: "user-1", kind: "user", content: "first prompt", status: "completed" },
      { id: "user-2", kind: "user", content: "retry this", status: "completed" },
    ],
  });
  render(<App />);

  fireEvent.mouseEnter(screen.getByText("retry this"));
  fireEvent.click(screen.getByRole("button", { name: /edit retry this/i }));
  expect((screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement).value).toBe("retry this");

  fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "retry this with logs" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(api.prompt).toHaveBeenCalledWith("retry this with logs", expect.anything()));
});

test("submits image attachments as internal prompt refs instead of visible textarea paths", async () => {
  const { api } = makeFakeApi();
  (window as unknown as { pi: PiApi }).pi = {
    ...api,
    chooseAttachmentFiles: vi.fn(async () => ["/tmp/shot-a.png"]),
    persistImageAttachment: vi.fn(async (input) => ({ path: "/tmp/pasted-1.png", name: input.name })),
  };
  useAppStore.setState({
    ...createInitialState(),
    session: { ...createInitialState().session, sessionId: "s1", cwd: "/tmp/project", status: "idle" },
    projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
    activeProjectId: "/tmp/project",
  });
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
  expect(await screen.findByLabelText(/attachment preview shot-a\.png/i)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "describe this" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(api.prompt).toHaveBeenCalled());
  expect(vi.mocked(api.prompt).mock.calls[0]?.[0]).toContain("@/tmp/shot-a.png");
  expect((screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement).value).toBe("");
});
```

- [ ] **Step 2: Run the renderer send-flow tests and confirm these new tests fail**

Run:

```bash
npx vitest run src/renderer/app.send-flow.test.tsx
```

Expected: FAIL because `App` still treats `Composer.onSubmit` as plain text, and there is no edit-resend wiring from `Timeline` to `Composer`.

- [ ] **Step 3: Implement the App glue and attachment formatting**

```ts
// src/renderer/App.tsx
type EditingInterruptedMessage = {
  messageId: string;
  text: string;
} | null;

const [editingInterruptedMessage, setEditingInterruptedMessage] = useState<EditingInterruptedMessage>(null);

const editableInterruptedMessageId = useMemo(() => {
  if (state.session.status === "running") return undefined;
  for (let i = state.timeline.length - 1; i >= 0; i -= 1) {
    const item = state.timeline[i];
    if (item.kind === "assistant" && item.status === "completed") return undefined;
    if (item.kind === "user") return item.id;
  }
  return undefined;
}, [state.session.status, state.timeline]);

const copyUserMessage = async (_messageId: string, content: string) => {
  await navigator.clipboard?.writeText(content);
};

const formatPromptWithAttachments = (text: string, attachments: Array<{ path: string }>) => {
  const refs = attachments.map((attachment) => `@${attachment.path}`);
  return [text.trim(), ...refs].filter(Boolean).join("\n");
};

const submit = async (payload: { text: string; attachments: Array<{ path: string }> }): Promise<boolean> => {
  if (!api) return false;
  if (!(await ensureSession())) return false;
  const sessionKey = activeTabIdRef.current ? await ensureActiveTabRuntime() : undefined;
  const resolved = await resolveSessionReferences(formatPromptWithAttachments(payload.text, payload.attachments));
  const opts = sessionKey ? { sessionKey } : undefined;
  await api.prompt(resolved, opts);
  setEditingInterruptedMessage(null);
  return true;
};
```

```tsx
// src/renderer/App.tsx
<Timeline
  items={timelineItems}
  editableInterruptedMessageId={editableInterruptedMessageId}
  onCopyUserMessage={copyUserMessage}
  onEditInterruptedMessage={(messageId, content) => setEditingInterruptedMessage({ messageId, text: content })}
  // existing props...
/>

<Composer
  onSubmit={submit}
  editDraft={editingInterruptedMessage}
  onCancelEdit={() => setEditingInterruptedMessage(null)}
  // existing props...
/>
```

```ts
// src/renderer/components/Composer.tsx
export interface ComposerProps {
  editDraft?: { messageId: string; text: string } | null;
  onCancelEdit?: () => void;
  // existing props...
}

useEffect(() => {
  if (!editDraft) return;
  setText(editDraft.text);
  textareaRef.current?.focus();
}, [editDraft]);
```

- [ ] **Step 4: Run the targeted renderer tests and the shared safety checks**

Run:

```bash
npx vitest run src/renderer/app.send-flow.test.tsx src/renderer/components/Composer.test.tsx src/renderer/components/Timeline.test.tsx
npm run typecheck
```

Expected:

- Vitest: PASS for the new edit-resend and attachment submission tests plus the focused component suites
- `npm run typecheck`: PASS with no new TypeScript errors

## Self-Review

### Spec coverage

- Interrupted-message `Copy / Edit`: covered by **Task 3** and **Task 4**
- Image picker + clipboard paste preview: covered by **Task 1** and **Task 2**
- No absolute image path shown in textarea: covered by **Task 2**
- Reuse current queue/runtime behavior without new scheduling rules: guarded in **Task 4**

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain
- All code-changing tasks include concrete snippets
- All verification steps include exact commands

### Type consistency

- Shared attachment contracts are defined first in `src/shared/protocol.ts`
- Renderer submit flow consistently uses `ComposerSubmitPayload`
- Attachment persistence naming is consistent across `persistImageAttachment`, `persistComposerImage`, and the `ImageAttachment` UI model
