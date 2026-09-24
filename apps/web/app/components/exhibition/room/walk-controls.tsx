import { useEffect } from 'react';

export type WalkDirection = 'forward' | 'backward' | 'left' | 'right';
const directions: { direction: WalkDirection; label: string; glyph: string }[] =
  [
    { direction: 'forward', label: 'Walk forward', glyph: '↑' },
    { direction: 'left', label: 'Turn left', glyph: '↶' },
    { direction: 'backward', label: 'Walk backward', glyph: '↓' },
    { direction: 'right', label: 'Turn right', glyph: '↷' },
  ];

export const WalkControls = ({
  onMove,
  onReset,
  disabled = false,
}: {
  onMove: (direction: WalkDirection, active: boolean) => void;
  onReset: () => void;
  disabled?: boolean;
}) => {
  useEffect(() => {
    const stop = () =>
      directions.forEach(({ direction }) => onMove(direction, false));
    if (disabled) stop();
    window.addEventListener('blur', stop);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
    };
  }, [onMove, disabled]);
  return (
    <nav className="gallery-walk" aria-label="Walk through the gallery">
      <div className="gallery-walk-pad">
        {directions.map(({ direction, label, glyph }) => (
          <button
            key={direction}
            type="button"
            data-direction={direction}
            aria-label={label}
            title={label}
            disabled={disabled}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              onMove(direction, true);
            }}
            onPointerUp={() => onMove(direction, false)}
            onPointerCancel={() => onMove(direction, false)}
            onLostPointerCapture={() => onMove(direction, false)}
            onBlur={() => onMove(direction, false)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                onMove(direction, true);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter')
                onMove(direction, false);
            }}
          >
            <span aria-hidden="true">{glyph}</span>
          </button>
        ))}
      </div>
      <div className="gallery-walk-caption">
        <span>Drag to look · Hold arrows to walk</span>
        <button type="button" onClick={onReset} disabled={disabled}>
          Back to entrance
        </button>
      </div>
    </nav>
  );
};
