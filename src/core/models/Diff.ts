export interface DiffRequest {
  repoRoot: string;
  commitHash: string;
  parentHash?: string;
  filePath: string;
  originalPath?: string;
}
