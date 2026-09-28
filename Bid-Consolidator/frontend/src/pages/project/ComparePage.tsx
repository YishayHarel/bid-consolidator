// The Compare sheet — the single place a project's item list is BUILT (upload
// CADs / import a sorted Excel / add rows) and COMPARED (every factory's offer
// under each product). Imports run as background jobs with live progress.
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import {
  useActiveJobs, useCads, useCompare, useCreateItem, useDeleteQuote, useDeletedItems, useDetectItems, useRestoreItem, useUpdateQuote, useUpload,
} from '../../api/hooks';
import type { CompareSheet, Item, Job, Quote } from '../../api/types';
import { useFeedback } from '../../components/feedback';
import { useJobWatcher } from '../../components/JobWatcher';
import { Button, Card, EmptyState, ErrorBox, Input, Loading } from '../../components/ui';
import { money, toNum } from '../../lib/format';
import { CompareItem } from './CompareItem';
import { useProjectId } from './ProjectLayout';

const JOB_LABEL: Record<string, string> = {
  'import-excel': 'Importing Excel', 'detect-items': 'Reading CADs with AI', 'import-quotes': 'Importing factory quote', 'purge-objects': 'Cleaning up files',
};

export default function ComparePage() {
  const projectId = useProjectId();
  const sheet = useCompare(projectId);
  const deleted = useDeletedItems(projectId);
  const cads = useCads(projectId);
  const jobs = useActiveJobs(projectId);
  const upload = useUpload(projectId);
  const detect = useDetectItems(projectId);
  const restore = useRestoreItem(projectId);
  const createItem = useCreateItem(projectId);
  const { toast } = useFeedback();
  const { watch, watchers } = useJobWatcher(projectId);
  const cadInput = useRef<HTMLInputElement>(null);
  const excelInput = useRef<HTMLInputElement>(null);
  const [row, setRow] = useState({ styleNum: '', description: '', moq: '', targetPrice: '' });

  async function onFiles(kind: 'cads' | 'excel', list: FileList | null) {
    const files = list ? [...list] : [];
    if (!files.length) return;
    try {
      const res = await upload.mutateAsync({ kind, files });
      if ('createdItems' in res) {
        if (res.job) { watch(res.job); toast('Designs uploaded — reading them now…'); }
        else toast(`Added ${res.createdItems} item${res.createdItems === 1 ? '' : 's'} from your designs`, 'success');
      } else {
        watch(res);
        toast('Spreadsheet uploaded — importing now…');
      }
    } catch (err) { toast(errorMessage(err), 'error'); }
    if (cadInput.current) cadInput.current.value = '';
    if (excelInput.current) excelInput.current.value = '';
  }

  async function addRow(e: FormEvent) {
    e.preventDefault();
    if (!row.styleNum.trim() && !row.description.trim()) return toast('Give the item a name or specs', 'error');
    try {
      await createItem.mutateAsync({ styleNum: row.styleNum || null, description: row.description || null, moq: toNum(row.moq), targetPrice: toNum(row.targetPrice) });
      setRow({ styleNum: '', description: '', moq: '', targetPrice: '' });
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  const busy = upload.isPending || (jobs.data?.length ?? 0) > 0;

  return (
    <div className="stack">
      {watchers}
      <Card>
        <div className="build-bar">
          <div className="build-bar__text">
            Build the sheet: <strong>upload CADs</strong> (AI reads and splits them into items) or <strong>import a sorted Excel</strong>.
            Then fill anything the file didn't have right on the sheet.
          </div>
          <div className="build-bar__actions">
            {(cads.data?.length ?? 0) > 0 && (
              <Button variant="ai" disabled={busy} busy={detect.isPending}
                onClick={() => detect.mutate(undefined, { onSuccess: (job) => { watch(job); toast('Reading designs…'); }, onError: (e) => toast(errorMessage(e), 'error') })}>
                ✨ Detect items (AI)
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => cadInput.current?.click()}>+ Upload CADs</Button>
            <Button variant="success" disabled={busy} onClick={() => excelInput.current?.click()}>+ Import Excel</Button>
          </div>
          <input ref={cadInput} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.svg,.pdf,.ai,.eps,.psd,image/*"
            onChange={(e) => onFiles('cads', e.target.files)} />
          <input ref={excelInput} type="file" hidden accept=".xlsx,.xls" onChange={(e) => onFiles('excel', e.target.files)} />
        </div>
        {jobs.data?.map((j) => <JobProgress key={j.id} job={j} />)}
      </Card>

      <form className="add-row" onSubmit={addRow}>
        <Input placeholder="Item name / style #" value={row.styleNum} onChange={(e) => setRow({ ...row, styleNum: e.target.value })} />
        <Input className="grow" placeholder="Specs / description" value={row.description} onChange={(e) => setRow({ ...row, description: e.target.value })} />
        <Input className="narrow" placeholder="MOQ" inputMode="numeric" value={row.moq} onChange={(e) => setRow({ ...row, moq: e.target.value })} />
        <Input className="narrow" placeholder="Target $" inputMode="decimal" value={row.targetPrice} onChange={(e) => setRow({ ...row, targetPrice: e.target.value })} />
        <Button type="submit" variant="primary" busy={createItem.isPending}>+ Add item</Button>
      </form>

      {(deleted.data?.length ?? 0) > 0 && (
        <div className="trash-bar">
          <strong>🗑 Deleted items ({deleted.data!.length}):</strong>
          {deleted.data!.map((d) => (
            <Button key={d.id} size="sm" onClick={() => restore.mutate(d.id, { onError: (e) => toast(errorMessage(e), 'error') })}>
              ↺ Restore {d.styleNum || `item ${d.position + 1}`}
            </Button>
          ))}
        </div>
      )}

      {sheet.isPending ? <Loading label="Loading the sheet…" /> : sheet.isError ? <ErrorBox error={sheet.error} onRetry={() => sheet.refetch()} /> : (
        <>
          {sheet.data.unmatched.length > 0 && (
            <Card title={`Quote rows to place (${sheet.data.unmatched.length})`} className="card--warn">
              <p className="muted small">
                These factory rows aren't on the sheet yet — either they didn't confidently match an item, or the factory
                already has a quote on their item. Pick the item each one belongs to (you can replace the factory's current
                quote), or dismiss rows you don't need.
              </p>
              <table className="table">
                <thead><tr><th>Factory</th><th>Their style #</th><th>Their description</th><th>Price</th><th>Belongs to</th><th /></tr></thead>
                <tbody>
                  {sheet.data.unmatched.map((q) => <RowToPlace key={q.id} projectId={projectId} quote={q} items={sheet.data.items} />)}
                </tbody>
              </table>
            </Card>
          )}

          {sheet.data.items.length === 0 ? (
            <EmptyState title="No items yet">Upload CADs or import an Excel sheet above to build this project's item list.</EmptyState>
          ) : (
            <div className="stack">
              <p className="hint">Header fields are your targets and specs — click to edit. Each factory's offer is a row below its item; the lowest price is highlighted.</p>
              {sheet.data.items.map((item) => <CompareItem key={item.id} projectId={projectId} item={item} format={sheet.data.format} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const itemLabel = (i: Item) => i.styleNum || i.description?.slice(0, 40) || `Item ${i.position + 1}`;

// One unplaced quote row: put it on an item (replacing that factory's current
// quote there, after confirming — the old one moves to this list), or dismiss it.
function RowToPlace({ projectId, quote, items }: { projectId: number; quote: Quote; items: CompareSheet['items'] }) {
  const updateQuote = useUpdateQuote(projectId);
  const deleteQuote = useDeleteQuote(projectId);
  const { toast, confirm } = useFeedback();
  const busy = updateQuote.isPending || deleteQuote.isPending;

  async function place(itemId: number) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const current = item.quotes.find((x) => x.projectFactoryId === quote.projectFactoryId);
    if (current) {
      const ok = await confirm({
        title: `Replace ${quote.factory.name}'s quote on ${itemLabel(item)}?`,
        body: <>Its current quote there is {money(current.price)}; this row is {money(quote.price)}. The current quote
          {current.isWinner ? ' (your chosen winner — this row takes over as winner)' : ''} moves to "Quote rows to place",
          so nothing is lost.</>,
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    try {
      await updateQuote.mutateAsync({ quoteId: quote.id, patch: { itemId, ...(current ? { replace: true } : {}) } });
      toast(current ? 'Quote replaced' : 'Quote placed', 'success');
    } catch (err) {
      const clash = err instanceof ApiError && (err.details as { reason?: string } | undefined)?.reason === 'factory_has_quote';
      toast(clash ? 'This factory just got a quote on that item — the sheet has been refreshed, try again.' : errorMessage(err), 'error');
    }
  }

  async function dismiss() {
    const ok = await confirm({
      title: 'Dismiss this quote row?',
      body: <>{quote.factory.name}'s row {quote.styleNum ? `"${quote.styleNum}" ` : ''}at {money(quote.price)} will be deleted. This can't be undone.</>,
      confirmLabel: 'Dismiss', danger: true,
    });
    if (!ok) return;
    deleteQuote.mutate(quote.id, { onSuccess: () => toast('Row dismissed'), onError: (err) => toast(errorMessage(err), 'error') });
  }

  return (
    <tr>
      <td>{quote.factory.name}</td><td>{quote.styleNum || '—'}</td><td className="wrap">{quote.description || '—'}</td><td>{money(quote.price)}</td>
      <td>
        <select className="input" value="" disabled={busy} aria-label="Item this row belongs to"
          onChange={(e) => e.target.value && void place(Number(e.target.value))}>
          <option value="">Choose item…</option>
          {items.map((i) => {
            const taken = i.quotes.some((x) => x.projectFactoryId === quote.projectFactoryId);
            return <option key={i.id} value={i.id}>{itemLabel(i)}{taken ? ' — replace current quote' : ''}</option>;
          })}
        </select>
      </td>
      <td><Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss()}>Dismiss</Button></td>
    </tr>
  );
}

function JobProgress({ job }: { job: Job }) {
  return (
    <div className="job">
      <div className="job__label">{JOB_LABEL[job.type] ?? job.type}{job.message ? ` — ${job.message}` : '…'}</div>
      <div className="progress"><div className="progress__bar" style={{ width: `${Math.max(4, job.progress)}%` }} /></div>
    </div>
  );
}
