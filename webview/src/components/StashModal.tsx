import { useEffect, useRef, useState } from 'react';
import type { GraphSnapshot, StashEntry } from '../../../src/core/models';
import { vscode } from '../vscode';

interface StashModalProps {
    snapshot: GraphSnapshot;
    stashes: StashEntry[];
    onClose: () => void;
}

type ActiveTab = 'list' | 'create';

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
});

function formatDate(input: string): string {
    try {
        return shortDateFormatter.format(new Date(input));
    } catch {
        return input;
    }
}

export function StashModal({ snapshot, stashes, onClose }: StashModalProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab>('list');
    const [stashMessage, setStashMessage] = useState('');
    const [includeUntracked, setIncludeUntracked] = useState(false);
    const messageInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (activeTab === 'create') {
            setTimeout(() => messageInputRef.current?.focus(), 0);
        }
    }, [activeTab]);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    const handleStash = () => {
        vscode.postMessage({
            type: 'stashChanges',
            payload: {
                repoRoot: snapshot.repoRoot,
                message: stashMessage.trim() || undefined,
                includeUntracked
            }
        });
        setStashMessage('');
        setIncludeUntracked(false);
        setActiveTab('list');
    };

    const handleApply = (entry: StashEntry) => {
        vscode.postMessage({
            type: 'applyStash',
            payload: { repoRoot: snapshot.repoRoot, ref: entry.ref }
        });
    };

    const handlePop = (entry: StashEntry) => {
        vscode.postMessage({
            type: 'popStash',
            payload: { repoRoot: snapshot.repoRoot, ref: entry.ref }
        });
    };

    const handleDrop = (entry: StashEntry) => {
        vscode.postMessage({
            type: 'dropStash',
            payload: { repoRoot: snapshot.repoRoot, ref: entry.ref }
        });
    };

    const stagedCount = snapshot.localChanges.staged.length;
    const unstagedCount = snapshot.localChanges.unstaged.length;
    const conflictedCount = snapshot.localChanges.conflicted.length;
    const hasLocalChanges = stagedCount + unstagedCount + conflictedCount > 0;

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal stash-modal" role="dialog" aria-modal="true" aria-label="Git Stash">
                <header className="modal__header">
                    <h2>Git Stash</h2>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                {/* Tab bar */}
                <div className="stash-tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'list'}
                        className={`stash-tab${activeTab === 'list' ? ' stash-tab--active' : ''}`}
                        onClick={() => setActiveTab('list')}
                    >
                        <i className="codicon codicon-list-unordered" aria-hidden="true" />
                        Saved stashes
                        {stashes.length > 0 && (
                            <span className="stash-tab__badge">{stashes.length}</span>
                        )}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'create'}
                        className={`stash-tab${activeTab === 'create' ? ' stash-tab--active' : ''}`}
                        onClick={() => setActiveTab('create')}
                    >
                        <i className="codicon codicon-add" aria-hidden="true" />
                        New stash
                        {hasLocalChanges && (
                            <span className="stash-tab__badge stash-tab__badge--warning">
                                {stagedCount + unstagedCount + conflictedCount}
                            </span>
                        )}
                    </button>
                </div>

                {/* Stash list */}
                {activeTab === 'list' && (
                    <div className="stash-body">
                        {stashes.length === 0 ? (
                            <div className="stash-empty">
                                <i className="codicon codicon-inbox" aria-hidden="true" />
                                <span>No stashes yet</span>
                                <p>Use <strong>New stash</strong> to save your current changes.</p>
                            </div>
                        ) : (
                            <ul className="stash-list" aria-label="Stash entries">
                                {stashes.map((entry) => (
                                    <li key={entry.ref} className="stash-entry">
                                        <div className="stash-entry__left">
                                            <i className="codicon codicon-archive stash-entry__icon" aria-hidden="true" />
                                        </div>
                                        <div className="stash-entry__info">
                                            <div className="stash-entry__top">
                                                <code className="stash-entry__ref">{entry.ref}</code>
                                                {entry.branch && (
                                                    <span className="ref-pill ref-pill--localBranch">
                                                        {entry.branch}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="stash-entry__message">{entry.message}</span>
                                            <span className="stash-entry__date">
                                                <i className="codicon codicon-calendar" aria-hidden="true" />
                                                {formatDate(entry.date)}
                                            </span>
                                        </div>
                                        <div className="stash-entry__actions">
                                            <button
                                                type="button"
                                                className="stash-action-btn"
                                                onClick={() => handleApply(entry)}
                                                title="Apply — restore changes without removing from stash list"
                                            >
                                                <i className="codicon codicon-run" aria-hidden="true" />
                                                Apply
                                            </button>
                                            <button
                                                type="button"
                                                className="stash-action-btn"
                                                onClick={() => handlePop(entry)}
                                                title="Pop — restore changes and remove from stash list"
                                            >
                                                <i className="codicon codicon-arrow-up" aria-hidden="true" />
                                                Pop
                                            </button>
                                            <button
                                                type="button"
                                                className="stash-action-btn stash-action-btn--danger"
                                                onClick={() => handleDrop(entry)}
                                                title="Drop — permanently delete this stash"
                                            >
                                                <i className="codicon codicon-trash" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* New stash form */}
                {activeTab === 'create' && (
                    <div className="stash-body stash-body--form">
                        {hasLocalChanges ? (
                            <div className="stash-changes-summary">
                                {stagedCount > 0 && (
                                    <span className="stash-changes-summary__item stash-changes-summary__item--staged">
                                        <i className="codicon codicon-diff-added" aria-hidden="true" />
                                        {stagedCount} staged
                                    </span>
                                )}
                                {unstagedCount > 0 && (
                                    <span className="stash-changes-summary__item stash-changes-summary__item--unstaged">
                                        <i className="codicon codicon-diff-modified" aria-hidden="true" />
                                        {unstagedCount} unstaged
                                    </span>
                                )}
                                {conflictedCount > 0 && (
                                    <span className="stash-changes-summary__item stash-changes-summary__item--conflict">
                                        <i className="codicon codicon-warning" aria-hidden="true" />
                                        {conflictedCount} conflicted
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="stash-no-changes">
                                <i className="codicon codicon-check" aria-hidden="true" />
                                <span>Working tree is clean — nothing to stash.</span>
                            </div>
                        )}

                        <div className="stash-form">
                            <label className="stash-form__label" htmlFor="stash-message">
                                Message
                                <span className="stash-form__hint">optional</span>
                            </label>
                            <input
                                ref={messageInputRef}
                                id="stash-message"
                                type="text"
                                className="stash-form__input"
                                placeholder="Describe what you are stashing…"
                                value={stashMessage}
                                onChange={(e) => setStashMessage(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && hasLocalChanges) handleStash(); }}
                                disabled={!hasLocalChanges}
                            />

                            <label className="stash-form__checkbox">
                                <input
                                    type="checkbox"
                                    checked={includeUntracked}
                                    onChange={(e) => setIncludeUntracked(e.target.checked)}
                                    disabled={!hasLocalChanges}
                                />
                                <span>Include untracked files</span>
                            </label>
                        </div>

                        <footer className="stash-footer">
                            <button type="button" className="stash-footer__cancel" onClick={onClose}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="stash-footer__submit"
                                onClick={handleStash}
                                disabled={!hasLocalChanges}
                            >
                                <i className="codicon codicon-archive" aria-hidden="true" />
                                Stash Changes
                            </button>
                        </footer>
                    </div>
                )}
            </div>
        </div>
    );
}
