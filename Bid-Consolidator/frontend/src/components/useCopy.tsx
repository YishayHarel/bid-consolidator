// One copy-to-clipboard behavior for the whole app: Safari-safe (see
// lib/clipboard.ts), toast on success, and if the clipboard is unavailable the
// text is shown in a dialog to copy by hand — never a silent failure.
import { useCallback } from 'react';
import { errorMessage } from '../api/client';
import { copyText } from '../lib/clipboard';
import { useFeedback } from './feedback';

export function useCopy() {
  const { toast, confirm } = useFeedback();
  return useCallback(async (text: string | Promise<string>, success = 'Copied') => {
    // Kick the clipboard write off synchronously (inside the click), then wait.
    const pending = copyText(text);
    try {
      await pending;
      toast(success, 'success');
    } catch (err) {
      let value: string;
      try { value = await text; } catch (e) { toast(errorMessage(e), 'error'); return; }
      void errorMessage(err);
      await confirm({
        title: 'Copy this text',
        body: (
          <textarea className="input textarea" readOnly rows={Math.min(14, value.split('\n').length + 1)} value={value}
            autoFocus onFocus={(e) => e.currentTarget.select()} aria-label="Text to copy" />
        ),
        confirmLabel: 'Done',
      });
    }
  }, [toast, confirm]);
}
