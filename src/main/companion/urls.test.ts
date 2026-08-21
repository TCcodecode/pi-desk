import { describe, expect, test } from "vitest";
import { companionOrigins } from "./urls.js";

describe("companion origins", () => {
  test("lists non-internal IPv4 LAN addresses and skips loopback", () => {
    const urls = companionOrigins({
      port: 17890,
      interfaces: {
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true, netmask: "", cidr: null, mac: "", scopeid: undefined }],
        en0: [{ address: "192.168.1.23", family: "IPv4", internal: false, netmask: "", cidr: null, mac: "", scopeid: undefined }],
        utun: [{ address: "100.91.4.12", family: "IPv4", internal: false, netmask: "", cidr: null, mac: "", scopeid: undefined }],
      },
    });
    expect(urls.map((item) => item.origin)).toEqual([
      "http://192.168.1.23:17890",
      "http://100.91.4.12:17890",
    ]);
    expect(urls[0]?.kind).toBe("lan");
    expect(urls[1]?.kind).toBe("tailscale");
  });

  test("adds a Tailscale MagicDNS origin without duplicating the IP", () => {
    const urls = companionOrigins({
      port: 17890,
      interfaces: {
        utun: [{ address: "100.91.4.12", family: "IPv4", internal: false, netmask: "", cidr: null, mac: "", scopeid: undefined }],
      },
      tailscaleIPv4: "100.91.4.12",
      tailscaleHostname: "mac.tailnet.ts.net",
    });
    expect(urls.map((item) => item.origin)).toEqual([
      "http://100.91.4.12:17890",
      "http://mac.tailnet.ts.net:17890",
    ]);
    expect(urls.every((item) => item.kind === "tailscale")).toBe(true);
  });

  test("skips link-local addresses", () => {
    const urls = companionOrigins({
      port: 17890,
      interfaces: {
        en0: [{ address: "169.254.12.4", family: "IPv4", internal: false, netmask: "", cidr: null, mac: "", scopeid: undefined }],
      },
    });
    expect(urls).toEqual([]);
  });
});
