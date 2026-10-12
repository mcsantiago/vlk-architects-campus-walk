import type { AiSuggestion, PhotoView } from '@campus-walk/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useAssetTypes, useCreateAsset, useTree } from '../api/queries';
import { AssetFields, emptyFields, locationBody, type AssetFieldValues } from '../components/AssetFields';
import { LocationPicker, describeLocation, type Location } from '../components/LocationPicker';
import { ErrorNotice, Loading, Page } from '../components/Page';
import { PhotoSection } from '../components/PhotoSection';
import { SuggestionNotice } from '../components/SuggestionNotice';
import { rememberType } from '../components/TypePicker';

/**
 * Add an asset where the walker is standing. The photo comes first because the suggestion
 * pre-fills the rest; everything the model proposes can be overridden before saving.
 */
export function AssetNewPage() {
  const { campusId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tree = useTree(campusId);
  const types = useAssetTypes();
  const create = useCreateAsset();

  const [loc, setLoc] = useState<Location | null>(null);
  const [editLoc, setEditLoc] = useState(false);
  const [fields, setFields] = useState<AssetFieldValues>(emptyFields);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Resolve ?roomId / ?floorId / ?buildingId into a full location once the tree is here.
  useEffect(() => {
    if (!tree.data || loc) return;
    const roomId = params.get('roomId');
    const floorId = params.get('floorId');
    const buildingId = params.get('buildingId');
    for (const b of tree.data.buildings) {
      for (const f of b.floors) {
        if (f.id === floorId) return setLoc({ buildingId: b.id, floorId: f.id, roomId: null });
        const r = f.rooms.find((x) => x.id === roomId);
        if (r) return setLoc({ buildingId: b.id, floorId: f.id, roomId: r.id });
      }
      if (b.id === buildingId) return setLoc({ buildingId: b.id, floorId: null, roomId: null });
    }
    const first = tree.data.buildings[0];
    if (first) setLoc({ buildingId: first.id, floorId: null, roomId: null });
  }, [tree.data, params, loc]);

  const back = loc?.roomId
    ? `/c/${campusId}/rooms/${loc.roomId}`
    : loc
      ? `/c/${campusId}/buildings/${loc.buildingId}/systems`
      : `/c/${campusId}`;

  function onPhotoAdded(photo: PhotoView) {
    setPhotos((p) => [...p, photo]);
    const s = photo.suggestion;
    if (!s) return;
    setSuggestion(s);
    // Fill only what the walker has not touched yet.
    setFields((f) => ({
      ...f,
      assetTypeId: f.assetTypeId ?? s.assetTypeId,
      condition: f.condition ?? s.condition,
      notes: f.notes || s.note,
    }));
  }

  async function save() {
    if (!loc) return;
    if (!fields.assetTypeId) return setProblem('Pick what the asset is.');
    if (!fields.condition) return setProblem('Pick a condition.');
    setProblem(null);
    const type = types.data?.find((t) => t.id === fields.assetTypeId);
    await create.mutateAsync({
      ...locationBody(loc),
      assetTypeId: fields.assetTypeId,
      quantity: type?.trackedIndividually ? 1 : fields.quantity,
      condition: fields.condition,
      label: fields.label.trim() || null,
      notes: fields.notes.trim() || null,
      photoIds: photos.map((p) => p.id),
    });
    rememberType(fields.assetTypeId);
    navigate(back);
  }

  if (tree.isPending || types.isPending || !loc)
    return (
      <Page title="Add asset" back={back}>
        {tree.isError ? <ErrorNotice error={tree.error} /> : types.isError ? <ErrorNotice error={types.error} /> : <Loading />}
      </Page>
    );
  if (types.isError)
    return (
      <Page title="Add asset" back={back}>
        <ErrorNotice error={types.error} onRetry={() => types.refetch()} />
      </Page>
    );

  return (
    <Page title="Add asset" subtitle={describeLocation(tree.data, loc)} back={back}>
      <form
        className="stack"
        style={{ gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label>Photo</label>
          <PhotoSection photos={photos} subject={null} onAdded={onPhotoAdded} onRemove={(p) => setPhotos((ps) => ps.filter((x) => x.id !== p.id))} />
          {suggestion && <SuggestionNotice suggestion={suggestion} />}
        </div>

        <AssetFields types={types.data ?? []} value={fields} onChange={setFields} />

        <div className="field">
          <label className="row between">
            <span>Location</span>
            <button type="button" className="btn sm" onClick={() => setEditLoc((v) => !v)}>
              {editLoc ? 'Done' : 'Change'}
            </button>
          </label>
          {editLoc ? (
            <LocationPicker tree={tree.data!} value={loc} onChange={setLoc} />
          ) : (
            <div className="muted">{describeLocation(tree.data, loc)}</div>
          )}
        </div>

        {problem && <div className="notice warn">{problem}</div>}
        {create.isError && <ErrorNotice error={create.error} />}
        <button className="btn primary block" disabled={create.isPending} style={{ minHeight: 56 }}>
          {create.isPending ? <span className="spinner" /> : 'Save asset'}
        </button>
      </form>
    </Page>
  );
}
