import { useQueryClient } from '@tanstack/react-query';
import { conditionLabel, type AssetView } from '@campus-walk/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { keys, useAsset, useAssetTypes, useDeletePhoto, useTree, useUpdateAsset } from '../api/queries';
import { AssetFields, type AssetFieldValues } from '../components/AssetFields';
import { describeLocation } from '../components/LocationPicker';
import { ErrorNotice, Loading, Page } from '../components/Page';
import { PhotoSection } from '../components/PhotoSection';
import { rememberType } from '../components/TypePicker';

const toFields = (a: AssetView): AssetFieldValues => ({
  assetTypeId: a.assetType.id,
  quantity: a.quantity,
  condition: a.condition,
  label: a.label ?? '',
  notes: a.notes ?? '',
});

/** Edit an asset's fields and photos. Saves carry the version we read; a 409 shows the other walker's changes. */
export function AssetEditPage() {
  const { campusId = '', assetId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const asset = useAsset(assetId);
  const tree = useTree(campusId);
  const types = useAssetTypes();
  const update = useUpdateAsset(assetId);
  const removePhoto = useDeletePhoto(assetId);

  const [fields, setFields] = useState<AssetFieldValues | null>(null);
  const [conflict, setConflict] = useState<AssetView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Load the form once; later background refetches must not clobber what the walker is typing.
  useEffect(() => {
    if (asset.data && !fields) setFields(toFields(asset.data));
  }, [asset.data, fields]);

  const a = asset.data;
  const back = `/c/${campusId}/assets/${assetId}`;

  async function save() {
    if (!a || !fields) return;
    if (!fields.assetTypeId) return setProblem('Pick what the asset is.');
    if (!fields.condition) return setProblem('Pick a condition.');
    setProblem(null);
    const type = types.data?.find((t) => t.id === fields.assetTypeId);
    try {
      await update.mutateAsync({
        version: a.version,
        assetTypeId: fields.assetTypeId,
        quantity: type?.trackedIndividually ? 1 : fields.quantity,
        condition: fields.condition,
        label: fields.label.trim() || null,
        notes: fields.notes.trim() || null,
      });
      rememberType(fields.assetTypeId);
      navigate(back);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(e.current as AssetView);
        void qc.invalidateQueries({ queryKey: keys.asset(assetId) });
      } else throw e;
    }
  }

  if (asset.isPending || !fields)
    return (
      <Page title="Edit asset" back={back}>
        {asset.isError ? <ErrorNotice error={asset.error} /> : <Loading />}
      </Page>
    );
  if (asset.isError || !a)
    return (
      <Page title="Edit asset" back={back}>
        <ErrorNotice error={asset.error ?? new Error('asset not found')} />
      </Page>
    );

  const dirty = JSON.stringify(fields) !== JSON.stringify(toFields(a));
  const lastChange = a.events[a.events.length - 1];

  return (
    <Page title="Edit asset" subtitle={describeLocation(tree.data, { buildingId: a.buildingId, floorId: a.floorId, roomId: a.roomId })} back={back}>
      <form
        className="stack"
        style={{ gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label>Photos</label>
          <PhotoSection
            photos={a.photos}
            subject={{ assetId: a.id }}
            onAdded={() => qc.invalidateQueries({ queryKey: keys.asset(assetId) })}
            onRemove={(p) => {
              if (confirm('Delete this photo?')) removePhoto.mutate(p.id);
            }}
            linkTo={(p) => `/c/${campusId}/photos/${p.id}`}
          />
        </div>

        {conflict && (
          <ConflictNotice
            theirs={conflict}
            mine={fields}
            who={lastChange?.changedBy.name}
            onUseTheirs={() => {
              setFields(toFields(conflict));
              setConflict(null);
            }}
          />
        )}

        <AssetFields types={types.data ?? []} value={fields} onChange={setFields} />

        {problem && <div className="notice warn">{problem}</div>}
        {update.isError && !(update.error instanceof ApiError && update.error.status === 409) && <ErrorNotice error={update.error} />}
        <div className="btn-row">
          <button className="btn primary" disabled={!dirty || update.isPending || !!conflict} style={{ minHeight: 56 }}>
            {update.isPending ? <span className="spinner" /> : 'Save changes'}
          </button>
          <button type="button" className="btn" onClick={() => navigate(back)}>
            {dirty ? 'Discard' : 'Back'}
          </button>
        </div>
      </form>
    </Page>
  );
}

function ConflictNotice({
  theirs,
  mine,
  who,
  onUseTheirs,
}: {
  theirs: AssetView;
  mine: AssetFieldValues;
  who: string | undefined;
  onUseTheirs: () => void;
}) {
  const diffs: string[] = [];
  if (theirs.assetType.id !== mine.assetTypeId) diffs.push(`type → ${theirs.assetType.name}`);
  if (theirs.quantity !== mine.quantity) diffs.push(`quantity → ${theirs.quantity}`);
  if (theirs.condition !== mine.condition) diffs.push(`condition → ${theirs.condition} (${conditionLabel(theirs.condition)})`);
  if ((theirs.label ?? '') !== mine.label) diffs.push(`label → ${theirs.label ?? '(none)'}`);
  if ((theirs.notes ?? '') !== mine.notes) diffs.push(`notes → ${theirs.notes ?? '(none)'}`);
  return (
    <div className="notice warn stack" style={{ gap: 6 }}>
      <strong>Updated by {who ?? 'someone else'} while you were editing.</strong>
      <span className="small">
        Their version{diffs.length ? `: ${diffs.join(' · ')}` : ' moved or changed the asset'}. Load it, then re-apply what you still want.
      </span>
      <button type="button" className="btn sm" onClick={onUseTheirs} style={{ alignSelf: 'flex-start' }}>
        Load their version
      </button>
    </div>
  );
}
