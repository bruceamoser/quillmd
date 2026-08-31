// Modify Style dialog (plan 05 task 5.4, issue #57): the in-app Word-style
// "Modify Style" editor for the built-in styles. The dialog is fully
// controlled — App.tsx owns the open state, the stored overrides, and the
// persistence (Rust read/write_style_overrides, app config dir) — so the
// dialog itself only edits a draft and previews it live.
//
// Layout (plan 05 §3): fields on the left (font family/size, color, weight,
// italic, spacing), a live preview pane on the right rendering the markdown
// construct the style really is. Every field has a "default" state (no
// override); Reset style clears the draft, Reset all clears every style.
//
// The preview applies the draft through the same overridesToCss generator
// the app uses for the WYSIWYG/preview surfaces, scoped to the pane's own
// container — so what the user sees here is exactly what the document gets
// on OK. The override is view-only CSS: saving it never touches the
// document's bytes.
//
// Keyboard model (plan 08 §3, same as the link dialog):
//   Enter          submit (OK)
//   Esc            cancel

import { useMemo, useState } from "react";
import type { JSX } from "react";
import { BUILT_IN_STYLES } from "../lib/styles";
import {
  BLOCK_OVERRIDE_KEYS,
  OVERRIDE_FONT_SIZES,
  OVERRIDE_KEY_LABELS,
  normalizeFontFamily,
  normalizeOverride,
  overridesToCss,
  styleKeyForStyleId,
} from "../lib/styleOverrides";
import type { OverrideKey, StyleOverride, StyleOverrides } from "../lib/styleOverrides";

export interface ModifyStyleDialogProps {
  // The style the dialog opens on (the one under the cursor when the menu
  // item fired, otherwise Normal).
  initialKey: OverrideKey;
  // The stored overrides: prefill for the opened style and the source of
  // the live preview (the other styles' overrides are included too).
  overrides: StyleOverrides;
  // OK: persists the edited style's normalized override (an empty override
  // means the style was reset to its theme default).
  onApply: (key: OverrideKey, override: StyleOverride) => void;
  // "Reset all": clears every style's override (App confirms first).
  onResetAll: () => void;
  // Cancel (Esc, Cancel button, or the backdrop).
  onClose: () => void;
}

// The form's field state. Empty strings / unchecked boxes are the "default"
// (no override) values; the draft is normalized onto StyleOverride only when
// building the preview and on OK.
interface Draft {
  family: string;
  size: string;
  useColor: boolean;
  color: string;
  weight: "" | "normal" | "bold";
  italic: boolean;
  spacing: "" | "compact" | "relaxed";
}

const EMPTY_DRAFT: Draft = {
  family: "",
  size: "",
  useColor: false,
  color: "#3c3c3c",
  weight: "",
  italic: false,
  spacing: "",
};

function draftFromOverride(o: StyleOverride | undefined): Draft {
  return {
    ...EMPTY_DRAFT,
    family: o?.fontFamily ?? "",
    size: o?.fontSize ?? "",
    useColor: o?.color !== undefined,
    color: o?.color ?? EMPTY_DRAFT.color,
    weight: o?.fontWeight ?? "",
    italic: o?.fontStyle === "italic",
    spacing: o?.spacing ?? "",
  };
}

// The sample the preview pane renders for each markdown construct (the same
// shapes the WYSIWYG/preview surfaces render, so the override CSS applies
// identically).
const PREVIEW_SAMPLES: Record<OverrideKey, JSX.Element> = {
  paragraph: <p>The quick brown fox jumps over the lazy dog.</p>,
  h1: <h1>Heading one</h1>,
  h2: <h2>Heading two</h2>,
  h3: <h3>Heading three</h3>,
  h4: <h4>Heading four</h4>,
  h5: <h5>Heading five</h5>,
  h6: <h6>Heading six</h6>,
  blockquote: <blockquote>A quoted passage with a little more text in it.</blockquote>,
  intenseQuote: (
    <blockquote>
      <strong>A quoted</strong> passage with a bold run.
    </blockquote>
  ),
  listItem: <ul><li>A list item with some text.</li></ul>,
  codeBlock: <pre><code>const x = 42;</code></pre>,
  inlineCode: <p>Use the <code>foo()</code> helper here.</p>,
  em: <p>The <em>emphasized</em> word.</p>,
  strong: <p>The <strong>strong</strong> word.</p>,
};

