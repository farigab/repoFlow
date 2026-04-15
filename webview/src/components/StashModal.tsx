import { useEffect, useRef, useState } from 'react';
import type { GraphSnapshot, StashEntry } from '../../../src/core/models/GitModels';
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

    const hasLocalChanges =
        snapshot.localChanges.staged.length +
        snapshot.localChanges.unstaged.length +
        snapshot.localChanges.conflicted.length > 0;

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Git Stash">
                <header className="modal__header">
                    <h2>
                        <i className="codicon codicon-archive" aria-hidden="true" style={{ marginRight: '0.45rem' }} />
                        Git Stash
                    </h2>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                <div className="modal__tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'list'}
                        className={`modal__tab${activeTab === 'list' ? ' modal__tab--active' : ''}`}
                        onClick={() => setActiveTab('list')}
                    >
                        Stash List ({stashes.length})
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'create'}
                        className={`modal__tab${activeTab === 'create' ? ' modal__tab--active' : ''}`}
                        onClick={() => setActiveTab('create')}
                    >
                        <i className="codicon codicon-add" aria-hidden="true" style={{ marginRight: '0.3rem' }} />
                        New Stash
                    </button>
                </div>

                <div className="modal__body">
                    {activeTab === 'list' && (
                        <>
                            {stashes.length === 0 ? (
                                <div className="stash-empty">
                                    <i className="codicon codicon-inbox" aria-hidden="true" />
                                    <p>No stashes found in this repository.</p>
                                </div>
                            ) : (
                                <ul className="stash-list" aria-label="Stash entries">
                                    {stashes.map((entry) => (
                                        <li key={entry.ref} className="stash-entry">
                                            <div className="stash-entry__info">
                                                <span className="stash-entry__ref">{entry.ref}</span>
                                                {entry.branch && (
                                                    <span className="ref-pill ref-pill--localBranch stash-entry__branch">
                                                        {entry.branch}
                                                    </span>
                                                )}
                                                <span className="stash-entry__message">{entry.message}</span>
                                                <span className="stash-entry__date">{formatDate(entry.date)}</span>
                                            </div>
                                            <div className="stash-entry__actions">
                                                <button
                                                    type="button"
                                                    className="btn btn--secondary btn--sm"
                                                    onClick={() => handleApply(entry)}
                                                    title="Apply stash (keep stash in list)"
                                                >
                                                    Apply
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn--secondary btn--sm"
                                                    onClick={() => handlePop(entry)}
                                                    title="Pop stash (apply and remove from list)"
                                                >
                                                    Pop
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn--danger btn--sm"
                                                    onClick={() => handleDrop(entry)}
                                                    title="Drop stash (permanently delete)"
                                                >
                                                    <i className="codicon codicon-trash" aria-hidden="true" />
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {activeTab === 'create' && (
                        <div className="settings-section">
                            {!hasLocalChanges && (
                                <p className="stash-warning">
                                    <i className="codicon codicon-warning" aria-hidden="true" style={{ marginRight: '0.3rem' }} />
                                    No local changes to stash.
                                </p>
                            )}
                            <div className="settings-field">
                                <label className="settings-field__label" htmlFor="stash-message">
                                    Message <span className="settings-field__hint">(optional)</span>
                                </label>
                                <input
                                    ref={messageInputRef}
                                    id="stash-message"
                                    type="text"
                                    className="settings-field__input"
                                    placeholder="Describe what you are stashing…"
                                    value={stashMessage}
                                    onChange={(e) => setStashMessage(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && hasLocalChanges) handleStash(); }}
                                />
                            </div>
                            <label className="settings-field settings-field--checkbox">
                                <input
                                    type="checkbox"
                                    checked={includeUntracked}
                                    onChange={(e) => setIncludeUntracked(e.target.checked)}
                                />
                                <span className="settings-field__label">Include untracked files</span>
                            </label>
                        </div>
                    )}
                </div>

                {activeTab === 'create' && (
                    <footer className="modal__footer">
                        <button type="button" className="btn btn--secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn btn--primary"
                            onClick={handleStash}
                            disabled={!hasLocalChanges}
                        >
                            <i className="codicon codicon-archive" aria-hidden="true" style={{ marginRight: '0.35rem' }} />
                            Stash Changes
                        </button>
                    </footer>
                )}
            </div>
        </div>
    );
}
