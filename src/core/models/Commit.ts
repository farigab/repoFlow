import type { GitRef } from './GitRef';

export interface CommitSummary {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  refs: GitRef[];
  isHead: boolean;
  isDirtyHead: boolean;
}

export interface CommitFileChange {
  path: string;
  originalPath?: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface CommitDetail extends CommitSummary {
  body: string;
  stats: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  files: CommitFileChange[];
}

export type CommitAnalysisMode = 'executive' | 'technical';

export interface CommitAnalysisModelOption {
  id: string;
  label: string;
  provider: string;
  family: string;
  version: string;
  description?: string;
  costPriority?: string;
}

export interface CommitAnalysisResult {
  commitHash: string;
  mode: CommitAnalysisMode;
  modelSelection: string;
  modelLabel: string;
  content: string;
  generatedAt: string;
  provider: string;
  contextTruncated: boolean;
}

export interface CommitStats {
  insertions: number;
  deletions: number;
  filesChanged: number;
}
