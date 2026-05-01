export interface StashFile {
  path: string;
  originalPath?: string;
  status: string;
}

export interface StashEntry {
  index: number;
  ref: string;
  message: string;
  branch: string;
  date: string;
  files: StashFile[];
}
