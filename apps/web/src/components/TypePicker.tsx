import { ASSET_CATEGORIES, type AssetTypeView } from '@campus-walk/shared';
import { readPref, writePref } from '../user';

const RECENT_KEY = 'recent-types';
const RECENT_MAX = 6;

export function rememberType(id: string): void {
  const recent = readPref<string[]>(RECENT_KEY, []).filter((r) => r !== id);
  writePref(RECENT_KEY, [id, ...recent].slice(0, RECENT_MAX));
}

interface TypePickerProps {
  types: AssetTypeView[];
  value: string | null;
  onChange: (id: string) => void;
}

/**
 * Recently used types as chips (a walker records the same few things room after room), with
 * the full catalogue in a native select underneath, which is the best picker a phone has.
 */
export function TypePicker({ types, value, onChange }: TypePickerProps) {
  const recent = readPref<string[]>(RECENT_KEY, [])
    .map((id) => types.find((t) => t.id === id))
    .filter((t): t is AssetTypeView => !!t);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {recent.length > 0 && (
        <div className="chips">
          {recent.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip${value === t.id ? ' selected' : ''}`}
              onClick={() => onChange(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Choose a type…
        </option>
        {ASSET_CATEGORIES.map((cat) => (
          <optgroup key={cat} label={cat[0]!.toUpperCase() + cat.slice(1)}>
            {types
              .filter((t) => t.category === cat)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
