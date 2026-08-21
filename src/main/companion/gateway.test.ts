import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CompanionGateway } from "./gateway.js";

describe("companion gateway", () => {
  const gateways: CompanionGateway[] = [];

  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
  });

  test("is off until enabled, then advertises a LAN url and token", async () => {
    const gateway = new CompanionGateway({
      userDataDir: mkdtempSync(join(tmpdir(), "pi-companion-gw-")),
      host: "127.0.0.1",
      port: 0,
      invoke: async () => undefined,
      subscribe: () => () => undefined,
      interfaces: {
        en0: [{ address: "192.168.1.23", family: "IPv4", internal: false, netmask: "", cidr: null, mac: "" }],
      },
      lookupTailscale: async () => ({}),
    });
    gateways.push(gateway);

    const idle = await gateway.getState();
    expect(idle.enabled).toBe(false);
    expect(idle.listening).toBe(false);
    expect(idle.urls).toEqual([]);

    const on = await gateway.setEnabled(true);
    expect(on.enabled).toBe(true);
    expect(on.listening).toBe(true);
    expect(on.port).toBeGreaterThan(0);
    expect(on.token.length).toBeGreaterThan(20);
    expect(on.urls.some((url) => url.origin.includes("192.168.1.23"))).toBe(true);
    expect(on.qrDataUrl?.startsWith("data:image/")).toBe(true);
  });
});
