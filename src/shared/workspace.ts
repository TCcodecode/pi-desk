export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  /** Stable application-owned identity for project-scoped assets. */
  projectUid?: string;
}

export interface ProjectFileEntry {
  path: string;
  isDir: boolean;
}
