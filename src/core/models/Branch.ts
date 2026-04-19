export interface BranchSummary {
  name: string;
  shortName: string;
  remote: boolean;
  current: boolean;
  targetHash: string;
  upstream?: string;
  tracking?: string;
  ahead?: number;
  behind?: number;
}
