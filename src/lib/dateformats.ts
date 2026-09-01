// Date & Time (plan 09 task 9.6, issue #89): the Insert > Date & Time picker's
// format list and the pure formatter behind it. Every format is a set of
// Intl.DateTimeFormat options — pure Intl, no date library — and the insert is
// plain text (no markup), so a picked date never changes how the surrounding
// markdown round-trips (golden rule 1).
//
// Locales: the formats whose identity IS the ordering or the clock style
// (US numeric, ISO, day-first, 12/24-hour) pin an explicit locale so they mean
// the same thing on every platform (Windows first-class, golden rule 4). The
// "long" date and the long date-time follow the runtime default locale — the
// `locale` argument to formatDateTime is the app locale setting's seam, passed
// through to Intl.DateTimeFormat verbatim when set.
//
// The picker (DateTimeDialog.tsx) renders each format's live sample for the
// current date/time, Word's Date & Time dialog convention: the row shows
// exactly what the Insert button will put in the document.

export interface DateTimeFormatSpec {
  // Stable id (menu/slash/dispatch param and the test contract).
  id: string;
  // The static en-US sample (the plan 09 §2.4 list); the dialog renders the
  // live sample for the current date/time instead.
  label: string;
  // The Intl options (absent for composite specs, which list the ids of the
  // specs they join with a single space instead — a locale's date-time
  // separator, e.g. en-CA's comma, would otherwise leak into the ISO
  // date + 24-hour time form).
  options?: Intl.DateTimeFormatOptions;
  parts?: readonly string[];
  // Explicit locale for formats whose ordering/clock style is the point.
  // Absent: the runtime default locale (or the passed `locale` override).
  locale?: string;
}

export const DATE_TIME_FORMATS: readonly DateTimeFormatSpec[] = [
  {
    id: "long",
    label: "August 30, 2026",
    options: { year: "numeric", month: "long", day: "numeric" },
  },
  {
    id: "iso",
    label: "2026-08-30",
    options: { year: "numeric", month: "2-digit", day: "2-digit" },
    locale: "en-CA",
  },
  {
    id: "us",
    label: "08/30/2026",
    options: { year: "numeric", month: "2-digit", day: "2-digit" },
    locale: "en-US",
  },
  {
    id: "dayfirst",
    label: "30 August 2026",
    options: { day: "numeric", month: "long", year: "numeric" },
    locale: "en-GB",
  },
  {
    id: "time12",
    label: "3:45 PM",
    options: { hour: "numeric", minute: "2-digit", hourCycle: "h12" },
    locale: "en-US",
  },
  {
    id: "time24",
    label: "15:45",
    options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    locale: "en-GB",
  },
  {
    id: "time12s",
    label: "3:45:22 PM",
    options: { hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h12" },
    locale: "en-US",
  },
  {
    id: "time24s",
    label: "15:45:22",
    options: { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" },
    locale: "en-GB",
  },
  {
    id: "datetime12",
    label: "August 30, 2026 at 3:45 PM",
    options: {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
    },
  },
  // Composite: the ISO date and the 24-hour time joined with a single space
  // (a single Intl call would insert the locale's date-time separator —
  // en-CA's ", " — between them).
  {
    id: "datetime24",
    label: "2026-08-30 15:45",
    parts: ["iso", "time24"],
  },
];

export function dateTimeFormatById(id: string): DateTimeFormatSpec | null {
  return DATE_TIME_FORMATS.find((f) => f.id === id) ?? null;
}

// Formats `date` with the spec. `locale` overrides the spec's pinned locale
// (and supplies the locale for the unpinned specs — the runtime default when
// omitted), the seam for the app locale setting. Composite specs format every
// part with the same locale and join them with a single space.
export function formatDateTime(
  date: Date,
  format: DateTimeFormatSpec,
  locale?: string,
): string {
  if (format.parts) {
    const parts = format.parts.map((id) => {
      const part = dateTimeFormatById(id);
      if (!part) throw new Error(`unknown datetime format part: ${id}`);
      return formatDateTime(date, part, locale);
    });
    return parts.join(" ");
  }
  return new Intl.DateTimeFormat(locale ?? format.locale, format.options).format(date);
}

// The picker's row sample for the current date/time: exactly the plain text
// the Insert button will insert.
export function dateTimeSample(format: DateTimeFormatSpec, now: Date, locale?: string): string {
  return formatDateTime(now, format, locale);
}
