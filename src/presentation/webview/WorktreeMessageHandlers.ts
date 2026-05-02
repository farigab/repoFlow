import * as vscode from 'vscode';
import type { WorktreeEntry } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import type { ExtensionToWebviewMessage } from '../../shared/protocol';
import {
  assertCommitHash,
  assertSafeAbsoluteFsPath,
  assertSafeBranchName,
  assertSafeGitRef
} from '../../shared/gitInputValidation';
import type { GitGraphHostServices } from './GitGraphHostServices';
import type { MessageHandlerMap, PayloadFor } from './GitGraphMessageTypes';

interface WorktreeMessageHandlersOptions {
  repository: GitRepository;
  host: GitGraphHostServices;
  output: vscode.OutputChannel;
  postMessage: (message: ExtensionToWebviewMessage) => Promise<void>;
}

export class WorktreeMessageHandlers {
  public constructor(private readonly options: WorktreeMessageHandlersOptions) { }

  public handlers(): MessageHandlerMap {
    return {
      listWorktrees: async (payload) => this.handleListWorktrees(payload),
      addWorktree: async (payload) => this.handleAddWorktree(payload),
      removeWorktree: async (payload) => this.handleRemoveWorktree(payload),
      openWorktreeInWindow: async (payload) => this.handleOpenWorktreeInWindow(payload),
      revealWorktreeInOs: async (payload) => this.handleRevealWorktreeInOs(payload),
      copyWorktreePath: async (payload) => this.handleCopyWorktreePath(payload),
      lockWorktree: async (payload) => this.handleLockWorktree(payload),
      unlockWorktree: async (payload) => this.handleUnlockWorktree(payload),
      moveWorktree: async (payload) => this.handleMoveWorktree(payload),
      addWorktreeAtCommit: async (payload) => this.handleAddWorktreeAtCommit(payload)
    };
  }

  private async handleListWorktrees(payload: PayloadFor<'listWorktrees'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const worktrees = await this.options.repository.listWorktrees(repoRoot);
    await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
  }

  private async handleAddWorktree(payload: PayloadFor<'addWorktree'>): Promise<void> {
    const { repoRoot, branch, createNew, worktreePath } = payload;
    const trustedRepoRoot = await this.options.host.getTrustedRepoRoot(repoRoot);
    const trustedBranch = createNew ? assertSafeBranchName(branch) : assertSafeGitRef(branch, 'branch');
    const trustedWorktreePath = assertSafeAbsoluteFsPath(worktreePath, 'worktree path');
    try {
      await this.options.host.withBusy('Adding worktree...', async () => {
        await this.options.repository.addWorktree(trustedRepoRoot, trustedWorktreePath, trustedBranch, createNew);
      });
      const worktrees = await this.options.repository.listWorktrees(trustedRepoRoot);
      await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[worktree-add] ${msg}`);
      await this.options.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleRemoveWorktree(payload: PayloadFor<'removeWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath, force } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.options.host.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot remove the main worktree.');
    }

    if (force) {
      const expected = this.getWorktreeConfirmationTarget(entry);
      const confirmed = await this.options.host.confirmTyped({
        title: 'Force Remove Worktree',
        prompt: `Force remove worktree ${entry.path}? This can discard uncommitted changes.`,
        expected,
        actionLabel: 'force remove the worktree'
      });
      if (!confirmed) return;
    }

    try {
      await this.options.host.withBusy('Removing worktree...', async () => {
        await this.options.repository.removeWorktree(trustedRepoRoot, entry.path, force);
        await this.options.repository.pruneWorktrees(trustedRepoRoot);
      });
      const worktrees = await this.options.repository.listWorktrees(trustedRepoRoot);
      await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[worktree-remove] ${msg}`);
      await this.options.postMessage({
        type: 'worktreeError',
        payload: { message: msg, path: worktreePath, canForce: !force && this.isDirtyWorktreeRemovalError(msg) }
      });
    }
  }

  private async handleOpenWorktreeInWindow(payload: PayloadFor<'openWorktreeInWindow'>): Promise<void> {
    const { entry } = await this.options.host.getKnownWorktree(payload.repoRoot, payload.path);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: true });
    await this.options.host.postNotification('info', 'Worktree opened in a new window.');
  }

  private async handleRevealWorktreeInOs(payload: PayloadFor<'revealWorktreeInOs'>): Promise<void> {
    const { entry } = await this.options.host.getKnownWorktree(payload.repoRoot, payload.path);
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
  }

  private async handleCopyWorktreePath(payload: PayloadFor<'copyWorktreePath'>): Promise<void> {
    const { entry } = await this.options.host.getKnownWorktree(payload.repoRoot, payload.path);
    await vscode.env.clipboard.writeText(entry.path);
    await this.options.host.postNotification('info', 'Worktree path copied to clipboard.');
  }

  private async handleLockWorktree(payload: PayloadFor<'lockWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.options.host.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot lock the main worktree.');
    }
    try {
      await this.options.repository.lockWorktree(trustedRepoRoot, entry.path);
      const worktrees = await this.options.repository.listWorktrees(trustedRepoRoot);
      await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[worktree-lock] ${msg}`);
      await this.options.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleUnlockWorktree(payload: PayloadFor<'unlockWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.options.host.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot unlock the main worktree.');
    }
    try {
      await this.options.repository.unlockWorktree(trustedRepoRoot, entry.path);
      const worktrees = await this.options.repository.listWorktrees(trustedRepoRoot);
      await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[worktree-unlock] ${msg}`);
      await this.options.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleMoveWorktree(payload: PayloadFor<'moveWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath, newPath } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.options.host.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot move the main worktree.');
    }
    const trustedNewPath = assertSafeAbsoluteFsPath(newPath, 'new worktree path');
    try {
      await this.options.host.withBusy('Moving worktree...', async () => {
        await this.options.repository.moveWorktree(trustedRepoRoot, entry.path, trustedNewPath);
      });
      const worktrees = await this.options.repository.listWorktrees(trustedRepoRoot);
      await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[worktree-move] ${msg}`);
      await this.options.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleAddWorktreeAtCommit(payload: PayloadFor<'addWorktreeAtCommit'>): Promise<void> {
    const { repoRoot, worktreePath, commitHash } = payload;
    const trustedRepoRoot = await this.options.host.getTrustedRepoRoot(repoRoot);
    const trustedWorktreePath = assertSafeAbsoluteFsPath(worktreePath, 'worktree path');
    const trustedCommitHash = assertCommitHash(commitHash);
    try {
      await this.options.host.withBusy('Adding detached worktree...', async () => {
        await this.options.repository.addWorktreeAtCommit(trustedRepoRoot, trustedWorktreePath, trustedCommitHash);
      });
      const worktrees = await this.options.repository.listWorktrees(trustedRepoRoot);
      await this.options.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[worktree-add-detached] ${msg}`);
      await this.options.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private getWorktreeConfirmationTarget(entry: WorktreeEntry): string {
    return entry.branch?.replace(/^refs\/heads\//, '') ?? entry.head.slice(0, 8);
  }

  private isDirtyWorktreeRemovalError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('contains modified or untracked files')
      || normalized.includes('has uncommitted changes')
      || normalized.includes('cannot remove: worktree contains');
  }
}
