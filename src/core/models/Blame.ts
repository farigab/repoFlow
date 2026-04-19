export interface BlameEntry {
  commitHash: string;
  authorName: string;
  authorEmail: string;
  /** ISO 8601 timestamp */
  committedAt: string;
  commitMessage: string;
  /** 1-based line number in the file */
  lineNumber: number;
}
