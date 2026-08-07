# Android Mobile Control MVP — Implementation Plan

> **Status:** Planning only. Do not publish or push this plan yet.
>
> **Goal:** Build an Android-first mobile client that the owner can use personally to control a running pi-desk instance, ask the Agent to modify a Web project, and inspect the resulting preview from a phone or tablet-sized screen.

## Product decision

The first product is not a mobile copy of the desktop UI and not a remote mouse/keyboard. It is a small project change loop:

```text
Choose host/project
  → describe a change
  → watch Agent progress
  → inspect the modified Web preview
  → continue, keep, or roll back the change
```

The first release deliberately supports one user, one desktop host, one Android device, one active project/session, and Web projects. The implementation must leave room for iPad, remote Relay, and paid cloud features, but those are not part of this MVP.

## Current baseline

| Area | Current state | Plan implication |
|---|---|---|
| Agent runtime | `PiHost` owns runtime slots and emits `PiEvent` | Keep `PiHost` as the only Agent authority |
| Desktop transport | Electron IPC through `PiApi` | Add a network adapter beside IPC; do not expose raw IPC |
| Shared state | `PiSnapshot`, `PiEvent`, Zustand reducer | Reuse the event model, but define a remote-safe subset |
| Event metadata | `eventId`, `sessionKey`, `sequence` already exist | Use them for reconnect and deduplication |
| File changes | Per-file change tracking and undo already exist | Add task-level change sets around it |
| Preview | No general project preview supervisor yet | Build a small Web-preview process/proxy layer |
| Repository | Public GitHub remote, clean `main`, no `LICENSE` file yet | Keep this work in the public core repo; add a license before a formal release |

Related implementation files:

- `electron/piHost.ts`
- `electron/main.ts`
- `electron/preload.ts`
- `src/shared/protocol.ts`
- `src/renderer/state/appStore.ts`

## Non-goals for this plan

- No paid account, Stripe, billing, or official cloud Relay.
- No multi-user or team permissions.
- No native iOS build yet.
- No remote desktop streaming or mouse/keyboard control.
- No arbitrary shell terminal exposed to Android.
- No general-purpose file editor on mobile.
- No support promise for native mobile projects, CLI-only projects, or backend-only projects beyond logs and checks.
- No automatic publication/deployment to production.

## Technical decisions

### 1. Android client: Expo React Native, Android first

Use a separate mobile app under `apps/mobile/` with Expo React Native. It should share TypeScript contracts and domain-level state with pi-desk, but not reuse Electron-specific components or `window.pi`.

Reasons:

- Android is the first target, but the same app can later build for iPad/iOS.
- React/TypeScript knowledge and protocol types are reusable.
- Native secure storage is available for the paired device token.
- A WebView can display the project preview inside the task flow.
- The app can later add push notifications without changing the desktop protocol.

The first development target may run with an Expo development build. Produce an installable Android APK only after the LAN vertical slice works.

### 2. Transport: HTTP commands + WebSocket events

Use the same logical protocol for local and future remote modes:

```text
HTTP(S)     snapshot, projects, commands, preview metadata
WebSocket  live Agent events, task status, preview status, heartbeats
```

Android has a built-in WebSocket client, and the same event channel can later connect to an official Relay. This avoids maintaining separate Android and browser event implementations during the MVP.

The desktop service listens locally. It is not a cloud server:

```text
Android → local/Tailscale address → Electron main process → PiHost
```

### 3. Local first, Tailscale second

Development order:

1. Same Wi-Fi direct connection.
2. Tailscale connection for personal remote use.
3. Official Relay only in a future private repository.

Tailscale is a transport option, not a product dependency. The open-source client must work without it on the local network. For personal remote use, Tailscale Serve can expose the local service privately over HTTPS; it may use a direct path or a relay depending on network conditions.

### 4. Remote API is a safe subset, not the full `PiApi`

The desktop IPC API contains desktop-only operations such as opening files, choosing folders, provider login, and external application access. Android must not receive these directly.

The initial remote command allowlist is:

```text
getSnapshot
listProjects
listSessions
start/resume session
prompt
steer
followUp
abort
getTask
getDiff
rollbackChangeSet
startPreview
stopPreview
```

