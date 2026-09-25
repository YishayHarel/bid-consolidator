// Every factory portal link across your projects — copy, see status, revoke.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api/client';
import { useRevokeLink, useVendorLinks } from '../api/hooks';
import type { VendorLink } from '../api/types';
import { useFeedback } from '../components/feedback';
import { useCopy } from '../components/useCopy';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading } from '../components/ui';
import { date } from '../lib/format';

const TONE: Record<VendorLink['status'], 'success' | 'info' | 'neutral'> = { active: 'info', submitted: 'success', expired: 'neutral' };

export default function VendorLinksPage() {
  const links = useVendorLinks();
  const revoke = useRevokeLink();
  const { toast, confirm } = useFeedback();
  const copy = useCopy();
  const [status, setStatus] = useState<'all' | VendorLink['status']>('all');
  const shown = useMemo(() => (links.data ?? []).filter((l) => status === 'all' || l.status === status), [links.data, status]);

  async function doRevoke(l: VendorLink) {
    if (!(await confirm({ title: `Revoke ${l.factoryName}'s link?`, body: 'The link stops working immediately. You can issue a new one from the project\'s Factories tab.', confirmLabel: 'Revoke', danger: true }))) return;
    revoke.mutate(l.id, { onSuccess: () => toast('Link revoked'), onError: (e) => toast(errorMessage(e), 'error') });
  }

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Vendor links</h1>
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
          <option value="all">All links</option><option value="active">Active</option><option value="submitted">Submitted</option><option value="expired">Expired</option>
        </select>
      </div>
      <p className="muted small">Each invited factory gets a private link to quote on one project. Links are single-use for submitting and expire after 30 days.</p>
      {links.isPending ? <Loading /> : links.isError ? <ErrorBox error={links.error} /> : shown.length === 0 ? (
        <EmptyState title="No links here">Invite factories from a project's Factories tab to create their links.</EmptyState>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Factory</th><th>Project</th><th>Round</th><th>Status</th><th>Created</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td><strong>{l.factoryName}</strong></td>
                    <td><Link to={`/app/projects/${l.project.id}/factories`}>{l.project.name}</Link></td>
                    <td>{l.purpose === 'revision' ? 'Best & Final' : 'Quote'}</td>
                    <td><Badge tone={TONE[l.status]}>{l.status}</Badge></td>
                    <td>{date(l.createdAt)}</td>
                    <td>{date(l.expiresAt)}</td>
                    <td className="actions-cell">
                      {l.status === 'active' && <Button size="sm" onClick={() => void copy(l.url, 'Link copied')}>Copy</Button>}
                      {l.status !== 'submitted' && <Button size="sm" variant="ghost" onClick={() => doRevoke(l)}>Revoke</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
