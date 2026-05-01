import { useState } from 'react';
import type { BranchSummary, GraphSnapshot } from '../../../src/core/models';
import { vscode } from '../vscode';

interface CreatePRModalProps {
    snapshot: GraphSnapshot;
    onClose: () => void;
}

function branchSort(left: BranchSummary, right: BranchSummary): number {
    if (left.current && !right.current) return -1;
    if (!left.current && right.current) return 1;
    return left.shortName.localeCompare(right.shortName);
}

export function CreatePRModal({ snapshot, onClose }: CreatePRModalProps) {
    const localBranches = snapshot.branches.filter((b) => !b.remote).sort(branchSort);
    const currentBranch = snapshot.localChanges.currentBranch ?? localBranches[0]?.shortName ?? '';

    const [title, setTitle] = useState('');
    const [sourceBranch, setSourceBranch] = useState(currentBranch);
    const [targetBranch, setTargetBranch] = useState(
        localBranches.find((b) => b.shortName === 'main' || b.shortName === 'master')?.shortName
        ?? localBranches.find((b) => !b.current)?.shortName
        ?? ''
    );
    const [description, setDescription] = useState('');

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!sourceBranch || !targetBranch) return;
        vscode.postMessage({
            type: 'openPullRequest',
            payload: {
                repoRoot: snapshot.repoRoot,
                sourceBranch,
                targetBranch,
                title: title.trim(),
                description: description.trim()
            }
        });
        onClose();
    };

    const canSubmit = sourceBranch && targetBranch && sourceBranch !== targetBranch;

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Create Pull Request">
                <header className="modal__header modal__header--hero">
                    <div className="modal__title-group">
                        <span className="modal__eyebrow">Repository tools</span>
                        <h2>Create Pull Request</h2>
                    </div>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                <form className="modal__body" onSubmit={handleSubmit}>

                    <section className="settings-section">
                        <h3 className="settings-section__title">Branches</h3>

                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="pr-source">Source branch</label>
                            <select
                                id="pr-source"
                                className="settings-input settings-input--wide"
                                value={sourceBranch}
                                onChange={(e) => setSourceBranch(e.target.value)}
                            >
                                {localBranches.map((b) => (
                                    <option key={b.name} value={b.shortName}>
                                        {b.current ? '● ' : ''}{b.shortName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="pr-target">Target branch</label>
                            <select
                                id="pr-target"
                                className="settings-input settings-input--wide"
                                value={targetBranch}
                                onChange={(e) => setTargetBranch(e.target.value)}
                            >
                                {localBranches.map((b) => (
                                    <option key={b.name} value={b.shortName}>
                                        {b.shortName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {sourceBranch && targetBranch && sourceBranch === targetBranch && (
                            <p className="pr-validation-error">
                                <i className="codicon codicon-warning" aria-hidden="true" />
                                Source and target branches must be different.
                            </p>
                        )}
                    </section>

                    <section className="settings-section">
                        <h3 className="settings-section__title">Details</h3>

                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="pr-title">Title</label>
                            <div className="settings-editable">
                                <input
                                    id="pr-title"
                                    type="text"
                                    className="settings-input settings-input--wide"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={sourceBranch ? `Merge ${sourceBranch} → ${targetBranch}` : 'Pull request title'}
                                />
                            </div>
                        </div>

                        <div className="pr-description-row">
                            <label className="settings-row__label" htmlFor="pr-description">Description</label>
                            <textarea
                                id="pr-description"
                                className="pr-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Optional description..."
                                rows={4}
                            />
                        </div>
                    </section>

                    <div className="pr-actions">
                        <button type="button" onClick={onClose}>Cancel</button>
                        <button type="submit" className="pr-actions__submit" disabled={!canSubmit}>
                            <i className="codicon codicon-git-pull-request-create" aria-hidden="true" />
                            Open Pull Request
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