Do not expose these in the MVP:

```text
executeCommand
loginWithApiKey
logoutProvider
openExternal
revealInFolder
arbitrary file write
arbitrary shell execution
```

## Target user flow

### First pairing

1. User opens pi-desk on the desktop.
2. Desktop enables Mobile Control from a local settings action.
3. Desktop starts the local API on `127.0.0.1` by default.
4. User explicitly enables LAN access or Tailscale access.
5. Desktop shows a QR code containing a short-lived pairing URL/code, never a permanent credential.
6. Android scans the QR code.
7. Desktop and Android exchange a one-time pairing code.
8. Desktop issues a random device token.
9. Android stores the token in secure storage.
10. Desktop records the device name and allows later revocation.

For the first development slice, pairing may be a manually copied one-time token. The QR flow is required before personal daily use.

### Main Android screens

1. **Hosts** — online/offline desktop hosts and last-seen time.
2. **Projects** — projects registered in the selected host.
3. **Task** — prompt composer, timeline, current status, stop/continue controls.
4. **Preview** — interactive Web preview with reload and open-in-browser fallback.
5. **Changes** — changed files, summary, checks, keep/rollback actions.
6. **Device settings** — connection URL, device name, revoke/reset pairing.

The phone layout uses a bottom navigation or stacked screens. The same components should have an iPad split-view layout later; do not create a separate iPad product.

## Protocol design

Create a public package:

```text
packages/remote-contract/
  src/types.ts
  src/schemas.ts
  src/commands.ts
  src/events.ts
```

Initially it can be an internal workspace package. Publish it only when the protocol is stable enough for a separate Relay repository to consume.

### Request envelope

```ts
interface RemoteCommandEnvelope {
  protocolVersion: 1;
  commandId: string;
  deviceId: string;
  hostId: string;
  projectId?: string;
  sessionKey?: string;
  type: "prompt" | "steer" | "follow_up" | "abort" | "start_preview" | "rollback";
  payload: unknown;
  createdAt: string;
}
```

Every command must return an acknowledgement:

```ts
interface CommandResult {
  commandId: string;
  status: "accepted" | "rejected";
  error?: { code: string; message: string };
}
```

The desktop must remember recently accepted `commandId` values so a retry cannot execute the same Prompt twice.

### WebSocket handshake

```text
Android → { type: "hello", deviceId, lastSequence }
Desktop → { type: "hello_ack", hostId, protocolVersion }
Desktop → snapshot or replayed events
Desktop → PiEvent messages
```

Rules:

- Snapshot is the source of truth.
- Events are incremental updates only.
- A reconnect always starts with a snapshot or replay decision.
- If the requested sequence is outside the in-memory replay window, send a fresh snapshot.
- Never transmit `PiEvent.raw` to the mobile client.
- Redact absolute paths, credentials, auth prompts, and provider secrets.

### Task state machine

```text
idle
  → queued
  → running
  → awaiting_approval
  → checking
  → preview_ready
  → completed

running/checking → failed
running/checking → cancelled
preview_ready   → rolled_back
```

The task state is separate from `SessionStatus`. A session can remain alive while a single mobile task is completed or rolled back.

## Preview design

### PreviewSupervisor

Add a desktop-side service that:

1. Detects the project kind from `package.json` and known scripts.
2. Selects a safe start command (`dev` preferred for Web projects).
3. Allocates an available local port.
4. Starts the process with a task/project-specific environment.
5. Captures stdout/stderr into the task timeline.
6. Polls a health URL until ready or failed.
7. Stops the process when the preview is closed or becomes stale.
8. Returns a `previewId`, status, local port, and relative URL.

Do not automatically expose the raw project port to the LAN. All preview requests go through a guarded proxy.

### PreviewProxy

Expose preview content through the same authenticated desktop service:

```text
/api/v1/previews/:previewId/
```

The proxy must support:

- HTML, JavaScript, CSS, images, and fonts.
- Relative and absolute asset URLs.
- WebSocket upgrades for Vite HMR.
- Preview-specific access tokens.
- A project/preview allowlist; no arbitrary URL proxying.

For the MVP, support Vite-style React projects first. Add Next/Nuxt/Vue variants only after the first project works reliably.

