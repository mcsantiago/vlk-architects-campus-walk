import { Link, useParams } from 'react-router';
import { useSystems, useTree } from '../api/queries';
import { AssetList } from '../components/AssetRow';
import { ErrorNotice, Loading, Page } from '../components/Page';

/** Assets with no room: building level (roof units) and floor level (corridor panels). */
export function SystemsPage() {
  const { campusId = '', buildingId = '' } = useParams();
  const tree = useTree(campusId);
  const systems = useSystems(buildingId);
  const back = `/c/${campusId}/buildings/${buildingId}`;
  const b = tree.data?.buildings.find((x) => x.id === buildingId);
  const title = b ? `${b.code} · Building systems` : 'Building systems';

  if (systems.isPending)
    return (
      <Page title={title} back={back}>
        <Loading />
      </Page>
    );
  if (systems.isError)
    return (
      <Page title={title} back={back}>
        <ErrorNotice error={systems.error} onRetry={() => systems.refetch()} />
      </Page>
    );

  const buildingLevel = systems.data.filter((a) => !a.floorId);
  const floors = b?.floors ?? [];
  return (
    <Page title={title} subtitle={b?.name} back={back}>
      <div className="section" style={{ marginTop: 0 }}>
        <h3>Building level</h3>
        <AssetList assets={buildingLevel} campusId={campusId} empty="Nothing recorded at building level yet." />
      </div>
      {floors.map((f) => {
        const rows = systems.data.filter((a) => a.floorId === f.id);
        if (rows.length === 0) return null;
        return (
          <div className="section" key={f.id}>
            <h3>{f.name} · floor level</h3>
            <AssetList assets={rows} campusId={campusId} empty="" />
          </div>
        );
      })}
      <div style={{ height: 72 }} />
      <Link className="btn primary fab" to={`/c/${campusId}/assets/new?buildingId=${buildingId}`}>
        + Add asset
      </Link>
    </Page>
  );
}
