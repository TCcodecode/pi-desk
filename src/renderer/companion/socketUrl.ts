const TOKEN_KEY = "pi-companion-token";

export function companionSocketUrl(location: { protocol: string; host: string }, token: string): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

export function readPairingToken(href: string): string | undefined {
  try {
    const url = new URL(href);
    return url.searchParams.get("t") ?? url.searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

export function readStoredToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Some in-app browsers block storage.
  }
}
