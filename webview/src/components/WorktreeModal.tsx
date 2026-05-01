import { useEffect, useRef, useState } from 'react';
import type { BranchSummary, WorktreeEntry } from '../../../src/core/models';
import { vscode } from '../vscode';

interface WorktreeModalProps {
    repoRoot: string;
    entries: WorktreeEntry[];
    branches: BranchSummary[];
    busy: boolean;
    worktreeError: { message: string; path?: string; canForce?: boolean } | null;
    onClose: () => void;
}

type AddMode = 'existing' | 'new' | 'detached';

/** Shortens an absolute path for display — shows last 3 segments. */
function shortenPath(p: string): string {
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(sep).filter(Boolean);
    if (parts.length <= 3) return p;
    return `\u2026${sep}${parts.slice(-3).join(sep)}`;
}

/** Computes a default sibling path: /parent/repoName-branchName */
function buildDefaultPath(repoRoot: string, branch: string): string {
    const sep = repoRoot.includes('\\') ? '\\' : '/';
    const safeBranch = branch.replace(/[/\\:*?"<>|]/g, '-');
    const lastSep = Math.max(repoRoot.lastIndexOf('/'), repoRoot.lastIndexOf('\\'));
    if (lastSep <= 0) return repoRoot + sep + safeBranch;
    const parent = repoRoot.slice(0, lastSep);
    const repoName = repoRoot.slice(lastSep + 1);
    return `${parent}${sep}${repoName}-${safeBranch}`;
}

export function WorktreeModal({ repoRoot, entries, branches, busy, worktreeError, onClose }: WorktreeModalProps) {
    const [addMode, setAddMode] = useState<AddMode>('existing');
    const [selectedBranch, setSelectedBranch] = useState('');
    const [newBranchName, setNewBranchName] = useState('');
    const [commitHash, setCommitHash] = useState('');
    const [worktreePath, setWorktreePath] = useState('');
    const [isPathManuallyEdited, setIsPathManuallyEdited] = useState(false);
    const [pendingRemovePath, setPendingRemovePath] = useState<string | null>(null);
    const [renamingPath, setRenamingPath] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const newBranchInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const localBranches = branches.filter((b) => !b.remote);

    // Set initial branch selection
    useEffect(() => {
        const local = branches.filter((b) => !b.remote);
        if (local.length > 0 && !selectedBranch) {
            const first = local[0].shortName;
            setSelectedBranch(first);
            if (!worktreePath) {
                setWorktreePath(buildDefaultPath(repoRoot, first));
                setIsPathManuallyEdited(false);
            }
        }
    }, [branches, selectedBranch, worktreePath, repoRoot]);

    // Update path suggestion when the effective branch changes (not for detached mode)
    const effectiveBranch = addMode === 'existing' ? selectedBranch : addMode === 'new' ? newBranchName.trim() : '';
    useEffect(() => {
        if (effectiveBranch && !isPathManuallyEdited) {
            setWorktreePath(buildDefaultPath(repoRoot, effectiveBranch));
        }
    }, [effectiveBranch, repoRoot, isPathManuallyEdited]);

    // Focus rename input when it appears
    useEffect(() => {
        if (renamingPath) {
            setTimeout(() => renameInputRef.current?.focus(), 0);
        }
    }, [renamingPath]);

    // If worktreeError arrives for the pending remove path with canForce, keep the
    // force-confirm UI visible. Otherwise reset pending state.
    const forceConfirmPath = worktreeError?.canForce ? worktreeError.path ?? null : null;

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    const handleAdd = () => {
        const destPath = worktreePath.trim();
        if (!destPath) return;

        if (addMode === 'detached') {
            const hash = commitHash.trim();
            if (!hash) return;
            vscode.postMessage({ type: 'addWorktreeAtCommit', payload: { repoRoot, worktreePath: destPath, commitHash: hash } });
            setCommitHash('');
        } else {
            const branch = addMode === 'existing' ? selectedBranch : newBranchName.trim();
            if (!branch) return;
            vscode.postMessage({ type: 'addWorktree', payload: { repoRoot, branch, createNew: addMode === 'new', worktreePath: destPath } });
            setNewBranchName('');
        }
    };

    const handleRemoveRequest = (path: string) => setPendingRemovePath(path);

    const handleRemoveConfirm = (path: string, force: boolean) => {
        setPendingRemovePath(null);
        vscode.postMessage({ type: 'removeWorktree', payload: { repoRoot, path, force } });
    };

    const handleOpenInWindow = (path: string) => {
        vscode.postMessage({ type: 'openWorktreeInWindow', payload: { path } });
    };

    const handleRevealInOs = (path: string) => {
        vscode.postMessage({ type: 'revealWorktreeInOs', payload: { path } });
    };

    const handleCopyPath = (path: string) => {
        vscode.postMessage({ type: 'copyWorktreePath', payload: { path } });
    };

    const handleModeChange = (mode: AddMode) => {
        setAddMode(mode);
        setIsPathManuallyEdited(false);
    };

    const handleToggleLock = (path: string, locked: boolean) => {
        vscode.postMessage({ type: locked ? 'unlockWorktree' : 'lockWorktree', payload: { repoRoot, path } });
    };

    const handleStartRename = (entry: WorktreeEntry) => {
        setRenamingPath(entry.path);
        setRenameValue(entry.path);
    };

    const handleRenameConfirm = (oldPath: string) => {
        const newPath = renameValue.trim();
        if (!newPath || newPath === oldPath) { setRenamingPath(null); return; }
        setRenamingPath(null);
        vscode.postMessage({ type: 'moveWorktree', payload: { repoRoot, path: oldPath, newPath } });
    };

    const addBranchValid = addMode === 'detached'
        ? commitHash.trim().length > 0 && worktreePath.trim().length > 0
        : (addMode === 'existing' ? !!selectedBranch : newBranchName.trim().length > 0) && worktreePath.trim().length > 0;

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal worktree-modal" role="dialog" aria-modal="true" aria-label="Worktree Manager">
                <header className="modal__header modal__header--hero">
                    <div className="modal__title-group">
                        <span className="modal__eyebrow">{entries.length} worktree{entries.length === 1 ? '' : 's'}</span>
                        <h2>Worktree Manager</h2>
                    </div>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                {/* Inline error banner (non-force-recoverable) */}
                {worktreeError && !worktreeError.canForce && (
                    <div className="worktree-error-banner" role="alert">
                        <i className="codicon codicon-error" aria-hidden="true" />
                        <span>{worktreeError.message}</span>
                    </div>
                )}

                {/* Worktree list */}
                <div className="worktree-body">
                    {entries.length === 0 ? (
                        <div className="worktree-empty">
                            <i className="codicon codicon-files" aria-hidden="true" />
                            <span>No linked worktrees</span>
                            <p>Use <strong>Add Worktree</strong> below to create a new checkout.</p>
                        </div>
                    ) : (
                        <ul className="worktree-list" aria-label="Worktree entries">
                            {entries.map((entry) => {
                                const shortName = entry.branch ? entry.branch.replace('refs/heads/', '') : null;
                                const isForceConfirm = forceConfirmPath === entry.path;
                                const isPendingRemove = pendingRemovePath === entry.path;
                                const isRenaming = renamingPath === entry.path;

                                return (
                                    <li key={entry.path} className={`worktree-entry${entry.dirty ? ' worktree-entry--dirty' : ''}`}>
                                        <div className="worktree-entry__info">
                                            <div className="worktree-entry__top">
                                                {entry.isMain && (
                                                    <span className="worktree-badge worktree-badge--main">MAIN</span>
                                                )}
                                                {shortName ? (
                                                    <span className="ref-pill ref-pill--localBranch">{shortName}</span>
                                                ) : (
                                                    <span className="worktree-badge worktree-badge--detached">DETACHED</span>
                                                )}
                                                <code className="worktree-entry__hash">{entry.head.slice(0, 8)}</code>
                                                {entry.locked && (
                                                    <span className="worktree-badge worktree-badge--locked" title="Locked">
                                                        <i className="codicon codicon-lock" aria-hidden="true" />
                                                    </span>
                                                )}
                                                {entry.dirty && (
                                                    <span className="worktree-dirty-dot" title={`${entry.staged} staged, ${entry.unstaged} unstaged`}>●</span>
                                                )}
                                            </div>

                                            {/* Rename input or path display */}
                                            {isRenaming ? (
                                                <div className="worktree-rename-row">
                                                    <input
                                                        ref={renameInputRef}
                                                        className="worktree-rename-input"
                                                        type="text"
                                                        value={renameValue}
                                                        onChange={(e) => setRenameValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleRenameConfirm(entry.path);
                                                            else if (e.key === 'Escape') setRenamingPath(null);
                                                        }}
                                                        disabled={busy}
                                                        spellCheck={false}
                                                        aria-label="New worktree path"
                                                    />
                                                    <button type="button" className="worktree-action-btn" onClick={() => handleRenameConfirm(entry.path)} disabled={busy}>
                                                        <i className="codicon codicon-check" aria-hidden="true" />
                                                    </button>
                                                    <button type="button" className="worktree-action-btn" onClick={() => setRenamingPath(null)} disabled={busy}>
                                                        <i className="codicon codicon-close" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="worktree-entry__path" title={entry.path}>{shortenPath(entry.path)}</span>
                                            )}

                                            {/* Detailed status row */}
                                            {(entry.staged > 0 || entry.unstaged > 0 || entry.ahead > 0 || entry.behind > 0) && (
                                                <div className="worktree-entry__status">
                                                    {entry.staged > 0 && (
                                                        <span className="worktree-status-pill worktree-status-pill--staged" title="Staged files">
                                                            <i className="codicon codicon-diff-added" aria-hidden="true" />{entry.staged}
                                                        </span>
                                                    )}
                                                    {entry.unstaged > 0 && (
                                                        <span className="worktree-status-pill worktree-status-pill--unstaged" title="Unstaged / untracked files">
                                                            <i className="codicon codicon-diff-modified" aria-hidden="true" />{entry.unstaged}
                                                        </span>
                                                    )}
                                                    {entry.ahead > 0 && (
                                                        <span className="worktree-status-pill worktree-status-pill--ahead" title={`${entry.ahead} commits ahead`}>
                                                            <i className="codicon codicon-arrow-up" aria-hidden="true" />{entry.ahead}
                                                        </span>
                                                    )}
                                                    {entry.behind > 0 && (
                                                        <span className="worktree-status-pill worktree-status-pill--behind" title={`${entry.behind} commits behind`}>
                                                            <i className="codicon codicon-arrow-down" aria-hidden="true" />{entry.behind}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="worktree-entry__actions">
                                            {/* Inline remove confirm */}
                                            {isPendingRemove && !isForceConfirm && (
                                                <div className="worktree-inline-confirm">
                                                    <span>Remove this worktree?</span>
                                                    <button type="button" className="worktree-action-btn worktree-action-btn--danger" onClick={() => handleRemoveConfirm(entry.path, false)} disabled={busy}>
                                                        Remove
                                                    </button>
                                                    <button type="button" className="worktree-action-btn" onClick={() => setPendingRemovePath(null)} disabled={busy}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            )}

                                            {/* Force confirm after dirty-worktree error */}
                                            {isForceConfirm && (
                                                <div className="worktree-inline-confirm worktree-inline-confirm--force">
                                                    <span>Has uncommitted changes. Force remove?</span>
                                                    <button type="button" className="worktree-action-btn worktree-action-btn--danger" onClick={() => handleRemoveConfirm(entry.path, true)} disabled={busy}>
                                                        Force Remove
                                                    </button>
                                                    <button type="button" className="worktree-action-btn" onClick={() => setPendingRemovePath(null)} disabled={busy}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            )}

                                            {/* Normal action buttons */}
                                            {!isPendingRemove && !isForceConfirm && !isRenaming && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="worktree-action-btn"
                                                        onClick={() => handleOpenInWindow(entry.path)}
                                                        disabled={busy || entry.isMain}
                                                        title={entry.isMain ? 'Already open in this window' : 'Open in new VS Code window'}
                                                    >
                                                        <i className="codicon codicon-multiple-windows" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="worktree-action-btn"
                                                        onClick={() => handleRevealInOs(entry.path)}
                                                        disabled={busy}
                                                        title="Reveal in Explorer"
                                                    >
                                                        <i className="codicon codicon-folder-opened" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="worktree-action-btn"
                                                        onClick={() => handleCopyPath(entry.path)}
                                                        disabled={busy}
                                                        title="Copy path to clipboard"
                                                    >
                                                        <i className="codicon codicon-copy" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="worktree-action-btn"
                                                        onClick={() => handleToggleLock(entry.path, entry.locked)}
                                                        disabled={busy || entry.isMain}
                                                        title={entry.locked ? 'Unlock worktree' : 'Lock worktree'}
                                                    >
                                                        <i className={`codicon ${entry.locked ? 'codicon-lock' : 'codicon-unlock'}`} aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="worktree-action-btn"
                                                        onClick={() => handleStartRename(entry)}
                                                        disabled={busy || entry.isMain}
                                                        title="Move / Rename worktree"
                                                    >
                                                        <i className="codicon codicon-edit" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="worktree-action-btn worktree-action-btn--danger"
                                                        onClick={() => handleRemoveRequest(entry.path)}
                                                        disabled={busy || entry.isMain || entry.locked}
                                                        title={entry.isMain ? 'Cannot remove the main worktree' : entry.locked ? 'Unlock before removing' : 'Remove worktree'}
                                                    >
                                                        <i className="codicon codicon-trash" aria-hidden="true" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Add worktree form */}
                <div className="worktree-add-form">
                    <h3 className="worktree-add-form__title">
                        <i className="codicon codicon-add" aria-hidden="true" />
                        Add Worktree
                    </h3>

                    <div className="worktree-add-form__mode" role="group" aria-label="Branch mode">
                        <label className="worktree-radio">
                            <input type="radio" name="addMode" value="existing" checked={addMode === 'existing'} onChange={() => handleModeChange('existing')} />
                            Existing branch
                        </label>
                        <label className="worktree-radio">
                            <input type="radio" name="addMode" value="new" checked={addMode === 'new'} onChange={() => handleModeChange('new')} />
                            New branch
                        </label>
                        <label className="worktree-radio">
                            <input type="radio" name="addMode" value="detached" checked={addMode === 'detached'} onChange={() => handleModeChange('detached')} />
                            Commit hash
                        </label>
                    </div>

                    {addMode === 'existing' ? (
                        <select className="worktree-add-form__select" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} disabled={busy} aria-label="Select branch">
                            {localBranches.length === 0 ? (
                                <option value="">No local branches</option>
                            ) : (
                                localBranches.map((b) => (
                                    <option key={b.name} value={b.shortName}>{b.shortName}</option>
                                ))
                            )}
                        </select>
                    ) : addMode === 'new' ? (
                        <input
                            ref={newBranchInputRef}
                            className="worktree-add-form__input"
                            type="text"
                            placeholder="New branch name…"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            disabled={busy}
                            aria-label="New branch name"
                            spellCheck={false}
                        />
                    ) : (
                        <input
                            className="worktree-add-form__input"
                            type="text"
                            placeholder="Commit hash or tag (detached HEAD)…"
                            value={commitHash}
                            onChange={(e) => setCommitHash(e.target.value)}
                            disabled={busy}
                            aria-label="Commit hash"
                            spellCheck={false}
                        />
                    )}

                    <label className="worktree-add-form__path-label">Path (new directory)</label>
                    <input
                        className="worktree-add-form__input"
                        type="text"
                        placeholder="Absolute path for the new worktree…"
                        value={worktreePath}
                        onChange={(e) => {
                            setWorktreePath(e.target.value);
                            setIsPathManuallyEdited(true);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && addBranchValid) handleAdd(); }}
                        disabled={busy}
                        aria-label="Worktree path"
                        spellCheck={false}
                    />

                    <button type="button" className="worktree-add-form__btn" onClick={handleAdd} disabled={busy || !addBranchValid}>
                        {busy ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                                Working…
                            </>
                        ) : (
                            <>
                                <i className="codicon codicon-add" aria-hidden="true" />
                                Add Worktree
                            </>
                        )}
                    </button>
                    <p className="worktree-add-form__hint">
                        The directory will be created by git. Edit the path above to change the location.
                        {addMode === 'detached' && ' Detached HEAD — no branch will be checked out.'}
                    </p>
                </div>
            </div>
        </div>
    );
}