### Change sets

At the start of each mobile task:

1. Create a `changeSetId`.
2. Record the current Git `HEAD` when available.
3. Reuse the existing file mutation tracking for touched files.
4. Store the pre-change contents needed for task-level rollback.
5. Associate tool events, checks, preview, and Diff with the change set.

The initial rollback implementation may restore touched files only. A full Git worktree-per-task model is deferred because it adds complexity around dependencies and running dev servers.

## Repository and open-source boundary

### Public repository: `pi-desk`

Keep these public:

```text
PiHost integration
remote-contract
local API server
Android client
preview supervisor/proxy
Tailscale/self-host documentation
```

This makes the project usable without any commercial account.

### Future private repository: `pi-desk-cloud`

Keep these private:

```text
official Relay deployment
account/auth service
subscription and billing
push notification service
multi-host registry
team and enterprise features
```

The future private repository consumes a versioned `@pi-desk/remote-contract` package. It must not copy protocol types manually.

Do not use a private branch, ignored directory, or submodule to hide commercial code inside the public repository. Use a separate repository from the first commercial implementation.

Before formal public release, add an OSI-approved license to the public repository. Apache-2.0 is the current recommendation for this core/client boundary.

## File map

### Public repository changes

| File/path | Responsibility |
|---|---|
| `packages/remote-contract/` | Versioned remote types, Zod schemas, command/event definitions |
| `electron/mobileApi.ts` | Remote-safe command router over `PiHost` |
| `electron/mobileServer.ts` | Local HTTP/WebSocket server, auth, pairing, rate limits |
| `electron/mobileEvents.ts` | Snapshot/replay buffer and event fan-out |
| `electron/previewSupervisor.ts` | Project dev-server lifecycle |
| `electron/previewProxy.ts` | Authenticated preview and HMR proxy |
| `apps/mobile/` | Expo React Native Android client |
| `apps/mobile/src/transport/` | HTTP and WebSocket client |
| `apps/mobile/src/screens/` | Hosts, Projects, Task, Preview, Changes, Settings |
| `electron/main.ts` | Start/stop mobile server and wire `PiHost` subscription |
| `src/shared/protocol.ts` | Gradually migrate or re-export shared contract types |
| `package.json` | Add `apps/*` workspace only when the mobile app is ready to join the monorepo |

## Implementation phases

### Phase 0 — Freeze the vertical slice

- [ ] Choose one simple Vite React demo project for dogfooding.
- [ ] Define the exact Prompt → change → preview → rollback happy path.
- [ ] Define the first remote-safe command allowlist.
- [ ] Decide the local development port and pairing UX.
- [ ] Record the decision in a short product spec before implementation.

**Exit criteria:** a developer can explain the first user journey without mentioning Relay, billing, or unrelated desktop features.

### Phase 1 — Extract the public remote contract

- [ ] Add `packages/remote-contract/`.
- [ ] Define command, acknowledgement, handshake, task, preview, and device types.
- [ ] Add Zod validation for every network input.
- [ ] Add protocol version and `commandId`.
- [ ] Add redaction helpers for snapshots/events.
- [ ] Add tests for invalid commands, unknown sessions, stale sequences, and duplicate command IDs.

**Exit criteria:** a fake client and fake host can exchange a snapshot, command acknowledgement, and ordered events without Electron.

### Phase 2 — Add the local desktop service

- [ ] Add `electron/mobileApi.ts` as a safe façade over `PiHost`.
- [ ] Add HTTP snapshot/project/session endpoints.
- [ ] Add WebSocket event endpoint.
- [ ] Bind to `127.0.0.1` by default.
- [ ] Add an explicit “Allow LAN access” switch; never enable it silently.
- [ ] Add short-lived pairing code and device token.
- [ ] Store only token hashes on the desktop.
- [ ] Add per-device revocation.
- [ ] Add request size limits, rate limits, and origin checks.
- [ ] Add a replay buffer keyed by `sequence`.
- [ ] Add unit tests with a fake `PiHost`.

**Exit criteria:** `curl` or a tiny test client can list projects, send a Prompt, receive events, reconnect, and resynchronize.

### Phase 3 — Add the Android shell

