import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTree } from '../api/queries';
import { SiteInfoCard } from '../components/InfoCard';
import { ErrorNotice, Loading, Page, formatWhen } from '../components/Page';

/**
 * Building detail: contact, a floor dropdown, and the rooms on that floor. The floor with the
 * next unwalked room is selected first so the walker lands where the work is.
 */
export function BuildingPage() {
  const { campusId = '', buildingId = '' } = useParams();
  const tree = useTree(campusId);
  const [floorChoice, setFloorChoice] = useState<string | null>(null);
  const back = `/c/${campusId}`;
  if (tree.isPending)
    return (
      <Page title="Building" back={back}>
        <Loading />
      </Page>
    );
  if (tree.isError)
    return (
      <Page title="Building" back={back}>
        <ErrorNotice error={tree.error} onRetry={() => tree.refetch()} />
      </Page>
    );
  const b = tree.data.buildings.find((x) => x.id === buildingId);
  if (!b)
    return (
      <Page title="Building" back={back}>
        <ErrorNotice error={new Error('building not found')} />
      </Page>
    );

  const allRooms = b.floors.flatMap((f) => f.rooms);
  const nextRoom = allRooms.find((r) => !r.walkedAt);
  const floorId = floorChoice ?? nextRoom?.floorId ?? b.floors[0]?.id ?? 'all';
  const floor = b.floors.find((f) => f.id === floorId);
  const rooms = floor ? floor.rooms : allRooms;

  return (
    <Page title={`${b.code} · ${b.name}`} subtitle={tree.data.name} back={back}>
      <div className="stack">
        <SiteInfoCard info={b}>
          <div className="small muted">
            {b.floors.length} floor{b.floors.length === 1 ? '' : 's'} · {allRooms.length} rooms · {allRooms.filter((r) => r.walkedAt).length} walked
            {b.yearBuilt && ` · built ${b.yearBuilt}`}
          </div>
        </SiteInfoCard>

        <Link className="item" to={`/c/${campusId}/buildings/${b.id}/systems`}>
          <span className="badge cat-system">systems</span>
          <div className="grow">
            <div className="title">Building systems</div>
            <div className="small muted">{b.systemAssetCount} assets not tied to a room (roof, mechanical, corridors)</div>
          </div>
          <span className="chev">›</span>
        </Link>

        <div className="field">
          <label htmlFor="floor">Floor</label>
          <select id="floor" className="input" value={floorId} onChange={(e) => setFloorChoice(e.target.value)}>
            {b.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.rooms.filter((r) => r.walkedAt).length}/{f.rooms.length} walked
              </option>
            ))}
            <option value="all">All floors</option>
          </select>
        </div>
      </div>

      <div className="section">
        <h3>
          Rooms · {rooms.length}
          {floor ? ` on ${floor.name}` : ''}
        </h3>
        <ul className="list">
          {rooms.map((r) => (
            <li key={r.id}>
              <Link
                className={`item${r.walkedAt ? ' walked' : ''}${r.id === nextRoom?.id ? ' next' : ''}`}
                to={`/c/${campusId}/rooms/${r.id}`}
              >
                <strong style={{ minWidth: 44 }}>{r.number}</strong>
                <div className="grow">
                  <div className="title">{r.name}</div>
                  <div className="small muted">
                    {r.roomType} · {r.assetCount} asset{r.assetCount === 1 ? '' : 's'}
                    {r.walkedAt && r.walkedBy && ` · ${r.walkedBy.name}, ${formatWhen(r.walkedAt)}`}
                  </div>
                </div>
                {r.walkedAt ? (
                  <span className="badge ok">walked</span>
                ) : r.id === nextRoom?.id ? (
                  <span className="badge warn">next</span>
                ) : null}
                <span className="chev">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}
