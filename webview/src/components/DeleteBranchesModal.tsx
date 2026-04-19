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

export function DeleteBranchesModal({ snapshot, onClose }: DeleteBranchesModalProps) {
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
        } else {
            setSelectedBranches(new Set(deletableBranches.map((b) => b.shortName)));
        }
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
                <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm Delete Branches">
                    <header className="modal__header">
                        <h2>Confirm Delete</h2>
                        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                            <i className="codicon codicon-close" aria-hidden="true" />
                        </button>
                    </header>

                    <div className="modal__body">
                        <div className="settings-section">
                            <p style={{ margin: '0 0 0.5rem', color: 'var(--warning)' }}>
                                Are you sure you want to delete the following {selectedBranches.size} branch{selectedBranches.size !== 1 ? 'es' : ''}?
                            </p>
                            <div style={{
                                background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius)',
                                border: '1px solid var(--danger)',
                                maxHeight: '200px',
                                overflowY: 'auto'
                            }}>
                                {Array.from(selectedBranches).map((branchName) => (
                                    <div key={branchName} style={{ padding: '0.3rem 0', fontSize: '0.9rem', color: 'var(--danger)' }}>
                                        • {branchName}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setConfirming(false)}
                                style={{ background: 'var(--vscode-button-secondaryBackground)' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                style={{
                                    background: 'var(--danger)',
                                    color: '#fff',
                                    border: `1px solid var(--danger)`
                                }}
                            >
                                Delete {selectedBranches.size} Branch{selectedBranches.size !== 1 ? 'es' : ''}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Delete Local Branches">
                <header className="modal__header">
                    <h2>Delete Local Branches</h2>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                <div className="modal__body">
                    <section className="settings-section">
                        {deletableBranches.length === 0 ? (
                            <p style={{ margin: 0, color: 'var(--muted)', textAlign: 'center', padding: '1rem' }}>
                                No branches available to delete. You are on the current branch.
                            </p>
                        ) : (
                            <>
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <label className="settings-toggle">
                                        <input
                                            type="checkbox"
                                            checked={selectedBranches.size === deletableBranches.length}
                                            onChange={selectAll}
                                        />
                                        <span>Select All ({deletableBranches.length})</span>
                                    </label>
                                </div>

                                <div style={{
                                    border: '1px solid var(--panel-border)',
                                    borderRadius: 'var(--radius)',
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column'
                                }}>
                                    {deletableBranches.map((branch) => (
                                        <label
                                            key={branch.name}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                padding: '0.5rem 0.75rem',
                                                borderBottom: '1px solid var(--panel-border)',
                                                cursor: 'pointer',
                                                transition: 'background 80ms ease',
                                                background: selectedBranches.has(branch.shortName) ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!selectedBranches.has(branch.shortName)) {
                                                    e.currentTarget.style.background = 'color-mix(in srgb, var(--text) 5%, transparent)';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = selectedBranches.has(branch.shortName) ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent';
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedBranches.has(branch.shortName)}
                                                onChange={() => toggleBranch(branch.shortName)}
                                                style={{ marginRight: '0.5rem' }}
                                            />
                                            <span style={{ flex: 1, fontSize: '0.9rem' }}>
                                                {branch.shortName}
                                            </span>
                                            {branch.upstream && (
                                                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '0.5rem' }}>
                                                    → {branch.upstream}
                                                </span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            </>
                        )}
                    </section>

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={selectedBranches.size === 0}
                            onClick={() => setConfirming(true)}
                            style={{
                                background: selectedBranches.size > 0 ? 'var(--danger)' : 'var(--vscode-button-secondaryBackground)',
                                color: selectedBranches.size > 0 ? '#fff' : 'var(--text)',
                                cursor: selectedBranches.size > 0 ? 'pointer' : 'not-allowed',
                                opacity: selectedBranches.size > 0 ? 1 : 0.6,
                                border: `1px solid ${selectedBranches.size > 0 ? 'var(--danger)' : 'var(--panel-border)'}`
                            }}
                        >
                            Delete ({selectedBranches.size})
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
