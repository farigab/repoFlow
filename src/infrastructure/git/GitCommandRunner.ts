import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024;
const MESSAGE_FLAGS = new Set(['-m', '--message', '-F', '--file']);

export interface GitOutputChannel {
  appendLine(value: string): void;
}

export interface GitRunOptions {
  logErrors?: boolean;
  logCommand?: boolean;
}

function redactUrl(value: string): string {
  return value
    .replaceAll(/\b(https?:\/\/)([^/@\s]+@)/gi, '$1<redacted>@')
    .replaceAll(/([?&](?:access_token|auth|password|pass|token)=)[^&\s]+/gi, '$1<redacted>');
}

function quoteLogArg(value: string): string {
  if (value === '') {
    return '""';
  }

  const escaped = value.replaceAll('"', String.raw`\"`);
  return /\s|"/.test(value) ? `"${escaped}"` : escaped;
}

export function redactGitArgsForLog(args: readonly string[]): string[] {
  const redacted: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const previous = args[index - 1];

    if (previous && MESSAGE_FLAGS.has(previous)) {
      redacted.push('<redacted-message>');
      continue;
    }

    if (arg.startsWith('--message=')) {
      redacted.push('--message=<redacted-message>');
      continue;
    }

    if (arg.startsWith('--file=')) {
      redacted.push('--file=<redacted-message-file>');
      continue;
    }

    redacted.push(redactUrl(arg));
  }

  return redacted;
}

export function formatGitCommandForLog(repoRoot: string, args: readonly string[]): string {
  return ['git', '-C', repoRoot, ...redactGitArgsForLog(args)]
    .map(quoteLogArg)
    .join(' ');
}

export class GitCommandRunner {
  public constructor(
    private readonly output: GitOutputChannel,
    private readonly executable = 'git'
  ) { }

  public async run(repoRoot: string, args: string[], options?: GitRunOptions): Promise<string> {
    if (options?.logCommand !== false) {
      this.output.appendLine(formatGitCommandForLog(repoRoot, args));
    }

    try {
      const result = await execFileAsync(this.executable, ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: DEFAULT_MAX_BUFFER
      });

      return result.stdout.trimEnd();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options?.logErrors !== false) {
        this.output.appendLine(`[error] ${message}`);
      }
      throw new Error(message);
    }
  }
}
