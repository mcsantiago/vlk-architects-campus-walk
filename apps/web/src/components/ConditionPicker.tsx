import { CONDITIONS, conditionLabel } from '@campus-walk/shared';

/** Five large buttons: a walker should pick one in under a second with a thumb. */
export function ConditionPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="conditions" role="radiogroup" aria-label="Condition">
      {[...CONDITIONS].reverse().map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          className={`cond c${c.value}${value === c.value ? ' selected' : ''}`}
          onClick={() => onChange(c.value)}
        >
          <span className="n">{c.value}</span>
          <span className="l">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A hollow dot stands for "not rated yet". */
export function ConditionDot({ value }: { value: number | null }) {
  return <span className={`dot ${value === null ? 'none' : `c${value}`}`} title={conditionLabel(value)} />;
}

/** "4 · Good", or "Not rated" for an imported record the walk has not reached. */
export const describeCondition = (value: number | null) => (value === null ? conditionLabel(null) : `${value} · ${conditionLabel(value)}`);
