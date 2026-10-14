/**
 * "Did you mean …?" for the asset-type catalogue. Before a walker adds a new type, the name is
 * compared with every existing one so "RTU", "Roof Top Unit" or "Projecter" surface "Rooftop
 * HVAC Unit" and "Projector" instead of quietly becoming a second type that splits the office's
 * counts. Pure and small enough to run on the phone against the cached list on every keystroke.
 *
 * It catches spelling, plurals, spacing ("Roof Top" / "Rooftop") and abbreviations. It cannot
 * know that "Packaged HVAC Unit" means the same thing; that takes curated aliases.
 */

/** Words too generic to make two names similar on their own. */
const GENERIC = new Set(['unit', 'units', 'system', 'systems', 'equipment', 'the', 'a', 'an', 'and', 'of', 'for', 'with', 'new', 'old']);

const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Crude singular: "desks" -> "desk", "benches" -> "bench", but not "glass" or "bus". */
const singular = (w: string) => (w.length > 4 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Words plus every pair of neighbours joined, so "roof top" also offers "rooftop". */
function forms(name: string): Set<string> {
  const ws = words(name).map(singular);
  const out = new Set(ws);
  for (let i = 0; i + 1 < ws.length; i++) out.add(ws[i]! + ws[i + 1]!);
  return out;
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Typos scale with length: none for short words, one for 5–7 letters, two beyond. */
const typoBudget = (w: string) => (w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0);

/**
 * Is `short` an abbreviation of `long`? Each letter must be found in order, the first at the
 * start of the first word and every word start used where a letter can land on one:
 * "RTU" -> Rooftop (r, t inside "rooftop") Unit (u). "AED" -> Automated External Defibrillator.
 */
function abbreviates(short: string, long: string): boolean {
  const letters = short.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ws = words(long);
  if (letters.length < 2 || letters.length > 6 || ws.length < 2 || letters[0] !== ws[0]![0]) return false;
  // Every word must contribute its first letter, except that letters may also land inside a word.
  let w = 0;
  let pos = 1;
  for (let i = 1; i < letters.length; i++) {
    const ch = letters[i]!;
    const nextStart = ws.findIndex((x, k) => k > w && x[0] === ch);
    const inside = ws[w]!.indexOf(ch, pos);
    if (nextStart !== -1 && (inside === -1 || nextStart === w + 1)) {
      w = nextStart;
      pos = 1;
    } else if (inside !== -1) {
      pos = inside + 1;
    } else return false;
  }
  return w === ws.length - 1 || ws.slice(w + 1).every((x) => GENERIC.has(x));
}

/** How alike two names are, 0 when not worth asking about. */
export function nameSimilarity(a: string, b: string): number {
  const na = words(a).map(singular).join(' ');
  const nb = words(b).map(singular).join(' ');
  if (!na || !nb) return 0;
  if (na === nb || na.replaceAll(' ', '') === nb.replaceAll(' ', '')) return 100; // plural, punctuation or spacing only

  const whole = editDistance(na, nb, 2);
  if (whole <= typoBudget(na.replaceAll(' ', ''))) return 90 - whole;

  if (abbreviates(a, b) || abbreviates(b, a)) return 80;

  const fa = forms(a);
  const fb = forms(b);
  let score = 0;
  for (const x of fa) {
    if (GENERIC.has(x) || x.length < 3) continue;
    for (const y of fb) {
      if (GENERIC.has(y) || y.length < 3) continue;
      if (x === y) score = Math.max(score, 40 + Math.min(x.length, 12));
      else if (Math.min(x.length, y.length) >= 5 && editDistance(x, y, 2) <= typoBudget(x)) score = Math.max(score, 35);
    }
  }
  return score;
}

/** Up to `limit` existing types that look like `name`, closest first. */
export function similarTypes<T extends { name: string }>(name: string, types: T[], limit = 3): T[] {
  if (name.trim().length < 2) return [];
  return types
    .map((t) => ({ t, score: nameSimilarity(name, t.name) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.t.name.localeCompare(y.t.name))
    .slice(0, limit)
    .map((x) => x.t);
}
