import type { AiSuggestion } from './api.ts';
import type { AssetCategory, RoomType } from './domain.ts';

/**
 * Response shapes, as the API serialises them (dates are ISO strings). The API builds these
 * from its queries; the web app reads them. docs/api.md is the prose version of this file.
 */

export interface UserView {
  id: string;
  name: string;
  createdAt: string;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface AssetTypeView {
  id: string;
  name: string;
  category: AssetCategory;
  trackedIndividually: boolean;
}

/** Address and point of contact for a campus or building; every field may be null. */
export interface SiteInfo {
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface CampusView extends SiteInfo {
  id: string;
  name: string;
  district: string;
  createdAt: string;
}

export interface AssetView {
  id: string;
  buildingId: string;
  floorId: string | null;
  roomId: string | null;
  label: string | null;
  quantity: number;
  condition: number;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  assetType: AssetTypeView;
}

export interface PhotoView {
  id: string;
  assetId: string | null;
  roomId: string | null;
  /** Presigned GET, valid 15 minutes. */
  url: string;
  suggestion: AiSuggestion | null;
  createdAt: string;
}

export type AssetWithPhotos = AssetView & { photos: PhotoView[] };

export type AssetEventKind = 'created' | 'updated' | 'moved' | 'deleted';

export interface AssetEventView {
  id: string;
  kind: AssetEventKind;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedAt: string;
  changedBy: UserRef;
}

export type AssetDetail = AssetWithPhotos & { events: AssetEventView[] };

export interface RoomSummary {
  id: string;
  floorId: string;
  number: string;
  name: string;
  roomType: RoomType;
  walkedAt: string | null;
  walkedById: string | null;
  createdAt: string;
  walkedBy: UserRef | null;
}

export type TreeRoom = RoomSummary & { assetCount: number };

export interface TreeFloor {
  id: string;
  buildingId: string;
  name: string;
  level: number;
  createdAt: string;
  rooms: TreeRoom[];
}

export interface TreeBuilding extends SiteInfo {
  id: string;
  campusId: string;
  name: string;
  code: string;
  yearBuilt: number | null;
  createdAt: string;
  /** Building- and floor-level assets: everything with no room. */
  systemAssetCount: number;
  floors: TreeFloor[];
}

export type CampusTree = CampusView & {
  progress: { rooms: number; walked: number };
  buildings: TreeBuilding[];
};

export type RoomHeader = RoomSummary & {
  floor: { id: string; name: string; level: number };
  building: { id: string; name: string; code: string };
};

/** Room photos are of the room itself; asset photos ride on each asset. */
export type RoomDetail = RoomHeader & { photos: PhotoView[]; assets: AssetWithPhotos[] };

/** One photo with whatever it is attached to, for the photo screen. */
export type PhotoDetail = PhotoView & { asset: AssetView | null; room: RoomHeader | null };

export interface UploadTicket {
  key: string;
  url: string;
  expiresInSeconds: number;
}

export interface CampusSummary {
  campus: CampusView;
  buildingId: string | null;
  rooms: {
    total: number;
    walked: number;
    notWalked: Array<{
      id: string;
      number: string;
      name: string;
      roomType: RoomType;
      assetCount: number;
      floor: { id: string; name: string; level: number };
      building: { id: string; code: string; name: string };
    }>;
  };
  walkers: Array<{ user: UserRef; roomsWalked: number }>;
  countsByType: Array<{ assetTypeId: string; name: string; category: AssetCategory; records: number; units: number }>;
  poorCondition: Array<
    AssetView & {
      building: { id: string; code: string; name: string };
      floor: { id: string; name: string } | null;
      room: { id: string; number: string; name: string } | null;
    }
  >;
  poorConditionMax: number;
}

export interface RoomImportResult {
  rows: number;
  buildings: { created: number };
  floors: { created: number };
  rooms: { created: number; updated: number };
}

/** The error envelope every non-2xx response uses. */
export interface ApiErrorBody {
  error: string;
  details: unknown;
}
