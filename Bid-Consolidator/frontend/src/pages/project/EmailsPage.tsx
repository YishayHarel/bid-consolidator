// Email drafts for a project. The master invite template cascades to every
// factory's invite unless that invite was edited individually. Send goes
// through the server from your own Outlook (recipients come from the factory
// record); tick several drafts to review and send them as one batch. Copy puts
// a ready-to-paste email — with a real portal link — on the clipboard for your
// own mail client.
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../api/client';
import {
  useConnectOutlook, useDrafts, useJob, useMailStatus, usePrepareLink, useResetTemplate, useSaveTemplate, useSendBatch, useSendEmail,
} from '../../api/hooks';
import type { BatchEmail, BatchResult, EmailDraft, Project } from '../../api/types';
import { useFeedback } from '../../components/feedback';
import { useCopy } from '../../components/useCopy';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, Textarea } from '../../components/ui';
import { dateTime, longDate } from '../../lib/format';
import { useProjectId } from './ProjectLayout';

const SECTIONS: { type: EmailDraft['type']; title: string; blurb: string; batch?: true }[] = [
  { type: 'vendor_invite', title: 'Invitations', blurb: 'One per invited factory, rendered from your master invite below.', batch: true },
  { type: 'follow_up_reminder', title: 'Follow-ups', blurb: 'Factories that haven\'t responded in 2+ days.', batch: true },
  { type: 'revision_request', title: 'Best & Final', blurb: 'Factories priced above the current best on items with competition. They see the best FOB and how far above it they are — never your target.', batch: true },
  { type: 'comparison_ready', title: 'Internal', blurb: 'A summary for your team (sent to you).' },
];

