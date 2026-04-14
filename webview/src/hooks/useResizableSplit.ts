import { useCallback, useRef, useState } from 'react';

const CLAMP_MIN = 20;
const CLAMP_MAX = 80;

export function useResizableSplit(defaultLeftPercent = 62) {
    const [leftPercent, setLeftPercent] = useState(defaultLeftPercent);
    const containerRef = useRef<HTMLElement>(null);
    const dragging = useRef(false);

    const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev: MouseEvent) => {
            if (!dragging.current || !containerRef.current) {
                return;
            }
            const rect = containerRef.current.getBoundingClientRect();
            const pct = ((ev.clientX - rect.left) / rect.width) * 100;
            setLeftPercent(Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, pct)));
        };

        const onMouseUp = () => {
            dragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, []);

    return { leftPercent, containerRef, onDividerMouseDown };
}
