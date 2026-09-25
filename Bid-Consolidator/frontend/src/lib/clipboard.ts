// Clipboard writes that work in Safari. Safari only allows clipboard access
// synchronously inside the click handler — an `await fetch(...)` first (e.g. to
// create a portal link) makes writeText() fail. The fix: start the write
// immediately with a ClipboardItem whose content is a Promise, which Safari
// and Chromium both accept. A timeout guards against embedded browsers where
// the clipboard never answers, so the caller can fall back to showing the text.
export async function copyText(text: string | Promise<string>, timeoutMs = 4000): Promise<void> {
  const write = (async () => {
    if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    }
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(await text);
  })();
  await Promise.race([
    write,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Clipboard did not respond')), timeoutMs)),
  ]);
}