export default function EmailsPage() {
  const projectId = useProjectId();
  const project = useOutletContext<Project>();
  const drafts = useDrafts(projectId);
  const saveTpl = useSaveTemplate();
  const resetTpl = useResetTemplate();
  const { toast, confirm } = useFeedback();
  const [master, setMaster] = useState<{ subject: string; body: string } | null>(null);
  const [edited, setEdited] = useState<Record<string, { subject?: string; body?: string }>>({});
  const [dues, setDues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sectionDue, setSectionDue] = useState<Record<string, string>>({});
  const [batchJob, setBatchJob] = useState<{ id: number; type: EmailDraft['type'] } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const mail = useMailStatus();
  const connect = useConnectOutlook();
  const sendBatch = useSendBatch(projectId);

  useEffect(() => { if (drafts.data) setMaster(drafts.data.inviteTemplate); }, [drafts.data]);

  const renderInvite = useMemo(() => (d: EmailDraft) => {
    const vars: Record<string, string> = {
      'Contact Name': d.contactName || d.factoryName || '',
      'Project Name': project.name,
      'Sender Name': drafts.data?.senderName ?? '',
    };
    let body = master?.body ?? d.body;
    for (const [k, v] of Object.entries(vars)) body = body.split(`[${k}]`).join(v);
    return { subject: (master?.subject ?? d.subject).split('[Project Name]').join(project.name), body };
  }, [master, project.name, drafts.data?.senderName]);

  if (drafts.isPending) return <Loading />;
  if (drafts.isError) return <ErrorBox error={drafts.error} onRetry={() => drafts.refetch()} />;

  const effective = (d: EmailDraft) => {
    const base = d.type === 'vendor_invite' ? renderInvite(d) : { subject: d.subject, body: d.body };
    return { subject: edited[d.key]?.subject ?? base.subject, body: edited[d.key]?.body ?? base.body };
  };

  async function saveMaster() {
    if (!master) return;
    try { await saveTpl.mutateAsync({ type: 'vendor_invite', subject: master.subject, body: master.body }); toast('Saved as your invite format — used for all your projects', 'success'); }
    catch (err) { toast(errorMessage(err), 'error'); }
  }
  async function resetMaster() {
    if (!(await confirm({ title: 'Reset your invite format?', body: 'This restores the built-in default invite for all your projects.', confirmLabel: 'Reset' }))) return;
    try { await resetTpl.mutateAsync('vendor_invite'); setEdited({}); toast('Invite format reset'); }
    catch (err) { toast(errorMessage(err), 'error'); }
  }

  const all = drafts.data.drafts;
  const dueFor = (d: EmailDraft) => dues[d.key] || sectionDue[d.type] || '';
  const toggle = (key: string, on: boolean) => setSelected((x) => { const n = new Set(x); if (on) n.add(key); else n.delete(key); return n; });

  async function sendSelected(type: EmailDraft['type'], list: EmailDraft[]) {
    const chosen = list.filter((d) => selected.has(d.key));
    const missingDue = chosen.filter((d) => effective(d).body.includes('[Due Date]') && !dueFor(d));
    if (missingDue.length) return toast(`Pick a due date first (${missingDue.map((d) => d.factoryName).join(', ')})`, 'error');
    const from = mail.data?.connected ? mail.data.address : null;
    const ok = await confirm({
      title: `Send ${chosen.length} email${chosen.length === 1 ? '' : 's'}${from ? ` from ${from}` : ''}?`,
      body: (
        <div className="stack stack--tight">
          <p className="muted small">Each factory gets the email exactly as shown on this page{from ? ', and it appears in your Sent folder' : ''}.</p>
          <ul className="batch-list">
            {chosen.map((d) => (
              <li key={d.key}><strong>{d.factoryName}</strong> <span className="muted">→ {d.to.join(', ')}</span><br /><span className="small">{effective(d).subject}</span>
                {dueFor(d) && <span className="muted small"> · due {longDate(dueFor(d))}</span>}</li>
            ))}
          </ul>
        </div>
      ),
      confirmLabel: `Send ${chosen.length}`,
    });
    if (!ok) return;
    const emails: BatchEmail[] = chosen.map((d) => ({
      key: d.key, type: d.type, projectFactoryId: d.projectFactoryId ?? undefined, ...effective(d), ...(dueFor(d) ? { dueDate: dueFor(d) } : {}),
    }));
    try {
      const job = await sendBatch.mutateAsync(emails);
      setBatchJob({ id: job.id, type });
      setBatchRunning(true);
      setSelected((x) => { const n = new Set(x); for (const d of chosen) n.delete(d.key); return n; });
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  return (
    <div className="stack">
      {mail.data?.available && !mail.data.connected && (
        <div className="notice row">
          <span className="grow">Connect your Outlook to send these emails from your own address — one at a time or in a batch. Until then, use <strong>Copy</strong>.</span>
          <Button size="sm" variant="primary" busy={connect.isPending} onClick={() => connect.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') })}>Connect Outlook</Button>
        </div>
      )}
      <Card title="Master invite" className="card--accent"
        actions={<>
          <Button size="sm" onClick={resetMaster}>Reset to default</Button>
          <Button size="sm" variant="primary" busy={saveTpl.isPending} onClick={saveMaster}>Save as my format</Button>
        </>}>
        <p className="muted small">Edits here flow into every factory's invite below (unless you've edited one individually).
          Placeholders: <code>[Contact Name]</code> <code>[Project Name]</code> <code>[Portal Link]</code> <code>[Sender Name]</code></p>
        <Input value={master?.subject ?? ''} onChange={(e) => setMaster((m) => m && { ...m, subject: e.target.value })} aria-label="Invite subject" />
        <Textarea rows={9} value={master?.body ?? ''} onChange={(e) => setMaster((m) => m && { ...m, body: e.target.value })} aria-label="Invite body" />
      </Card>

      {all.length === 0 && <EmptyState title="No emails yet">Invite factories on the Factories tab and their invitations appear here.</EmptyState>}
      {SECTIONS.map((sec) => {
        const list = all.filter((d) => d.type === sec.type);
        if (!list.length) return null;
        const sendable = list.filter((d) => d.to.length > 0);
        const picked = list.filter((d) => selected.has(d.key)).length;
        const needsDue = sec.type === 'revision_request';
        return (
          <section key={sec.type} className="stack">
            <div className="section-head">
              <div><h2 className="section-title">{sec.title} <span className="muted">({list.length})</span></h2><p className="muted small">{sec.blurb}</p></div>
              {sec.batch && sendable.length > 1 && (
                <div className="section-head__actions">
                  {needsDue && (
                    <label className="due"><span className="muted small">Due date for all</span>
                      <input type="date" className="input" value={sectionDue[sec.type] ?? ''} onChange={(e) => setSectionDue((x) => ({ ...x, [sec.type]: e.target.value }))} /></label>
                  )}
                  <label className="check">
                    <input type="checkbox" checked={picked === sendable.length}
                      ref={(el) => { if (el) el.indeterminate = picked > 0 && picked < sendable.length; }}
                      onChange={(e) => setSelected((x) => { const n = new Set(x); for (const d of sendable) { if (e.target.checked) n.add(d.key); else n.delete(d.key); } return n; })} />
                    Select all
                  </label>
                  <Button size="sm" variant="primary" disabled={!picked || batchRunning} busy={sendBatch.isPending || batchRunning}
                    onClick={() => void sendSelected(sec.type, list)}>Send {picked || ''} selected</Button>
                </div>
              )}
            </div>
            {batchJob?.type === sec.type && (
              <BatchProgress key={batchJob.id} jobId={batchJob.id}
                onFinished={() => { setBatchRunning(false); void drafts.refetch(); }} onDismiss={() => setBatchJob(null)} />
            )}
            {list.map((d) => (
              <DraftCard key={d.key} projectId={projectId} draft={d} value={effective(d)}
                individuallyEdited={!!edited[d.key]}
                due={dues[d.key] ?? ''} dueFallback={sectionDue[d.type] ?? ''} onDue={(v) => setDues((x) => ({ ...x, [d.key]: v }))}
                selectable={!!sec.batch && sendable.length > 1 && d.to.length > 0}
                selected={selected.has(d.key)} onSelect={(on) => toggle(d.key, on)}
                onChange={(v) => setEdited((e) => ({ ...e, [d.key]: { ...e[d.key], ...v } }))}
                onRevert={() => setEdited((e) => { const n = { ...e }; delete n[d.key]; return n; })} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function DraftCard({ projectId, draft, value, individuallyEdited, due: ownDue, dueFallback, onDue, selectable, selected, onSelect, onChange, onRevert }: {
  projectId: number; draft: EmailDraft; value: { subject: string; body: string }; individuallyEdited: boolean;
  due: string; dueFallback: string; onDue: (v: string) => void;
  selectable: boolean; selected: boolean; onSelect: (on: boolean) => void;
  onChange: (v: { subject?: string; body?: string }) => void; onRevert: () => void;
}) {
  const send = useSendEmail(projectId);
  const prepare = usePrepareLink(projectId);
  const { toast } = useFeedback();
  const copy = useCopy();
  const due = ownDue || dueFallback;
  const needsDue = value.body.includes('[Due Date]');
  const canEmail = draft.type === 'comparison_ready' || draft.to.length > 0;

  function fillDue(text: string) {
    return due ? text.split('[Due Date]').join(longDate(due)) : text;
  }

  async function doSend() {
    if (needsDue && !due) return toast('Pick a due date first', 'error');
    try {
      const r = await send.mutateAsync({ type: draft.type, projectFactoryId: draft.projectFactoryId ?? undefined, subject: value.subject, body: value.body, ...(due ? { dueDate: due } : {}) });
      toast(`Sent to ${r.to.join(', ')}${r.via === 'outlook' ? ' from your Outlook' : ''}`, 'success');
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  function doCopy() {
    if (needsDue && !due) return toast('Pick a due date first', 'error');
    const pfId = draft.projectFactoryId;
    const type = draft.type;
    // The link may need creating first; the clipboard write starts NOW (inside
    // the click, as Safari requires) and receives the finished text when ready.
    const text = (async () => {
      let body = fillDue(value.body);
      if (body.includes('[Portal Link]') && pfId && type !== 'comparison_ready') {
        const link = draft.portalUrl ?? (await prepare.mutateAsync({ projectFactoryId: pfId, type })).portalUrl;
        body = body.split('[Portal Link]').join(link);
      }
      return `${draft.to.length ? `To: ${draft.to.join(', ')}\n` : ''}Subject: ${value.subject}\n\n${body}`;
    })();
    void copy(text, 'Email copied — paste it into your mail app');
  }

  return (
    <Card className="draft">
      <div className="draft__head">
        <div>
          {selectable && <input type="checkbox" className="draft__check" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Include ${draft.factoryName} in batch send`} />}
          <strong>{draft.factoryName ?? 'Your team'}</strong>
          <span className="muted small"> → {draft.to.length ? draft.to.join(', ') : <span className="text-warn">no email on file — use Copy</span>}</span>
          {draft.type === 'revision_request' && draft.itemsAbove ? <Badge tone="warning">{draft.itemsAbove} item{draft.itemsAbove === 1 ? '' : 's'} above best</Badge> : null}
          {draft.lastSentAt && <Badge tone="success">Sent {dateTime(draft.lastSentAt)}</Badge>}
          {individuallyEdited && <Badge>edited</Badge>}
        </div>
        <div className="draft__actions">
          {needsDue && <label className="due"><span className="muted small">Revised pricing due</span><input type="date" className="input" value={due} onChange={(e) => onDue(e.target.value)} /></label>}
          {individuallyEdited && <Button size="sm" variant="ghost" onClick={onRevert}>Revert</Button>}
          <Button size="sm" busy={prepare.isPending} onClick={doCopy}>Copy</Button>
          <Button size="sm" variant="primary" busy={send.isPending} disabled={!canEmail} onClick={doSend}>Send</Button>
        </div>
      </div>
      <Input value={value.subject} onChange={(e) => onChange({ subject: e.target.value })} aria-label="Subject" />
      <Textarea rows={Math.min(16, value.body.split('\n').length + 1)} value={value.body} onChange={(e) => onChange({ body: e.target.value })} aria-label="Body" />
      {value.body.includes('[Portal Link]') && <p className="muted small">[Portal Link] is replaced with {draft.type === 'revision_request' ? 'a fresh Best & Final link' : "this factory's portal link"} when you send or copy.</p>}
    </Card>
  );
}

// Live progress of a batch send, then its outcome — which emails went out and
// which didn't (and why) — until you dismiss it.
function BatchProgress({ jobId, onFinished, onDismiss }: { jobId: number; onFinished: () => void; onDismiss: () => void }) {
  const job = useJob(jobId);
  const { toast } = useFeedback();
  const j = job.data;
  const finished = !!j && (j.state === 'succeeded' || j.state === 'failed');
  const r = (j?.result ?? null) as BatchResult | null;
  useEffect(() => {
    if (!finished) return;
    if (j.state === 'failed') toast(j.error ?? 'The batch send failed — please try again.', 'error');
    else if (r?.failed.length) toast(`Sent ${r.sent} of ${r.total} — ${r.failed.length} didn't send.`, 'error');
    else if (r) toast(`All ${r.sent} emails sent`, 'success');
    onFinished();
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!finished) {
    return (
      <div className="job">
        <div className="job__label">Sending emails{j?.message ? ` — ${j.message}` : '…'}</div>
        <div className="progress"><div className="progress__bar" style={{ width: `${Math.max(4, j?.progress ?? 0)}%` }} /></div>
      </div>
    );
  }
  if (j.state === 'succeeded' && !r?.failed.length) return null;
  return (
    <Card className="card--warn" title={j.state === 'failed' ? 'Batch send failed' : `Sent ${r?.sent ?? 0} of ${r?.total ?? 0}`}
      actions={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
      {j.state === 'failed' ? <p className="small">{j.error}</p> : (
        <ul className="batch-list">
          {r!.failed.map((f) => <li key={f.key}><strong>{f.factoryName ?? f.key}</strong> — {f.error}</li>)}
        </ul>
      )}
      <p className="muted small">Fix the problem, then tick those factories and send again — the ones that already went out won't be affected.</p>
    </Card>
  );
}
