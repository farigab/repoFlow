import { useState } from 'react';
import type { BranchSummary, GraphSnapshot } from '../../../src/core/models';
import { vscode } from '../vscode';

interface DeleteBranchesModalProps {
    snapshot: GraphSnapshot;
    onClose: () => void;
}

function branchSort(left: BranchSummary, right: BranchSummary): number {
    if (left.current && !right.current) return -1;
    if (!left.current && right.current) return 1;
    return left.shortName.localeCompare(right.shortName);
}

export function DeleteBranchesModal({ snapshot, onClose }: Readonly<DeleteBranchesModalProps>) {
    const localBranches = snapshot.branches
        .filter((b) => !b.remote)
        .sort(branchSort);

    const deletableBranches = localBranches.filter((b) => !b.current);
    const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
    const [confirming, setConfirming] = useState(false);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    const toggleBranch = (branchName: string) => {
        const updated = new Set(selectedBranches);
        if (updated.has(branchName)) {
            updated.delete(branchName);
        } else {
            updated.add(branchName);
        }
        setSelectedBranches(updated);
    };

    const selectAll = () => {
        if (selectedBranches.size === deletableBranches.length) {
            setSelectedBranches(new Set());
            return;
        }
        setSelectedBranches(new Set(deletableBranches.map((b) => b.shortName)));
    };

    const handleDelete = () => {
        if (selectedBranches.size === 0) return;

        for (const branchName of selectedBranches) {
            vscode.postMessage({
                type: 'deleteBranch',
                payload: { repoRoot: snapshot.repoRoot, branchName }
            });
        }

        setSelectedBranches(new Set());
        setConfirming(false);
        onClose();
    };

    if (confirming && selectedBranches.size > 0) {
        return (
            <div className="modal-backdrop" onClick={handleBackdropClick}>
                <div className="modal delete-branches-modal" role="dialog" aria-modal="true" aria-label="Confirm Delete Branches">
                    <header className="modal__header modal__header--hero">
                        <div className="modal__title-group">
                            <span className="modal__eyebrow">Destructive action</span>
                            <h2>Confirm Delete</h2>
                        </div>
                        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                            <i className="codicon codicon-close" aria-hidden="true" />
                        </button>
                    </header>

                    <div className="modal__body">
                        <div className="delete-confirm">
                            <i className="codicon codicon-warning delete-confirm__icon" aria-hidden="true" />
                            <div>
                                <strong>Delete {selectedBranches.size} local branch{selectedBranches.size === 1 ? '' : 'es'}?</strong>
                                <p>This removes the local branch refs. Remote branches are not deleted.</p>
                            </div>
                        </div>

                        <div className="delete-branch-list delete-branch-list--danger">
                            {Array.from(selectedBranches).map((branchName) => (
                                <div key={branchName} className="delete-branch-row delete-branch-row--readonly">
                                    <i className="codicon codicon-git-branch" aria-hidden="true" />
                                    <span>{branchName}</span>
                                </div>
                            ))}
                        </div>

                        <div className="modal-actions">
                            <button type="button" onClick={() => setConfirming(false)}>
                                Cancel
                            </button>
                            <button type="button" className="button--danger" onClick={handleDelete}>
                                Delete {selectedBranches.size}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal delete-branches-modal" role="dialog" aria-modal="true" aria-label="Delete Local Branches">
                <header className="modal__header modal__header--hero">
                    <div className="modal__title-group">
                        <span className="modal__eyebrow">{deletableBranches.length} deletable</span>
                        <h2>Delete Local Branches</h2>
                    </div>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                <div className="modal__body">
                    <section className="settings-section">
                        {deletableBranches.length === 0 ? (
                            <div className="modal-empty">
                                <i className="codicon codicon-check" aria-hidden="true" />
                                <span>No local branches available to delete.</span>
                            </div>
                        ) : (
                            <>
                                <div className="delete-branch-toolbar">
                                    <label className="settings-toggle">
                                        <input
                                            type="checkbox"
                                            checked={selectedBranches.size === deletableBranches.length}
                                            onChange={selectAll}
                                        />
                                        <span>Select all</span>
                                    </label>
                                    <span>{selectedBranches.size} selected</span>
                                </div>

                                <div className="delete-branch-list">
                                    {deletableBranches.map((branch) => {
                                        const selected = selectedBranches.has(branch.shortName);
                                        return (
                                            <label key={branch.name} className={`delete-branch-row${selected ? ' delete-branch-row--selected' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => toggleBranch(branch.shortName)}
                                                />
                                                <i className="codicon codicon-git-branch" aria-hidden="true" />
                                                <span className="delete-branch-row__name">{branch.shortName}</span>
                                                {branch.upstream ? (
                                                    <span className="delete-branch-row__upstream">{branch.upstream}</span>
                                                ) : null}
                                            </label>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </section>

                    <div className="modal-actions">
                        <button type="button" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="button--danger"
                            disabled={selectedBranches.size === 0}
                            onClick={() => setConfirming(true)}
                        >
                            Delete ({selectedBranches.size})
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
