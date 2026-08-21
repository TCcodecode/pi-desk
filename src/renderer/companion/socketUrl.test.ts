import { afterEach, describe, expect, test } from "vitest";
import { companionSocketUrl, readPairingToken, readStoredToken, writeStoredToken } from "./socketUrl.js";

describe("companion socket url", () => {
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      // Replaced with a throwing stub in one test.
    }
  });

  test("uses the page host so Tailscale and LAN share one client", () => {
    expect(companionSocketUrl({ protocol: "http:", host: "100.91.4.12:17890" }, "abc")).toBe(
      "ws://100.91.4.12:17890/ws?token=abc",
    );
    expect(companionSocketUrl({ protocol: "https:", host: "mac.tailnet.ts.net" }, "abc")).toBe(
      "wss://mac.tailnet.ts.net/ws?token=abc",
    );
  });

  test("reads the pairing token from t or token", () => {
    expect(readPairingToken("http://192.168.1.9:17890/?t=hello")).toBe("hello");
    expect(readPairingToken("http://192.168.1.9:17890/?token=z")).toBe("z");
    expect(readPairingToken("http://192.168.1.9:17890/")).toBeUndefined();
  });

  test("survives a localStorage implementation that throws", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("blocked");
        },
      },
    });
    expect(readStoredToken()).toBeUndefined();
    expect(() => writeStoredToken("abc")).not.toThrow();
    Object.defineProperty(window, "localStorage", { configurable: true, value: original });
  });
});
