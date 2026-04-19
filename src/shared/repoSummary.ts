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
export function buildRepoSummary(status: WorkingTreeStatus): string {
  const branch = status.currentBranch ?? 'HEAD';
  const staged = status.staged.length;
  const unstaged = status.unstaged.length;
  const conflicted = status.conflicted.length;

  const parts: string[] = [];

  // Branch / HEAD prefix
  if (status.specialState === 'detached') {
    parts.push(`Detached HEAD at ${branch}`);
  } else {
    parts.push(`Branch ${branch}`);
  }

  // Special in-progress state label
  const stateLabel = status.specialState ? SPECIAL_STATE_LABEL[status.specialState] : undefined;
  if (stateLabel) {
    parts.push(stateLabel);
  }

  // Divergence
  if (status.ahead > 0 || status.behind > 0) {
    const divParts: string[] = [];
    if (status.ahead > 0) {
      divParts.push(`${status.ahead} ahead`);
    }
    if (status.behind > 0) {
      divParts.push(`${status.behind} behind`);
    }
    const upstream = status.upstream ? ` of ${status.upstream}` : '';
    parts.push(divParts.join(', ') + upstream);
  }

  // File counts
  if (conflicted > 0 || staged > 0 || unstaged > 0) {
    const fileParts: string[] = [];
    if (staged > 0) {
      fileParts.push(`${staged} staged`);
    }
    if (unstaged > 0) {
      fileParts.push(`${unstaged} modified`);
    }
    if (conflicted > 0) {
      fileParts.push(`${conflicted} conflict${conflicted > 1 ? 's' : ''}`);
    }
    parts.push(fileParts.join(', '));
  }

  if (parts.length === 1) {
    parts.push('clean');
  }

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
