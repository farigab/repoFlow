import * as vscode from 'vscode';
import type { GitRepository } from '../../core/ports/GitRepository';
import type { ExtensionToWebviewMessage } from '../../shared/protocol';
import { assertStashRef } from '../../shared/gitInputValidation';
import type { GitGraphHostServices } from './GitGraphHostServices';
import type { MessageHandlerMap, PayloadFor } from './GitGraphMessageTypes';

interface StashMessageHandlersOptions {
  repository: GitRepository;
  host: GitGraphHostServices;
  output: vscode.OutputChannel;
  postMessage: (message: ExtensionToWebviewMessage) => Promise<void>;
}

export class StashMessageHandlers {
  public constructor(private readonly options: StashMessageHandlersOptions) { }

  public handlers(): MessageHandlerMap {
    return {
      listStashes: async (payload) => this.handleListStashes(payload),
      stashChanges: async (payload) => this.handleStashChanges(payload),
      previewStash: async (payload) => this.handlePreviewStash(payload),
      applyStash: async (payload) => this.handleApplyStash(payload),
      popStash: async (payload) => this.handlePopStash(payload),
      dropStash: async (payload) => this.handleDropStash(payload)
    };
  }

  private async handleListStashes(payload: PayloadFor<'listStashes'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const entries = await this.options.repository.listStashes(repoRoot);
    await this.options.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleStashChanges(payload: PayloadFor<'stashChanges'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const selectedPaths = payload.paths ? this.options.host.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths?.length === 0) {
      await this.options.host.postNotification('error', 'Select at least one file to stash.');
      return;
    }

    const ok = await this.options.host.executeRepositoryAction('Stashing selected files...', async () => {
      await this.options.repository.stashChanges(repoRoot, payload.message, payload.includeUntracked, selectedPaths);
    }, selectedPaths ? 'Selected files stashed.' : undefined);
    if (!ok) return;
    const entries = await this.options.repository.listStashes(repoRoot);
    await this.options.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handlePreviewStash(payload: PayloadFor<'previewStash'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    try {
      await this.options.host.withBusy('Opening stash preview...', async () => {
        await this.options.repository.previewStash(repoRoot, stashRef);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[ui-error] ${message}`);
      await this.options.host.postNotification('error', message);
    }
  }

  private async handleApplyStash(payload: PayloadFor<'applyStash'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    const selectedPaths = payload.paths ? this.options.host.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths?.length === 0) {
      await this.options.host.postNotification('error', 'Select at least one file to apply.');
      return;
    }

    const ok = await this.options.host.executeRepositoryAction(selectedPaths ? 'Applying selected stash files...' : 'Applying stash...', async () => {
      await this.options.repository.applyStash(repoRoot, stashRef, selectedPaths);
    }, selectedPaths ? 'Selected stash files applied.' : undefined);
    if (!ok) return;
    const entries = await this.options.repository.listStashes(repoRoot);
    await this.options.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handlePopStash(payload: PayloadFor<'popStash'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    const selectedPaths = payload.paths ? this.options.host.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths?.length === 0) {
      await this.options.host.postNotification('error', 'Select at least one file to pop.');
      return;
    }

    const entriesBefore = selectedPaths ? await this.options.repository.listStashes(repoRoot) : [];
    const selectedStash = entriesBefore.find((entry) => entry.ref === stashRef);
    const isPartialPop = Boolean(selectedPaths && selectedStash?.files.length && selectedPaths.length < selectedStash.files.length);

    const ok = await this.options.host.executeRepositoryAction(selectedPaths ? 'Restoring selected stash files...' : 'Popping stash...', async () => {
      await this.options.repository.popStash(repoRoot, stashRef, selectedPaths);
    }, isPartialPop ? 'Selected files restored. The stash was kept because only part of it was selected.' : undefined);
    if (!ok) return;
    const entries = await this.options.repository.listStashes(repoRoot);
    await this.options.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleDropStash(payload: PayloadFor<'dropStash'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    const confirmed = await vscode.window.showWarningMessage(`Drop stash ${stashRef}?`, { modal: true }, 'Drop');
    if (confirmed !== 'Drop') return;
    await this.options.host.executeRepositoryAction('Dropping stash...', async () => {
      await this.options.repository.dropStash(repoRoot, stashRef);
    });
    const entries = await this.options.repository.listStashes(repoRoot);
    await this.options.postMessage({ type: 'stashList', payload: { entries } });
  }
}
