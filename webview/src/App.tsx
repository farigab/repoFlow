import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CommitDetail, CommitFileChange, CommitSummary, DiffRequest, GraphFilters, GraphSnapshot } from '../../src/core/models/GitModels';
import type { ExtensionToWebviewMessage } from '../../src/shared/protocol';
import { CommitDetails } from './components/CommitDetails';
import { CreatePRModal } from './components/CreatePRModal';
import { GraphCanvas } from './components/GraphCanvas';
import { RepoSettingsModal } from './components/RepoSettingsModal';
import { useResizableSplit } from './hooks/useResizableSplit';
import { vscode } from './vscode';

interface ContextMenuState {
    commit: CommitSummary;
    x: number;
    y: number;
}

const DEFAULT_FILTERS: GraphFilters = {
    includeRemotes: true,
    limit: 200
};

function areFiltersEqual(left: GraphFilters, right: GraphFilters): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function App() {
    const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
    const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
    const [selectedCommitHash, setSelectedCommitHash] = useState<string>();
    const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null);
    const [busy, setBusy] = useState<{ value: boolean; label?: string }>({ value: false });
    const [notification, setNotification] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [prOpen, setPrOpen] = useState(false);

    const deferredFilters = {
        ...filters,
        search: useDeferredValue(filters.search),
        author: useDeferredValue(filters.author)
    } satisfies GraphFilters;

    useEffect(() => {
        const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
            const message = event.data;

            switch (message.type) {
                case 'graphSnapshot':
                    setSnapshot(message.payload);
                    setFilters(message.payload.filters);
                    return;
                case 'commitDetail':
                    setSelectedCommit(message.payload);
                    setSelectedCommitHash(message.payload.hash);
                    return;
                case 'busy':
                    setBusy(message.payload);
                    return;
                case 'notification':
                    setNotification(message.payload);
                    window.setTimeout(() => setNotification(null), 3000);
                    return;
                default:
                    return;
            }
        };

        window.addEventListener('message', handler);
        vscode.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        if (!selectedCommitHash || !snapshot.rows.some((row) => row.commit.hash === selectedCommitHash)) {
            const firstCommit = snapshot.rows[0]?.commit;
            if (firstCommit) {
                setSelectedCommitHash(firstCommit.hash);
                vscode.postMessage({
                    type: 'selectCommit',
                    payload: { repoRoot: snapshot.repoRoot, commitHash: firstCommit.hash }
                });
            }
        }
    }, [snapshot, selectedCommitHash]);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            if (!areFiltersEqual(snapshot.filters, deferredFilters)) {
                startTransition(() => {
                    vscode.postMessage({ type: 'applyFilters', payload: deferredFilters });
                });
            }
        }, 180);

        return () => window.clearTimeout(timeoutId);
    }, [deferredFilters, snapshot]);

    useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    const assets = useMemo(() => window.__GITGRAPHOR_ASSETS__ ?? {}, []);
    const { leftPercent, containerRef, onDividerMouseDown } = useResizableSplit(62);

    const handleSelectCommit = (commit: CommitSummary): void => {
        if (!snapshot) {
            return;
        }

        setSelectedCommitHash(commit.hash);
        vscode.postMessage({
            type: 'selectCommit',
            payload: { repoRoot: snapshot.repoRoot, commitHash: commit.hash }
        });
    };

    const handleOpenDiff = (file: CommitFileChange, detail: CommitDetail): void => {
        if (!snapshot) {
            return;
        }

        const request: DiffRequest = {
            repoRoot: snapshot.repoRoot,
            commitHash: detail.hash,
            parentHash: detail.parentHashes[0],
            filePath: file.path,
            originalPath: file.originalPath
        };

        vscode.postMessage({ type: 'openDiff', payload: request });
    };

    const handleContextAction = (action: 'checkout' | 'cherryPick' | 'revert' | 'drop' | 'createBranch' | 'merge' | 'rebase' | 'reset' | 'copyHash' | 'copySubject' | 'openTerminal'): void => {
        if (!snapshot || !contextMenu) {
            return;
        }

        switch (action) {
            case 'createBranch':
                vscode.postMessage({ type: 'createBranchPrompt', payload: { repoRoot: snapshot.repoRoot, fromRef: contextMenu.commit.hash } });
                break;
            case 'checkout':
                vscode.postMessage({ type: 'checkoutCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'cherryPick':
                vscode.postMessage({ type: 'cherryPick', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'revert':
                vscode.postMessage({ type: 'revertCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'drop':
                vscode.postMessage({ type: 'dropCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'merge':
                vscode.postMessage({ type: 'mergeCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'rebase':
                vscode.postMessage({ type: 'rebaseOnCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'reset':
                vscode.postMessage({ type: 'resetToCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'copyHash':
                vscode.postMessage({ type: 'copyHash', payload: { hash: contextMenu.commit.hash } });
                break;
            case 'copySubject':
                vscode.postMessage({ type: 'copySubject', payload: { subject: contextMenu.commit.subject } });
                break;
            case 'openTerminal':
                vscode.postMessage({
                    type: 'openInTerminal',
                    payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash }
                });
                break;
            default:
                break;
        }

        setContextMenu(null);
    };

    if (!snapshot) {
        return (
            <main className="shell shell--loading">
                <div className="loading-card panel">
                    {assets.hero ? <img className="loading-card__hero" src={assets.hero} alt="Git Graphor" /> : null}
                    <h1>Git Graphor</h1>
                    <p>Loading repository graph...</p>
                </div>
            </main>
        );
    }

    return (
        <main className="shell">
            <section
                className="layout"
                ref={containerRef as React.RefObject<HTMLElement>}
                style={{ gridTemplateColumns: `${leftPercent}% 5px ${100 - leftPercent}%` }}
            >
                <GraphCanvas
                    snapshot={snapshot}
                    selectedCommitHash={selectedCommitHash}
                    onSelectCommit={handleSelectCommit}
                    onOpenContextMenu={(commit, point) => setContextMenu({ commit, ...point })}
                    onLoadMore={(limit) => vscode.postMessage({ type: 'loadMore', payload: { limit } })}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onOpenPR={() => setPrOpen(true)}
                />

                <div className="resizer" onMouseDown={onDividerMouseDown} />
                <aside className="sidebar">
                    <CommitDetails detail={selectedCommit} repoRoot={snapshot.repoRoot} onOpenDiff={handleOpenDiff} />
                </aside>
            </section>

            {contextMenu ? (
                <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                    <button type="button" onClick={() => handleContextAction('checkout')}>
                        Checkout...
                    </button>
                    <button type="button" onClick={() => handleContextAction('createBranch')}>
                        Create Branch...
                    </button>
                    <div className="context-menu__separator" />
                    <button type="button" onClick={() => handleContextAction('cherryPick')}>
                        Cherry Pick...
                    </button>
                    <button type="button" onClick={() => handleContextAction('revert')}>
                        Revert...
                    </button>
                    <button type="button" onClick={() => handleContextAction('drop')}>
                        Drop...
                    </button>
                    <div className="context-menu__separator" />
                    <button type="button" onClick={() => handleContextAction('merge')}>
                        Merge into current branch...
                    </button>
                    <button type="button" onClick={() => handleContextAction('rebase')}>
                        Rebase current branch on this Commit...
                    </button>
                    <button type="button" onClick={() => handleContextAction('reset')}>
                        Reset current branch to this Commit...
                    </button>
                    <div className="context-menu__separator" />
                    <button type="button" onClick={() => handleContextAction('copyHash')}>
                        Copy Commit Hash to Clipboard
                    </button>
                    <button type="button" onClick={() => handleContextAction('copySubject')}>
                        Copy Commit Subject to Clipboard
                    </button>
                </div>
            ) : null}

            {busy.value ? <div className="busy-indicator">{busy.label ?? 'Processing...'}</div> : null}
            {notification ? <div className={`toast toast--${notification.kind}`}>{notification.message}</div> : null}
            {settingsOpen ? (
                <RepoSettingsModal
                    snapshot={snapshot}
                    filters={filters}
                    onChangeFilters={setFilters}
                    onClose={() => setSettingsOpen(false)}
                />
            ) : null}
            {prOpen ? (
                <CreatePRModal
                    snapshot={snapshot}
                    onClose={() => setPrOpen(false)}
                />
            ) : null}
        </main>
    );
}
