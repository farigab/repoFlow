import type { WorkingTreeFile, WorkingTreeStatus } from '../../../src/core/models';

function getStatusBadge(file: WorkingTreeFile): { label: string; cls: string } {
    const code = (file.indexStatus.trim() || file.workTreeStatus.trim()).toUpperCase();
    switch (code) {
        case 'M': return { label: 'M', cls: 'status-badge--m' };
        case 'A': return { label: 'A', cls: 'status-badge--a' };
        case 'D': return { label: 'D', cls: 'status-badge--d' };
        case 'R': return { label: 'R', cls: 'status-badge--r' };
        case 'C': return { label: 'C', cls: 'status-badge--r' };
        default: return { label: code || '?', cls: 'status-badge--u' };
    }
}

function splitPath(path: string): { dir: string; name: string } {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

interface LocalChangesPanelProps {
    status: WorkingTreeStatus;
    onStage: (file: WorkingTreeFile) => void;
    onUnstage: (file: WorkingTreeFile) => void;
    onDiscard: (file: WorkingTreeFile) => void;
    onCommit: () => void;
}

interface FileSectionProps {
    title: string;
    sectionType: 'staged' | 'unstaged' | 'conflicts';
    files: WorkingTreeFile[];
    onPrimaryAction: (file: WorkingTreeFile) => void;
    primaryLabel: string;
    onDiscard: (file: WorkingTreeFile) => void;
}

function FileSection({ title, sectionType, files, onPrimaryAction, primaryLabel, onDiscard }: FileSectionProps) {
    if (files.length === 0) {
        return null;
    }

    return (
        <section className={`changes__section changes__section--${sectionType}`}>
            <header className="changes__section-header">
                <h3>{title}</h3>
                <span className="changes__section-count">{files.length}</span>
            </header>
            <div className="changes__list">
                {files.map((file) => {
                    const badge = getStatusBadge(file);
                    const { dir, name } = splitPath(file.path);
                    return (
                        <div key={`${title}-${file.path}-${file.indexStatus}${file.workTreeStatus}`} className="change-item">
                            <div className="change-item__info">
                                <span className={`status-badge ${badge.cls}`}>{badge.label}</span>
                                <div className="change-item__path">
                                    <strong>{name}</strong>
                                    {dir && <span>{dir}</span>}
                                </div>
                            </div>
                            <div className="change-item__actions">
                                <button type="button" onClick={() => onPrimaryAction(file)}>
                                    {primaryLabel}
                                </button>
                                <button type="button" className="button--ghost" onClick={() => onDiscard(file)}>
                                    Discard
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export function LocalChangesPanel({ status, onStage, onUnstage, onDiscard, onCommit }: LocalChangesPanelProps) {
    const totalChanges = status.staged.length + status.unstaged.length + status.conflicted.length;

    return (
        <section className="changes panel">
            <header className="panel__header">
                <div className="changes__header-identity">
                    <span className="panel__eyebrow">Working Tree</span>
                    <div className="changes__title-row">
                        <h2>Local Changes</h2>
                        {status.currentBranch && (
                            <span className="changes__branch-chip">{status.currentBranch}</span>
                        )}
                    </div>
                </div>
                <button type="button" className="changes__commit-btn" onClick={onCommit} disabled={status.staged.length === 0}>
                    <i className="codicon codicon-check" aria-hidden="true" />
                    Commit
                </button>
            </header>

            <div className="changes__summary">
                <span className="changes__stat">
                    <span>Total</span>
                    <strong>{totalChanges}</strong>
                </span>
                <span className="changes__stat-divider" />
                <span className="changes__stat">
                    <span>Ahead</span>
                    <strong className={status.ahead > 0 ? 'changes__stat--ahead' : ''}>{status.ahead}</strong>
                </span>
                <span className="changes__stat-divider" />
                <span className="changes__stat">
                    <span>Behind</span>
                    <strong className={status.behind > 0 ? 'changes__stat--behind' : ''}>{status.behind}</strong>
                </span>
            </div>

            <FileSection title="Conflicts" sectionType="conflicts" files={status.conflicted} onPrimaryAction={onStage} primaryLabel="Stage" onDiscard={onDiscard} />
            <FileSection title="Staged" sectionType="staged" files={status.staged} onPrimaryAction={onUnstage} primaryLabel="Unstage" onDiscard={onDiscard} />
            <FileSection title="Unstaged" sectionType="unstaged" files={status.unstaged} onPrimaryAction={onStage} primaryLabel="Stage" onDiscard={onDiscard} />
            {totalChanges === 0 ? (
                <div className="changes__empty">
                    <i className="codicon codicon-check" aria-hidden="true" />
                    <span>Working tree clean</span>
                </div>
            ) : null}
        </section>
    );
}
