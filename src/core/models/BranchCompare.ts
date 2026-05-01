export interface BranchCompareCommit {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authoredAt: string;
}

export interface BranchCompareFile {
  status: string;
  path: string;
  originalPath?: string;
  additions: number;
  deletions: number;
}

export interface BranchCompareResult {
  baseRef: string;
  targetRef: string;
  ahead: number;
  behind: number;
  commitsAhead: BranchCompareCommit[];
  commitsBehind: BranchCompareCommit[];
  files: BranchCompareFile[];
}
