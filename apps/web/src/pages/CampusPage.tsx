import { Link, useParams } from 'react-router';
import { useTree } from '../api/queries';
import { SiteInfoCard } from '../components/InfoCard';
import { ErrorNotice, Loading, Page } from '../components/Page';

/** Campus detail: who to call, how far along the walk is, and the buildings to pick from. */
export function CampusPage() {
  const { campusId = '' } = useParams();
  const tree = useTree(campusId);
  if (tree.isPending)
    return (
      <Page title="Campus" back="/">
        <Loading />
      </Page>
    );
  if (tree.isError)
    return (
      <Page title="Campus" back="/">
        <ErrorNotice error={tree.error} onRetry={() => tree.refetch()} />
      </Page>
    );
  const t = tree.data;
  const percent = t.progress.rooms ? Math.round((100 * t.progress.walked) / t.progress.rooms) : 0;

  return (
    <Page title={t.name} subtitle={t.district} back="/">
      <div className="stack">
        <SiteInfoCard info={t}>
          <div className="row between">
            <strong>
              {t.progress.walked} of {t.progress.rooms} rooms walked
            </strong>
            <span className="muted">{percent}%</span>
          </div>
          <div className="progress" style={{ marginBottom: 6 }}>
            <div style={{ width: `${percent}%` }} />
          </div>
        </SiteInfoCard>
        <Link to={`/c/${campusId}/summary`} className="btn">
          Office summary ›
        </Link>
      </div>

      <div className="section">
        <h3>Buildings · {t.buildings.length}</h3>
        <ul className="list">
          {t.buildings.map((b) => {
            const rooms = b.floors.flatMap((f) => f.rooms);
            const walked = rooms.filter((r) => r.walkedAt).length;
            const done = rooms.length > 0 && walked === rooms.length;
            return (
              <li key={b.id}>
                <Link className={`item${done ? ' walked' : ''}`} to={`/c/${campusId}/buildings/${b.id}`}>
                  <span className="badge">{b.code}</span>
                  <div className="grow">
                    <div className="title">{b.name}</div>
                    <div className="small muted">
                      {b.floors.length} floor{b.floors.length === 1 ? '' : 's'} · {walked}/{rooms.length} rooms walked
                      {b.yearBuilt && ` · built ${b.yearBuilt}`}
                    </div>
                  </div>
                  <span className="chev">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Page>
  );
}
