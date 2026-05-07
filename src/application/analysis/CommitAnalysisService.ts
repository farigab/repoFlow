import * as vscode from 'vscode';
import type { CommitAnalysisResult, CommitDetail } from '../../core/models';
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

export class CommitAnalysisService {
  private readonly cache = new GitCache<CommitAnalysisResult>(ANALYSIS_CACHE_TTL_MS);

  public constructor(
    private readonly repository: GitRepository,
    private readonly output: vscode.OutputChannel
  ) { }

  public async analyzeCommit(repoRoot: string, commitHash: string, token?: vscode.CancellationToken): Promise<CommitAnalysisResult> {
    const cacheKey = `${repoRoot}::${commitHash}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!model) {
      throw new Error('GitHub Copilot não está disponível neste VS Code para analisar commits.');
    }

    const context = await this.buildContext(repoRoot, commitHash);
    const response = await model.sendRequest([
      vscode.LanguageModelChatMessage.User(this.buildPrompt(context))
    ], {
      justification: 'Analyze a Git commit selected by the user in RepoFlow.'
    }, token);

    let content = '';
    for await (const chunk of response.text) {
      content += chunk;
    }

    const result: CommitAnalysisResult = {
      commitHash,
      content: content.trim(),
      generatedAt: new Date().toISOString(),
      provider: PROVIDER_LABEL,
      contextTruncated: context.contextTruncated
    };

    this.cache.set(cacheKey, result);
    this.output.appendLine(`[commit-analysis] Generated analysis for ${commitHash.slice(0, 8)}${context.contextTruncated ? ' (truncated diff)' : ''}.`);
    return result;
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

  private buildPrompt(context: AnalysisContext): string {
    const { detail, patch, contextTruncated } = context;
    const files = detail.files
      .slice(0, 40)
      .map((file) => `- ${file.status} ${file.path} (+${file.additions}/-${file.deletions})`)
      .join('\n');

    return [
      'You are analyzing a Git commit for a developer inside VS Code.',
      'Provide a concise, practical review in plain text with these sections:',
      '1. Summary',
      '2. What Changed',
      '3. Risks / Attention Points',
      '4. Suggested Follow-up',
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
}
