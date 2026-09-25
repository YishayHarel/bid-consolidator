// One product on the compare sheet. The header holds what YOU set (name, specs,
// targets, GM pack counts) — edited inline, anything a CAD couldn't provide.
// The table shows each factory's offer; the lowest price is highlighted.
import { apiUrl, errorMessage } from '../../api/client';
import { useDeleteItem, useSetWinner, useUpdateItem, useUpdateQuote, type ItemPatch } from '../../api/hooks';
import type { CompareSheet, DivisionFormat } from '../../api/types';
import { useFeedback } from '../../components/feedback';
import { Badge, Button, InlineInput, Thumb } from '../../components/ui';
import { field, int, money, toNum } from '../../lib/format';

type SheetItem = CompareSheet['items'][number];

export function CompareItem({ projectId, item, format }: { projectId: number; item: SheetItem; format: DivisionFormat }) {
  const updateItem = useUpdateItem(projectId);
  const deleteItem = useDeleteItem(projectId);
  const setWinner = useSetWinner(projectId);
  const updateQuote = useUpdateQuote(projectId);
  const { toast, confirm } = useFeedback();

  const save = (patch: ItemPatch) =>
    updateItem.mutate({ itemId: item.id, patch }, { onError: (e) => toast(errorMessage(e), 'error') });
  const saveNum = (key: 'moq' | 'targetPrice' | 'innerPack' | 'masterPack', v: string) => {
    const n = toNum(v);
    if (v.trim() !== '' && n === null) return toast('Enter a number', 'error');
    save({ [key]: n });
  };

  const prices = item.quotes.map((q) => q.price).filter((p): p is number => p != null);
  const lowest = prices.length > 1 ? Math.min(...prices) : null;

  async function remove() {
    const ok = await confirm({ title: `Remove ${item.styleNum || 'this item'}?`, body: 'You can restore it from the "Deleted items" bar at the top of the sheet.', confirmLabel: 'Remove' });
    if (ok) deleteItem.mutate(item.id, { onError: (e) => toast(errorMessage(e), 'error') });
  }

  return (
    <article className="cmp-item">
      <header className="cmp-item__head">
        <Thumb src={apiUrl(item.imageUrl)} alt={item.styleNum ?? 'Item'} size="lg" />
        <div className="cmp-item__fields">
          <InlineInput className="cmp-item__name" value={item.styleNum ?? ''} placeholder="Item name / style #"
            onSave={(v) => save({ styleNum: v || null })} aria-label="Item name" />
          <InlineInput multiline value={item.description ?? ''} placeholder="Specs / description"
            onSave={(v) => save({ description: v || null })} />
          <div className="cmp-item__targets">
            <label className="mini-field"><span>Target $</span>
              <InlineInput value={field(item.targetPrice)} placeholder="—" inputMode="decimal" onSave={(v) => saveNum('targetPrice', v)} />
            </label>
            <label className="mini-field"><span>Target MOQ</span>
              <InlineInput value={field(item.moq)} placeholder="—" inputMode="numeric" onSave={(v) => saveNum('moq', v)} />
            </label>
            {format.packCounts && (
              <>
                <label className="mini-field"><span>Inner #</span>
                  <InlineInput value={field(item.innerPack)} placeholder="—" inputMode="numeric" onSave={(v) => saveNum('innerPack', v)} />
                </label>
                <label className="mini-field"><span>Master #</span>
                  <InlineInput value={field(item.masterPack)} placeholder="—" inputMode="numeric" onSave={(v) => saveNum('masterPack', v)} />
                </label>
              </>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={remove} aria-label="Remove item">✕ Remove</Button>
      </header>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Factory</th><th>Their image</th><th>MOQ</th><th>Price</th><th>Lead time</th><th>Notes</th><th className="center">Winner</th></tr>
          </thead>
          <tbody>
            {item.quotes.length === 0 && (
              <tr><td colSpan={7} className="muted italic">Awaiting quotes</td></tr>
            )}
            {item.quotes.map((q) => (
              <tr key={q.id} className={q.isWinner ? 'row--winner' : undefined}>
                <td>
                  <div className="factory-cell">
                    <strong>{q.factory.name}</strong>
                    {!q.factory.submitted && <Badge tone="draft">Draft — not submitted</Badge>}
                  </div>
                </td>
                <td><Thumb src={apiUrl(q.imageUrl)} alt={`${q.factory.name} image`} size="sm" /></td>
                <td>{int(q.moq)}</td>
                <td className={q.price != null && q.price === lowest ? 'price--best' : 'price'}>
                  {money(q.price)}{q.price != null && q.price === lowest && <span className="best-tag">lowest</span>}
                </td>
                <td>{q.leadTime ?? '—'}</td>
                <td className="notes-cell">
                  <InlineInput multiline value={q.notes ?? ''} placeholder="Notes…"
                    onSave={(v) => updateQuote.mutate({ quoteId: q.id, patch: { notes: v || null } }, { onError: (e) => toast(errorMessage(e), 'error') })} />
                </td>
                <td className="center">
                  <button className={`winner-btn ${q.isWinner ? 'winner-btn--on' : ''}`} disabled={setWinner.isPending}
                    title={q.isWinner ? 'Winner — click to clear' : 'Select as winner'}
                    onClick={() => setWinner.mutate({ itemId: item.id, quoteId: q.isWinner ? null : q.id }, { onError: (e) => toast(errorMessage(e), 'error') })}>
                    {q.isWinner ? '✓ Winner' : 'Select'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
