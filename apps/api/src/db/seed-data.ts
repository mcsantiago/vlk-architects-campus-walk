import type { AssetCategory, RoomType } from '@campus-walk/shared';

/**
 * A fictional K-8 campus: a two-story classroom building, a gym/cafeteria, an admin
 * building and a portables cluster. 36 rooms. Roughly 40% of the campus is already walked
 * so the office summary is populated on first load; one room has assets but is not yet
 * marked walked, to show the two states are independent.
 */

export interface AssetSpec {
  type: string;
  qty?: number;
  condition: number;
  label?: string;
  notes?: string;
}
export interface Walk {
  by: string;
  daysAgo: number;
}
export interface RoomSpec {
  number: string;
  name: string;
  type: RoomType;
  walked?: Walk;
  assets?: AssetSpec[];
}
export interface FloorSpec {
  name: string;
  level: number;
  rooms: RoomSpec[];
  /** Floor-level assets, e.g. a corridor fire alarm panel. */
  assets?: AssetSpec[];
}
export interface BuildingSpec {
  code: string;
  name: string;
  yearBuilt: number;
  /** Who recorded this building's systems and any room assets without their own walk. */
  walker: string;
  floors: FloorSpec[];
  /** Building-level assets, e.g. rooftop HVAC. */
  assets?: AssetSpec[];
}
export interface CampusSpec {
  name: string;
  district: string;
  buildings: BuildingSpec[];
}

export const ASSET_TYPES: { name: string; category: AssetCategory; trackedIndividually: boolean }[] = [
  // Furniture is counted: 24 desks are one record with quantity 24.
  { name: 'Student Desk', category: 'furniture', trackedIndividually: false },
  { name: 'Student Chair', category: 'furniture', trackedIndividually: false },
  { name: 'Teacher Desk', category: 'furniture', trackedIndividually: false },
  { name: 'Task Chair', category: 'furniture', trackedIndividually: false },
  { name: 'Table', category: 'furniture', trackedIndividually: false },
  { name: 'Cafeteria Table', category: 'furniture', trackedIndividually: false },
  { name: 'Bookshelf', category: 'furniture', trackedIndividually: false },
  { name: 'Storage Cabinet', category: 'furniture', trackedIndividually: false },
  { name: 'Whiteboard', category: 'furniture', trackedIndividually: false },
  { name: 'Fire Extinguisher', category: 'equipment', trackedIndividually: false },
  // Equipment is tracked one record per unit so each can carry its own condition and note.
  { name: 'Interactive Display', category: 'equipment', trackedIndividually: true },
  { name: 'Projector', category: 'equipment', trackedIndividually: true },
  { name: 'Document Camera', category: 'equipment', trackedIndividually: true },
  { name: 'Copier', category: 'equipment', trackedIndividually: true },
  { name: 'Refrigerator', category: 'equipment', trackedIndividually: true },
  { name: 'Commercial Range', category: 'equipment', trackedIndividually: true },
  { name: 'Walk-in Cooler', category: 'equipment', trackedIndividually: true },
  { name: 'Dishwasher', category: 'equipment', trackedIndividually: true },
  { name: 'Basketball Hoop', category: 'equipment', trackedIndividually: true },
  { name: 'Bleachers', category: 'equipment', trackedIndividually: true },
  { name: 'Scoreboard', category: 'equipment', trackedIndividually: true },
  { name: 'Water Fountain', category: 'equipment', trackedIndividually: true },
  { name: 'Wall-Pack HVAC', category: 'equipment', trackedIndividually: true },
  { name: 'Network Switch', category: 'equipment', trackedIndividually: true },
  // Systems serve a building or floor rather than a room.
  { name: 'Rooftop HVAC Unit', category: 'system', trackedIndividually: true },
  { name: 'Boiler', category: 'system', trackedIndividually: true },
  { name: 'Water Heater', category: 'system', trackedIndividually: true },
  { name: 'Fire Alarm Control Panel', category: 'system', trackedIndividually: true },
  { name: 'Electrical Panel', category: 'system', trackedIndividually: true },
  { name: 'Intercom Head-End', category: 'system', trackedIndividually: true },
];

const DANA: Walk = { by: 'Dana R.', daysAgo: 3 };
const PRIYA: Walk = { by: 'Priya S.', daysAgo: 2 };

/** A typical walked classroom; `cond` sets the furniture baseline, extras add per-room variation. */
function walkedClassroom(
  number: string,
  name: string,
  walked: Walk,
  { desks = 24, cond = 4, extras = [] as AssetSpec[] } = {},
): RoomSpec {
  return {
    number,
    name,
    type: 'classroom',
    walked,
    assets: [
      { type: 'Student Desk', qty: desks, condition: cond },
      { type: 'Student Chair', qty: desks, condition: cond },
      { type: 'Teacher Desk', condition: cond },
      { type: 'Task Chair', condition: cond },
      { type: 'Whiteboard', qty: 2, condition: 4 },
      { type: 'Storage Cabinet', qty: 2, condition: cond },
      ...extras,
    ],
  };
}

