import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

function normalizeAttachmentName(input: string, fallbackExt: string): string {
  const trimmed = basename(input).trim().toLowerCase();
  const detectedExt = extname(trimmed) || fallbackExt;
  const normalizedExt = detectedExt.toLowerCase();
  const rawStem = trimmed.slice(0, Math.max(0, trimmed.length - detectedExt.length));
  const normalizedStem = rawStem.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pasted-image";
  return `${normalizedStem}${normalizedExt}`;
}

async function writeUniqueAttachment(rootDir: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const ext = extname(fileName);
  const stem = fileName.slice(0, Math.max(0, fileName.length - ext.length)) || "pasted-image";
  let candidate = fileName;

  for (;;) {
    const filePath = join(rootDir, candidate);
    try {
      await writeFile(filePath, bytes, { flag: "wx" });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      candidate = `${stem}-${randomUUID().slice(0, 8)}${ext}`;
    }
  }
}

export async function persistComposerImage({
  rootDir,
  name,
  mimeType,
  bytes,
}: {
  rootDir: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ path: string; name: string }> {
  const fallbackExt = mimeType === "image/jpeg" ? ".jpg" : ".png";
  const fileName = normalizeAttachmentName(name, fallbackExt);
  await mkdir(rootDir, { recursive: true });
  const filePath = await writeUniqueAttachment(rootDir, fileName, bytes);
  return { path: filePath, name: basename(filePath) };
}
