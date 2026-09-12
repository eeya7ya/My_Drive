"use client";

/**
 * A two-or-three way choice as the design system draws it: real radio inputs
 * inside a `.seg`, so it is a keyboard control and a form field rather than a
 * pair of buttons pretending to be one.
 *
 * Shared by the admin panel and the drive's own settings panel, which now ask
 * for different things about the same drive and should not look like they came
 * from different sites while doing it.
 */

export default function Choice<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <label key={option.value} className="seg-opt">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** The design's recurring micro-label: 11px, uppercase, letterspaced, accent. */
export const LABEL: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

/** The sidebar's small line under a name, at panel scale. */
export const TAGLINE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

/** The one red in the system, used for refusals and for destructive controls. */
export const DANGER = "var(--color-danger)";

/**
 * A confirm button paints DANGER over `.btn-primary`, which colours its label
 * with `--color-bg` — nearly black under the dark theme, and unreadable on the
 * red. The two go together, so both are stated here rather than at either call
 * site, and white is the one that holds in both themes because the background
 * behind it is the same red whatever the page is doing.
 */
export const DANGER_TEXT = "var(--color-danger-fg)";

/**
 * A group of radios is a fieldset with a legend rather than a label, since a
 * label may only name one control. These two carry the `.field > label` look
 * across, so a choice sits in a form beside the text inputs without announcing
 * that it is built from different parts.
 */
export const GROUP: React.CSSProperties = {
  border: "none",
  padding: 0,
  margin: 0,
  minWidth: 0,
};

export const GROUP_LABEL: React.CSSProperties = {
  padding: 0,
  fontSize: 12,
  marginBottom: 5,
  color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
};
