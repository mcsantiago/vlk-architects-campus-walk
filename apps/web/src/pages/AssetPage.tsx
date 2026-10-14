import { useQueryClient } from '@tanstack/react-query';
import type { AssetEventView, AssetView, CampusTree } from '@campus-walk/shared';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { keys, useAsset, useDeleteAsset, useMoveAsset, useTree } from '../api/queries';
import { locationBody } from '../components/AssetFields';
import { ConditionDot, describeCondition } from '../components/ConditionPicker';
import { useConfirm } from '../components/Confirm';
import { CopySheet } from '../components/CopySheet';
import { LocationPicker, describeLocation, type Location } from '../components/LocationPicker';
import { ErrorNotice, Loading, Page, formatWhen } from '../components/Page';

/** Asset detail: the photo large, the facts, and edit / move / copy / delete. Editing is its own screen. */
export function AssetPage() {
  const { campusId = '', assetId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const asset = useAsset(assetId);
  const tree = useTree(campusId);
  const move = useMoveAsset(assetId);
  const remove = useDeleteAsset(assetId);
  const [moveTo, setMoveTo] = useState<Location | null>(null);
  const [copying, setCopying] = useState<AssetView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const confirm = useConfirm();

  const a = asset.data;
  const back = a ? (a.roomId ? `/c/${campusId}/rooms/${a.roomId}` : `/c/${campusId}/buildings/${a.buildingId}/systems`) : `/c/${campusId}`;

  if (asset.isPending)
    return (
      <Page title="Asset" back={back}>
        <Loading />
      </Page>
    );
  if (asset.isError || !a)
    return (
      <Page title="Asset" back={back}>
        <ErrorNotice error={asset.error ?? new Error('asset not found')} />
      </Page>
    );

  const here: Location = { buildingId: a.buildingId, floorId: a.floorId, roomId: a.roomId };
  const [hero, ...rest] = a.photos;
  const title = `${a.quantity > 1 ? `${a.quantity} × ` : ''}${a.assetType.name}`;

  async function doMove() {
    if (!a || !moveTo) return;
    try {
      await move.mutateAsync({ version: a.version, ...locationBody(moveTo) });
      sheet.current?.close();
    } catch (e) {
      sheet.current?.close();
      if (e instanceof ApiError && e.status === 409) {
        setFlash('Someone else changed this asset first. Showing the latest version; try again.');
        void qc.invalidateQueries({ queryKey: keys.asset(assetId) });
      } else throw e;
    }
  }

  async function doDelete() {
    if (!a) return;
    if (!(await confirm({ title: `Delete ${title}${a.label ? ` (${a.label})` : ''}?`, detail: 'It leaves every list and roll-up. Its history is kept.', confirmLabel: 'Delete asset', danger: true }))) return;
    try {
      await remove.mutateAsync(a.version);
      navigate(back);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setFlash('Someone else changed this asset first. Showing the latest version; try again.');
      } else throw e;
    }
  }

  return (
    <Page title={title} subtitle={describeLocation(tree.data, here)} back={back}>
      <div className="stack">
        {hero ? (
          <Link to={`/c/${campusId}/photos/${hero.id}`} className="photo-full">
            <img src={hero.url} alt={title} />
          </Link>
        ) : (
          <Link to={`/c/${campusId}/assets/${a.id}/edit`} className="photo-btn" style={{ aspectRatio: '16 / 9' }}>
            <span style={{ fontSize: '1.6rem' }}>📷</span>
            <span className="small">No photo yet · add one</span>
          </Link>
        )}
        {rest.length > 0 && (
          <div className="photo-grid">
            {rest.map((p) => (
              <Link key={p.id} to={`/c/${campusId}/photos/${p.id}`} className="photo">
                <img src={p.url} alt="" />
              </Link>
            ))}
          </div>
        )}

        {flash && <div className="notice warn small">{flash}</div>}

        <div className="card">
          <dl className="facts">
            <dt>Type</dt>
            <dd>
              {a.assetType.name} <span className={`badge cat-${a.assetType.category}`}>{a.assetType.category}</span>
            </dd>
            <dt>Label</dt>
            <dd>{a.label ?? <span className="muted">none</span>}</dd>
            <dt>Quantity</dt>
            <dd>{a.quantity}{a.assetType.trackedIndividually && <span className="muted small"> · tracked one per record</span>}</dd>
            <dt>Condition</dt>
            <dd className="row" style={{ gap: 6 }}>
              <ConditionDot value={a.condition} /> {describeCondition(a.condition)}
              {a.condition === null && <span className="muted small">· on the inventory, not yet walked</span>}
            </dd>
            {(a.manufacturer || a.model) && (
              <>
                <dt>Make / model</dt>
                <dd>{[a.manufacturer, a.model].filter(Boolean).join(' ')}</dd>
              </>
            )}
            {a.serialNumber && (
              <>
                <dt>Serial</dt>
                <dd>{a.serialNumber}</dd>
              </>
            )}
            {a.installYear && (
              <>
                <dt>Installed</dt>
                <dd>{a.installYear}</dd>
              </>
            )}
            <dt>Location</dt>
            <dd>{describeLocation(tree.data, here)}</dd>
            <dt>Notes</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{a.notes ?? <span className="muted">none</span>}</dd>
            <dt>Updated</dt>
            <dd className="muted">{formatWhen(a.updatedAt)} · version {a.version}</dd>
          </dl>
        </div>

        <div className="btn-row">
          <Link className="btn primary" to={`/c/${campusId}/assets/${a.id}/edit`} style={{ minHeight: 56 }}>
            ✎ Edit
          </Link>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => {
              setMoveTo(here);
              sheet.current?.showModal();
            }}
          >
            Move…
          </button>
          <button className="btn" onClick={() => setCopying(a)}>
            Copy…
          </button>
          <button className="btn danger" disabled={remove.isPending} onClick={doDelete}>
            Delete
          </button>
        </div>
        {move.isError && !(move.error instanceof ApiError && move.error.status === 409) && <ErrorNotice error={move.error} />}
        {remove.isError && !(remove.error instanceof ApiError && remove.error.status === 409) && <ErrorNotice error={remove.error} />}

        <div className="card">
          <h3>History</h3>
          <ul className="history">
            {[...a.events].reverse().map((ev) => (
              <li key={ev.id}>
                <strong>{ev.changedBy.name}</strong> <span className="muted">{formatWhen(ev.changedAt)}</span>
                <div>{describeEvent(ev, tree.data, a.assetType.name)}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <dialog ref={sheet} className="sheet" onClose={() => setMoveTo(null)}>
        <div className="stack">
          <h2>Move to…</h2>
          {tree.data && moveTo ? <LocationPicker tree={tree.data} value={moveTo} onChange={setMoveTo} /> : <Loading />}
          <div className="btn-row">
            <button className="btn primary" disabled={move.isPending || !moveTo} onClick={doMove}>
              {move.isPending ? <span className="spinner" /> : 'Move here'}
            </button>
            <button className="btn" onClick={() => sheet.current?.close()}>
              Cancel
            </button>
          </div>
        </div>
      </dialog>

      <CopySheet
        tree={tree.data}
        asset={copying}
        onClose={() => setCopying(null)}
        onCopied={(copy, to) => {
          setCopying(null);
          setFlash(`Copied to ${describeLocation(tree.data, to)}.`);
          navigate(`/c/${campusId}/assets/${copy.id}`);
        }}
      />
    </Page>
  );
}

export function describeEvent(ev: AssetEventView, tree: CampusTree | undefined, typeName = ''): string {
  const snap = (s: Record<string, unknown> | null) => s as (Partial<AssetView> & Partial<Location>) | null;
  const before = snap(ev.before);
  const after = snap(ev.after);
  switch (ev.kind) {
    case 'created':
      return `Recorded${after?.quantity && after.quantity > 1 ? ` ${after.quantity} ×` : ''} ${after?.assetType?.name ?? typeName}, ${after?.condition == null ? 'not yet rated' : `condition ${after.condition}`}`;
    case 'deleted':
      return 'Deleted';
    case 'moved':
      return `Moved from ${describeLocation(tree, asLocation(before))} to ${describeLocation(tree, asLocation(after))}`;
    case 'updated': {
      const changes: string[] = [];
      if (before?.assetType?.id !== after?.assetType?.id) changes.push(`type ${before?.assetType?.name} → ${after?.assetType?.name}`);
      if (before?.quantity !== after?.quantity) changes.push(`quantity ${before?.quantity} → ${after?.quantity}`);
      if (before?.condition !== after?.condition) changes.push(`condition ${before?.condition ?? 'not rated'} → ${after?.condition ?? 'not rated'}`);
      if (before?.label !== after?.label) changes.push(`label ${before?.label ?? '—'} → ${after?.label ?? '—'}`);
      if (before?.notes !== after?.notes) changes.push('notes');
      return changes.length ? `Changed ${changes.join(', ')}` : 'Saved without changes';
    }
  }
}

const asLocation = (s: Partial<Location> | null): Location => ({
  buildingId: s?.buildingId ?? '',
  floorId: s?.floorId ?? null,
  roomId: s?.roomId ?? null,
});
