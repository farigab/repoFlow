export type GitRefType = 'head' | 'localBranch' | 'remoteBranch' | 'tag';

export interface GitRef {
  name: string;
  type: GitRefType;
}
