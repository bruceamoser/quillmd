// Date & time formats (plan 09 task 9.6, issue #89): the format list contract
// (ids, labels, pinned locales), the pure Intl formatter, and the composite
// datetime24 spec (ISO date + 24-hour time joined with a single space — a
// locale's date-time separator must not leak in).
import { describe, expect, it } from "vitest";
import {
  DATE_TIME_FORMATS,
  dateTimeFormatById,
  dateTimeSample,
  formatDateTime,
  type DateTimeFormatSpec,
} from "../dateformats";

// A fixed instant for deterministic samples: 2026-08-30 15:45:22 local time.
// The dialog renders the same shapes for "now"; the tests pin the clock.
const FIXED = new Date(2026, 7, 30, 15, 45, 22);

// Formats the spec for the test: pinned specs keep their locale; the two
// runtime-default specs (long, datetime12) are pinned to en-US here. The
// composite is formatted without an override so its parts keep their own.
function fmt(id: string): string {
  const spec = dateTimeFormatById(id);
  if (!spec) throw new Error(`missing format ${id}`);
  if (spec.parts) return formatDateTime(FIXED, spec);
  return formatDateTime(FIXED, spec, spec.locale ? undefined : "en-US");
}

describe("DATE_TIME_FORMATS (plan 09 §2.4 format list)", () => {
  it("carries the ten formats with stable ids", () => {
    expect(DATE_TIME_FORMATS.map((f) => f.id)).toEqual([
      "long",
      "iso",
      "us",
      "dayfirst",
      "time12",
      "time24",
      "time12s",
      "time24s",
      "datetime12",
      "datetime24",
    ]);
  });

  it("resolves a format by id", () => {
    expect(dateTimeFormatById("iso")?.label).toBe("2026-08-30");
    expect(dateTimeFormatById("nope")).toBeNull();
  });

  it("pins locales for the ordering/clock formats (Windows first-class)", () => {
    expect(dateTimeFormatById("iso")?.locale).toBe("en-CA");
    expect(dateTimeFormatById("us")?.locale).toBe("en-US");
    expect(dateTimeFormatById("dayfirst")?.locale).toBe("en-GB");
    expect(dateTimeFormatById("time12")?.locale).toBe("en-US");
    expect(dateTimeFormatById("time24")?.locale).toBe("en-GB");
    expect(dateTimeFormatById("time12s")?.locale).toBe("en-US");
    expect(dateTimeFormatById("time24s")?.locale).toBe("en-GB");
    // "long" and the long date-time follow the runtime default locale — the
    // locale argument is the app locale setting's seam.
    expect(dateTimeFormatById("long")?.locale).toBeUndefined();
    expect(dateTimeFormatById("datetime12")?.locale).toBeUndefined();
  });

  it("datetime24 is the composite of the iso date and the 24-hour time", () => {
    expect(dateTimeFormatById("datetime24")?.parts).toEqual(["iso", "time24"]);
  });
});

describe("formatDateTime (the picker's plain-text insert)", () => {
  it.each([
    ["long", "August 30, 2026"],
    ["iso", "2026-08-30"],
    ["us", "08/30/2026"],
    ["dayfirst", "30 August 2026"],
    ["time12", "3:45 PM"],
    ["time24", "15:45"],
    ["time12s", "3:45:22 PM"],
    ["time24s", "15:45:22"],
    ["datetime12", "August 30, 2026 at 3:45 PM"],
  ])("formats %s as %s", (id, want) => {
    expect(fmt(id)).toBe(want);
  });

  it("joins the datetime24 composite with a single space (no locale separator)", () => {
    expect(fmt("datetime24")).toBe("2026-08-30 15:45");
  });

  it("throws on an unknown composite part", () => {
    const spec: DateTimeFormatSpec = { id: "x", label: "x", parts: ["nope"] };
    expect(() => formatDateTime(FIXED, spec)).toThrow("unknown datetime format part: nope");
  });

  it("the locale override drives the runtime-default formats (app locale seam)", () => {
    const spec = dateTimeFormatById("long")!;
    expect(formatDateTime(FIXED, spec, "en-GB")).toBe("30 August 2026");
    expect(formatDateTime(FIXED, spec, "en-US")).toBe("August 30, 2026");
  });
});

describe("dateTimeSample (the picker row preview)", () => {
  it("is exactly what the insert will place", () => {
    const spec = dateTimeFormatById("us")!;
    expect(dateTimeSample(spec, FIXED)).toBe("08/30/2026");
    expect(dateTimeSample(spec, FIXED)).toBe(formatDateTime(FIXED, spec));
  });
});
