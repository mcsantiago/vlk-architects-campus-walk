import { ASSET_CATEGORIES, type AssetCategory, type AssetTypeView } from '@campus-walk/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { describeError } from '../api/client';
import { keys, useCreateAssetType, useUpdateAssetType } from '../api/queries';

const categoryLabel = (c: AssetCategory) => c[0]!.toUpperCase() + c.slice(1);
/** Furniture is counted; anything else gets one record per unit unless the walker says otherwise. */
const defaultTracking = (c: AssetCategory) => c !== 'furniture';

interface Draft {
  category: AssetCategory;
  trackedIndividually: boolean;
}

/** Category chips and the counted / one-per-unit switch, shared by "new type" and "change type". */
function TypeSettings({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  return (
    <>
      <div className="chips">
        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`chip${value.category === cat ? ' selected' : ''}`}
            aria-pressed={value.category === cat}
            onClick={() => onChange({ category: cat, trackedIndividually: defaultTracking(cat) })}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </div>
      <label className="check small">
        <input type="checkbox" checked={value.trackedIndividually} onChange={(e) => onChange({ ...value, trackedIndividually: e.target.checked })} />
        <span>
          One record per unit, each with its own condition and photos.
          <span className="muted"> Untick for things that are counted, like chairs.</span>
        </span>
      </label>
    </>
  );
}

interface TypePickerProps {
  types: AssetTypeView[];
  value: string | null;
  onChange: (id: string) => void;
}

/**
 * A combobox over the shared catalogue: tap to see every type grouped by category, type to
 * filter. Filtering is in memory on the phone; the list comes from one GET, cached, and is
 * refreshed in the background each time the dropdown opens. When nothing matches, the walker
 * adds the type from here, with category and counting chosen inline, and it is selected as
 * soon as it is saved. The selected type's category can be changed from here too: category
 * belongs to the type, so that moves every asset of the type at once.
 */
export function TypePicker({ types, value, onChange }: TypePickerProps) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Settings being changed on the selected type, or null when not editing. */
  const [editing, setEditing] = useState<Draft | null>(null);
  const create = useCreateAssetType();
  const update = useUpdateAssetType();

  const selected = types.find((t) => t.id === value) ?? null;

  const name = query.trim();
  const q = name.toLowerCase();
  const matches = q ? types.filter((t) => t.name.toLowerCase().includes(q)) : types;
  const exact = q ? types.find((t) => t.name.toLowerCase() === q) : undefined;
  const groups = ASSET_CATEGORIES.map((cat) => ({ cat, items: matches.filter((t) => t.category === cat) })).filter((g) => g.items.length);

  function show() {
    setOpen(true);
    setDraft(null);
    setEditing(null);
    void qc.invalidateQueries({ queryKey: keys.assetTypes });
  }

  /** Closing also drops focus, so the next tap on the field is a focus and reopens the list. */
  function close() {
    setOpen(false);
    setQuery('');
    input.current?.blur();
  }

  function pick(id: string) {
    onChange(id);
    close();
    setDraft(null);
    create.reset();
  }

  function startDraft() {
    setOpen(false);
    setDraft({ category: 'equipment', trackedIndividually: true });
  }

  async function add() {
    if (!draft || !name) return;
    const type = await create.mutateAsync({ name, ...draft });
    pick(type.id);
  }

  async function saveSettings() {
    if (!selected || !editing) return;
    await update.mutateAsync({ id: selected.id, ...editing });
    setEditing(null);
  }

  const showing = open || draft !== null;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="combo">
        <input
          ref={input}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={selected ? 'Choose another…' : 'Choose or type a type…'}
          value={showing ? query : (selected?.name ?? '')}
          onFocus={show}
          onClick={() => {
            if (!showing) show();
          }}
          onBlur={() => {
            if (!draft) close();
          }}
          onChange={(e) => {
            // If a keystroke lands while the list is closed, the field held the selected name.
            const v = e.target.value;
            setQuery(!showing && selected && v.startsWith(selected.name) ? v.slice(selected.name.length) : v);
            setOpen(true);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return close();
            // Enter picks the obvious match instead of submitting the whole asset form.
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const only = exact ?? (q && matches.length === 1 ? matches[0] : undefined);
            if (only) pick(only.id);
            else if (name) startDraft();
          }}
        />
        <button
          type="button"
          className="combo-toggle"
          aria-label={open ? 'Hide types' : 'Show all types'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : show())}
        >
          {open ? '▴' : '▾'}
        </button>
        {open && (
          // mousedown is swallowed so the input keeps focus and the click lands before any blur.
          <div className="options drop" onMouseDown={(e) => e.preventDefault()}>
            {groups.map((g) => (
              <div key={g.cat}>
                <div className="option-group">{categoryLabel(g.cat)}</div>
                {g.items.map((t) => (
                  <button key={t.id} type="button" className={`option${t.id === value ? ' selected' : ''}`} onClick={() => pick(t.id)}>
                    <span className="grow">{t.name}</span>
                    {t.id === value && <span className="small">✓</span>}
                  </button>
                ))}
              </div>
            ))}
            {name && !exact && (
              <button type="button" className="option add" onClick={startDraft}>
                + Add “{name}” as a new type
              </button>
            )}
            {!name && groups.length === 0 && <div className="option muted">No types yet. Type a name to add one.</div>}
          </div>
        )}
      </div>
      {draft && (
        <div className="card stack" style={{ gap: 10 }}>
          <strong>New type: {name}</strong>
          <TypeSettings value={draft} onChange={setDraft} />
          {create.isError && <div className="notice error small">{describeError(create.error)}</div>}
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={create.isPending} onClick={add}>
              {create.isPending ? <span className="spinner" /> : 'Add type'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(null);
                setQuery('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {selected && !showing && !editing && (
        <div className="row small muted" style={{ gap: 8 }}>
          <span className="grow">
            {categoryLabel(selected.category)} · {selected.trackedIndividually ? 'one record per unit' : 'counted'}
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              update.reset();
              setEditing({ category: selected.category, trackedIndividually: selected.trackedIndividually });
            }}
          >
            Change…
          </button>
        </div>
      )}
      {selected && editing && (
        <div className="card stack" style={{ gap: 10 }}>
          <strong>{selected.name}</strong>
          <span className="small muted">This changes the type itself: every {selected.name} on every campus follows.</span>
          <TypeSettings value={editing} onChange={setEditing} />
          {update.isError && <div className="notice error small">{describeError(update.error)}</div>}
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={update.isPending || (editing.category === selected.category && editing.trackedIndividually === selected.trackedIndividually)}
              onClick={saveSettings}
            >
              {update.isPending ? <span className="spinner" /> : 'Save type'}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
