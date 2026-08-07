import { app } from "electron";
import electronUpdater from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { AppUpdateState } from "../../shared/protocol.js";

const { autoUpdater } = electronUpdater;

type Broadcast = (state: AppUpdateState) => void;

function releaseNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === "string") return info.releaseNotes || undefined;
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map((note) => note.note).filter(Boolean).join("\n\n") || undefined;
  }
  return undefined;
}

function updateDetails(info: UpdateInfo): Pick<AppUpdateState, "version" | "releaseName" | "releaseNotes" | "releaseDate"> {
  return {
    version: info.version,
    releaseName: info.releaseName || undefined,
    releaseNotes: releaseNotes(info),
    releaseDate: info.releaseDate,
  };
}

/**
 * The initial public macOS build is deliberately unsigned. Squirrel.Mac
 * cannot safely install an in-place update for it, so retain the user's clear
 * manual-download path until the release pipeline has Developer ID signing.
 */
function unsupportedReason(): string | undefined {
  if (!app.isPackaged) return "Updates are available in packaged builds only.";
  if (process.platform === "darwin") return "macOS updates will be enabled after Developer ID signing is available.";
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return "Use your package manager or download the next release for this Linux install.";
  }
  if (process.platform !== "win32" && process.platform !== "linux") return "Updates are not available on this platform.";
  return undefined;
}

export class UpdateService {
  private state: AppUpdateState = { status: "idle", currentVersion: app.getVersion() };
  private started = false;

  constructor(private readonly broadcast: Broadcast) {}

  getState(): AppUpdateState {
    return this.state;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const unsupported = unsupportedReason();
    if (unsupported) {
      this.setState({ status: "unsupported", currentVersion: app.getVersion(), message: unsupported });
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = app.getVersion().includes("-");
    autoUpdater.on("checking-for-update", () => this.setState({ status: "checking", currentVersion: app.getVersion() }));
    autoUpdater.on("update-available", (info) => this.setState({
      status: "available",
      currentVersion: app.getVersion(),
      ...updateDetails(info),
    }));
    autoUpdater.on("update-not-available", () => this.setState({ status: "idle", currentVersion: app.getVersion() }));
    autoUpdater.on("download-progress", (progress: ProgressInfo) => this.setState({
      ...this.state,
      status: "downloading",
      progress: Math.round(progress.percent),
    }));
    autoUpdater.on("update-downloaded", (info) => this.setState({
      status: "downloaded",
      currentVersion: app.getVersion(),
      ...updateDetails(info),
      progress: 100,
    }));
    autoUpdater.on("error", (error) => this.setState({
      ...this.state,
      status: "error",
      message: error.message,
    }));
    this.check();
  }

  check(): void {
    if (this.state.status === "unsupported" || this.state.status === "checking" || this.state.status === "downloading") return;
    void autoUpdater.checkForUpdates().catch((error: unknown) => this.setState({
      ...this.state,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  download(): void {
    if (this.state.status !== "available") return;
    this.setState({ ...this.state, status: "downloading", progress: 0 });
    void autoUpdater.downloadUpdate().catch((error: unknown) => this.setState({
      ...this.state,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  install(): void {
    if (this.state.status === "downloaded") autoUpdater.quitAndInstall();
  }

  private setState(next: AppUpdateState): void {
    this.state = next;
    this.broadcast(next);
  }
}
