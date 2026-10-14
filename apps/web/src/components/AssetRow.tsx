import { ASSET_CATEGORIES, conditionLabel, type AssetWithPhotos } from '@campus-walk/shared';
import { Link, useNavigate } from 'react-router';
import { ConditionDot } from './ConditionPicker';

export interface AssetRowActions {
  onCopy: (asset: AssetWithPhotos) => void;
  onDelete: (asset: AssetWithPhotos) => void;
}

/** One asset in a room or building listing. The row opens the asset; the buttons act on it in place. */
export function AssetRow({ asset, campusId, actions }: { asset: AssetWithPhotos; campusId: string; actions?: AssetRowActions }) {
  const navigate = useNavigate();
  const thumb = asset.photos[0];
  const href = `/c/${campusId}/assets/${asset.id}`;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <Link className="item" to={href} style={{ border: 0, borderRadius: 0 }}>
        {thumb ? (
          <img src={thumb.url} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
        ) : (
          <span className={`badge cat-${asset.assetType.category}`} style={{ flex: 'none' }}>
            {asset.assetType.category}
          </span>
        )}
        <div className="grow">
          <div className="title">
            {asset.quantity > 1 && `${asset.quantity} × `}
            {asset.assetType.name}
            {asset.label && <span className="muted"> · {asset.label}</span>}
          </div>
          <div className="small muted row" style={{ gap: 6 }}>
            <ConditionDot value={asset.condition} /> {conditionLabel(asset.condition)}
            {asset.notes && <span>· {asset.notes.length > 48 ? asset.notes.slice(0, 48) + '…' : asset.notes}</span>}
          </div>
        </div>
        <span className="chev">›</span>
      </Link>
      {actions && (
        <div className="row-actions">
          <button type="button" onClick={() => navigate(`${href}/edit`)}>
            ✎ Edit
          </button>
          <button type="button" onClick={() => actions.onCopy(asset)}>
            ⧉ Copy
          </button>
          <button type="button" className="danger" onClick={() => actions.onDelete(asset)}>
            ✕ Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** Assets grouped by category in the order a walker scans a room: furniture, technology, equipment, then systems. */
export function AssetList({
  assets,
  campusId,
  empty,
  actions,
}: {
  assets: AssetWithPhotos[];
  campusId: string;
  empty: string;
  actions?: AssetRowActions;
}) {
  if (assets.length === 0) return <p className="center">{empty}</p>;
  return (
    <div className="stack">
      {ASSET_CATEGORIES.map((g) => {
        const rows = assets.filter((a) => a.assetType.category === g);
        if (rows.length === 0) return null;
        return (
          <div key={g} className="section" style={{ marginTop: 8 }}>
            <h3>{g}</h3>
            <ul className="list">
              {rows.map((a) => (
                <li key={a.id}>
                  <AssetRow asset={a} campusId={campusId} actions={actions} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