- [ ] Create `apps/mobile/` with Expo React Native.
- [ ] Build Android development target first.
- [ ] Implement manual endpoint entry for development.
- [ ] Implement QR pairing.
- [ ] Store the device token in Android secure storage.
- [ ] Implement Hosts and Projects screens.
- [ ] Implement Task screen with Prompt, stop, continue, and connection status.
- [ ] Implement reconnect → snapshot → event replay behavior.
- [ ] Add a visible “command accepted” state so the user knows a Prompt was not lost.

**Exit criteria:** Android can control one local pi-desk instance over the same Wi-Fi.

### Phase 4 — Add project preview

- [ ] Implement `PreviewSupervisor` for one Vite React project.
- [ ] Add port allocation and process cleanup.
- [ ] Add health checking and preview status events.
- [ ] Add authenticated preview proxy.
- [ ] Proxy HMR WebSocket traffic.
- [ ] Add Android WebView preview screen.
- [ ] Add browser fallback when WebView fails.
- [ ] Add preview logs to the Task screen.
- [ ] Add task-level Diff and rollback action.

**Exit criteria:** Prompt “change the title color” modifies the demo project, the Android preview updates, Diff shows the file, and rollback restores the prior state.

### Phase 5 — Personal remote dogfooding

- [ ] Install Tailscale on the development Mac and Android device.
- [ ] Configure Tailscale Serve to proxy the local mobile service.
- [ ] Test phone on mobile data, not only home Wi-Fi.
- [ ] Test sleep/wake, network switching, and app restart.
- [ ] Test the preview through the Tailscale address.
- [ ] Test an Agent task that requires approval or fails.
- [ ] Record failures and simplify the flow before adding more features.

**Exit criteria:** the owner can use the system remotely for real project changes without manually restarting the connection after every normal network interruption.

### Phase 6 — Only after successful dogfooding

- [ ] Decide whether a paid official Relay is still necessary.
- [ ] Create a separate private `pi-desk-cloud` repository.
- [ ] Implement desktop outbound Relay connection.
- [ ] Implement Android Relay connection.
- [ ] Keep the same public contract and task semantics.
- [ ] Add account, subscription, push, and multi-host features separately.

This phase is intentionally outside the Android self-use MVP.

## Stability requirements

- [ ] A command is never silently lost.
- [ ] A command is never executed twice because of a retry.
- [ ] Reconnecting always returns to a correct Snapshot.
- [ ] Switching sessions cannot send a command to the wrong session.
- [ ] Preview processes are cleaned up after failure or task completion.
- [ ] A malformed mobile request cannot invoke arbitrary shell or file operations.
- [ ] Local mode remains usable if Tailscale is unavailable.
- [ ] Closing the Android app does not stop the desktop Agent.
- [ ] The desktop UI remains usable while Android is connected.

## Verification checklist

### Automated

- [ ] Protocol schema tests.
- [ ] Duplicate command/idempotency tests.
- [ ] Replay and resync tests.
- [ ] Pairing/revocation tests.
- [ ] Preview process lifecycle tests.
- [ ] Preview proxy path and WebSocket upgrade tests.
- [ ] Android transport tests with a fake server.
- [ ] Existing `npm test` and `npm run typecheck` remain green.

### Manual Android matrix

- [ ] Same Wi-Fi, Android screen open.
- [ ] Same Wi-Fi, Android app backgrounded and reopened.
- [ ] Switch from Wi-Fi to mobile data.
- [ ] Mac sleeps and wakes.
- [ ] Agent succeeds.
- [ ] Agent errors.
- [ ] Agent awaits approval.
- [ ] User stops a running task.
- [ ] Preview reloads after a code change.
- [ ] Rollback restores the visible result.

## Definition of done

The MVP is done when the owner can:

1. Open pi-desk on the Mac.
2. Pair an Android phone without editing config files.
3. Select a Web project.
4. Ask the Agent to change the project.
5. Watch progress from the phone.
6. See the modified Web page from the phone.
7. Continue the task or stop it.
8. Inspect the Diff.
9. Roll back the task.
10. Repeat the flow through Tailscale from outside the home network.

No account system, paid Relay, public cloud, or production deployment is required for this definition of done.
