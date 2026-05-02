import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { CommitSummary } from '../../../../src/core/models';

export interface HoverTooltip {
    commit: CommitSummary;
    x: number;
    y: number;
}

interface CommitHoverTooltipProps {
    data: HoverTooltip;
    onEnter: () => void;
    onLeave: () => void;
}

export function CommitHoverTooltip({ data, onEnter, onLeave }: Readonly<CommitHoverTooltipProps>) {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: data.x, top: data.y });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const padding = 8;
        let left = data.x;
        let top = data.y;
        if (left + rect.width + padding > window.innerWidth) left = window.innerWidth - rect.width - padding;
        if (left < padding) left = padding;
        if (top + rect.height + padding > window.innerHeight) top = data.y - rect.height - 24;
        if (top < padding) top = padding;
        setStyle({ visibility: 'visible', left, top });
    }, [data.x, data.y]);

    const branches = data.commit.refs.filter((r) => r.type === 'localBranch' || r.type === 'remoteBranch');
    const tags = data.commit.refs.filter((r) => r.type === 'tag');

    return (
        <div
            ref={ref}
            className="commit-hover-tooltip"
            style={style}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
        >
            <div className="commit-hover-tooltip__title">Commit {data.commit.shortHash}</div>
            {data.commit.isHead && (
                <div className="commit-hover-tooltip__head-row">
                    This commit is included in <span className="ref-pill ref-pill--head">HEAD</span>
                </div>
            )}
            {branches.length > 0 && (
                <div className="commit-hover-tooltip__section">
                    <span className="commit-hover-tooltip__label">Branches:</span>
                    <div className="commit-hover-tooltip__pills">
                        {branches.map((ref) => (
                            <span key={ref.name} className={`ref-pill ref-pill--${ref.type}`}>{ref.name}</span>
                        ))}
                    </div>
                </div>
            )}
            {tags.length > 0 && (
                <div className="commit-hover-tooltip__section">
                    <span className="commit-hover-tooltip__label">Tags:</span>
                    <div className="commit-hover-tooltip__pills">
                        {tags.map((ref) => (
                            <span key={ref.name} className="ref-pill ref-pill--tag">{ref.name}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
