import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineInput } from './ui';

describe('InlineInput (every inline-editable cell)', () => {
  it('saves on blur only when the value actually changed', () => {
    const onSave = vi.fn();
    render(<InlineInput value="3.25" onSave={onSave} aria-label="Target" />);
    const input = screen.getByLabelText('Target');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled(); // no change → no request
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '3.10' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('3.10');
  });

  it('Escape reverts the edit instead of saving it', () => {
    const onSave = vi.fn();
    render(<InlineInput value="A" onSave={onSave} aria-label="Name" />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('A');
  });

  it('does not clobber what the user is typing when the server value refreshes', () => {
    const { rerender } = render(<InlineInput value="1" onSave={vi.fn()} aria-label="Qty" />);
    const input = screen.getByLabelText('Qty') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12' } });
    rerender(<InlineInput value="5" onSave={vi.fn()} aria-label="Qty" />); // background refetch
    expect(input.value).toBe('12');
  });
});
