import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell } from "electron";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { persistComposerImage } from "../session/attachments.js";
import { PiHost } from "../session/host.js";
import { setProjectCatalogPath } from "../workspace/projectCatalog.js";
import { CodeIndexService } from "../session/indexService.js";
import { sessionCompletionNotification, shouldNotifySessionCompleted } from "./notifications.js";
import { HttpWorkbenchStore, setHttpWorkbenchUserDataPath } from "../http/store.js";
import { UpdateService } from "./updates.js";

// The main bundle is ESM (electron-vite), where __dirname is not defined.
const __dirname = import.meta.dirname;

const execFileAsync = promisify(execFile);

async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 2000,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

let mainWindow: BrowserWindow | undefined;
const updates = new UpdateService((state) => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("pi:updateState", state));
});
const piHost = new PiHost({
  workspaceId: "local",
  openExternal: (url) => void shell.openExternal(url),
});

const indexService = new CodeIndexService({
  onStatusChange: (status, cwd) => piHost.emitIndexStatus(status, cwd),
});

const httpWorkbench = new HttpWorkbenchStore(() => piHost.listProjects());
piHost.setHttpWorkbenchStore(httpWorkbench);

/** Background index; never reject into unhandledPromiseRejection. */
function kickIndex(cwd: string | undefined): void {
  if (!cwd) return;
  void indexService.ensureIndexed(cwd).catch((error) => {
    console.warn("[code-index]", cwd, error instanceof Error ? error.message : error);
  });
}

