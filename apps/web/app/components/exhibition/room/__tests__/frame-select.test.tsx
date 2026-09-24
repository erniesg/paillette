import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FrameSelect } from '../frame-select';

describe('FrameSelect', () => {
  it('names every available frame and reports the visitor selection', async () => {
    const onChange = vi.fn();
    render(<FrameSelect value="none" onChange={onChange} />);

    const control = screen.getByRole('combobox', { name: 'Frame style' });
    expect(control).toHaveClass('exhibition-frame-select');
    expect(screen.getByRole('option', { name: 'No frame' })).toHaveValue('none');
    expect(screen.getByRole('option', { name: 'Black' })).toHaveValue('black');
    expect(screen.getByRole('option', { name: 'White' })).toHaveValue('white');
    expect(screen.getByRole('option', { name: 'Oak' })).toHaveValue('oak');
    expect(screen.getByRole('option', { name: 'Gilt' })).toHaveValue('gilt');

    await userEvent.selectOptions(control, 'oak');
    expect(onChange).toHaveBeenCalledWith('oak');
  });
});
