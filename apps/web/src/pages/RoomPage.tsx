import { useQueryClient } from '@tanstack/react-query';
import type { AssetWithPhotos, RoomDetail } from '@campus-walk/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, describeError } from '../api/client';
import { keys, useDeletePhoto, useRoom, useSetWalked, useTree } from '../api/queries';
import { AssetList } from '../components/AssetRow';
import { useConfirm } from '../components/Confirm';
import { CopySheet } from '../components/CopySheet';
import { describeLocation } from '../components/LocationPicker';
import { ErrorNotice, Loading, Page, formatWhen } from '../components/Page';
import { PhotoSection } from '../components/PhotoSection';

/** Room detail: walk status, photos of the room, and its assets with edit / copy / delete in place. */
export function RoomPage() {
  const { campusId = '', roomId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const room = useRoom(roomId);
  const tree = useTree(campusId);
  const walked = useSetWalked(roomId);
  const removePhoto = useDeletePhoto();
  const confirm = useConfirm();
  const [copying, setCopying] = useState<AssetWithPhotos | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (room.isPending)
    return (
      <Page title="Room" back={`/c/${campusId}`}>
        <Loading />
      </Page>
    );
  if (room.isError)
    return (
      <Page title="Room" back={`/c/${campusId}`}>
        <ErrorNotice error={room.error} onRetry={() => room.refetch()} />
      </Page>
    );
  const r = room.data;
  const back = `/c/${campusId}/buildings/${r.building.id}`;
  const refreshRoom = () => qc.invalidateQueries({ queryKey: keys.room(roomId) });

  async function markWalked() {
    await walked.mutateAsync(true);
    navigate(back);
  }

  async function deleteAsset(a: AssetWithPhotos) {
    const name = `${a.quantity > 1 ? `${a.quantity} × ` : ''}${a.assetType.name}${a.label ? ` (${a.label})` : ''}`;
    if (!(await confirm({ title: `Delete ${name}?`, detail: 'It leaves this room and every roll-up. Its history is kept.', confirmLabel: 'Delete asset', danger: true }))) return;
    setProblem(null);
    try {
      await api<void>(`/assets/${a.id}`, { method: 'DELETE', body: { version: a.version } });
      // Drop the row at once; the refetch below confirms it.
      qc.setQueryData<RoomDetail>(keys.room(roomId), (old) => old && { ...old, assets: old.assets.filter((x) => x.id !== a.id) });
      await Promise.all([refreshRoom(), qc.invalidateQueries({ queryKey: ['tree'] }), qc.invalidateQueries({ queryKey: ['summary'] })]);
    } catch (e) {
      setProblem(describeError(e));
      await refreshRoom();
    }
  }

  return (
    <Page title={`${r.number} · ${r.name}`} subtitle={`${r.building.code} ${r.building.name} · ${r.floor.name} · ${r.roomType}`} back={back}>
      <div className="stack">
        <div className="card stack" style={{ gap: 10 }}>
          {r.walkedAt ? (
            <>
              <div className="row">
                <span className="badge ok">walked</span>
                <span className="grow">
                  {r.walkedBy?.name ?? 'Someone'}, {formatWhen(r.walkedAt)}
                </span>
                <button className="btn sm" disabled={walked.isPending} onClick={() => walked.mutate(false)}>
                  Clear
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <span className="badge">not walked</span>
                <span className="grow muted small">
                  {r.assets.length === 0 ? 'Record what is in the room, then mark it walked.' : 'Done recording? Mark it and move on.'}
                </span>
              </div>
              <button className="btn primary block" disabled={walked.isPending} onClick={markWalked}>
                {walked.isPending ? <span className="spinner" /> : '✓ Mark room walked'}
              </button>
            </>
          )}
          {walked.isError && <ErrorNotice error={walked.error} />}
        </div>

        <div className="section" style={{ marginTop: 4 }}>
          <h3>Room photos · {r.photos.length}</h3>
          <PhotoSection
            photos={r.photos}
            subject={{ roomId }}
            onAdded={refreshRoom}
            onRemove={async (p) => {
              if (await confirm({ title: 'Delete this photo of the room?', confirmLabel: 'Delete photo', danger: true })) removePhoto.mutate(p.id);
            }}
            linkTo={(p) => `/c/${campusId}/photos/${p.id}`}
          />
        </div>

        <div className="section" style={{ marginTop: 4 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Assets · {r.assets.length}</h3>
            <Link className="btn primary sm" to={`/c/${campusId}/assets/new?roomId=${roomId}`}>
              + Add asset
            </Link>
          </div>
          {flash && <div className="notice info small" style={{ marginBottom: 8 }}>{flash}</div>}
          {problem && <div className="notice error small" style={{ marginBottom: 8 }}>{problem}</div>}
          <AssetList
            assets={r.assets}
            campusId={campusId}
            empty="Nothing recorded in this room yet."
            actions={{ onCopy: setCopying, onDelete: deleteAsset }}
          />
        </div>
      </div>

      <div style={{ height: 72 }} />
      <Link className="btn primary fab" to={`/c/${campusId}/assets/new?roomId=${roomId}`}>
        + Add asset
      </Link>

      <CopySheet
        tree={tree.data}
        asset={copying}
        onClose={() => setCopying(null)}
        onCopied={(copy, to) => {
          setCopying(null);
          setFlash(`Copied ${copy.assetType.name} to ${describeLocation(tree.data, to)}.`);
          setTimeout(() => setFlash(null), 4000);
        }}
      />
    </Page>
  );
}