function registerPiIpc() {
  ipcMain.handle("pi:getUpdateState", () => updates.getState());
  ipcMain.handle("pi:checkForUpdate", () => updates.check());
  ipcMain.handle("pi:downloadUpdate", () => updates.download());
  ipcMain.handle("pi:installUpdate", () => updates.install());
  ipcMain.handle("pi:getSnapshot", async () => ({ ...piHost.snapshot(), sessions: await piHost.listSessions() }));
  ipcMain.handle("pi:chooseWorkspace", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("pi:chooseFile", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("pi:chooseAttachmentFiles", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select image attachments",
      buttonLabel: "Attach images",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("pi:persistImageAttachment", async (_event, input) => {
    const rootDir = join(app.getPath("temp"), "pi-desk", "composer-attachments");
    return persistComposerImage({ rootDir, ...input });
  });
  ipcMain.handle("pi:loadImagePreview", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) return undefined;
    const image = nativeImage.createFromPath(targetPath);
    return image.isEmpty() ? undefined : image.toDataURL();
  });
  ipcMain.handle(
    "pi:startSession",
    async (_event, options: { cwd: string; sessionPath?: string; sessionKey?: string }) => {
      kickIndex(options.cwd);
      return { ...await piHost.start(options), sessions: await piHost.listSessions() };
    },
  );
  ipcMain.handle("pi:focusSession", async (_event, sessionKey: string, opts?: { includeTimeline?: boolean }) => {
    return { ...await piHost.focusSession(sessionKey, opts), sessions: await piHost.listSessions() };
  });
  ipcMain.handle("pi:disposeSession", async (_event, sessionKey: string) => {
    await piHost.disposeSession(sessionKey);
  });
  ipcMain.handle("pi:loadOlder", async (_event, options: { sessionKey: string; beforeId: string; limit?: number }) => {
    return piHost.loadOlder(options);
  });
  ipcMain.handle("pi:listLiveSessions", () => piHost.listLiveSessions());
  ipcMain.handle("pi:listProjects", () => piHost.listProjects());
  ipcMain.handle("pi:setActiveProject", (_event, projectId: string) => piHost.setActiveProjectOnly(projectId));
  ipcMain.handle("pi:removeProject", (_event, projectId: string) => piHost.removeProject(projectId));
  ipcMain.handle("pi:revealInFolder", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) return;
    shell.showItemInFolder(targetPath);
  });
  ipcMain.handle("pi:openFile", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) return;
    const cwd = piHost.snapshot().session.cwd;
    const absolutePath = resolve(cwd || process.cwd(), targetPath);

    // Prefer VS Code. The macOS app launcher works even when the `code` CLI
    // was not added to PATH; the CLI covers Windows/Linux installations.
    try {
      if (process.platform === "darwin") {
        await execFileAsync("open", ["-a", "Visual Studio Code", absolutePath]);
      } else {
        await execFileAsync("code", [absolutePath]);
      }
      return;
    } catch {
      // VS Code is not available; continue to the application picker.
    }

    const selected = await dialog.showOpenDialog({
      title: "Choose an application to open this file",
      properties: ["openFile", "openDirectory"],
    });
    const application = selected.filePaths[0];
    if (selected.canceled || !application) return;
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", application, absolutePath]);
    } else {
      await execFileAsync(application, [absolutePath]);
    }
  });
  ipcMain.handle("pi:listSessions", (_event, cwd?: string) => piHost.listSessions(cwd));
  ipcMain.handle("pi:listProjectFiles", (_event, cwd?: string) => piHost.listProjectFiles(cwd));
  ipcMain.handle("pi:renameSession", (_event, sessionPath: string, name: string) => piHost.renameSession(sessionPath, name));
  ipcMain.handle("pi:deleteSession", (_event, sessionPath: string) => piHost.deleteSession(sessionPath));
  ipcMain.handle("pi:getSessionContext", (_event, sessionPath: string) => piHost.getSessionContext(sessionPath));
  ipcMain.handle("pi:listProviders", () => piHost.listProviders());
  ipcMain.handle("pi:getProviderUsage", (_event, options?: { force?: boolean }) => piHost.getProviderUsage(options));
  ipcMain.handle("pi:loginWithApiKey", (_event, providerId: string, apiKey: string) => piHost.loginWithApiKey(providerId, apiKey));
  ipcMain.handle("pi:logoutProvider", (_event, providerId: string) => piHost.logoutProvider(providerId));
  ipcMain.handle("pi:loginWithOAuth", (_event, providerId: string) => piHost.loginWithOAuth(providerId));
  ipcMain.handle("pi:answerAuthPrompt", (_event, promptId: string, answer: string) => piHost.answerAuthPrompt(promptId, answer));
  ipcMain.handle("pi:cancelProviderLogin", (_event, providerId: string) => piHost.cancelProviderLogin(providerId));
  ipcMain.handle("pi:openExternal", async (_event, url: string) => {
    // Only open http(s) URLs from the renderer (avoid file:// / scheme tricks).
    if (typeof url !== "string") return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("pi:addProject", async (_event, path?: string) => {
    const projectPath =
      path ??
      (
        await dialog.showOpenDialog({
          properties: ["openDirectory"],
          title: "Open project",
          buttonLabel: "Open project",
        })
      ).filePaths[0];
    if (!projectPath) return undefined;

    // 1) Always register the project first so the sidebar can show it even if session start fails.
    const project = piHost.addProjectFromPath(projectPath);
    const projects = piHost.listProjects();

    try {
      const snapshot = await piHost.start({ cwd: project.path });
      kickIndex(project.path);
      return {
        ...snapshot,
        sessions: await piHost.listSessions(project.path),
        projects: piHost.listProjects(),
        activeProjectId: project.id,
      };
    } catch (error) {
      // Session may fail (SDK/trust/etc.) but the project must still appear in the list.
      const base = piHost.snapshot();
      return {
        ...base,
        session: {
          ...base.session,
          cwd: project.path,
          name: project.name,
        },
        sessions: [],
        projects,
        activeProjectId: project.id,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle("pi:selectProject", async (_event, projectId: string) => {
    const result = { ...await piHost.selectProject(projectId), sessions: await piHost.listSessions() };
    kickIndex(result.session.cwd);
    return result;
  });
  ipcMain.handle("pi:prompt", (_event, text: string, opts?: { sessionKey?: string }) =>
    piHost.prompt(text, opts),
  );
  ipcMain.handle("pi:steer", (_event, text: string, opts?: { sessionKey?: string }) =>
    piHost.steer(text, opts),
  );
  ipcMain.handle("pi:followUp", (_event, text: string, opts?: { sessionKey?: string }) =>
    piHost.followUp(text, opts),
  );
  ipcMain.handle("pi:undoFileChange", (_event, path: string, opts?: { sessionKey?: string }) =>
    piHost.undoFileChange(path, opts),
  );
  ipcMain.handle("pi:editFollowUp", (_event, index: number, text: string, opts?: { sessionKey?: string }, expectedText?: string) =>
    piHost.editFollowUp(index, text, opts, expectedText),
  );
  ipcMain.handle("pi:sendFollowUpNow", (_event, index: number, opts?: { sessionKey?: string }, expectedText?: string) =>
    piHost.sendFollowUpNow(index, opts, expectedText),
  );
  ipcMain.handle("pi:abort", (_event, opts?: { sessionKey?: string }) => piHost.abort(opts));
  ipcMain.handle("pi:newSession", (_event, opts?: { sessionKey?: string }) => piHost.newSession(opts));
  ipcMain.handle("pi:resumeSession", async (_event, sessionPath: string) => {
    await piHost.switchSession(sessionPath);
    return { ...piHost.snapshot(), sessions: await piHost.listSessions() };
  });
  ipcMain.handle("pi:forkSession", (_event, entryId: string) => piHost.forkSession(entryId));
  ipcMain.handle("pi:cloneSession", () => piHost.cloneSession());
  ipcMain.handle("pi:importSession", (_event, path: string, cwdOverride?: string) => piHost.importSession(path, cwdOverride));
  ipcMain.handle("pi:compact", (_event, instructions?: string) => piHost.compact(instructions));
  ipcMain.handle("pi:setThinkingLevel", (_event, level) => piHost.setThinkingLevel(level));
  ipcMain.handle("pi:setMode", (_event, mode, opts) => piHost.setMode(mode, opts));
  ipcMain.handle("pi:setModeProfile", (_event, mode, profile, opts) => piHost.setModeProfile(mode, profile, opts));
  ipcMain.handle("pi:listPlans", (_event, opts) => piHost.listPlans(opts));
  ipcMain.handle("pi:readPlan", (_event, planId, opts) => piHost.readPlan(planId, opts));
  ipcMain.handle("pi:updatePlan", (_event, planId, content, revision, opts) => piHost.updatePlan(planId, content, revision, opts));
  ipcMain.handle("pi:savePlan", (_event, title, content, status, planId, opts) => piHost.savePlan(title, content, status, planId, opts));
  ipcMain.handle("pi:startExecution", (_event, planId, opts) => piHost.startExecution(planId, opts));
  ipcMain.handle("pi:setTools", (_event, tools: string[], opts) => piHost.setTools(tools, opts));
  ipcMain.handle("pi:setSkills", (_event, patterns: string[]) => piHost.setSkills(patterns));
  ipcMain.handle("pi:reload", () => piHost.reload());
  ipcMain.handle("pi:executeCommand", (_event, name: string, args?: string) => piHost.executeCommand(name, args));
  ipcMain.handle("pi:setModel", (_event, model: string) => piHost.setModel(model));
  ipcMain.handle("pi:getCommands", () => piHost.getCommands());
  ipcMain.handle("pi:getModels", async () => piHost.refreshAvailableModels());
  ipcMain.handle("pi:getTools", () => piHost.getTools());
  ipcMain.handle("pi:getResources", () => piHost.getResources());
  ipcMain.handle("pi:getSessionTree", () => piHost.getSessionTree());
  ipcMain.handle("pi:resolveTrust", (_event, trusted: boolean) => piHost.resolveTrust(trusted));
  ipcMain.handle("pi:getGitBranch", async (_event, cwd?: string) => {
    const target = cwd || piHost.snapshot().session.cwd;
    if (!target) return undefined;
    return getGitBranch(target);
  });
  ipcMain.handle("pi:indexStatus", (_e, cwd: string) => indexService.getStatus(cwd));
  ipcMain.handle("pi:indexRefresh", async (_e, cwd: string) => indexService.refresh(cwd));
  ipcMain.handle("pi:indexSearch", async (_e, cwd: string, query: string, opts?: { limit?: number }) => indexService.searchSymbols(cwd, query, opts));
  ipcMain.handle("pi:indexFindUsages", async (_e, cwd: string, qualified: string, opts?: { kind?: string }) => indexService.findUsages(cwd, qualified, opts));
  ipcMain.handle("pi:getMcpConfig", (_e, cwd?: string) => piHost.getMcpConfig(cwd));
  ipcMain.handle("pi:setMcpServerEnabled", (_e, name: string, enabled: boolean) => piHost.setMcpServerEnabled(name, enabled));
  ipcMain.handle("pi:importCursorMcp", () => piHost.importCursorMcp());
  ipcMain.handle("pi:openMcpConfigFile", async (_e, cwd?: string) => {
    const file = await piHost.openMcpConfigFile(cwd);
    if (file) await shell.openPath(file);
  });
  ipcMain.handle("pi:http:workspace", (_event, projectId: string) => httpWorkbench.workspace(projectId));
  ipcMain.handle("pi:http:readFile", (_event, projectId: string, relativePath: string) => httpWorkbench.readFile(projectId, relativePath));
  ipcMain.handle("pi:http:saveFile", (_event, projectId: string, relativePath: string, content: string) => httpWorkbench.saveFile(projectId, relativePath, content));
  ipcMain.handle("pi:http:readEnvironment", (_event, projectId: string, relativePath: string) => httpWorkbench.readEnvironment(projectId, relativePath));
  ipcMain.handle("pi:http:saveEnvironment", (_event, projectId: string, relativePath: string, content: string) => httpWorkbench.saveEnvironment(projectId, relativePath, content));
  ipcMain.handle("pi:http:createFolder", (_event, projectId: string, parentPath: string, name: string) => httpWorkbench.createFolder(projectId, parentPath, name));
  ipcMain.handle("pi:http:createFile", (_event, projectId: string, parentPath: string, name: string) => httpWorkbench.createFile(projectId, parentPath, name));
  ipcMain.handle("pi:http:createEnvironment", (_event, projectId: string, name: string) => httpWorkbench.createEnvironment(projectId, name));
  ipcMain.handle("pi:http:listRuns", (_event, projectId: string, scopePath: string) => httpWorkbench.listRuns(projectId, scopePath));
  ipcMain.handle("pi:http:readRun", (_event, projectId: string, scopePath: string, runId: string) => httpWorkbench.readRun(projectId, scopePath, runId));
  ipcMain.handle("pi:http:readResponse", (_event, projectId: string, scopePath: string, runId: string, requestId: string) => httpWorkbench.readResponse(projectId, scopePath, runId, requestId));
  ipcMain.handle("pi:http:deleteRun", (_event, projectId: string, scopePath: string, runId: string) => httpWorkbench.deleteRun(projectId, scopePath, runId));
  ipcMain.handle("pi:http:deleteResponse", (_event, projectId: string, scopePath: string, runId: string, requestId: string) => httpWorkbench.deleteResponse(projectId, scopePath, runId, requestId));
  ipcMain.handle("pi:http:deleteRunHistory", (_event, projectId: string, scopePath: string) => httpWorkbench.deleteRunHistory(projectId, scopePath));
  ipcMain.handle("pi:http:run", (_event, projectId: string, scopePath: string, environmentName?: string, requestLine?: number) => httpWorkbench.run(projectId, scopePath, environmentName, requestLine));
  piHost.subscribe((event) => {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("pi:event", event));

    if (!shouldNotifySessionCompleted(event, {
      windowFocused: mainWindow?.isFocused() ?? false,
      foregroundSession: piHost.isForegroundSession(event.sessionKey),
    })) return;
    const notification = sessionCompletionNotification(event);
    if (!notification || !Notification.isSupported()) return;
    try {
      new Notification(notification).show();
    } catch {
      // A system notification is best effort and must not affect the session.
    }
  });
}

/**
 * Replace the default application menu. The stock macOS menu binds ⌘W to the
 * "close window" role, which quits the whole app — but ⌘W must close the
 * active session tab instead (handled in the renderer). We keep every other
 * standard menu (app/Edit/View/Window/Help) so copy-paste, zoom, DevTools,
 * minimize, etc. still work; only the close-window accelerator is removed.
 */
function installApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: "appMenu" } as Electron.MenuItemConstructorOptions]
      : [{ label: "File", submenu: [{ role: "quit" as const }] }]),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([{ type: "separator" }, { role: "front" }] as Electron.MenuItemConstructorOptions[])
          : []),
      ],
    },
    ...(isMac ? ([{ role: "help" }] as Electron.MenuItemConstructorOptions[]) : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#171717",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          // Keep traffic lights clear of the sidebar brand row.
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[main] window failed to load", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] renderer process gone", details);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // userData is derived from the app name. The app was renamed pi-desktop → pi-desk,
  // so carry projects.json over from the legacy directory if the current one is empty.
  const userDataDir = app.getPath("userData");
  const currentProjects = join(userDataDir, "projects.json");
  const legacyCandidates = [
    join(userDataDir, "..", "pi-desktop", "projects.json"),
    join(homedir(), ".pi-desktop", "projects.json"),
    join(homedir(), ".pi-desk", "projects.json"),
  ];
  if (!existsSync(currentProjects)) {
    const legacy = legacyCandidates.find((path) => existsSync(path));
    if (legacy) {
      mkdirSync(dirname(currentProjects), { recursive: true });
      copyFileSync(legacy, currentProjects);
    }
  }
  setProjectCatalogPath(currentProjects);
  setHttpWorkbenchUserDataPath(userDataDir);
  installApplicationMenu();
  registerPiIpc();
  createWindow();
  updates.start();
  // Pre-download rg/fd in the background so grep/find are ready without blocking startup.
  void piHost.warmupTools();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  indexService.dispose();
  void piHost.dispose();
});
