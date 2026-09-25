// A project's frame: header (switch project, see division/buyer) and the
// per-project tabs. Child pages read the project id from the URL.
import { NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { useProject, useProjects } from '../../api/hooks';
import { ErrorBox, Loading } from '../../components/ui';

export function useProjectId(): number {
  return Number(useParams().projectId);
}

export default function ProjectLayout() {
  const id = useProjectId();
  const project = useProject(id);
  const projects = useProjects();
  const navigate = useNavigate();

  if (project.isPending) return <Loading />;
  if (project.isError) return <div className="page"><ErrorBox error={project.error} /></div>;
  const p = project.data;

  return (
    <div className="page">
      <div className="project-head">
        <div>
          <select className="project-switch" value={id} aria-label="Switch project"
            onChange={(e) => navigate(`/app/projects/${e.target.value}/compare`)}>
            {(projects.data?.items ?? [p]).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <div className="project-head__meta">{[p.buyer, p.division].filter(Boolean).join(' · ') || 'No buyer or division set'}</div>
        </div>
        <nav className="tabs">
          <NavLink to="compare" className="tabs__tab">Compare</NavLink>
          <NavLink to="factories" className="tabs__tab">Factories {p.counts ? <span className="tabs__count">{p.counts.submitted}/{p.counts.factories}</span> : null}</NavLink>
          <NavLink to="emails" className="tabs__tab">Emails</NavLink>
          <NavLink to="landed-cost" className="tabs__tab">Landed Cost</NavLink>
        </nav>
      </div>
      <Outlet context={p} />
    </div>
  );
}
