interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function Stepper({ value, onChange, min = 1, max = 10_000, disabled }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n) || min));
  return (
    <div className="stepper">
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))} aria-label="Fewer">
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label="Quantity"
      />
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))} aria-label="More">
        +
      </button>
    </div>
  );
}
