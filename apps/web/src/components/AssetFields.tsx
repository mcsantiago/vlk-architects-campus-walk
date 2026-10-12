import type { AssetTypeView } from '@campus-walk/shared';
import { ConditionPicker } from './ConditionPicker';
import { Stepper } from './Stepper';
import { TypePicker } from './TypePicker';

/** The editable part of an asset, as the form holds it (strings for text, null for "not chosen yet"). */
export interface AssetFieldValues {
  assetTypeId: string | null;
  quantity: number;
  condition: number | null;
  label: string;
  notes: string;
}

export const emptyFields: AssetFieldValues = { assetTypeId: null, quantity: 1, condition: null, label: '', notes: '' };

interface AssetFieldsProps {
  types: AssetTypeView[];
  value: AssetFieldValues;
  onChange: (v: AssetFieldValues) => void;
}

/** Shared by "add asset" and "edit asset": type, quantity (when the type is counted), condition, label, notes. */
export function AssetFields({ types, value, onChange }: AssetFieldsProps) {
  const type = types.find((t) => t.id === value.assetTypeId);
  const set = <K extends keyof AssetFieldValues>(k: K, v: AssetFieldValues[K]) => onChange({ ...value, [k]: v });

  return (
    <>
      <div className="field">
        <label>What is it?</label>
        <TypePicker
          types={types}
          value={value.assetTypeId}
          onChange={(id) => {
            const t = types.find((x) => x.id === id);
            onChange({ ...value, assetTypeId: id, quantity: t?.trackedIndividually ? 1 : value.quantity });
          }}
        />
      </div>

      <div className="field">
        <label>
          How many?
          {type?.trackedIndividually && <span className="muted small"> · {type.name} is tracked one per record</span>}
        </label>
        <Stepper value={value.quantity} onChange={(q) => set('quantity', q)} disabled={type?.trackedIndividually ?? false} />
      </div>

      <div className="field">
        <label>Condition</label>
        <ConditionPicker value={value.condition} onChange={(c) => set('condition', c)} />
      </div>

      <div className="field">
        <label>
          Label <span className="muted small">· optional tag, e.g. RTU-3 or asset sticker</span>
        </label>
        <input className="input" value={value.label} maxLength={80} onChange={(e) => set('label', e.target.value)} />
      </div>

      <div className="field">
        <label>
          Notes <span className="muted small">· optional</span>
        </label>
        <textarea className="input" value={value.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </>
  );
}

/** Which of the location ids to send: the most specific one, and the server fills in the rest. */
export function locationBody(loc: { buildingId: string; floorId: string | null; roomId: string | null }) {
  if (loc.roomId) return { roomId: loc.roomId };
  if (loc.floorId) return { floorId: loc.floorId };
  return { buildingId: loc.buildingId };
}
