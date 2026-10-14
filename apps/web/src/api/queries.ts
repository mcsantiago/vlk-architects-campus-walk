import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssetCategoryView,
  AssetDetail,
  CopyAssetInput,
  PhotoDetail,
  AssetTypeView,
  AssetView,
  AssetWithPhotos,
  CampusSummary,
  CampusTree,
  CampusView,
  CreateAssetInput,
  CreateAssetTypeInput,
  UpdateAssetTypeInput,
  MoveAssetInput,
  RoomDetail,
  RoomHeader,
  RoomImportResult,
  UpdateAssetInput,
  UserView,
} from '@campus-walk/shared';
import { api } from './client';

export const keys = {
  users: ['users'] as const,
  campuses: ['campuses'] as const,
  assetTypes: ['asset-types'] as const,
  assetCategories: ['asset-categories'] as const,
  tree: (campusId: string) => ['tree', campusId] as const,
  room: (roomId: string) => ['room', roomId] as const,
  systems: (buildingId: string) => ['systems', buildingId] as const,
  asset: (assetId: string) => ['asset', assetId] as const,
  photo: (photoId: string) => ['photo', photoId] as const,
  summary: (campusId: string, buildingId?: string) => ['summary', campusId, buildingId ?? null] as const,
};

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api<UserView[]>('/users') });
export const useCampuses = () => useQuery({ queryKey: keys.campuses, queryFn: () => api<CampusView[]>('/campuses') });
export const useAssetTypes = () =>
  useQuery({ queryKey: keys.assetTypes, queryFn: () => api<AssetTypeView[]>('/asset-types'), staleTime: 5 * 60_000 });
/** Changes rarely and has no editor yet, so it is fetched once per session. */
export const useAssetCategories = () =>
  useQuery({ queryKey: keys.assetCategories, queryFn: () => api<AssetCategoryView[]>('/asset-categories'), staleTime: Infinity });
export const useTree = (campusId: string) =>
  useQuery({ queryKey: keys.tree(campusId), queryFn: () => api<CampusTree>(`/campuses/${campusId}/tree`) });
export const useRoom = (roomId: string) =>
  useQuery({ queryKey: keys.room(roomId), queryFn: () => api<RoomDetail>(`/rooms/${roomId}`) });
export const useSystems = (buildingId: string) =>
  useQuery({ queryKey: keys.systems(buildingId), queryFn: () => api<AssetWithPhotos[]>(`/buildings/${buildingId}/systems`) });
export const useAsset = (assetId: string) =>
  useQuery({ queryKey: keys.asset(assetId), queryFn: () => api<AssetDetail>(`/assets/${assetId}`) });
export const usePhoto = (photoId: string) =>
  useQuery({ queryKey: keys.photo(photoId), queryFn: () => api<PhotoDetail>(`/photos/${photoId}`) });
export const useSummary = (campusId: string, buildingId?: string) =>
  useQuery({
    queryKey: keys.summary(campusId, buildingId),
    queryFn: () => api<CampusSummary>(`/campuses/${campusId}/summary${buildingId ? `?buildingId=${buildingId}` : ''}`),
  });

/** Anything that touches an asset changes room lists, building systems, the tree counts and the summary. */
function useInvalidateAssets() {
  const qc = useQueryClient();
  return (assetId?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['room'] }),
      qc.invalidateQueries({ queryKey: ['systems'] }),
      qc.invalidateQueries({ queryKey: ['tree'] }),
      qc.invalidateQueries({ queryKey: ['summary'] }),
      assetId ? qc.invalidateQueries({ queryKey: keys.asset(assetId) }) : Promise.resolve(),
    ]);
}

/** Adds a type to the shared catalogue (or finds it by name) and drops it into the cached list at once. */
export function useCreateAssetType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAssetTypeInput) => api<AssetTypeView>('/asset-types', { method: 'POST', body: input }),
    onSuccess: (type) => {
      qc.setQueryData<AssetTypeView[]>(keys.assetTypes, (old) => old && (old.some((t) => t.id === type.id) ? old : [...old, type]));
      void qc.invalidateQueries({ queryKey: keys.assetTypes });
    },
  });
}

/** Recategorises or recounts a type; every listing shows the type's category, so they all refresh. */
export function useUpdateAssetType() {
  const qc = useQueryClient();
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateAssetTypeInput & { id: string }) => api<AssetTypeView>(`/asset-types/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (type) => {
      qc.setQueryData<AssetTypeView[]>(keys.assetTypes, (old) => old?.map((t) => (t.id === type.id ? type : t)));
      void qc.invalidateQueries({ queryKey: keys.assetTypes });
      void qc.invalidateQueries({ queryKey: ['asset'] });
      void invalidate();
    },
  });
}

export function useCreateAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (input: CreateAssetInput) => api<AssetView>('/assets', { method: 'POST', body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateAsset(assetId: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (input: UpdateAssetInput) => api<AssetView>(`/assets/${assetId}`, { method: 'PATCH', body: input }),
    // Refresh in the background: the save is done once the PATCH answers, and the edit page
    // holds navigation until then, so a slow refetch must not keep the walker waiting.
    onSuccess: () => {
      void invalidate(assetId);
    },
  });
}

export function useMoveAsset(assetId: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (input: MoveAssetInput) => api<AssetView>(`/assets/${assetId}/move`, { method: 'POST', body: input }),
    onSuccess: () => invalidate(assetId),
  });
}

export function useCopyAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: ({ assetId, to }: { assetId: string; to: CopyAssetInput }) =>
      api<AssetView>(`/assets/${assetId}/copy`, { method: 'POST', body: to }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteAsset(assetId: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (version: number) => api<void>(`/assets/${assetId}`, { method: 'DELETE', body: { version } }),
    // Lists are refetched; the deleted record's own cache entry is left alone (the page
    // navigates away, and touching it while still mounted would only trigger a 404 refetch).
    onSuccess: () => invalidate(),
  });
}

/** Works for asset photos and room photos alike: both listings are refetched. */
export function useDeletePhoto(assetId?: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (photoId: string) => api<void>(`/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(assetId),
  });
}

export function useSetWalked(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (walked: boolean) => api<RoomHeader>(`/rooms/${roomId}/walked`, { method: walked ? 'POST' : 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.room(roomId) }),
        qc.invalidateQueries({ queryKey: ['tree'] }),
        qc.invalidateQueries({ queryKey: ['summary'] }),
      ]),
  });
}

export function useImportRooms(campusId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) =>
      api<RoomImportResult>(`/campuses/${campusId}/rooms/import`, {
        method: 'POST',
        text: { body: csv, contentType: 'text/csv' },
      }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ['tree'] }), qc.invalidateQueries({ queryKey: ['summary'] })]),
  });
}
