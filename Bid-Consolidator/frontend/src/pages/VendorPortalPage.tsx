// The factory's quoting page (public — the link is the credential). A factory
// sees our item list and fills in its own price / MOQ / lead time per item.
// Entries autosave; "Submit my quote" finalizes (the link is then spent).
// A factory never sees other factories' quotes or our target price.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, apiUrl, errorMessage } from '../api/client';
import { usePortal } from '../api/hooks';
import type { PortalItem } from '../api/types';
import { useFeedback } from '../components/feedback';
import { Button, Loading, Thumb } from '../components/ui';
import { toNum } from '../lib/format';

interface RowState { bidding: boolean; price: string; moq: string; leadTime: string; saving: boolean; saved: boolean; error: string | null }

function Screen({ tone, title, children }: { tone: 'info' | 'warn' | 'ok' | 'bad'; title: string; children: React.ReactNode }) {
  return (
    <div className="portal-screen">
      <div className={`portal-status portal-status--${tone}`}>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function VendorPortalPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const view = usePortal(token);
  const { confirm } = useFeedback();
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (view.data?.status !== 'valid') return;
    setRows(Object.fromEntries(view.data.items.map((it) => [it.id, {
      bidding: !!it.quote, price: it.quote?.price?.toString() ?? '', moq: it.quote?.moq?.toString() ?? '',
      leadTime: it.quote?.leadTime ?? '', saving: false, saved: false, error: null,
    }])));
  }, [view.data]);

  if (!token) return <Screen tone="warn" title="Invite link required">Please use the personal quote link we emailed you. If you don't have one, contact us and we'll send it over.</Screen>;
  if (view.isPending) return <Loading label="Loading your quote sheet…" />;
  if (view.isError || view.data.status === 'invalid') return <Screen tone="bad" title="This link isn't valid">Please check you copied the whole link from our email, or ask us for a new one.</Screen>;
  const v = view.data;
  if (v.status === 'expired') return <Screen tone="warn" title="This link has expired">Please contact us for a new quote link for {v.projectName}.</Screen>;
  if (v.status === 'used' || submitted) return <Screen tone="ok" title="Quote submitted — thank you!">We've received {v.status === 'used' ? `${v.factoryName}'s` : 'your'} pricing{'projectName' in v ? ` for ${v.projectName}` : ''}. We'll be in touch.</Screen>;

  const set = (id: number, patch: Partial<RowState>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));

  async function save(item: PortalItem, override?: Partial<RowState>) {
    const r = { ...rows[item.id]!, ...override };
    const price = toNum(r.price);
    const moq = toNum(r.moq);
    if (r.bidding && r.price.trim() && price === null) return set(item.id, { error: 'Price must be a number' });
    if (r.bidding && r.moq.trim() && (moq === null || !Number.isInteger(moq))) return set(item.id, { error: 'MOQ must be a whole number' });
    set(item.id, { ...override, saving: true, error: null, saved: false });
    try {
      await api.public.put(`/portal/${token}/items/${item.id}`, { bidding: r.bidding, price, moq, leadTime: r.leadTime.trim() || null });
      set(item.id, { saving: false, saved: true });
    } catch (err) {
      set(item.id, { saving: false, error: errorMessage(err) });
    }
  }

  const bidCount = Object.values(rows).filter((r) => r.bidding).length;
  const missingPrice = v.items.filter((it) => rows[it.id]?.bidding && !rows[it.id]?.price.trim()).length;

  async function submit() {
    const ok = await confirm({
      title: `Submit your quote for ${bidCount} item${bidCount === 1 ? '' : 's'}?`,
      body: missingPrice ? `${missingPrice} bid item${missingPrice === 1 ? ' has' : 's have'} no price yet. Once submitted, this link can't be used to make changes.` : "Once submitted, this link can't be used to make changes.",
      confirmLabel: 'Submit quote',
    });
    if (!ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.public.post(`/portal/${token}/submit`);
      setSubmitted(true);
    } catch (err) { setSubmitError(errorMessage(err)); }
    setSubmitting(false);
  }

  return (
    <div className="portal">
      <div className="portal__card">
        <header className="portal__head">
          <div>
            <div className="portal__title">Supplier quote — {v.projectName}</div>
            <div className="portal__sub">{v.factoryName}</div>
          </div>
          <span className="sealed">🔒 Your pricing is private</span>
        </header>
        {v.purpose === 'revision' && (
          <div className="portal__banner">Best & Final round — please review your pricing and submit your best and final quote.</div>
        )}
        <p className="portal__intro">Tick <strong>Bid</strong> for each item you want to quote, then enter your best FOB price, MOQ and lead time. Your entries save automatically — press <strong>Submit my quote</strong> when you're done.</p>
        <div className="table-wrap">
          <table className="table portal-table">
            <thead>
              <tr>
                <th className="center">Bid</th><th>Design</th><th>Item</th>
                {v.format.packCounts && <><th>Inner #</th><th>Master #</th></>}
                <th>Your FOB $</th><th>MOQ</th><th>Lead time</th><th aria-label="Save status" />
              </tr>
            </thead>
            <tbody>
              {v.items.map((it) => {
                const r = rows[it.id];
                if (!r) return null;
                return (
                  <tr key={it.id} className={r.bidding ? '' : 'row--muted'}>
                    <td className="center"><input type="checkbox" className="bid-check" checked={r.bidding} aria-label={`Bid on ${it.styleNum ?? 'item'}`}
                      onChange={(e) => save(it, { bidding: e.target.checked })} /></td>
                    <td><Thumb src={apiUrl(it.imageUrl)} alt={it.styleNum ?? 'Design'} size="md" /></td>
                    <td>
                      <strong>{it.styleNum || `Item ${it.position + 1}`}</strong>
                      {it.description && <div className="muted small wrap">{it.description}</div>}
                      {it.targetMoq != null && <div className="muted small">Requested MOQ: {it.targetMoq.toLocaleString()}</div>}
                    </td>
                    {v.format.packCounts && <><td>{it.innerPack ?? '—'}</td><td>{it.masterPack ?? '—'}</td></>}
                    <td><input className="input input--num" inputMode="decimal" disabled={!r.bidding} value={r.price} placeholder="0.00" aria-label="Your FOB price"
                      onChange={(e) => set(it.id, { price: e.target.value, saved: false })} onBlur={() => save(it)} /></td>
                    <td><input className="input input--num" inputMode="numeric" disabled={!r.bidding} value={r.moq} placeholder="—" aria-label="MOQ"
                      onChange={(e) => set(it.id, { moq: e.target.value, saved: false })} onBlur={() => save(it)} /></td>
                    <td><input className="input" disabled={!r.bidding} value={r.leadTime} placeholder="e.g. 45 days" aria-label="Lead time"
                      onChange={(e) => set(it.id, { leadTime: e.target.value, saved: false })} onBlur={() => save(it)} /></td>
                    <td className="save-state">
                      {r.saving ? 'Saving…' : r.error ? <span className="text-danger" role="alert">{r.error}</span> : r.saved ? <span className="text-ok">Saved ✓</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {submitError && <div className="form-error" role="alert">{submitError}</div>}
        <footer className="portal__foot">
          <span className="muted">Quoting <strong>{bidCount}</strong> of {v.items.length} items · saved automatically</span>
          <Button variant="primary" busy={submitting} disabled={bidCount === 0} onClick={submit}>Submit my quote →</Button>
        </footer>
      </div>
    </div>
  );
}
