import { Link } from 'react-router';
import { useCampuses } from '../api/queries';
import { ErrorNotice, Loading, Page } from '../components/Page';

/**
 * Every campus the walker can open. Access control is a later concern (see README), so for
 * now that is all of them; with one campus seeded it gets the whole screen.
 */
export function ProjectsPage() {
  const campuses = useCampuses();
  return (
    <Page title="Projects" subtitle="Campuses you can walk">
      {campuses.isPending && <Loading />}
      {campuses.isError && <ErrorNotice error={campuses.error} onRetry={() => campuses.refetch()} />}
      {campuses.data && campuses.data.length === 0 && <p className="center">No campuses yet. Seed one or import rooms.</p>}
      {campuses.data && (
        <ul className="list" style={{ gap: 12 }}>
          {campuses.data.map((c) => (
            <li key={c.id}>
              <Link className="project" to={`/c/${c.id}`}>
                <div className="project-district">{c.district}</div>
                <div className="project-name">{c.name}</div>
                {c.address && <div className="small" style={{ opacity: 0.85 }}>{c.address}</div>}
                <div className="row between" style={{ marginTop: 10 }}>
                  <span className="small" style={{ opacity: 0.85 }}>
                    {c.contactName ?? ''}
                  </span>
                  <span className="btn sm" style={{ background: '#fff', color: 'var(--green)', border: 0 }}>
                    Open campus ›
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
