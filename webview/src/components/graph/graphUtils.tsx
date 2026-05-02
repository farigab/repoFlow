import type { ReactNode } from 'react';

export const GRAPH_ROW_HEIGHT = 46;
export const GRAPH_LANE_GAP = 20;

const PALETTE = ['#22c55e', '#38bdf8', '#f59e0b', '#fb7185', '#a78bfa', '#14b8a6', '#f97316', '#84cc16'];

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
});

export function formatDate(input: string): string {
    return shortDateFormatter.format(new Date(input));
}

export function getLaneColor(lane: number): string {
    return PALETTE[lane % PALETTE.length];
}

export function buildSearchPattern(query: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): RegExp | null {
    if (!query) return null;
    try {
        const flags = caseSensitive ? 'g' : 'gi';
        const escaped = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const source = wholeWord ? `\\b${escaped}\\b` : escaped;
        return new RegExp(source, flags);
    } catch {
        return null;
    }
}

export function highlightText(text: string, pattern: RegExp | null): ReactNode {
    if (!pattern || !text) return text;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    const re = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        parts.push(<mark key={match.index} className="find-highlight">{match[0]}</mark>);
        lastIndex = match.index + match[0].length;
        if (match[0].length === 0) { re.lastIndex++; }
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return <>{parts}</>;
}
