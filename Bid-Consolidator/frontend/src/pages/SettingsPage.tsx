// Settings: the shared factory directory (everyone in the org), your account,
// and — for admins — org defaults, sign-up domains, members and invites.
import { useMemo, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import {
  useCreateInvite, useDeleteFactory, useFactories, useInvites, useMembers, useOrgSettings, useRevokeInvite,
  useSaveFactory, useSetRole, useUpdateOrg,
} from '../api/hooks';
import { api } from '../api/client';
import type { Factory } from '../api/types';
import { useFeedback } from '../components/feedback';
import { useCopy } from '../components/useCopy';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, InlineInput, Input, Loading } from '../components/ui';
import { useAuth } from '../lib/auth';
import { date, DIVISIONS, field, toNum } from '../lib/format';

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  return (
    <div className="page stack">
      <h1 className="page__title">Settings</h1>
      <FactoryDirectory />
      <AccountCard />
      {isAdmin && <OrgCard />}
      {isAdmin && <MembersCard />}
    </div>
  );
}

function FactoryDirectory() {
  const factories = useFactories();
  const save = useSaveFactory();
  const del = useDeleteFactory();
  const { toast, confirm } = useFeedback();
  const [division, setDivision] = useState('All');
  const [q, setQ] = useState('');
  const [fresh, setFresh] = useState({ name: '', emails: '', contactName: '', divisions: [] as string[] });

  const shown = useMemo(() => (factories.data ?? []).filter((f) =>
    (division === 'All' || f.divisions.includes(division)) && (!q || f.name.toLowerCase().includes(q.toLowerCase()))), [factories.data, division, q]);

  const update = (f: Factory, patch: Partial<Pick<Factory, 'name' | 'contactName' | 'divisions'>> & { emails?: string }) =>
    save.mutate({ id: f.id, ...patch }, { onError: (e) => toast(errorMessage(e), 'error') });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!fresh.name.trim()) return;
    try {
      await save.mutateAsync({ name: fresh.name.trim(), emails: fresh.emails, contactName: fresh.contactName || null, divisions: fresh.divisions });
      setFresh({ name: '', emails: '', contactName: '', divisions: [] });
      toast('Factory added to the directory', 'success');
    } catch (err) { toast(errorMessage(err), 'error'); }
  }
  async function remove(f: Factory) {
    if (!(await confirm({ title: `Delete ${f.name} from the directory?`, confirmLabel: 'Delete', danger: true }))) return;
    del.mutate(f.id, { onError: (e) => toast(errorMessage(e), 'error') });
  }
  const toggle = (list: string[], d: string) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);

  return (
    <Card title="Factory directory" actions={
      <div className="row">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input--auto" value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Filter by division">
          <option value="All">All divisions</option>{DIVISIONS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>}>
      <p className="muted small">Shared by everyone in your organization. Tag each factory with the divisions it serves — projects show only that division's factories when inviting.</p>
      <form className="form-row" onSubmit={add}>
        <Field label="Name"><Input value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} placeholder="Factory name" /></Field>
        <Field label="Emails"><Input value={fresh.emails} onChange={(e) => setFresh({ ...fresh, emails: e.target.value })} placeholder="comma-separated" /></Field>
        <Field label="Contact"><Input value={fresh.contactName} onChange={(e) => setFresh({ ...fresh, contactName: e.target.value })} placeholder="e.g. Beddy" /></Field>
        <div className="form-row__submit"><Button type="submit" variant="primary" busy={save.isPending && !save.variables?.id}>+ Add factory</Button></div>
        <div className="chips full">
          <span className="muted small">Divisions:</span>
          {DIVISIONS.map((d) => (
            <button type="button" key={d} className={`chip ${fresh.divisions.includes(d) ? 'chip--on' : ''}`} onClick={() => setFresh({ ...fresh, divisions: toggle(fresh.divisions, d) })}>{d}</button>
          ))}
        </div>
      </form>
      {factories.isPending ? <Loading /> : factories.isError ? <ErrorBox error={factories.error} /> : shown.length === 0 ? (
        <EmptyState title={division === 'All' ? 'No factories yet' : `No ${division} factories`} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Emails</th><th>Contact</th><th>Divisions</th><th>Projects</th><th /></tr></thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id}>
                  <td><InlineInput value={f.name} onSave={(v) => v.trim() && update(f, { name: v.trim() })} /></td>
                  <td><InlineInput value={f.emails.join(', ')} placeholder="—" onSave={(v) => update(f, { emails: v })} /></td>
                  <td><InlineInput value={f.contactName ?? ''} placeholder="—" onSave={(v) => update(f, { contactName: v || null })} /></td>
                  <td>
                    <div className="chips">
                      {DIVISIONS.map((d) => (
                        <button key={d} type="button" className={`chip chip--sm ${f.divisions.includes(d) ? 'chip--on' : ''}`}
                          onClick={() => update(f, { divisions: toggle(f.divisions, d) })}>{d}</button>
                      ))}
                    </div>
                  </td>
                  <td>{f.projectCount}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>✕</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AccountCard() {
  const { toast } = useFeedback();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '' });
      toast('Password changed', 'success');
    } catch (err) { toast(errorMessage(err), 'error'); }
    setBusy(false);
  }
  return (
    <Card title="Your account">
      <form className="form-row" onSubmit={submit}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <div className="form-row__submit"><Button type="submit" busy={busy} disabled={!pw.current || pw.next.length < 8}>Change password</Button></div>
      </form>
    </Card>
  );
}

