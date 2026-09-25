// Email drafts for a project. The master invite template cascades to every
// factory's invite unless that invite was edited individually. Send goes
// through the server (recipients come from the factory record); Copy puts a
// ready-to-paste email — with a real portal link — on the clipboard for your
// own mail client.
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../api/client';
import { useDrafts, usePrepareLink, useResetTemplate, useSaveTemplate, useSendEmail } from '../../api/hooks';
import type { EmailDraft, Project } from '../../api/types';
import { useFeedback } from '../../components/feedback';
import { useCopy } from '../../components/useCopy';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, Textarea } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useProjectId } from './ProjectLayout';

const SECTIONS: { type: EmailDraft['type']; title: string; blurb: string }[] = [
  { type: 'vendor_invite', title: 'Invitations', blurb: 'One per invited factory, rendered from your master invite below.' },
  { type: 'follow_up_reminder', title: 'Follow-ups', blurb: 'Factories that haven\'t responded in 2+ days.' },
  { type: 'revision_request', title: 'Best & Final', blurb: 'Factories priced above the current best on items with competition. They see the best FOB and how far above it they are — never your target.' },
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
  return (
    <div className="stack">
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
        return (
          <section key={sec.type} className="stack">
            <div><h2 className="section-title">{sec.title} <span className="muted">({list.length})</span></h2><p className="muted small">{sec.blurb}</p></div>
            {list.map((d) => (
              <DraftCard key={d.key} projectId={projectId} draft={d} value={effective(d)}
                individuallyEdited={!!edited[d.key]}
                onChange={(v) => setEdited((e) => ({ ...e, [d.key]: { ...e[d.key], ...v } }))}
                onRevert={() => setEdited((e) => { const n = { ...e }; delete n[d.key]; return n; })} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function DraftCard({ projectId, draft, value, individuallyEdited, onChange, onRevert }: {
  projectId: number; draft: EmailDraft; value: { subject: string; body: string }; individuallyEdited: boolean;
  onChange: (v: { subject?: string; body?: string }) => void; onRevert: () => void;
}) {
  const send = useSendEmail(projectId);
  const prepare = usePrepareLink(projectId);
  const { toast } = useFeedback();
  const copy = useCopy();
  const [due, setDue] = useState('');
  const needsDue = value.body.includes('[Due Date]');
  const canEmail = draft.type === 'comparison_ready' || draft.to.length > 0;

  function fillDue(text: string) {
    if (!due) return text;
    const d = new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return text.split('[Due Date]').join(d);
  }

  async function doSend() {
    if (needsDue && !due) return toast('Pick a due date first', 'error');
    try {
      const r = await send.mutateAsync({ type: draft.type, projectFactoryId: draft.projectFactoryId ?? undefined, subject: value.subject, body: value.body, ...(due ? { dueDate: due } : {}) });
      toast(`Sent to ${r.to.join(', ')}`, 'success');
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
          <strong>{draft.factoryName ?? 'Your team'}</strong>
          <span className="muted small"> → {draft.to.length ? draft.to.join(', ') : <span className="text-warn">no email on file — use Copy</span>}</span>
          {draft.type === 'revision_request' && draft.itemsAbove ? <Badge tone="warning">{draft.itemsAbove} item{draft.itemsAbove === 1 ? '' : 's'} above best</Badge> : null}
          {draft.lastSentAt && <Badge tone="success">Sent {dateTime(draft.lastSentAt)}</Badge>}
          {individuallyEdited && <Badge>edited</Badge>}
        </div>
        <div className="draft__actions">
          {needsDue && <label className="due"><span className="muted small">Revised pricing due</span><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></label>}
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
