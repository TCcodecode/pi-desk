import type { ProviderAuthStatus, ProviderLoginEvent } from "../../shared/protocol.js";

export function normalizeAuthSource(source: string): ProviderAuthStatus["source"] {
  if (source === "stored" || source === "environment" || source === "runtime" || source === "none") {
    return source;
  }
  if (source.includes("env") || source.includes("API") || source.includes("KEY")) return "environment";
  return "environment";
}

/** Normalize a Pi AuthEvent into the renderer-safe ProviderLoginEvent shape. */
export function normalizeAuthEvent(event: unknown): ProviderLoginEvent | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const record = event as { type?: unknown };
  switch (record.type) {
    case "auth_url": {
      const { url, instructions } = event as { url: unknown; instructions?: unknown };
      if (typeof url !== "string") return undefined;
      return { type: "auth_url", url, ...(typeof instructions === "string" ? { instructions } : {}) };
    }
    case "device_code": {
      const { userCode, verificationUri, intervalSeconds, expiresInSeconds } = event as { userCode: unknown; verificationUri: unknown; intervalSeconds?: unknown; expiresInSeconds?: unknown };
      if (typeof userCode !== "string" || typeof verificationUri !== "string") return undefined;
      return {
        type: "device_code",
        userCode,
        verificationUri,
        ...(typeof intervalSeconds === "number" ? { intervalSeconds } : {}),
        ...(typeof expiresInSeconds === "number" ? { expiresInSeconds } : {}),
      };
    }
    case "info": {
      const { message, links } = event as { message: unknown; links?: unknown };
      if (typeof message !== "string") return undefined;
      const normalizedLinks = Array.isArray(links)
        ? links
            .filter((link): link is { url: unknown; label?: unknown } => typeof link === "object" && link !== null && typeof (link as { url?: unknown }).url === "string")
            .map((link) => ({ url: link.url as string, ...(typeof link.label === "string" ? { label: link.label } : {}) }))
        : undefined;
      return { type: "info", message, ...(normalizedLinks && normalizedLinks.length > 0 ? { links: normalizedLinks } : {}) };
    }
    case "progress": {
      const { message } = event as { message: unknown };
      if (typeof message !== "string") return undefined;
      return { type: "progress", message };
    }
    default:
      return undefined;
  }
}
