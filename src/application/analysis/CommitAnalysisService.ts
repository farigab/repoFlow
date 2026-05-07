import * as vscode from 'vscode';
import type { CommitAnalysisMode, CommitAnalysisModelOption, CommitAnalysisResult, CommitDetail } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import { GitCache } from '../../infrastructure/git/GitCache';

const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PATCH_CHARS = 18_000;
const PROVIDER_LABEL = 'GitHub Copilot';

interface AnalysisContext {
  detail: CommitDetail;
  patch: string;
  contextTruncated: boolean;
}

type ModelLike = vscode.LanguageModelChat & {
  id?: string;
  family?: string;
  version?: string;
  name?: string;
  detail?: string;
  tooltip?: string;
};

export class CommitAnalysisService {
  private readonly cache = new GitCache<CommitAnalysisResult>(ANALYSIS_CACHE_TTL_MS);

  public constructor(
    private readonly repository: GitRepository,
    private readonly output: vscode.OutputChannel
  ) { }

  public async analyzeCommit(repoRoot: string, commitHash: string, mode: CommitAnalysisMode, modelSelection: string, token?: vscode.CancellationToken): Promise<CommitAnalysisResult> {
    const cacheKey = `${repoRoot}::${commitHash}::${mode}::${modelSelection}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { model, modelLabel } = await this.resolveModel(modelSelection);

    const context = await this.buildContext(repoRoot, commitHash);
    const response = await model.sendRequest([
      vscode.LanguageModelChatMessage.User(this.buildPrompt(context, mode))
    ], {
      justification: 'Analyze a Git commit selected by the user in RepoFlow.'
    }, token);

    let content = '';
    for await (const chunk of response.text) {
      content += chunk;
    }

    const result: CommitAnalysisResult = {
      commitHash,
      mode,
      modelSelection,
      modelLabel,
      content: content.trim(),
      generatedAt: new Date().toISOString(),
      provider: PROVIDER_LABEL,
      contextTruncated: context.contextTruncated
    };

    this.cache.set(cacheKey, result);
    this.output.appendLine(`[commit-analysis] Generated ${mode} analysis for ${commitHash.slice(0, 8)} using ${modelLabel}${context.contextTruncated ? ' (truncated diff)' : ''}.`);
    return result;
  }

  public async listAvailableModels(): Promise<CommitAnalysisModelOption[]> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return this.sortModels(models).map((model) => {
      const normalized = this.toModelLike(model);
      return {
        id: normalized.id ?? 'unknown',
        label: this.getModelLabel(normalized),
        provider: normalized.vendor,
        family: normalized.family ?? 'unknown',
        version: normalized.version ?? '',
        description: this.getModelDescription(normalized),
        costPriority: this.getCostPriority(normalized)
      };
    });
  }

  private async buildContext(repoRoot: string, commitHash: string): Promise<AnalysisContext> {
    const [detail, patchRaw] = await Promise.all([
      this.repository.getCommitDetail(repoRoot, commitHash),
      this.repository.getCommitPatch(repoRoot, commitHash)
    ]);

    const contextTruncated = patchRaw.length > MAX_PATCH_CHARS;
    const patch = contextTruncated
      ? `${patchRaw.slice(0, MAX_PATCH_CHARS)}\n\n[diff truncated by RepoFlow]`
      : patchRaw;

    return { detail, patch, contextTruncated };
  }

  private buildPrompt(context: AnalysisContext, mode: CommitAnalysisMode): string {
    const { detail, patch, contextTruncated } = context;
    const files = detail.files
      .slice(0, 40)
      .map((file) => `- ${file.status} ${file.path} (+${file.additions}/-${file.deletions})`)
      .join('\n');

    const modeInstructions = mode === 'executive'
      ? [
        'Mode: Executive Summary.',
        'Prioritize user impact, scope, release risk, and whether extra coordination or communication is needed.',
        'Keep the tone compact and decision-oriented for someone scanning multiple commits quickly.'
      ]
      : [
        'Mode: Technical Review.',
        'Prioritize implementation details, touched code paths, edge cases, regression risk, and missing tests.',
        'Assume the reader is an engineer reviewing the change before merge or release.'
      ];

    return [
      'You are analyzing a Git commit for a developer inside VS Code.',
      'Return a concise, practical review in plain text using exactly these markdown headings in this order:',
      '## Summary',
      '## What Changed',
      '## Risks',
      '## Validation',
      '## Suggested Follow-up',
      '',
      'Formatting rules:',
      '- Under each heading, write 1 to 4 short bullet points using `- `.',
      '- Keep each bullet specific and action-oriented.',
      '- If something is unknown from the diff, say so briefly instead of inventing details.',
      '- Do not wrap the answer in code fences.',
      '',
      ...modeInstructions,
      '',
      'Focus on implementation impact, likely intent, possible regressions, and missing validation.',
      'Do not mention that you are an AI model.',
      '',
      `Commit: ${detail.hash}`,
      `Subject: ${detail.subject}`,
      `Author: ${detail.authorName} <${detail.authorEmail}>`,
      `Date: ${detail.authoredAt}`,
      `Stats: +${detail.stats.additions} / -${detail.stats.deletions} across ${detail.stats.filesChanged} files`,
      '',
      'Commit body:',
      detail.body.trim() || '(empty)',
      '',
      'Changed files:',
      files || '(none)',
      '',
      `Diff truncated: ${contextTruncated ? 'yes' : 'no'}`,
      'Unified diff:',
      patch || '(empty)'
    ].join('\n');
  }

  private async resolveModel(modelSelection: string): Promise<{ model: vscode.LanguageModelChat; modelLabel: string }> {
    if (modelSelection && modelSelection !== 'auto') {
      const [exactMatch] = await vscode.lm.selectChatModels({ vendor: 'copilot', id: modelSelection });
      if (exactMatch) {
        return {
          model: exactMatch,
          modelLabel: this.getModelLabel(this.toModelLike(exactMatch))
        };
      }

      this.output.appendLine(`[commit-analysis] Preferred model '${modelSelection}' is unavailable; falling back to automatic selection.`);
    }

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const [preferredModel] = this.sortModels(models);
    if (!preferredModel) {
      throw new Error('GitHub Copilot não está disponível neste VS Code para analisar commits.');
    }

    return {
      model: preferredModel,
      modelLabel: this.getModelLabel(this.toModelLike(preferredModel))
    };
  }

  private sortModels(models: readonly vscode.LanguageModelChat[]): vscode.LanguageModelChat[] {
    return [...models].sort((left, right) => this.scoreModel(right) - this.scoreModel(left));
  }

  private scoreModel(model: vscode.LanguageModelChat): number {
    const normalized = this.toModelLike(model);
    const haystack = `${normalized.family ?? ''} ${normalized.id ?? ''}`.toLowerCase();
    if (/\bo[134]\b|\bo[134]-|\bo[134]mini\b|\bo[134]-mini\b/.test(haystack)) {
      return 100;
    }
    if (haystack.startsWith('o')) {
      return 80;
    }
    return 10;
  }

  private toModelLike(model: vscode.LanguageModelChat): ModelLike {
    return model as ModelLike;
  }

  private getModelLabel(model: ModelLike): string {
    if (typeof model.name === 'string' && model.name.trim()) {
      return model.name;
    }

    if (typeof model.family === 'string' && model.family.trim()) {
      return typeof model.version === 'string' && model.version.trim()
        ? `${model.family} (${model.version})`
        : model.family;
    }

    return model.id ?? 'GitHub Copilot';
  }

  private getModelDescription(model: ModelLike): string {
    if (typeof model.tooltip === 'string' && model.tooltip.trim()) {
      return model.tooltip.trim();
    }

    if (typeof model.detail === 'string' && model.detail.trim()) {
      return model.detail.trim();
    }

    return `GitHub Copilot model from the ${model.family ?? 'default'} family.`;
  }

  private getCostPriority(model: ModelLike): string | undefined {
    const detailText = [model.detail, model.tooltip]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' · ');

    return detailText || undefined;
  }
}
