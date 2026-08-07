export interface ComposerImageAttachmentInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ComposerImageAttachmentFile {
  path: string;
  name: string;
}

export type AppUpdateStatus = "idle" | "unsupported" | "checking" | "available" | "downloading" | "downloaded" | "error";

/** A serializable view of the app updater; no release asset URLs are exposed to the renderer. */
export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  version?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  progress?: number;
  message?: string;
}
