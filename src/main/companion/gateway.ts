import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import QRCode from "qrcode";
import { COMPANION_PORT, type CompanionState } from "../../shared/companion.js";
import { mintCompanionToken } from "./pairing.js";
import { CompanionServer } from "./server.js";
import { companionOrigins, pageUrl } from "./urls.js";

const execFileAsync = promisify(execFile);

interface CompanionFileStore {
  enabled: boolean;
  token: string;
}

export async function lookupTailscale(): Promise<{ ip?: string; hostname?: string }> {
  try {
    const ip = (await execFileAsync("tailscale", ["ip", "-4"], { timeout: 1500 })).stdout.trim();
    let hostname: string | undefined;
    try {
      const raw = (await execFileAsync("tailscale", ["status", "--json"], { timeout: 1500 })).stdout;
      const parsed = JSON.parse(raw) as { Self?: { DNSName?: string } };
      hostname = parsed.Self?.DNSName?.replace(/\.$/, "") || undefined;
    } catch {
      hostname = undefined;
    }
    return { ip: ip || undefined, hostname };
  } catch {
    return {};
  }
}

export class CompanionGateway {
  private store: CompanionFileStore;
  private server: CompanionServer | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly options: {
      userDataDir: string;
      host?: string;
      port?: number;
      invoke: (method: string, args: unknown[]) => Promise<unknown>;
      subscribe: (listener: (event: unknown) => void) => () => void;
      staticRoot?: string;
      devProxyOrigin?: string;
      /** Resolve the current workspace cwd for preview port inference. */
      previewCwd?: () => string | undefined;
      interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
      lookupTailscale?: () => Promise<{ ip?: string; hostname?: string }>;
    },
  ) {
    this.store = this.readStore();
  }

  async restore(): Promise<void> {
    if (this.store.enabled) await this.startServer();
  }

  async getState(): Promise<CompanionState> {
    return this.buildState();
  }

  async setEnabled(enabled: boolean): Promise<CompanionState> {
    if (enabled) {
      if (!this.store.token) this.store.token = mintCompanionToken();
      this.store.enabled = true;
      this.writeStore();
      await this.startServer();
    } else {
      this.store.enabled = false;
      this.writeStore();
      await this.stop();
    }
    return this.buildState();
  }

  async rotateToken(): Promise<CompanionState> {
    this.store.token = mintCompanionToken();
    this.writeStore();
    this.server?.setToken(this.store.token);
    return this.buildState();
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await this.server.close();
    this.server = undefined;
  }

  private storePath(): string {
    return join(this.options.userDataDir, "companion.json");
  }

  private readStore(): CompanionFileStore {
    try {
      if (!existsSync(this.storePath())) return { enabled: false, token: mintCompanionToken() };
      const raw = JSON.parse(readFileSync(this.storePath(), "utf8")) as Partial<CompanionFileStore>;
      return {
        enabled: raw.enabled === true,
        token: typeof raw.token === "string" && raw.token.length > 8 ? raw.token : mintCompanionToken(),
      };
    } catch {
      return { enabled: false, token: mintCompanionToken() };
    }
  }

  private writeStore(): void {
    mkdirSync(dirname(this.storePath()), { recursive: true });
    writeFileSync(this.storePath(), `${JSON.stringify(this.store, null, 2)}\n`, "utf8");
  }

  private async startServer(): Promise<void> {
    if (this.server) return;
    this.lastError = undefined;
    const server = new CompanionServer({
      host: this.options.host ?? "0.0.0.0",
      port: this.options.port ?? COMPANION_PORT,
      token: this.store.token,
      staticRoot: this.options.staticRoot,
      devProxyOrigin: this.options.devProxyOrigin,
      previewCwd: this.options.previewCwd,
      invoke: this.options.invoke,
      subscribe: this.options.subscribe,
    });
    try {
      await server.listen();
      this.server = server;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.store.enabled = false;
      this.writeStore();
    }
  }

  private async buildState(): Promise<CompanionState> {
    const listening = Boolean(this.server);
    const port = this.server?.port ?? this.options.port ?? COMPANION_PORT;
    const tailscale = listening ? await (this.options.lookupTailscale ?? lookupTailscale)() : {};
    const urls = listening
      ? companionOrigins({
          port,
          interfaces: this.options.interfaces ?? networkInterfaces(),
          tailscaleIPv4: tailscale.ip,
          tailscaleHostname: tailscale.hostname,
        })
      : [];
    const pairUrl = urls[0] ? pageUrl(urls[0].origin, this.store.token) : undefined;
    let qrDataUrl: string | undefined;
    if (pairUrl) {
      try {
        qrDataUrl = await QRCode.toDataURL(pairUrl, { width: 280, margin: 1, color: { dark: "#202020", light: "#ffffff" } });
      } catch {
        qrDataUrl = undefined;
      }
    }
    return {
      enabled: this.store.enabled && listening,
      listening,
      port,
      token: this.store.token,
      urls,
      qrDataUrl,
      error: this.lastError,
    };
  }
}
