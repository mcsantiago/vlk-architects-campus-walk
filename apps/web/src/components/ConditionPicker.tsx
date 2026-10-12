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

export function ConditionDot({ value }: { value: number }) {
  return <span className={`dot c${value}`} title={conditionLabel(value)} />;
}
