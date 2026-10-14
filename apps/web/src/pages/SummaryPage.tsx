import { conditionLabel, type CampusSummary } from '@campus-walk/shared';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { API_URL } from '../api/client';
import { useImportRooms, useSummary, useTree } from '../api/queries';
import { ConditionDot } from '../components/ConditionPicker';
import { ErrorNotice, Loading, Page } from '../components/Page';

/** The office view: progress, then what is left to walk (the office's main question), counts by type and poor condition. Filterable by building. */
export function SummaryPage() {
  const { campusId = '' } = useParams();
  const [buildingId, setBuildingId] = useState<string>('');
  const tree = useTree(campusId);
  const summary = useSummary(campusId, buildingId || undefined);
  const back = `/c/${campusId}`;

  if (summary.isPending)
    return (
      <Page title="Summary" back={back}>
        <Loading />
      </Page>
    );
  if (summary.isError)
    return (
      <Page title="Summary" back={back}>
        <ErrorNotice error={summary.error} onRetry={() => summary.refetch()} />
      </Page>
    );
  const s = summary.data;
  const percent = s.rooms.total ? Math.round((100 * s.rooms.walked) / s.rooms.total) : 0;
  const units = s.countsByType.reduce((n, t) => n + t.units, 0);
  const maxUnits = Math.max(1, ...s.countsByType.map((t) => t.units));

  return (
    <Page title={`${s.campus.name} · Summary`} subtitle={s.campus.district} back={back}>
      <div className="stack">
        <select className="input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
          <option value="">All buildings</option>
          {tree.data?.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
            </option>
          ))}
        </select>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <strong>
              {s.rooms.walked} of {s.rooms.total} rooms walked
            </strong>
            <span className="muted">{percent}%</span>
          </div>
          <div className="progress">
            <div style={{ width: `${percent}%` }} />
          </div>
          {s.walkers.length > 0 && (
            <div className="small muted">{s.walkers.map((w) => `${w.user.name} ${w.roomsWalked}`).join(' · ')}</div>
          )}
        </div>

        <div className="section card" style={{ marginTop: 0 }}>
        <h3>Rooms not yet walked</h3>
        {s.rooms.notWalked.length === 0 ? (
          <p className="muted">Every room has been walked.</p>
        ) : (
          groupRooms(s.rooms.notWalked).map((g) => (
            <div key={g.key} style={{ marginBottom: 10 }}>
              <div className="small" style={{ fontWeight: 600 }}>
                {g.label}
              </div>
              <div className="chips" style={{ marginTop: 4 }}>
                {g.rooms.map((r) => (
                  <Link key={r.id} className="chip" to={`/c/${campusId}/rooms/${r.id}`} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
                    {r.number} <span className="muted small" style={{ marginLeft: 4 }}>{r.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
        </div>

        <div className="stats">
          <div className="stat">
            <div className="v">{units.toLocaleString()}</div>
            <div className="k">asset units recorded</div>
          </div>
          <div className="stat">
            <div className="v" style={{ color: s.poorCondition.length ? 'var(--c1)' : undefined }}>
              {s.poorCondition.length}
            </div>
            <div className="k">in poor condition (≤ {s.poorConditionMax})</div>
          </div>
          <div className="stat">
            <div className="v">{s.rooms.notWalked.length}</div>
            <div className="k">rooms left to walk</div>
          </div>
        </div>
      </div>

      <div className="section card">
        <h3>Counts by type</h3>
        {s.countsByType.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Units</th>
              </tr>
            </thead>
            <tbody>
              {s.countsByType.map((t) => (
                <tr key={t.assetTypeId}>
                  <td>
                    {t.name} <span className={`badge cat-${t.category}`}>{t.category}</span>
                    <div className="bar" style={{ width: `${(100 * t.units) / maxUnits}%`, marginTop: 6 }} />
                  </td>
                  <td className="num">
                    {t.units.toLocaleString()}
                    {t.records !== t.units && <div className="small muted">{t.records} rec.</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section card">
        <h3>Poor condition</h3>
        {s.poorCondition.length === 0 ? (
          <p className="muted">Nothing rated {s.poorConditionMax} or below.</p>
        ) : (
          <ul className="list">
            {s.poorCondition.map((a) => (
              <li key={a.id}>
                <Link className="item" to={`/c/${campusId}/assets/${a.id}`} style={{ minHeight: 52, padding: '8px 12px' }}>
                  <ConditionDot value={a.condition} />
                  <div className="grow">
                    <div className="title">
                      {a.quantity > 1 && `${a.quantity} × `}
                      {a.assetType.name}
                      {a.label && <span className="muted"> · {a.label}</span>}
                    </div>
                    <div className="small muted">
                      {conditionLabel(a.condition)} · {placeOf(a)}
                      {a.notes && ` · ${a.notes}`}
                    </div>
                  </div>
                  <span className="chev">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CsvTools campusId={campusId} />
    </Page>
  );
}

const placeOf = (a: CampusSummary['poorCondition'][number]) =>
  a.room ? `${a.building.code} ${a.room.number} ${a.room.name}` : a.floor ? `${a.building.name} · ${a.floor.name}` : `${a.building.name} · building level`;

function groupRooms(rooms: CampusSummary['rooms']['notWalked']) {
  const groups = new Map<string, { key: string; label: string; rooms: typeof rooms }>();
  for (const r of rooms) {
    const key = `${r.building.id}/${r.floor.id}`;
    const g = groups.get(key) ?? { key, label: `${r.building.code} · ${r.building.name} · ${r.floor.name}`, rooms: [] };
    g.rooms.push(r);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Export both CSVs; import rooms from the same layout the rooms export uses. */
function CsvTools({ campusId }: { campusId: string }) {
  const importRooms = useImportRooms(campusId);
  const input = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    importRooms.mutate(await file.text());
    if (input.current) input.current.value = '';
  }

  return (
    <div className="section card stack">
      <h3>CSV</h3>
      <div className="btn-row">
        <a className="btn" href={`${API_URL}/campuses/${campusId}/assets.csv`} download>
          Export assets
        </a>
        <a className="btn" href={`${API_URL}/campuses/${campusId}/rooms.csv`} download>
          Export rooms
        </a>
        <label className="btn" style={{ cursor: 'pointer' }}>
          {importRooms.isPending ? <span className="spinner" /> : 'Import rooms…'}
          <input ref={input} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The rooms export is the import template. Existing rooms keep their assets and walk status; new buildings, floors and rooms are
        created. The whole file is checked first: any bad row means nothing is written.
      </p>
      {importRooms.isSuccess && (
        <div className="notice info small">
          Imported {importRooms.data.rows} rows: {importRooms.data.buildings.created} buildings, {importRooms.data.floors.created} floors,{' '}
          {importRooms.data.rooms.created} rooms created, {importRooms.data.rooms.updated} updated.
        </div>
      )}
      {importRooms.isError && <ErrorNotice error={importRooms.error} />}
    </div>
  );
}
