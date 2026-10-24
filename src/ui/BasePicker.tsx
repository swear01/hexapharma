import { BASE_NAMES } from "../sim/phase0_interfaces";

export function LockGlyph() {
  return (
    <svg className="tool-lock" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3.5 5.5V4a2.5 2.5 0 015 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor" />
    </svg>
  );
}

/** Base choice: one button per base of the level; a locked base explains itself instead of switching. */
export function BasePicker({ value, locks, onChange, onHint, testId }: {
  readonly value: number;
  /** Per base: why it is locked, or null when it is available. */
  readonly locks: readonly (string | null)[];
  readonly onChange: (base: number) => void;
  readonly onHint: (hint: string | null) => void;
  readonly testId: string;
}) {
  return (
    <div className="base-picker" role="group" aria-label="Base" data-testid={testId}>
      {locks.map((lock, base) => {
        const hint = lock === null ? undefined : () => onHint(lock);
        const clear = lock === null ? undefined : () => onHint(null);
        return (
          <button
            key={base}
            type="button"
            className={lock === null ? undefined : "is-locked"}
            aria-pressed={value === base}
            aria-disabled={lock === null ? undefined : true}
            title={lock ?? undefined}
            data-testid={`${testId}-${base}`}
            onClick={lock === null ? () => onChange(base) : hint}
            onMouseEnter={hint}
            onMouseLeave={clear}
            onFocus={hint}
            onBlur={clear}
          >
            {lock !== null && <LockGlyph />}
            {BASE_NAMES[base]}
          </button>
        );
      })}
    </div>
  );
}
