// Factories on this project: invite (from the directory, filtered to the
// project's division, or brand-new), track who responded, copy/re-issue portal
// links, and upload a factory's emailed Excel quote on its behalf.
import { useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../api/client';
import { useFactories, useInviteFactories, useInvited, useNewLink, useRemoveInvited, useUpload } from '../../api/hooks';
import type { InvitedFactory, Project } from '../../api/types';
import { useFeedback } from '../../components/feedback';
import { useJobWatcher } from '../../components/JobWatcher';
import { useCopy } from '../../components/useCopy';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading } from '../../components/ui';
import { date, dateTime } from '../../lib/format';
import { useProjectId } from './ProjectLayout';

const STATUS: Record<InvitedFactory['status'], { tone: 'success' | 'warning' | 'info'; label: string }> = {
  submitted: { tone: 'success', label: 'Submitted' },
  no_response: { tone: 'warning', label: 'No response (2+ days)' },
  pending: { tone: 'info', label: 'Invited' },
};

export default function FactoriesPage() {
  const projectId = useProjectId();
  const project = useOutletContext<Project>();
  const invited = useInvited(projectId);
  const remove = useRemoveInvited(projectId);
  const newLink = useNewLink(projectId);
  const upload = useUpload(projectId);
  const { toast, confirm } = useFeedback();
  const { watch, watchers } = useJobWatcher(projectId);
  const copy = useCopy();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  async function onQuoteFile(list: FileList | null) {
    const f = list?.[0];
    if (!f || !uploadFor) return;
    try {
      const job = await upload.mutateAsync({ kind: 'quote', files: [f], fields: { projectFactoryId: String(uploadFor) } });
      if ('id' in job) watch(job);
      toast('Quote uploaded — matching it to your items…');
    } catch (err) { toast(errorMessage(err), 'error'); }
    setUploadFor(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function removeFactory(f: InvitedFactory) {
    const ok = await confirm({
      title: `Remove ${f.factory.name} from this project?`,
      body: f.itemsReceived ? `This also deletes their ${f.itemsReceived} quote${f.itemsReceived === 1 ? '' : 's'} and portal links on this project. The factory stays in your directory.` : 'Their portal link stops working. The factory stays in your directory.',
      confirmLabel: 'Remove', danger: f.itemsReceived > 0,
    });
    if (ok) remove.mutate(f.id, { onSuccess: () => toast(`${f.factory.name} removed`), onError: (e) => toast(errorMessage(e), 'error') });
  }

  return (
    <div className="stack">
      {watchers}
      <input ref={fileInput} type="file" hidden accept=".xlsx,.xls" onChange={(e) => onQuoteFile(e.target.files)} />
      <Card title={`Invited factories (${invited.data?.length ?? 0})`}
        actions={<Button variant="primary" onClick={() => setShowInvite((s) => !s)}>{showInvite ? 'Done' : '+ Invite factories'}</Button>}>
        {showInvite && <InvitePanel projectId={projectId} division={project.division} invitedIds={new Set(invited.data?.map((f) => f.factory.id))} />}
        {invited.isPending ? <Loading /> : invited.isError ? <ErrorBox error={invited.error} /> : invited.data.length === 0 ? (
          <EmptyState title="No factories invited yet">Invite factories and each gets a private portal link to quote on this project's items.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Factory</th><th>Status</th><th>Items quoted</th><th>Invited</th><th>Last emailed</th><th>Portal link</th><th /></tr></thead>
              <tbody>
                {invited.data.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.factory.name}</strong>
                      <div className="muted small">{f.factory.contactName ? `${f.factory.contactName} · ` : ''}{f.factory.emails.join(', ') || <span className="text-warn">no email on file</span>}</div>
                    </td>
                    <td><Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>{f.submittedAt && <div className="muted small">{date(f.submittedAt)}</div>}</td>
                    <td>{f.totalItems ? `${f.itemsReceived}/${f.totalItems}` : '—'}</td>
                    <td>{date(f.invitedAt)}</td>
                    <td>{f.lastEmailedAt ? dateTime(f.lastEmailedAt) : '—'}</td>
                    <td>
                      {f.portalUrl ? (
                        <div className="link-cell">
                          <Button size="sm" onClick={() => void copy(f.portalUrl!, 'Portal link copied')}>Copy link</Button>
                          <span className="muted small">expires {date(f.linkExpiresAt)}</span>
                        </div>
                      ) : (
                        <Button size="sm" busy={newLink.isPending && newLink.variables === f.id}
                          onClick={() => void copy(newLink.mutateAsync(f.id).then((r) => r.portalUrl), 'New link created and copied')}>
                          New link
                        </Button>
                      )}
                    </td>
                    <td className="actions-cell">
                      <Button size="sm" onClick={() => { setUploadFor(f.id); fileInput.current?.click(); }} title="Upload the Excel quote this factory emailed you">Upload quote</Button>
                      <Button size="sm" variant="ghost" onClick={() => removeFactory(f)} aria-label={`Remove ${f.factory.name}`}>✕</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function InvitePanel({ projectId, division, invitedIds }: { projectId: number; division: string | null; invitedIds: Set<number> }) {
  const directory = useFactories();
  const invite = useInviteFactories(projectId);
  const { toast } = useFeedback();
  const [q, setQ] = useState('');
  const [allDivisions, setAllDivisions] = useState(!division);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState({ name: '', emails: '', contactName: '' });

  const visible = useMemo(() => (directory.data ?? []).filter((f) =>
    !invitedIds.has(f.id)
    && (allDivisions || !division || f.divisions.some((d) => d.toLowerCase() === division.toLowerCase()))
    && (!q || f.name.toLowerCase().includes(q.toLowerCase()) || (f.contactName ?? '').toLowerCase().includes(q.toLowerCase()))),
  [directory.data, invitedIds, allDivisions, division, q]);

  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function send() {
    const newFactories = fresh.name.trim()
      ? [{ name: fresh.name.trim(), emails: fresh.emails.split(/[,;\s]+/).filter(Boolean), contactName: fresh.contactName.trim() || null }]
      : [];
    if (!picked.size && !newFactories.length) return toast('Pick at least one factory', 'error');
    try {
      const r = await invite.mutateAsync({ factoryIds: [...picked], newFactories });
      toast(`Invited ${r.invited} factor${r.invited === 1 ? 'y' : 'ies'} — each has its own portal link`, 'success');
      setPicked(new Set());
      setFresh({ name: '', emails: '', contactName: '' });
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  return (
    <div className="invite-panel">
      <div className="invite-panel__filters">
        <Input placeholder="Search your factory directory…" value={q} onChange={(e) => setQ(e.target.value)} />
        {division && (
          <label className="check">
            <input type="checkbox" checked={allDivisions} onChange={(e) => setAllDivisions(e.target.checked)} />
            Show all divisions (not just {division})
          </label>
        )}
      </div>
      {directory.isPending ? <Loading /> : (
        <div className="pick-list">
          {visible.length === 0 && <div className="muted small pad">{directory.data?.length ? `No ${!allDivisions && division ? `${division} ` : ''}factories left to invite.` : 'Your factory directory is empty — add one below.'}</div>}
          {visible.map((f) => (
            <label key={f.id} className="pick-list__row">
              <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
              <span className="grow"><strong>{f.name}</strong>{f.contactName && <span className="muted"> · {f.contactName}</span>}</span>
              <span className="muted small">{f.emails.join(', ') || 'no email'}</span>
            </label>
          ))}
        </div>
      )}
      <div className="form-row">
        <Field label="Or add a new factory"><Input placeholder="Factory name" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></Field>
        <Field label="Emails"><Input placeholder="sales@factory.com, ops@factory.com" value={fresh.emails} onChange={(e) => setFresh({ ...fresh, emails: e.target.value })} /></Field>
        <Field label="Contact name"><Input placeholder="e.g. Beddy" value={fresh.contactName} onChange={(e) => setFresh({ ...fresh, contactName: e.target.value })} /></Field>
      </div>
      <div className="row-end">
        <Button variant="primary" busy={invite.isPending} onClick={send}>
          Invite {picked.size + (fresh.name.trim() ? 1 : 0) || ''}
        </Button>
      </div>
    </div>
  );
}
