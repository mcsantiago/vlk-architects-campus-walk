import { conditionLabel } from '@campus-walk/shared';
import { Link, useNavigate, useParams } from 'react-router';
import { useDeletePhoto, usePhoto } from '../api/queries';
import { ErrorNotice, Loading, Page, formatWhen } from '../components/Page';
import { SuggestionNotice } from '../components/SuggestionNotice';

/** One photo, large, with what it is of and the model's note if there was one. */
export function PhotoPage() {
  const { campusId = '', photoId = '' } = useParams();
  const navigate = useNavigate();
  const photo = usePhoto(photoId);
  const remove = useDeletePhoto(photo.data?.assetId ?? undefined);

  if (photo.isPending)
    return (
      <Page title="Photo" back={`/c/${campusId}`}>
        <Loading />
      </Page>
    );
  if (photo.isError)
    return (
      <Page title="Photo" back={`/c/${campusId}`}>
        <ErrorNotice error={photo.error} onRetry={() => photo.refetch()} />
      </Page>
    );
  const p = photo.data;
  const back = p.asset
    ? `/c/${campusId}/assets/${p.asset.id}`
    : p.room
      ? `/c/${campusId}/rooms/${p.room.id}`
      : `/c/${campusId}`;
  const subject = p.asset
    ? `${p.asset.quantity > 1 ? `${p.asset.quantity} × ` : ''}${p.asset.assetType.name}${p.asset.label ? ` · ${p.asset.label}` : ''}`
    : p.room
      ? `${p.room.building.code} ${p.room.number} · ${p.room.name}`
      : 'Unattached photo';

  async function doDelete() {
    if (!confirm('Delete this photo? This cannot be undone.')) return;
    await remove.mutateAsync(p.id);
    navigate(back);
  }

  return (
    <Page title={subject} subtitle={`Photo · ${formatWhen(p.createdAt)}`} back={back}>
      <div className="stack">
        <a href={p.url} target="_blank" rel="noreferrer" className="photo-full">
          <img src={p.url} alt={subject} />
        </a>
        <div className="card stack" style={{ gap: 6 }}>
          {p.asset && (
            <Link to={`/c/${campusId}/assets/${p.asset.id}`} className="row">
              <span className="grow">
                Photo of <strong>{subject}</strong>, condition {p.asset.condition} ({conditionLabel(p.asset.condition)})
              </span>
              <span className="chev">›</span>
            </Link>
          )}
          {p.room && (
            <Link to={`/c/${campusId}/rooms/${p.room.id}`} className="row">
              <span className="grow">
                Photo of room <strong>{subject}</strong> · {p.room.building.name}, {p.room.floor.name}
              </span>
              <span className="chev">›</span>
            </Link>
          )}
          <div className="small muted">Taken {new Date(p.createdAt).toLocaleString()}</div>
        </div>
        {p.suggestion && <SuggestionNotice suggestion={p.suggestion} />}
        <button className="btn danger" disabled={remove.isPending} onClick={doDelete}>
          Delete photo
        </button>
        {remove.isError && <ErrorNotice error={remove.error} />}
      </div>
    </Page>
  );
}
