import { useQueryClient } from '@tanstack/react-query';
import { conditionLabel, type AssetView } from '@campus-walk/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { keys, useAsset, useAssetTypes, useDeletePhoto, useTree, useUpdateAsset } from '../api/queries';
import { AssetFields, type AssetFieldValues } from '../components/AssetFields';
import { useConfirm } from '../components/Confirm';
import { useUnsavedChangesGuard } from '../components/UnsavedChanges';
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

/** Only the five editable fields; label and notes are saved trimmed, so whitespace alone is not a change. */
const sameFields = (x: AssetFieldValues, y: AssetFieldValues) =>
  x.assetTypeId === y.assetTypeId &&
  x.quantity === y.quantity &&
  x.condition === y.condition &&
  x.label.trim() === y.label.trim() &&
  x.notes.trim() === y.notes.trim();

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
  const confirm = useConfirm();

  const [fields, setFields] = useState<AssetFieldValues | null>(null);
  /**
   * What the form was loaded from, fixed for the editing session: the comparison for "unsaved"
   * and the version the save carries. A background refetch must not move either, or a save
   * could carry a newer version than the walker read and overwrite someone else's change.
   * Only "Load their version" after a 409 replaces it.
   */
  const [baseline, setBaseline] = useState<{ fields: AssetFieldValues; version: number } | null>(null);
  const [conflict, setConflict] = useState<AssetView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [photosChanged, setPhotosChanged] = useState(false);
  // isPending only updates on the next render; two quick taps both see false. This does not.
  const saving = useRef(false);
  // A save that returns after the page is gone (walker switched) must not navigate anywhere.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load the form once; later background refetches must not clobber what the walker is typing.
  useEffect(() => {
    if (asset.data && !baseline) {
      const loaded = toFields(asset.data);
      setFields(loaded);
      setBaseline({ fields: loaded, version: asset.data.version });
    }
  }, [asset.data, baseline]);

  const dirty = !!fields && !!baseline && !sameFields(fields, baseline.fields);
  const { allowNextNavigation } = useUnsavedChangesGuard({
    dirty,
    busy: saving,
    note: photosChanged ? 'Photos you added or removed are already saved and stay as they are.' : undefined,
  });

  const a = asset.data;
  const back = `/c/${campusId}/assets/${assetId}`;

  async function save() {
    if (!a || !fields || !baseline || saving.current) return;
    if (!fields.assetTypeId) return setProblem('Pick what the asset is.');
    if (!fields.condition) return setProblem('Pick a condition.');
    setProblem(null);
    const type = types.data?.find((t) => t.id === fields.assetTypeId);
    saving.current = true;
    try {
      await update.mutateAsync({
        version: baseline.version,
        assetTypeId: fields.assetTypeId,
        quantity: type?.trackedIndividually ? 1 : fields.quantity,
        condition: fields.condition,
        label: fields.label.trim() || null,
        notes: fields.notes.trim() || null,
      });
      rememberType(fields.assetTypeId);
      // Saved: the form is about to unmount, so its pre-save dirty flag must not block this.
      if (!mounted.current) return;
      allowNextNavigation();
      navigate(back);
    } catch (e) {
      // The save is over; from here the usual dirty guard applies, not the in-flight hold.
      saving.current = false;
      if (e instanceof ApiError && e.status === 409) {
        // Refetch first so the notice can name who changed it (from the asset's history).
        await qc.invalidateQueries({ queryKey: keys.asset(assetId) });
        setConflict(e.current as AssetView);
      }
      // Anything else is shown from update.error; the values and the guard stay as they are.
    } finally {
      saving.current = false;
    }
  }

  if (asset.isPending || !fields || !baseline)
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
            onAdded={() => {
              setPhotosChanged(true);
              void qc.invalidateQueries({ queryKey: keys.asset(assetId) });
            }}
            onRemove={async (p) => {
              if (await confirm({ title: 'Delete this photo?', confirmLabel: 'Delete photo', danger: true }))
                removePhoto.mutate(p.id, { onSuccess: () => setPhotosChanged(true) });
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
              // Their version becomes the new starting point: clean form, their version number.
              const theirs = toFields(conflict);
              setFields(theirs);
              setBaseline({ fields: theirs, version: conflict.version });
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
