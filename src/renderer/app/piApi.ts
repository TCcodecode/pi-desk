import type { PiApi } from "../../shared/protocol";

export function getPiApi(): PiApi | undefined {
  return typeof window === "undefined" ? undefined : window.pi;
}