const classroom = (number: string, name: string): RoomSpec => ({ number, name, type: 'classroom' });

export const CAMPUS: CampusSpec = {
  name: 'Live Oak K-8',
  district: 'Cedar Valley USD',
  buildings: [
    {
      code: 'A',
      name: 'Main Classroom Building',
      yearBuilt: 1998,
      walker: 'Dana R.',
      assets: [
        { type: 'Rooftop HVAC Unit', label: 'RTU-1', condition: 3, notes: 'Serves east wing. Compressor noisy.' },
        { type: 'Rooftop HVAC Unit', label: 'RTU-2', condition: 2, notes: 'Original 1998 unit, past service life.' },
        { type: 'Boiler', label: 'B-1', condition: 2, notes: 'Leaking at return header, flagged by maintenance.' },
        { type: 'Water Heater', condition: 3 },
        { type: 'Electrical Panel', label: 'MDP', condition: 3 },
        { type: 'Intercom Head-End', condition: 4 },
      ],
      floors: [
        {
          name: 'Floor 1',
          level: 1,
          assets: [
            { type: 'Fire Alarm Control Panel', condition: 4, notes: 'Replaced 2019.' },
            { type: 'Fire Extinguisher', qty: 4, condition: 4 },
            { type: 'Water Fountain', condition: 3 },
          ],
          rooms: [
            walkedClassroom('101', 'Kindergarten A', DANA, { desks: 20, cond: 4 }),
            walkedClassroom('102', 'Kindergarten B', DANA, {
              desks: 20,
              cond: 3,
              extras: [{ type: 'Projector', condition: 2, notes: 'Bulb dim, mount loose.' }],
            }),
            walkedClassroom('103', '1st Grade', DANA, {
              extras: [{ type: 'Interactive Display', condition: 5, notes: 'Installed Aug 2025.' }],
            }),
            walkedClassroom('104', '1st Grade', DANA, {
              cond: 3,
              extras: [
                { type: 'Student Chair', qty: 6, condition: 2, notes: 'Cracked seats, stacked in back corner.' },
                { type: 'Document Camera', condition: 3 },
              ],
            }),
            classroom('105', '2nd Grade'),
            classroom('106', '2nd Grade'),
            {
              number: '107',
              name: 'Library',
              type: 'library',
              walked: DANA,
              assets: [
                { type: 'Bookshelf', qty: 18, condition: 3 },
                { type: 'Table', qty: 8, condition: 4 },
                { type: 'Task Chair', qty: 32, condition: 4 },
                { type: 'Copier', condition: 3 },
                { type: 'Interactive Display', condition: 4 },
              ],
            },
            { number: '108', name: 'Restroom (Student)', type: 'restroom', walked: DANA, assets: [] },
            {
              number: '109',
              name: 'Mechanical Room',
              type: 'mechanical',
              walked: DANA,
              assets: [{ type: 'Electrical Panel', label: 'LP-1', condition: 3 }],
            },
          ],
        },
        {
          name: 'Floor 2',
          level: 2,
          assets: [
            { type: 'Fire Extinguisher', qty: 4, condition: 4 },
            { type: 'Water Fountain', condition: 2, notes: 'Low pressure, bottle filler out of order.' },
          ],
          rooms: [
            classroom('201', '3rd Grade'),
            classroom('202', '3rd Grade'),
            // Walk in progress: assets recorded but not yet marked complete.
            {
              number: '203',
              name: '4th Grade',
              type: 'classroom',
              assets: [
                { type: 'Student Desk', qty: 26, condition: 4 },
                { type: 'Student Chair', qty: 26, condition: 4 },
              ],
            },
            classroom('204', '4th Grade'),
            classroom('205', '5th Grade'),
            classroom('206', '5th Grade'),
            {
              number: '207',
              name: 'Science Lab',
              type: 'lab',
              walked: PRIYA,
              assets: [
                { type: 'Table', qty: 12, condition: 3, notes: 'Lab tables, chemical-resistant tops worn.' },
                { type: 'Task Chair', qty: 28, condition: 3 },
                { type: 'Storage Cabinet', qty: 4, condition: 3 },
                { type: 'Refrigerator', condition: 4 },
                { type: 'Interactive Display', condition: 4 },
              ],
            },
            { number: '208', name: 'Restroom (Student)', type: 'restroom' },
          ],
        },
      ],
    },
    {
      code: 'B',
      name: 'Gym & Cafeteria',
      yearBuilt: 2006,
      walker: 'Priya S.',
      assets: [
        { type: 'Rooftop HVAC Unit', label: 'RTU-3', condition: 4 },
        { type: 'Rooftop HVAC Unit', label: 'RTU-4', condition: 4 },
        { type: 'Water Heater', condition: 3 },
      ],
      floors: [
        {
          name: 'Floor 1',
          level: 1,
          assets: [
            { type: 'Fire Alarm Control Panel', condition: 4 },
            { type: 'Fire Extinguisher', qty: 6, condition: 4 },
          ],
          rooms: [
            {
              number: 'B101',
              name: 'Gymnasium',
              type: 'gym',
              walked: PRIYA,
              assets: [
                { type: 'Basketball Hoop', label: 'North', condition: 4 },
                { type: 'Basketball Hoop', label: 'South', condition: 3, notes: 'Backboard cracked at lower edge.' },
                { type: 'Bleachers', condition: 3 },
                { type: 'Scoreboard', condition: 2, notes: 'Shot clock segments out.' },
              ],
            },
            {
              number: 'B102',
              name: 'Cafeteria',
              type: 'cafeteria',
              walked: PRIYA,
              assets: [
                { type: 'Cafeteria Table', qty: 20, condition: 2, notes: 'Folding tables, several with broken latches.' },
                { type: 'Water Fountain', condition: 4 },
              ],
            },
            {
              number: 'B103',
              name: 'Kitchen',
              type: 'kitchen',
              walked: PRIYA,
              assets: [
                { type: 'Commercial Range', condition: 3 },
                { type: 'Walk-in Cooler', condition: 4 },
                { type: 'Dishwasher', condition: 1, notes: 'Out of service since spring. Hand-washing only.' },
                { type: 'Refrigerator', condition: 3 },
                { type: 'Table', qty: 3, condition: 4, notes: 'Stainless prep tables.' },
              ],
            },
            { number: 'B104', name: 'PE Office', type: 'office' },
            { number: 'B105', name: 'Locker Room (Boys)', type: 'restroom' },
            { number: 'B106', name: 'Locker Room (Girls)', type: 'restroom' },
            { number: 'B107', name: 'Equipment Storage', type: 'storage' },
          ],
        },
      ],
    },
    {
      code: 'C',
      name: 'Administration',
      yearBuilt: 1998,
      walker: 'Dana R.',
      assets: [
        { type: 'Rooftop HVAC Unit', label: 'RTU-5', condition: 3 },
        { type: 'Water Heater', condition: 4 },
      ],
      floors: [
        {
          name: 'Floor 1',
          level: 1,
          assets: [
            { type: 'Fire Alarm Control Panel', condition: 3 },
            { type: 'Fire Extinguisher', qty: 3, condition: 4 },
          ],
          rooms: [
            {
              number: 'C101',
              name: 'Front Office',
              type: 'office',
              walked: DANA,
              assets: [
                { type: 'Teacher Desk', qty: 3, condition: 3 },
                { type: 'Task Chair', qty: 3, condition: 3 },
                { type: 'Copier', condition: 4 },
                { type: 'Storage Cabinet', qty: 4, condition: 3 },
              ],
            },
            { number: 'C102', name: "Principal's Office", type: 'office' },
            { number: 'C103', name: 'Counselor', type: 'office' },
            { number: 'C104', name: 'Nurse', type: 'office' },
            { number: 'C105', name: 'Conference Room', type: 'office' },
            { number: 'C106', name: 'Staff Lounge', type: 'other' },
            { number: 'C107', name: 'Restroom (Staff)', type: 'restroom' },
            {
              number: 'C108',
              name: 'IT Closet',
              type: 'storage',
              walked: DANA,
              assets: [
                { type: 'Network Switch', label: 'Core', condition: 4 },
                { type: 'Network Switch', label: 'IDF-C', condition: 3 },
              ],
            },
          ],
        },
      ],
    },
    {
      code: 'P',
      name: 'Portables',
      yearBuilt: 2015,
      walker: 'Priya S.',
      floors: [
        {
          name: 'Floor 1',
          level: 1,
          assets: [{ type: 'Fire Extinguisher', qty: 4, condition: 4 }],
          rooms: [
            walkedClassroom('P1', 'Portable 1 — 6th Grade', PRIYA, {
              desks: 28,
              cond: 4,
              extras: [{ type: 'Wall-Pack HVAC', condition: 4 }],
            }),
            walkedClassroom('P2', 'Portable 2 — 7th Grade', PRIYA, {
              desks: 28,
              cond: 4,
              extras: [{ type: 'Wall-Pack HVAC', condition: 3 }],
            }),
            walkedClassroom('P3', 'Portable 3 — 8th Grade', PRIYA, {
              desks: 28,
              cond: 3,
              extras: [{ type: 'Wall-Pack HVAC', condition: 1, notes: 'Not cooling. Room unusable in afternoon.' }],
            }),
            classroom('P4', 'Portable 4 — Art'),
          ],
        },
      ],
    },
  ],
};
