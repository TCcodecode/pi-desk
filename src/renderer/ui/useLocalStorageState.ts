import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * localStorage-backed state with silent degradation in restricted
 * environments (jsdom tests, sandboxed storage). Values are stored via
 * `String(value)`; reads use the provided `parse` function so existing
 * stored formats (raw numbers, "true"/"false", plain strings) keep working.
 *
 * Replaces the repeated read/write pairs in App.tsx and HttpWorkbench.tsx.
 */
export function useLocalStorageState<T>(
  key: string,
  initialValue: T | (() => T),
  parse: (raw: string) => T = (raw) => JSON.parse(raw) as T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) throw new Error("missing");
      return parse(raw);
    } catch {
      return typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Ignore storage failures in restricted/test environments.
    }
  }, [key, value]);

  return [value, setValue];
}
