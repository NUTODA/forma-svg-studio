import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { clampValue, formatNumberValue, parseNumberInput, stepValue } from './NumberField.logic';
import './NumberField.css';

export interface NumberFieldProps {
  label: string;
  value: number;
  /** Called with the new value on Enter, blur or arrow-key steps. */
  onCommit: (value: number) => void;
  /** Visible suffix inside the field, e.g. «°». */
  unit?: string;
  /** Spoken form of the unit, e.g. «градусы». */
  unitLabel?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Max fraction digits shown. */
  decimals?: number;
  disabled?: boolean;
}

const ERROR_TEXT = 'Нужно число';
const ERROR_MS = 2600;

export function NumberField({
  label,
  value,
  onCommit,
  unit,
  unitLabel,
  step = 1,
  min,
  max,
  decimals = 1,
  disabled,
}: NumberFieldProps): JSX.Element {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // `null` — show the live value; a string — the user is editing.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(false), ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const shown = draft ?? formatNumberValue(value, decimals);

  const apply = (next: number): void => {
    const clamped = clampValue(next, min, max);
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
  };

  const commitDraft = (): void => {
    if (draft === null) return;
    const parsed = parseNumberInput(draft);
    setDraft(null);
    if (parsed === null) {
      setError(true);
      return;
    }
    setError(false);
    apply(parsed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
      inputRef.current?.select();
    } else if (event.key === 'Escape') {
      if (draft !== null || error) {
        event.preventDefault();
        event.stopPropagation();
        setDraft(null);
        setError(false);
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = (draft === null ? value : parseNumberInput(draft)) ?? value;
      apply(stepValue(base, event.key === 'ArrowUp' ? 1 : -1, step, { shift: event.shiftKey, alt: event.altKey }));
      setDraft(null);
      setError(false);
    }
  };

  return (
    <div className="number-field">
      <label className="field__label number-field__label" htmlFor={inputId}>
        {label}
        {unitLabel ? <span className="visually-hidden"> ({unitLabel})</span> : null}
      </label>
      <div className="number-field__control">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="spinbutton"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className="input input--num number-field__input"
          value={shown}
          disabled={disabled}
          aria-valuenow={value}
          aria-invalid={error}
          aria-describedby={error ? errorId : undefined}
          data-has-unit={unit ? '' : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(false);
          }}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
        />
        {unit ? (
          <span className="number-field__unit" aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
      {error ? (
        <span id={errorId} className="number-field__error" role="alert">
          {ERROR_TEXT}
        </span>
      ) : null}
    </div>
  );
}
