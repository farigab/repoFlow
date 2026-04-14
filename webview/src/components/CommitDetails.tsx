import type { CommitDetail, CommitFileChange } from '../../../src/core/models/GitModels';

interface CommitDetailsProps {
    detail: CommitDetail | null;
    repoRoot?: string;
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void;
}

function formatFullDate(input: string): string {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(input));
}

export function CommitDetails({ detail, onOpenDiff }: CommitDetailsProps) {
    if (!detail) {
        return (
            <section className="details panel">
                <header className="panel__header">
                    <div>
                        <span className="panel__eyebrow">Commit Details</span>
                        <h2>Select a commit</h2>
                    </div>
                </header>
                <div className="empty-state">Choose a commit in the graph to inspect files, stats and native diffs.</div>
            </section>
        );
    }

    return (
        <section className="details panel">
            <header className="panel__header panel__header--stacked">
                <div>
                    <span className="panel__eyebrow">Commit Details</span>
                    <h2>{detail.subject}</h2>
                </div>
                <div className="details__meta-grid">
                    <div>
                        <span>Hash</span>
                        <strong title={detail.hash}>{detail.hash.slice(0, 8)}</strong>
                    </div>
                    <div>
                        <span>Author</span>
                        <strong>{detail.authorName}</strong>
                    </div>
                    <div>
                        <span>Date</span>
                        <strong>{formatFullDate(detail.authoredAt)}</strong>
                    </div>
                    <div>
                        <span>Stats</span>
                        <strong>
                            <span className="file-card__stats--add">+{detail.stats.additions}</span>
                            {' '}<span className="file-card__stats--del">−{detail.stats.deletions}</span>
                            {' · '}{detail.stats.filesChanged}f
                        </strong>
                    </div>
                </div>
            </header>

            {detail.body ? <pre className="details__body">{detail.body}</pre> : null}

            <div className="details__files">
                {detail.files.map((file) => (
                    <button key={`${detail.hash}-${file.path}`} type="button" className="file-card" onClick={() => onOpenDiff(file, detail)}>
                        <span className={`status-badge status-badge--${file.status.toLowerCase()}`}>{file.status}</span>
                        <span className="file-card__path">
                            {file.originalPath ? <span className="file-card__rename">{file.originalPath} → </span> : null}
                            <strong>{file.path}</strong>
                        </span>
                        <span className="file-card__stats">
                            <span className="file-card__stats--add">+{file.additions}</span>
                            <span className="file-card__stats--del">−{file.deletions}</span>
                        </span>
                    </button>
                ))}
            </div>
        </section>
    );
}
