import { useEffect, useRef, useState } from 'react';

interface GraphToolbarProps {
    onOpenSettings: () => void;
    onOpenPR: () => void;
    onOpenDeleteBranches: () => void;
    onOpenStashModal: () => void;
    onOpenWorktreeModal: () => void;
    onOpenBranchCompareModal: () => void;
    onOpenUndoModal: () => void;
}

export function GraphToolbar({
    onOpenSettings,
    onOpenPR,
    onOpenDeleteBranches,
    onOpenStashModal,
    onOpenWorktreeModal,
    onOpenBranchCompareModal,
    onOpenUndoModal
}: GraphToolbarProps) {
    const [moreActionsOpen, setMoreActionsOpen] = useState(false);
    const moreActionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onPointerDown = (event: globalThis.MouseEvent) => {
            if (!moreActionsRef.current) return;
            if (!moreActionsRef.current.contains(event.target as Node)) {
                setMoreActionsOpen(false);
            }
        };

        window.addEventListener('mousedown', onPointerDown);
        return () => window.removeEventListener('mousedown', onPointerDown);
    }, []);

    const runMenuAction = (action: () => void): void => {
        setMoreActionsOpen(false);
        action();
    };

    return (
        <div className="panel__header-actions" ref={moreActionsRef}>
            <button
                type="button"
                className="panel__settings-btn"
                onClick={onOpenPR}
                title="Create Pull Request"
                aria-label="Create Pull Request"
            >
                <i className="codicon codicon-git-pull-request-create" aria-hidden="true" />
            </button>
            <button
                type="button"
                className="panel__settings-btn"
                onClick={onOpenWorktreeModal}
                title="Worktree Manager"
                aria-label="Worktree Manager"
            >
                <i className="codicon codicon-repo-clone" aria-hidden="true" />
            </button>
            <button
                type="button"
                className="panel__settings-btn"
                onClick={onOpenStashModal}
                title="Git Stash"
                aria-label="Git Stash"
            >
                <i className="codicon codicon-archive" aria-hidden="true" />
            </button>
            <button
                type="button"
                className="panel__settings-btn"
                onClick={() => setMoreActionsOpen((open) => !open)}
                title="More Actions"
                aria-label="More Actions"
                aria-expanded={moreActionsOpen}
            >
                <i className="codicon codicon-ellipsis" aria-hidden="true" />
            </button>
            {moreActionsOpen ? (
                <div className="panel-actions-menu">
                    <button type="button" onClick={() => runMenuAction(onOpenBranchCompareModal)}>
                        <i className="codicon codicon-git-compare" aria-hidden="true" /> Compare Branches
                    </button>
                    <button type="button" onClick={() => runMenuAction(onOpenUndoModal)}>
                        <i className="codicon codicon-history" aria-hidden="true" /> Undo Last Operation
                    </button>
                    <button type="button" onClick={() => runMenuAction(onOpenDeleteBranches)}>
                        <i className="codicon codicon-trash" aria-hidden="true" /> Delete Local Branches
                    </button>
                    <button type="button" onClick={() => runMenuAction(onOpenSettings)}>
                        <i className="codicon codicon-settings-gear" aria-hidden="true" /> Repository Settings
                    </button>
                </div>
            ) : null}
        </div>
    );
}
