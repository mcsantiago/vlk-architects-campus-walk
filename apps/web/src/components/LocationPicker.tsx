import type { CampusTree } from '@campus-walk/shared';

export interface Location {
  buildingId: string;
  floorId: string | null;
  roomId: string | null;
}

/** "Which building, which floor, which room" with building- and floor-level as explicit options. */
export function LocationPicker({ tree, value, onChange }: { tree: CampusTree; value: Location; onChange: (l: Location) => void }) {
  const building = tree.buildings.find((b) => b.id === value.buildingId) ?? tree.buildings[0];
  if (!building) return <p className="muted">No buildings yet.</p>;
  const floor = building.floors.find((f) => f.id === value.floorId) ?? null;

  return (
    <div className="stack">
      <div className="field">
        <label>Building</label>
        <select
          className="input"
          value={building.id}
          onChange={(e) => onChange({ buildingId: e.target.value, floorId: null, roomId: null })}
        >
          {tree.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Floor</label>
        <select
          className="input"
          value={floor?.id ?? ''}
          onChange={(e) => onChange({ buildingId: building.id, floorId: e.target.value || null, roomId: null })}
        >
          <option value="">Building level (roof, exterior, whole building)</option>
          {building.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      {floor && (
        <div className="field">
          <label>Room</label>
          <select
            className="input"
            value={value.roomId ?? ''}
            onChange={(e) => onChange({ buildingId: building.id, floorId: floor.id, roomId: e.target.value || null })}
          >
            <option value="">Floor level (corridor, stairwell)</option>
            {floor.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} · {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function describeLocation(tree: CampusTree | undefined, loc: Location): string {
  const b = tree?.buildings.find((x) => x.id === loc.buildingId);
  if (!b) return '…';
  const f = b.floors.find((x) => x.id === loc.floorId);
  if (!f) return `${b.name} · building level`;
  const r = f.rooms.find((x) => x.id === loc.roomId);
  return r ? `${b.code} ${r.number} · ${r.name}` : `${b.name} · ${f.name} · floor level`;
}
