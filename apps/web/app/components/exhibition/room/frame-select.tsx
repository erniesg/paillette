import type { ChangeEvent } from 'react';
import { FRAME_STYLES, type FrameStyle } from '~/lib/room/frame';

const NAME: Record<FrameStyle, string> = {
  none: 'No frame',
  black: 'Black',
  white: 'White',
  oak: 'Oak',
  gilt: 'Gilt',
};

/** A small controlled control so the room can change its finish in place. */
export const FrameSelect = ({
  value,
  onChange,
}: {
  value: FrameStyle;
  onChange: (style: FrameStyle) => void;
}) => {
  const select = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.currentTarget.value as FrameStyle);
  };

  return (
    <select
      aria-label="Frame style"
      className="exhibition-frame-select"
      value={value}
      onChange={select}
    >
      {FRAME_STYLES.map((style) => (
        <option key={style} value={style}>
          {NAME[style]}
        </option>
      ))}
    </select>
  );
};
