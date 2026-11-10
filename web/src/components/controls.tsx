import { useId, type ReactNode } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is abbreviated. */
  ariaLabel?: string;
}

/**
 * Segmented control: a native radio group styled as one pill, so arrow keys,
 * labels and form semantics come for free.
 */
export function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  testId,
  hideLegend = false,
}: {
  legend: string;
  /** Keep the legend for screen readers only (when a heading already says it). */
  hideLegend?: boolean;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  const name = useId();
  return (
    <fieldset className="field" data-testid={testId}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={String(o.value)} className="segment">
            <input
              type="radio"
              name={name}
              checked={o.value === value}
              aria-label={o.ariaLabel}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** On/off switch: a native checkbox with `role="switch"`. */
export function Switch({
  label,
  checked,
  onChange,
  autoFocus = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Take the focus when the surrounding sheet opens. */
  autoFocus?: boolean;
}) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        data-autofocus={autoFocus || undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
