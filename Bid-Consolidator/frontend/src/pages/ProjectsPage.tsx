import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { useCreateProject, useDeleteProject, useProjects } from '../api/hooks';
import { useFeedback } from '../components/feedback';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading } from '../components/ui';
import { date, DIVISIONS } from '../lib/format';

export default function ProjectsPage() {
  const projects = useProjects();
  const create = useCreateProject();
  const remove = useDeleteProject();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', buyer: '', division: '' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await create.mutateAsync({ name: form.name, buyer: form.buyer || null, division: form.division || null });
      setForm({ name: '', buyer: '', division: '' });
      setOpen(false);
      navigate(`/app/projects/${p.id}/compare`);
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  async function del(id: number, name: string) {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: 'This permanently deletes the project, its items, all factory quotes, portal links and uploaded files.',
      confirmLabel: 'Delete project', danger: true,
    });
    if (!ok) return;
    try { await remove.mutateAsync(id); toast('Project deleted', 'success'); } catch (err) { toast(errorMessage(err), 'error'); }
  }

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Projects</h1>
        <Button variant="primary" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : '+ New project'}</Button>
      </div>

      {open && (
        <Card>
          <form className="form-row" onSubmit={submit}>
            <Field label="Project name *"><Input required value={form.name} placeholder="e.g. Ross Hydration Summer 2026" autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Buyer"><Input value={form.buyer} placeholder="e.g. Ross, TJ Maxx" onChange={(e) => setForm({ ...form, buyer: e.target.value })} /></Field>
            <Field label="Division">
              <Input list="division-options" value={form.division} placeholder="e.g. Hydration" onChange={(e) => setForm({ ...form, division: e.target.value })} />
              <datalist id="division-options">{DIVISIONS.map((d) => <option key={d} value={d} />)}</datalist>
            </Field>
            <div className="form-row__submit"><Button type="submit" variant="primary" busy={create.isPending}>Create project</Button></div>
          </form>
          <p className="muted small">Next you'll build its item list on the Compare sheet — by uploading CADs or importing a sorted Excel sheet.</p>
        </Card>
      )}

      {projects.isPending ? <Loading /> : projects.isError ? <ErrorBox error={projects.error} onRetry={() => projects.refetch()} /> :
        projects.data.items.length === 0 ? (
          <EmptyState title="No projects yet" action={<Button variant="primary" onClick={() => setOpen(true)}>Create your first project</Button>}>
            A project is one sourcing program — its items, the factories you invite, and their quotes.
          </EmptyState>
        ) : (
          <div className="project-grid">
            {projects.data.items.map((p) => {
              const c = p.counts;
              return (
                <Card key={p.id} className="project-card">
                  <Link to={`/app/projects/${p.id}/compare`} className="project-card__link">
                    <div className="project-card__name">{p.name}</div>
                    <div className="project-card__meta">{[p.buyer, p.division].filter(Boolean).join(' · ') || '—'}</div>
                  </Link>
                  <div className="project-card__stats">
                    <span><strong>{c?.items ?? 0}</strong> items</span>
                    <span><strong>{c?.submitted ?? 0}/{c?.factories ?? 0}</strong> factories quoted</span>
                    <span><strong>{c?.quotes ?? 0}</strong> quotes</span>
                  </div>
                  {c && c.factories > 0 && (
                    <div className="progress" aria-label={`${c.submitted} of ${c.factories} factories submitted`}>
                      <div className="progress__bar" style={{ width: `${(c.submitted / c.factories) * 100}%` }} />
                    </div>
                  )}
                  <div className="project-card__foot">
                    <span className="muted small">Created {date(p.createdAt)}</span>
                    {p.status !== 'active' && <Badge>{p.status}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => del(p.id, p.name)}>Delete</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
    </div>
  );
}
