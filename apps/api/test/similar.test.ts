import { nameSimilarity, similarTypes } from '@campus-walk/shared';
import { describe, expect, it } from 'vitest';
import { ASSET_TYPES } from '../src/db/seed-data.ts';

/** The seed catalogue plus a few of the sample district's types. */
const catalogue = [...ASSET_TYPES.map((t) => ({ name: t.name })), { name: 'Automated External Defibrillator' }, { name: 'Wireless Access Point' }, { name: 'Lab Bench' }];
const suggest = (name: string) => similarTypes(name, catalogue).map((t) => t.name);

describe('similar asset type names', () => {
  it.each([
    ['RTU', 'Rooftop HVAC Unit'],
    ['Roof Top Unit', 'Rooftop HVAC Unit'],
    ['rooftop hvac', 'Rooftop HVAC Unit'],
    ['HVAC', 'Rooftop HVAC Unit'],
    ['Projecter', 'Projector'],
    ['Projectors', 'Projector'],
    ['Student Desks', 'Student Desk'],
    ['Bookshelves', 'Bookshelf'],
    ['WAP', 'Wireless Access Point'],
    ['AED', 'Automated External Defibrillator'],
    ['Lab Benches', 'Lab Bench'],
  ])('%s suggests %s', (typed, expected) => {
    expect(suggest(typed)[0]).toBe(expected);
  });

  it('offers every plausible match when a name straddles two types', () => {
    expect(suggest('Interactive Whiteboard')).toEqual(expect.arrayContaining(['Interactive Display', 'Whiteboard']));
  });

  it('cannot see synonyms with no words in common; that is what curated aliases are for', () => {
    expect(suggest('Smart Board')).not.toContain('Interactive Display');
  });

  it('stays quiet for genuinely new things', () => {
    for (const name of ['Kiln', 'Piano', 'Leaf Blower', '3D Printer', 'Ice Machine']) expect(suggest(name), name).toEqual([]);
  });

  it('ignores words too generic to mean anything', () => {
    expect(suggest('Storage Unit')).toEqual(['Storage Cabinet']);
    expect(nameSimilarity('Packaged HVAC Unit', 'Rooftop HVAC Unit')).toBeGreaterThan(0); // shares "hvac"
    expect(nameSimilarity('Sound System', 'Rooftop HVAC Unit')).toBe(0);
  });

  it('ranks closer names first and caps the list', () => {
    expect(suggest('Student Chairs')[0]).toBe('Student Chair');
    expect(suggest('Desk').length).toBeLessThanOrEqual(3);
  });
});
