import type { DiffRequest } from '../models';

export interface GitViewPort {
  openDiff(request: DiffRequest): Promise<void>;
  openFile(repoRoot: string, filePath: string): Promise<void>;
}
