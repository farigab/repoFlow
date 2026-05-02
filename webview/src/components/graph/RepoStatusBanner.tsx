import { useEffect, useState } from 'react';
import type { WorkingTreeStatus } from '../../../../src/core/models';
import { buildRepoSummary } from '../../../../src/shared/repoSummary';

export type RepoBannerAction = 'continue' | 'skip' | 'abort' | 'pull' | 'push' | 'fetch';

function formatTimeAgo(isoDate: string): string {
    const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

interface RepoStatusBannerProps {
    status: WorkingTreeStatus;
    onAction: (action: RepoBannerAction) => void;
    onOpenConflictFile: (filePath: string) => void;
}

export function RepoStatusBanner({ status, onAction, onOpenConflictFile }: RepoStatusBannerProps) {
    const [, setClockTick] = useState(0);

    useEffect(() => {
        if (!status.lastFetchAt) {
            return;
        }

        const intervalId = window.setInterval(() => {
            setClockTick((current) => current + 1);
        }, 30_000);

        return () => window.clearInterval(intervalId);
    }, [status.lastFetchAt]);

    const hasSpecialState = Boolean(status.specialState);
    const hasConflicts = status.conflicted.length > 0;

    const variant = hasSpecialState && (
        status.specialState === 'merging' ||
        status.specialState === 'rebasing' ||
        status.specialState === 'cherry-picking' ||
        status.specialState === 'reverting'
    )
        ? 'warning'
        : hasSpecialState
            ? 'info'
            : status.behind > 0
                ? 'behind'
                : status.ahead > 0
                    ? 'ahead'
                    : 'clean';

    const iconClass = hasSpecialState
        ? 'codicon-warning'
        : status.behind > 0
            ? 'codicon-arrow-down'
            : status.ahead > 0
                ? 'codicon-arrow-up'
                : 'codicon-check';

    const canContinue = hasSpecialState && status.specialState !== 'detached' && status.specialState !== 'bisecting' && !hasConflicts;
    const canSkip = status.specialState === 'rebasing';
    const canAbort = hasSpecialState && status.specialState !== 'detached';

    return (
        <div className={`repo-status-banner repo-status-banner--${variant}`} role="status" aria-live="polite">
            <div className="repo-status-banner__row">
                <i className={`codicon ${iconClass}`} aria-hidden="true" />
                <span className="repo-status-banner__text">{buildRepoSummary(status)}</span>
                {status.lastFetchAt && (
                    <span className="repo-status-banner__fetch" title={`Last fetch: ${new Date(status.lastFetchAt).toLocaleString()}`}>
                        fetched {formatTimeAgo(status.lastFetchAt)}
                    </span>
                )}
                <div className="repo-status-banner__actions">
                    {canContinue && (
                        <button type="button" className="repo-status-banner__btn repo-status-banner__btn--primary" onClick={() => onAction('continue')} title="Continue current operation">
                            <i className="codicon codicon-play" aria-hidden="true" /> Continue
                        </button>
                    )}
                    {canSkip && (
                        <button type="button" className="repo-status-banner__btn" onClick={() => onAction('skip')} title="Skip current commit during rebase">
                            <i className="codicon codicon-debug-step-over" aria-hidden="true" /> Skip
                        </button>
                    )}
                    {canAbort && (
                        <button type="button" className="repo-status-banner__btn repo-status-banner__btn--danger" onClick={() => onAction('abort')} title="Abort current operation">
                            <i className="codicon codicon-stop" aria-hidden="true" /> Abort
                        </button>
                    )}
                    {!hasSpecialState && status.behind > 0 && (
                        <button type="button" className="repo-status-banner__btn repo-status-banner__btn--primary" onClick={() => onAction('pull')} title={`Pull ${status.behind} commit${status.behind > 1 ? 's' : ''} from ${status.upstream ?? 'upstream'}`}>
                            <i className="codicon codicon-arrow-down" aria-hidden="true" /> Pull
                        </button>
                    )}
                    {!hasSpecialState && status.ahead > 0 && (
                        <button type="button" className="repo-status-banner__btn" onClick={() => onAction('push')} title={`Push ${status.ahead} commit${status.ahead > 1 ? 's' : ''} to ${status.upstream ?? 'upstream'}`}>
                            <i className="codicon codicon-arrow-up" aria-hidden="true" /> Push
                        </button>
                    )}
                    <button type="button" className="repo-status-banner__btn repo-status-banner__btn--icon" onClick={() => onAction('fetch')} title="Fetch remote refs">
                        <i className="codicon codicon-sync" aria-hidden="true" />
                    </button>
                </div>
            </div>
            {hasConflicts && (
                <div className="repo-status-banner__conflicts">
                    <span className="repo-status-banner__conflicts-label">
                        <i className="codicon codicon-warning" aria-hidden="true" /> {status.conflicted.length} conflict{status.conflicted.length > 1 ? 's' : ''} - click to open:
                    </span>
                    <div className="repo-status-banner__conflicts-list">
                        {status.conflicted.map((f) => (
                            <button
                                key={f.path}
                                type="button"
                                className="repo-status-banner__conflict-file"
                                onClick={() => onOpenConflictFile(f.path)}
                                title={`Open ${f.path}`}
                            >
                                <i className="codicon codicon-file" aria-hidden="true" />
                                {f.path}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
