import { useState } from 'react';
import type { BranchSummary, GraphFilters, GraphSnapshot } from '../../../src/core/models';
import { vscode } from '../vscode';

interface RepoSettingsModalProps {
    snapshot: GraphSnapshot;
    filters: GraphFilters;
    onChangeFilters: (filters: GraphFilters) => void;
    onClose: () => void;
}

function groupRemotes(branches: BranchSummary[]): Map<string, BranchSummary[]> {
    const map = new Map<string, BranchSummary[]>();
    for (const branch of branches) {
        if (!branch.remote) {
            continue;
        }
        const remote = branch.shortName.split('/')[0] ?? 'origin';
        if (!map.has(remote)) {
            map.set(remote, []);
        }
        map.get(remote)!.push(branch);
    }
    return map;
}

export function RepoSettingsModal({ snapshot, filters, onChangeFilters, onClose }: RepoSettingsModalProps) {
    const repoName = snapshot.repoRoot.split(/[/\\]/).pop() ?? snapshot.repoRoot;
    const remoteGroups = groupRemotes(snapshot.branches);
    const localBranches = snapshot.branches.filter((b) => !b.remote);

    const [userName, setUserName] = useState(snapshot.repoConfig.userName);
    const [userEmail, setUserEmail] = useState(snapshot.repoConfig.userEmail);
    const [remoteUrls, setRemoteUrls] = useState<Record<string, string>>(
        Object.fromEntries(snapshot.repoConfig.remotes.map((r) => [r.name, r.url]))
    );

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const saveUserName = () => {
        const trimmed = userName.trim();
        if (trimmed && trimmed !== snapshot.repoConfig.userName) {
            vscode.postMessage({ type: 'setGitUserName', payload: { repoRoot: snapshot.repoRoot, name: trimmed } });
        }
    };

    const saveUserEmail = () => {
        const trimmed = userEmail.trim();
        if (trimmed && trimmed !== snapshot.repoConfig.userEmail) {
            vscode.postMessage({ type: 'setGitUserEmail', payload: { repoRoot: snapshot.repoRoot, email: trimmed } });
        }
    };

    const saveRemoteUrl = (remoteName: string) => {
        const url = (remoteUrls[remoteName] ?? '').trim();
        const original = snapshot.repoConfig.remotes.find((r) => r.name === remoteName)?.url ?? '';
        if (url && url !== original) {
            vscode.postMessage({ type: 'setRemoteUrl', payload: { repoRoot: snapshot.repoRoot, remoteName, url } });
        }
    };

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Repository Settings">
                <header className="modal__header">
                    <h2>Repository Settings</h2>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                <div className="modal__body">

                    {/* ── General ──────────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="settings-section__title">General</h3>
                        <div className="settings-row settings-row--readonly">
                            <span className="settings-row__label">Name</span>
                            <span className="settings-row__value">{repoName}</span>
                        </div>
                        <div className="settings-row settings-row--readonly">
                            <span className="settings-row__label">Path</span>
                            <span className="settings-row__value settings-row__value--muted">{snapshot.repoRoot}</span>
                        </div>
                        <div className="settings-row">
                            <label className="settings-toggle">
                                <input
                                    type="checkbox"
                                    checked={filters.includeRemotes}
                                    onChange={(e) => onChangeFilters({ ...filters, includeRemotes: e.target.checked })}
                                />
                                <span>Show remote branches</span>
                            </label>
                        </div>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-limit">Commit limit</label>
                            <input
                                id="settings-limit"
                                type="number"
                                min={50}
                                max={5000}
                                step={50}
                                className="settings-input"
                                value={filters.limit}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val >= 50) {
                                        onChangeFilters({ ...filters, limit: val });
                                    }
                                }}
                            />
                        </div>
                    </section>

                    {/* ── User Details ─────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="settings-section__title">User Details</h3>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-username">User Name</label>
                            <div className="settings-editable">
                                <input
                                    id="settings-username"
                                    type="text"
                                    className="settings-input settings-input--wide"
                                    value={userName}
                                    onChange={(e) => setUserName(e.target.value)}
                                    onBlur={saveUserName}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { saveUserName(); (e.target as HTMLInputElement).blur(); } }}
                                    placeholder="Your name"
                                />
                            </div>
                        </div>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-useremail">User Email</label>
                            <div className="settings-editable">
                                <input
                                    id="settings-useremail"
                                    type="email"
                                    className="settings-input settings-input--wide"
                                    value={userEmail}
                                    onChange={(e) => setUserEmail(e.target.value)}
                                    onBlur={saveUserEmail}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { saveUserEmail(); (e.target as HTMLInputElement).blur(); } }}
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>
                    </section>

                    {/* ── Remote Configuration ─────────────────── */}
                    {snapshot.repoConfig.remotes.length > 0 && (
                        <section className="settings-section">
                            <h3 className="settings-section__title">Remote Configuration</h3>
                            {snapshot.repoConfig.remotes.map((remote) => (
                                <div key={remote.name} className="settings-row">
                                    <label className="settings-row__label" htmlFor={`settings-remote-${remote.name}`}>
                                        <i className="codicon codicon-remote" aria-hidden="true" style={{ marginRight: '0.3rem' }} />
                                        {remote.name}
                                    </label>
                                    <div className="settings-editable">
                                        <input
                                            id={`settings-remote-${remote.name}`}
                                            type="text"
                                            className="settings-input settings-input--wide"
                                            value={remoteUrls[remote.name] ?? remote.url}
                                            onChange={(e) => setRemoteUrls((prev) => ({ ...prev, [remote.name]: e.target.value }))}
                                            onBlur={() => saveRemoteUrl(remote.name)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { saveRemoteUrl(remote.name); (e.target as HTMLInputElement).blur(); } }}
                                            placeholder="https://github.com/..."
                                        />
                                    </div>
                                </div>
                            ))}
                            <div className="settings-table">
                                <div className="settings-table__head">
                                    <span>Remote</span>
                                    <span>Branches</span>
                                </div>
                                {[...remoteGroups.entries()].map(([remote, branches]) => (
                                    <div key={remote} className="settings-table__row">
                                        <span className="settings-table__remote">
                                            <i className="codicon codicon-remote" aria-hidden="true" />
                                            {remote}
                                        </span>
                                        <span className="settings-table__branches">
                                            {branches.map((b) => b.shortName.split('/').slice(1).join('/')).join(', ')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* ── Local Branches ───────────────────────── */}
                    {localBranches.length > 0 && (
                        <section className="settings-section">
                            <h3 className="settings-section__title">Local Branches</h3>
                            <div className="settings-branches">
                                {localBranches.map((b) => (
                                    <div key={b.name} className="settings-branch-row">
                                        <i className={`codicon codicon-git-branch${b.current ? ' settings-branch-row__icon--active' : ''}`} aria-hidden="true" />
                                        <span className={b.current ? 'settings-branch-row--current' : ''}>
                                            {b.shortName}
                                        </span>
                                        {b.upstream && (
                                            <span className="settings-branch-row__upstream">{b.upstream}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                </div>
            </div>
        </div>
    );
}