export default function ModifyStyleDialog({
  initialKey,
  overrides,
  onApply,
  onResetAll,
  onClose,
}: ModifyStyleDialogProps) {
  // The style being edited: one of the registry ids (the dialog offers every
  // built-in style; ids that alias the same markdown construct share an
  // override — the honest mapping the gallery documents).
  const [styleId, setStyleId] = useState<string>(
    BUILT_IN_STYLES.find((s) => styleKeyForStyleId(s.id) === initialKey)?.id ?? "normal",
  );
  const key = styleKeyForStyleId(styleId) ?? "paragraph";
  const [draft, setDraft] = useState<Draft>(() => draftFromOverride(overrides[initialKey]));

  // Switching the style select loads that style's stored override (or an
  // empty draft) — the fields are per-style, so nothing carries over.
  const switchStyle = (id: string) => {
    const nextKey = styleKeyForStyleId(id);
    if (!nextKey) return;
    setStyleId(id);
    setDraft(draftFromOverride(overrides[nextKey]));
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const isBlock = (BLOCK_OVERRIDE_KEYS as readonly string[]).includes(key);

  // The draft normalized through the same validator the storage path uses,
  // so the preview can never show something OK would not persist.
  const draftOverride = useMemo<StyleOverride>(() => {
    const raw = {
      fontFamily: normalizeFontFamily(draft.family),
      fontSize: draft.size || null,
      color: draft.useColor ? draft.color : null,
      fontWeight: draft.weight || null,
      fontStyle: draft.italic ? "italic" : null,
      spacing: draft.spacing || null,
    };
    return normalizeOverride(key, raw);
  }, [draft, key]);

  // Live preview: the stored overrides plus the edited style's draft,
  // rendered through the app's own CSS generator scoped to this pane.
  const previewCss = useMemo(
    () =>
      overridesToCss(
        { ...overrides, [key]: Object.keys(draftOverride).length > 0 ? draftOverride : undefined },
        [".quillmd-modify-preview"],
      ),
    [overrides, key, draftOverride],
  );

  const style = BUILT_IN_STYLES.find((s) => s.id === styleId);
  const hasAnyOverrides = Object.keys(overrides).length > 0;

  const submit = () => {
    onApply(key, draftOverride);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      // Selects and buttons own their Enter behavior (open dropdown / click).
      if (target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="quillmd-modify-overlay"
      onMouseDown={(e) => {
        // A backdrop press cancels; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-modify-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Modify Style"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-modify-title">Modify Style</div>

        <form
          className="quillmd-modify-body"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="quillmd-modify-fields">
            <label className="quillmd-modify-field">
              <span className="quillmd-modify-label">Style</span>
              <select
                className="quillmd-modify-select"
                data-field="style"
                value={styleId}
                onChange={(e) => switchStyle(e.target.value)}
              >
                {BUILT_IN_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="quillmd-modify-hint">
              {style
                ? `${style.label} is ${OVERRIDE_KEY_LABELS[key]} in markdown — this restyles every ${OVERRIDE_KEY_LABELS[key]}.`
                : ""}
            </div>

            <label className="quillmd-modify-field">
              <span className="quillmd-modify-label">Font family</span>
              <input
                className="quillmd-modify-input"
                data-field="family"
                type="text"
                value={draft.family}
                placeholder="Default (theme font)"
                onChange={(e) => patch({ family: e.target.value })}
                spellCheck={false}
              />
            </label>

            <div className="quillmd-modify-row">
              <label className="quillmd-modify-field">
                <span className="quillmd-modify-label">Size</span>
                <select
                  className="quillmd-modify-select"
                  data-field="size"
                  value={draft.size}
                  onChange={(e) => patch({ size: e.target.value })}
                >
                  <option value="">Default</option>
                  {OVERRIDE_FONT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <label className="quillmd-modify-field">
                <span className="quillmd-modify-label">Weight</span>
                <select
                  className="quillmd-modify-select"
                  data-field="weight"
                  value={draft.weight}
                  onChange={(e) => patch({ weight: e.target.value as Draft["weight"] })}
                >
                  <option value="">Default</option>
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </label>
            </div>

            <div className="quillmd-modify-row">
              <label className="quillmd-modify-field">
                <span className="quillmd-modify-label">Color</span>
                <span className="quillmd-modify-color">
                  <input
                    data-field="use-color"
                    type="checkbox"
                    checked={draft.useColor}
                    onChange={(e) => patch({ useColor: e.target.checked })}
                  />
                  <input
                    data-field="color"
                    type="color"
                    value={draft.color}
                    disabled={!draft.useColor}
                    onChange={(e) => patch({ color: e.target.value })}
                  />
                  <span>{draft.useColor ? draft.color : "Default"}</span>
                </span>
              </label>
              <label className="quillmd-modify-field">
                <span className="quillmd-modify-label">Italic</span>
                <span className="quillmd-modify-check">
                  <input
                    data-field="italic"
                    type="checkbox"
                    checked={draft.italic}
                    onChange={(e) => patch({ italic: e.target.checked })}
                  />
                  <span>{draft.italic ? "Italic" : "Default"}</span>
                </span>
              </label>
            </div>

            {isBlock && (
              <label className="quillmd-modify-field">
                <span className="quillmd-modify-label">Spacing</span>
                <select
                  className="quillmd-modify-select"
                  data-field="spacing"
                  value={draft.spacing}
                  onChange={(e) => patch({ spacing: e.target.value as Draft["spacing"] })}
                >
                  <option value="">Default</option>
                  <option value="compact">Compact</option>
                  <option value="relaxed">Relaxed</option>
                </select>
              </label>
            )}
          </div>

          <div className="quillmd-modify-preview-wrap">
            <div className="quillmd-modify-preview-label">Preview</div>
            <div className="quillmd-modify-preview">
              <style>{previewCss}</style>
              {PREVIEW_SAMPLES[key]}
            </div>
          </div>

          <div className="quillmd-modify-actions">
            <div className="quillmd-modify-actions-left">
              <button
                type="button"
                className="quillmd-modify-button"
                onClick={() => setDraft({ ...EMPTY_DRAFT })}
              >
                Reset style
              </button>
              {hasAnyOverrides && (
                <button type="button" className="quillmd-modify-button danger" onClick={onResetAll}>
                  Reset all
                </button>
              )}
            </div>
            <div className="quillmd-modify-actions-right">
              <button type="button" className="quillmd-modify-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="quillmd-modify-button primary">
                OK
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
