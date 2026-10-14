import type { AssetView, CampusTree } from '@campus-walk/shared';
import { useEffect, useRef, useState } from 'react';
import { useCopyAsset } from '../api/queries';
import { locationBody } from './AssetFields';
import { LocationPicker, describeLocation, type Location } from './LocationPicker';
import { ErrorNotice } from './Page';

interface CopySheetProps {
  tree: CampusTree | undefined;
  /** The asset being copied; null closes the sheet. */
  asset: AssetView | null;
  onClose: () => void;
  onCopied: (copy: AssetView, to: Location) => void;
}

/** "Copy to…" bottom sheet: pick a building, floor and room, then copy. Opened from a room row or the asset screen. */
export function CopySheet({ tree, asset, onClose, onCopied }: CopySheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const copy = useCopyAsset();
  const [to, setTo] = useState<Location | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (asset) {
      setTo({ buildingId: asset.buildingId, floorId: asset.floorId, roomId: asset.roomId });
      copy.reset();
      if (!d.open) d.showModal();
    } else if (d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  async function doCopy() {
    if (!asset || !to) return;
    const made = await copy.mutateAsync({ assetId: asset.id, to: locationBody(to) });
    onCopied(made, to);
  }

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <div className="stack">
        <h2>Copy to…</h2>
        {asset && (
          <p className="muted small" style={{ margin: 0 }}>
            {asset.quantity > 1 && `${asset.quantity} × `}
            {asset.assetType.name}
            {asset.label && ` · ${asset.label}`}. Type, quantity, condition, label and notes are copied; photos and the serial number stay with the original.
          </p>
        )}
        {tree && to ? <LocationPicker tree={tree} value={to} onChange={setTo} /> : <p className="muted">Loading rooms…</p>}
        {copy.isError && <ErrorNotice error={copy.error} />}
        <div className="btn-row">
          <button className="btn primary" disabled={copy.isPending || !to} onClick={doCopy}>
            {copy.isPending ? <span className="spinner" /> : `Copy to ${to ? describeLocation(tree, to) : '…'}`}
          </button>
          <button className="btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
