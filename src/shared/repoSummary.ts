import type { WorkingTreeStatus } from '../core/models';

const SPECIAL_STATE_LABEL: Record<string, string> = {
  merging: 'MERGING',
  rebasing: 'REBASING',
  'cherry-picking': 'CHERRY-PICKING',
  reverting: 'REVERTING',
  bisecting: 'BISECTING'
};

/**
 * Builds a human-readable one-line summary of the current repository state.
 *
 * Examples:
 *   "Branch feature-x — 2 ahead, 3 behind origin/main — 1 staged, 2 modified"
 *   "Branch main — MERGING — 2 conflicts"
 *   "Detached HEAD at abc12345 — 1 modified"
 *   "Branch main — clean"
 */
function branchPrefix(status: WorkingTreeStatus): string {
  const branch = status.currentBranch ?? 'HEAD';
  return status.specialState === 'detached' ? `Detached HEAD at ${branch}` : `Branch ${branch}`;
}

function stateLabelPart(status: WorkingTreeStatus): string | undefined {
  return status.specialState ? SPECIAL_STATE_LABEL[status.specialState] : undefined;
}

function divergencePart(status: WorkingTreeStatus): string | undefined {
  if (status.ahead <= 0 && status.behind <= 0) return undefined;
  const parts: string[] = [];
  if (status.ahead > 0) parts.push(`${status.ahead} ahead`);
  if (status.behind > 0) parts.push(`${status.behind} behind`);
  const upstream = status.upstream ? ` of ${status.upstream}` : '';
  return parts.join(', ') + upstream;
}

function fileCountsPart(status: WorkingTreeStatus): string | undefined {
  const staged = status.staged.length;
  const unstaged = status.unstaged.length;
  const conflicted = status.conflicted.length;
  if (staged === 0 && unstaged === 0 && conflicted === 0) return undefined;
  const parts: string[] = [];
  if (staged > 0) parts.push(`${staged} staged`);
  if (unstaged > 0) parts.push(`${unstaged} modified`);
  if (conflicted > 0) parts.push(`${conflicted} conflict${conflicted > 1 ? 's' : ''}`);
  return parts.join(', ');
}

export function buildRepoSummary(status: WorkingTreeStatus): string {
  const parts: string[] = [];
  parts.push(branchPrefix(status));

  const state = stateLabelPart(status);
  if (state) parts.push(state);

  const divergence = divergencePart(status);
  if (divergence) parts.push(divergence);

  const files = fileCountsPart(status);
  if (files) parts.push(files);

  if (parts.length === 1) parts.push('clean');
  return parts.join(' — ');
}

/**
 * Compact one-liner for the VS Code status bar.
 * Uses codicon syntax understood by VS Code StatusBarItem.
 */
// repoSummary.ts — só aparece quando há algo relevante além do branch
export function buildRepoStatusBarText(status: WorkingTreeStatus): string {
  const tokens: string[] = ['$(source-control) RepoFlow'];

  if (status.specialState && status.specialState !== 'detached') {
    const label = SPECIAL_STATE_LABEL[status.specialState] ?? status.specialState;
    tokens.push(`$(warning) ${label}`);
  }

  if (status.ahead > 0) tokens.push(`$(arrow-up)${status.ahead}`);
  if (status.behind > 0) tokens.push(`$(arrow-down)${status.behind}`);

  const conflicts = status.conflicted.length;
  if (conflicts > 0) tokens.push(`$(warning)${conflicts}`);

  return tokens.join(' ');
}