function OrgCard() {
  const org = useOrgSettings();
  const update = useUpdateOrg();
  const { toast } = useFeedback();
  const [domain, setDomain] = useState('');
  if (org.isPending) return <Card title="Organization"><Loading /></Card>;
  if (org.isError) return <Card title="Organization"><ErrorBox error={org.error} /></Card>;
  const o = org.data;
  const saveLc = (key: 'commissionDivisor' | 'freightPerContainer' | 'defaultEtc', v: string) => {
    const n = toNum(v);
    if (n === null || n < 0) return toast('Enter a valid number', 'error');
    update.mutate({ landedCost: { [key]: n } }, { onSuccess: () => toast('Default saved'), onError: (e) => toast(errorMessage(e), 'error') });
  };
  const setDomains = (list: string[]) => update.mutate({ allowedDomains: list }, { onError: (e) => toast(errorMessage(e), 'error') });

  return (
    <Card title={`Organization — ${o.name}`}>
      <h4 className="subhead">Landed-cost defaults</h4>
      <div className="constants">
        <label className="mini-field"><span>Commission divisor</span><InlineInput value={field(o.landedCost.commissionDivisor)} onSave={(v) => saveLc('commissionDivisor', v)} /></label>
        <label className="mini-field"><span>Freight per 40' container ($)</span><InlineInput value={field(o.landedCost.freightPerContainer)} onSave={(v) => saveLc('freightPerContainer', v)} /></label>
        <label className="mini-field"><span>Default Etc. ($/unit)</span><InlineInput value={field(o.landedCost.defaultEtc)} onSave={(v) => saveLc('defaultEtc', v)} /></label>
      </div>
      <h4 className="subhead">Sign-up domains</h4>
      <p className="muted small">People with these email domains can create their own account in your organization. Anyone else needs an invite.</p>
      <div className="chips">
        {o.allowedDomains.map((d) => (
          <span key={d} className="chip chip--on">{d} <button className="chip__x" aria-label={`Remove ${d}`} onClick={() => setDomains(o.allowedDomains.filter((x) => x !== d))}>×</button></span>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) { setDomains([...o.allowedDomains, domain.trim().toLowerCase()]); setDomain(''); } }}>
          <Input placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <Button type="submit" size="sm">Add</Button>
        </form>
      </div>
    </Card>
  );
}

function MembersCard() {
  const { user } = useAuth();
  const members = useMembers(true);
  const invites = useInvites(true);
  const setRole = useSetRole();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const { toast } = useFeedback();
  const copy = useCopy();
  const [inv, setInv] = useState({ email: '', role: 'member' as 'member' | 'admin' });
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  function sendInvite(e: FormEvent) {
    e.preventDefault();
    const url = createInvite.mutateAsync(inv).then((r) => {
      setLastUrl(r.inviteUrl ?? null);
      setInv({ email: '', role: 'member' });
      return r.inviteUrl ?? '';
    });
    url.catch((err) => toast(errorMessage(err), 'error'));
    void copy(url, 'Invite link created and copied — send it to them');
  }

  return (
    <Card title="Members & invites">
      {members.isPending ? <Loading /> : members.isError ? <ErrorBox error={members.error} /> : (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.id}>
                <td>{m.name}{m.id === user?.id && <span className="muted"> (you)</span>}</td>
                <td>{m.email}</td>
                <td>
                  <select className="input input--auto" value={m.role} aria-label={`Role for ${m.name}`}
                    onChange={(e) => setRole.mutate({ userId: m.id, role: e.target.value as 'admin' | 'member' }, { onError: (err) => toast(errorMessage(err), 'error') })}>
                    <option value="member">Member</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td>{date(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4 className="subhead">Invite someone</h4>
      <form className="form-row" onSubmit={sendInvite}>
        <Field label="Email"><Input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="name@company.com" /></Field>
        <Field label="Role">
          <select className="input" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as 'member' | 'admin' })}>
            <option value="member">Member</option><option value="admin">Admin</option>
          </select>
        </Field>
        <div className="form-row__submit"><Button type="submit" variant="primary" busy={createInvite.isPending}>Create invite link</Button></div>
      </form>
      {lastUrl && <div className="notice">Invite link (valid 14 days, single use): <code className="break">{lastUrl}</code></div>}
      {(invites.data?.length ?? 0) > 0 && (
        <table className="table">
          <thead><tr><th>Invited</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {invites.data!.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td><td>{i.role}</td>
                <td>{i.usedAt ? <Badge tone="success">Joined {date(i.usedAt)}</Badge> : new Date(i.expiresAt) < new Date() ? <Badge>Expired</Badge> : <Badge tone="info">Pending · expires {date(i.expiresAt)}</Badge>}</td>
                <td>{!i.usedAt && <Button size="sm" variant="ghost" onClick={() => revokeInvite.mutate(i.id)}>Revoke</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
