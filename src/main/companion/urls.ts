import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export type CompanionUrlKind = "lan" | "tailscale";

export interface CompanionListenUrl {
  kind: CompanionUrlKind;
  origin: string;
  label: string;
}

export function isAdvertisedIPv4(address: string, internal: boolean): boolean {
  if (internal) return false;
  if (address === "127.0.0.1") return false;
  if (address.startsWith("169.254.")) return false;
  return true;
}

export function ipKind(address: string): CompanionUrlKind {
  const parts = address.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 100 && b >= 64 && b <= 127) return "tailscale";
  return "lan";
}

function isIPv4(info: NetworkInterfaceInfo): boolean {
  return info.family === "IPv4" || (info.family as unknown) === 4;
}

export function companionOrigins(options: {
  port: number;
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
  tailscaleIPv4?: string;
  tailscaleHostname?: string;
}): CompanionListenUrl[] {
  const nics = options.interfaces ?? networkInterfaces();
  const seen = new Set<string>();
  const urls: CompanionListenUrl[] = [];

  const add = (kind: CompanionUrlKind, host: string, label: string) => {
    const origin = `http://${host}:${options.port}`;
    if (seen.has(origin)) return;
    seen.add(origin);
    urls.push({ kind, origin, label });
  };

  for (const infos of Object.values(nics)) {
    for (const info of infos ?? []) {
      if (!isIPv4(info) || !isAdvertisedIPv4(info.address, info.internal)) continue;
      const kind = ipKind(info.address);
      add(kind, info.address, kind === "tailscale" ? "Tailscale" : "Local network");
    }
  }

  if (options.tailscaleIPv4) add("tailscale", options.tailscaleIPv4, "Tailscale");
  if (options.tailscaleHostname) add("tailscale", options.tailscaleHostname, "Tailscale");

  return urls;
}

export function pageUrl(origin: string, token: string): string {
  const url = new URL(origin);
  url.searchParams.set("t", token);
  // Bump when the phone shell changes so QR scanners skip a cached white page.
  url.searchParams.set("v", "3");
  return url.toString();
}
