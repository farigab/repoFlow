export type { GitBranchPort } from './GitBranchPort';
export type { GitConfigPort } from './GitConfigPort';
export type { GitHistoryPort } from './GitHistoryPort';
export type { GitOperationPort } from './GitOperationPort';
export type { GitQueryPort } from './GitQueryPort';
export type { GitRemotePort } from './GitRemotePort';
export type { GitStagingPort } from './GitStagingPort';
export type { GitStashPort } from './GitStashPort';
export type { GitViewPort } from './GitViewPort';
export type { GitWorktreePort } from './GitWorktreePort';

import type { GitBranchPort } from './GitBranchPort';
import type { GitConfigPort } from './GitConfigPort';
import type { GitHistoryPort } from './GitHistoryPort';
import type { GitOperationPort } from './GitOperationPort';
import type { GitQueryPort } from './GitQueryPort';
import type { GitRemotePort } from './GitRemotePort';
import type { GitStagingPort } from './GitStagingPort';
import type { GitStashPort } from './GitStashPort';
import type { GitViewPort } from './GitViewPort';
import type { GitWorktreePort } from './GitWorktreePort';

/** Composite port — implemented by the infrastructure adapter (GitCliRepository).
 *  Consumers should depend on the narrowest focused port that satisfies their needs. */
export interface GitRepository
  extends GitQueryPort,
  GitStagingPort,
  GitBranchPort,
  GitRemotePort,
  GitHistoryPort,
  GitConfigPort,
  GitStashPort,
  GitOperationPort,
  GitWorktreePort,
  GitViewPort { }
