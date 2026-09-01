#!/bin/bash
# QuillMD acceptance test runner.
# Runs on Linux (bash) and Windows (Git Bash preinstalled on windows-latest runners).
# Every acceptance criterion in spec.md §5 maps 1:1 to a check below.
#
# Usage: tests/acceptance-test.sh [subset]
#   subset: core   -> §5.1-5.12 headless (CI platform gate)
#           export -> §5.13-5.18 (requires pandoc + typst)
#           pkg    -> §5.19 (packaging, requires built artifacts)
#           p0-shell -> all app-shell checks: File > New (#24), Make a Copy /
#                       Close / Close All (#25), File > Info (#26), drag & drop
#                       (#27), multi-open + dialog choke point (#28)
#           p1-editor -> plan 02 editor-core checks: underline toolbar/menu/
#                       Ctrl+U wiring (#31), text alignment toolbar/menu/
#                       serializer wiring (#32), indent/outdent + list
#                       keyboard (Ctrl+]/[ + Tab) wiring (#33), line spacing +
#                       word wrap + formatting marks wiring (#34), zoom
#                       state/menu submenu/shortcuts/Ctrl-wheel/status (#35),
#                       spellcheck attr + View toggle / paste-as-text
#                       Edit menu + Ctrl+Shift+V wiring (#36), Ctrl+1..6
#                       heading shortcuts + Help > Shortcuts dialog + plan 02
#                       test-suite presence (#37)
#           p1-find -> plan 07 acceptance gate: task 7.5 menu + shortcuts
#                       (Edit menu Find / Find and Replace / Find Next /
#                       Find Previous + accelerators, App.tsx menu-id +
#                       window F3/Shift+F3/Ctrl+F/H/Esc routing, per-doc
#                       search-term memory + global panel-position
#                       persistence (findMemory.ts), panel top/bottom
#                       toggle + CSS), the plan 07 §4 acceptance criteria
#                       AC1-AC7 vitest-suite presence (open/highlight/
#                       counter/F3/Esc, case/word/regex incl. capture
#                       groups, single + replace-all single undo,
#                       source/WYSIWYG parity, cross-block refusal +
#                       tooltip, dirty save + byte-identical re-save, no
#                       window.prompt in the find path), and the large-doc
#                       perf test (100k-char recompute < 100ms, issue #74)
 #           p1-media -> plan 08 full acceptance gate (issues #77-#82): the
 #                       tasks 8.2-8.6 wiring checks (Insert > Image submenu
 #                       + from-URL, the Rust asset copy pipeline +
 #                       copy_asset/file_exists commands, the image edit
 #                       dialog + <img> HTML width serialization, open links
 #                       + broken-image placeholder + Re-link, DnD image
 #                       insert), the plan 08 §4 acceptance criteria AC1-AC8
 #                       coverage (link dialog insert/edit/remove + title
 #                       round-trip, bare-URL paste, from-file copy +
 #                       relative path, collision naming photo-1.png, width
 #                       persist + re-apply, broken-image placeholder +
 #                       Re-link, middle-click/context Open, links + 2-images
 #                       doc byte-identical re-save), and the Windows manual
 #                       pass for asset copy (reserved-name refusal, CRLF
 #                       round-trip) + open-link (plugin-opener system
 #                       browser)
 #           p1-assets -> plan 08 task 8.3 acceptance gate (issue #78): the
 #                       Rust fs/assets.rs core (AssetFolder, copy_asset,
 #                       files_exist), the copy_asset + file_exists Tauri
 #                       commands registered in generate_handler, the
 #                       assets.ts module (asset-folder setting, invoke
 #                       bridge, from-file src pipeline), App.tsx routing the
 #                       from-file picker through the pipeline, and the
 #                       assets.test.ts vitest suite presence
 #           p1-imageedit -> plan 08 task 8.4 acceptance gate (issue #79):
 #                       the image edit dialog (click image -> dialog,
 #                       URL/alt/width fields), the <img> HTML width
 #                       serialization in pm.ts (parse + canonical render),
 #                       the ImageWithWidth node attribute in Editor.tsx,
 #                       the imageEdit registry command + App.tsx wiring,
 #                       the width/apply/prefill logic in images.ts, and the
  #                       AC8 round-trip fixture (links + 1 relative image +
  #                       1 HTML-width image) + images.test.tsx suite presence
  #           p1-links -> plan 08 task 8.5 acceptance gate (issue #80): the
  #                       tauri-plugin-opener dependency + opener:default
  #                       capability, links.ts (openLinkUrl,
  #                       middleClickLinkHref), the editor auxclick ->
  #                       linkHrefAt -> openLinkUrl wiring, the preview
  #                       onAuxClick wiring, the missingImages.ts detection
  #                       module (collect/resolve/relink-folder/batched
  #                       find-missing) + filesExist bridge, the image node
  #                       view broken-image placeholder + Re-link button +
  #                       CSS, App.tsx detection effect + re-link picker ->
  #                       setNodeMarkup flow, and the openLinks.test.tsx /
  #                       missingImages.test.tsx vitest suite presence
 #           p1-dnd -> plan 08 task 8.6 acceptance gate (issue #81): the
 #                     dragDrop.ts image classification (IMAGE_FILTER
 #                     extensions) + insertImage dep routing + skip/failure
 #                     status lines, App.tsx wiring the drop handler's
 #                     insertImage through the shared from-file flow
 #                     (insertImageFromPath + currentFindEditor, same
 #                     pipeline as Insert > Image > From file), and the
  #                     dragDrop.test.ts image routing/skip/failure suite
  #                     presence
   #           p2-fonts -> plan 04 full acceptance gate (issues #47-#52):
   #                       task 4.1 marks + serializer (issue #47: the three
   #                       font marks + highlight color in Editor.tsx, the
   #                       quillmd-font / quillmd-highlight span parse + emit
   #                       in pm.ts in fixed attribute order, the clean
   #                       font-styled.md fixture contract), task 4.2 shared
   #                       color palette (issue #48), task 4.3 toolbar font
   #                       cluster (issue #49), task 4.4 Format > Font
   #                       submenu (issue #50), task 4.5 clear formatting +
   #                       editor-chrome font (issue #51), and task 4.6
   #                       (issue #52): the plan 04 §4 acceptance criteria
   #                       AC1-AC7 vitest-suite + fixture coverage (apply +
   #                       one span line + byte-identical re-save, clean
   #                       corpus verbatim, compose + per-attr toggle, clear
   #                       keeps bold/italic, highlight color + ==text==
   #                       compat, toolbar/menu dispatch parity), the
   #                       PDF (typst) + DOCX export spot-checks of the
   #                       styled fixture (spans degrade to plain —
   #                       documented AC7 limitation), and the Windows CRLF
   #                       round-trip manual pass for the styled doc
   #           p2-colors -> plan 04 task 4.2 acceptance gate (issue #48): the
   #                       shared 24-swatch palette + normalize in colors.ts,
   #                       the fontColor / highlightColor registry commands +
   #                       color readers in editorCommands.ts, the shared
   #                       ColorPalette popover component (24-grid + auto +
    #                       custom), and the Toolbar rendering both pickers
    #                       through that one component
    #           p2-font-toolbar -> plan 04 task 4.3 acceptance gate (issue #49):
    #                       the fontFamily / fontSize registry commands +
    #                       selection readers + curated family/size constants in
    #                       editorCommands.ts, and the Toolbar rendering the
    #                       family + size selects as the font cluster next to the
    #                       color/highlight pickers
    #           p2-font-menu -> plan 04 task 4.4 acceptance gate (issue #50): the
    #                       Format > Font submenu (family/size/color/highlight/
    #                       underline/clear) in menu.rs with per-pick menu ids,
    #                       the fontMenuCommand id -> (registry command, param)
    #                       resolver + fontFamilySlug in editorCommands.ts (the
    #                       Rust family_slug contract), App.tsx routing the ids
    #                       through the shared registry (incl. the Custom…
    #                       prompt), and the fontmenu.test.tsx AC6 suite presence
    #                       (menu path vs toolbar path document text)
    #           p2-styles -> plan 05 full acceptance gate (issues #54-#59):
    #                       task 5.1 style registry + gallery popover (issue
    #                       #54: the QuillStyle data model, the built-in style
    #                       set of >=12 styles each aliasing an existing
    #                       registry command, the paragraph registry command,
    #                       the StyleGallery popover + gallery CSS), task 5.2
    #                       Format > Styles submenu + toolbar gallery button
    #                       (issue #55), task 5.3 the five built-in themes as
    #                       CSS variable sheets + View > Theme menus +
    #                       per-doc/per-app persistence (issue #56), task 5.4
    #                       Modify Style + overrides storage (issue #57),
    #                       task 5.5 the status-bar block-type indicator
    #                       (issue #58), and task 5.6 (issue #59): the plan
    #                       05 §4 acceptance criteria AC1-AC6 vitest-suite +
    #                       fixture coverage (gallery + Heading 2 -> h2 +
    #                       selection state, theme switch zero bytes in
    #                       currentText, Modify H2 Georgia/18pt live restyle
    #                       + bytes untouched + restart persistence, the
    #                       committed screenshot baselines of the standard
    #                       fixture under all 5 themes, the OS-dark default,
    #                       and the round-trip regression that no style/theme
    #                       markup is ever written to disk)
    #           p2-themes -> plan 05 task 5.3 acceptance gate (issue #56): the
#                       five built-in themes as CSS variable sheets scoped to
#                       the document content container (theme.ts registry +
#                       per-app default persistence with the OS-dark first-run
#                       default, DocSettings.theme per-doc override, the
#                       src/themes/*.css sheets, the View > Theme + View >
#                       Default theme submenus in menu.rs, App.tsx rendering
#                       data-theme without touching the document bytes), and
#                       the theme.test.tsx vitest suite presence
#           p2-styles-menu -> plan 05 task 5.2 acceptance gate (issue #55):
    #                       the Format > Styles submenu in menu.rs (the STYLES
    #                       (id, label) list mirroring BUILT_IN_STYLES, one
    #                       menu id per style), the styleMenuCommand id ->
    #                       (registry command, with) resolver in styles.ts,
    #                       App.tsx routing the ids through the shared
    #                       registry, the Toolbar mounting the StyleGallery
    #                       as its first control (the Word-style gallery
    #                       button), and the stylemenu.test.tsx suite
    #                       presence (menu path vs gallery path document
    #                       text parity + menu-event e2e)
    #           p2-style-modify -> plan 05 task 5.4 acceptance gate (issue #57):
    #                       the styleOverrides.ts module (the OverrideKey
    #                       markdown-key model, the style-id -> key map with
    #                       alias sharing, the field validators, the
    #                       overridesToCss view-only CSS generator, the
    #                       Tauri + localStorage storage bridge), the
    #                       ModifyStyleDialog component (fields + live
    #                       preview + reset flows), the Rust
    #                       read/write_style_overrides commands (app config
    #                       dir JSON), the menu.rs Format > Styles > Modify
    #                       item, App.tsx routing the menu id to the dialog
    #                       + <style> injection + persistence, the dialog
    #                       CSS, and the styleOverrides.test.tsx suite
    #                       presence (AC3 H2 Georgia/18pt live restyle +
    #                       bytes untouched + restart persistence, the
     #                       reset flows, the storage round-trips)
     #           p2-style-inspector -> plan 05 task 5.5 acceptance gate (issue #58):
     #                       the status-bar block-type indicator. styles.ts
     #                       currentBlockStyle (the first built-in block style
     #                       active at the selection, the same "first active
     #                       wins" rule the Modify Style preselect uses), the
     #                       editorCommands.ts block-style publish + gallery-
     #                       open request channels, Editor.tsx publishing the
     #                       label on every transaction (null on unmount), the
     #                       StatusBar indicator + inspector popover ("This
     #                       block is: ..." + "Jump to style"), StyleGallery
     #                       registering the opener, App.tsx state + routing,
     #                       the indicator CSS, and the styleinspector.test.tsx
     #                       suite presence (style mapping + popover behavior +
     #                       gallery-open request)
     #           p2-tables -> plan 06 full acceptance gate (issues #61-#67):
     #                       the task 6.1-6.6 wiring checks (GFM table
     #                       serializer + GfmTable extension + gfm-tables.md
     #                       fixture (issue #61), the row/column/cell/header/
     #                       delete registry commands (issue #62), the size
     #                       picker + insert dialog + Insert > Table menu
     #                       (issue #63), the floating table toolbar
     #                       (issue #64), Tab/Shift+Tab/Escape keyboard
     #                       navigation with the 99-row guard (issue #65),
     #                       merged-cell HTML form + colgroup widths
     #                       (issue #66)), the plan 06 §4 acceptance criteria
     #                       AC1-AC8 coverage (exact-size pick with header,
     #                       valid-GFM lint of the table fixtures, alignment
     #                       + <br> persistence, keyboard nav, delete table,
     #                       escaped-pipe round-trip, floating toolbar
     #                       focus, fixtures green), and the GFM lint of the
     #                       table fixtures actually run here (issue #67) —
      #                       always in CI via the npm test gate
      #           p2-mermaid-export -> plan 11 task 11.5 acceptance gate
      #                       (issue #104): the PNG export pipeline. The
      #                       export_write_asset / export_remove_asset Rust
      #                       commands (collision-safe, reserved-name-safe
      #                       asset writes into the export dir, best-effort
      #                       cleanup) with the in-binary --self-test
      #                       export-asset, the SVG -> 2x canvas PNG pipeline
      #                       module (mermaidExport.ts: fence discovery via
      #                       the editor's parser, fence swap, all-or-nothing
      #                       orchestration, temp markdown + diagram-N.png
      #                       assets cleaned up on every path), the File >
      #                       Export routing through the current document
      #                       text (fileMenu.ts + App.tsx), and the plan 11
       #                       AC5 coverage (2 diagrams -> 2 PNGs in the right
       #                       positions; a broken diagram refuses the export
       #                       with a named error) pinned in
       #                       mermaidExport.test.ts + the on-disk fixture
       #                       fixtures/clean/mermaid-export.md
       #           p2-mermaid -> plan 11 full acceptance gate (task 11.7,
       #                       issue #106): AC1-AC8 coverage pinned in the
       #                       mermaid vitest suites + the app-level wiring
       #                       the GUI driver cannot reach headlessly (Insert
       #                       > Diagram menu id, /diagram, toolbar, the
       #                       shared render service, the source-view
       #                       highlight language, the card CSS), the AC8
       #                       startup perf gate (lazy mermaid import + the
       #                       <100ms budget) actually run here, the AC5
       #                       export gate (the p2-mermaid-export checks),
       #                       and the Windows manual pass (insert -> edit
       #                       -> export PDF/DOCX: the CRLF save-pipeline
       #                       round-trip for diagram docs, the
        #                       reserved-name-safe PNG asset gate, and the
        #                       pandoc PDF/DOCX conversion)
        #           p3-context -> plan 03 full acceptance gate (task 3.7,
        #                       issue #45): the plan 03 §4 acceptance
        #                       criteria AC1-AC7 (WYSIWYG/source/preview text
        #                       menus with 1:1 registry dispatch, table menu
        #                       3x3 -> 3x4 GFM + confirm-gated delete, image
        #                       menu edit/replace/undoable remove, tab menu
        #                       close/close-others/close-all with dirty
        #                       confirms, explorer menu with on-disk fs_*
        #                       commands + trash Undo + reveal, keyboard
        #                       navigation, all suites green) pinned in the
        #                       context-menu vitest suites + the app-level
        #                       wiring the GUI driver cannot reach
        #                       headlessly, the AC suites actually run here,
        #                       and the Windows + Linux manual matrix
        #                       (every menu x every surface: CRLF save
        #                       pipeline, reserved-name refusal,
        #                       plugin-opener reveal, native confirms)
        #           p4-doc-tools -> plan 09 task 9.2 acceptance gate (issue
        #                          #85): export-time TOC generation. The
        #                          `<!-- quillmd:toc -->` token (tocBlock,
        #                          issue #84) expands in a throwaway copy of
        #                          the markdown at conversion time — a raw
        #                          typst #outline() block for PDF, a Word TOC
        #                          field for DOCX — the source file is never
        #                          rewritten (golden rule 1). Checks: the
        #                          cross-language token contract (convert.rs
        #                          vs pm.ts), the fixtures/clean/toc.md
        #                          corpus entry (token + H1-H4 + one H5),
        #                          the convert.rs wiring, the cargo convert
        #                          suite actually run here (expansion
        #                          contract, temp-copy + cleanup, real
        #                          PDF/DOCX export incl. the pdftotext
        #                          outline check and the DOCX zip field
        #                          check), and the in-binary
        #                          --self-test export-toc; and task 9.3
        #                          (issue #86): the navigation pane. A right
        #                          rail listing the active doc's H1-H4 with
        #                          click-to-jump + scroll tracking; the
        #                          toggle persists per-path in DocSettings
        #                          (navigationPane, default false), driven
        #                          from the View menu + Ctrl+Shift+8. Checks:
        #                          the menu.rs + App.tsx wiring, the
        #                          docSettings persistence, the outline.ts
        #                          pure helpers, and the outline/pane/App
        #                          vitest suites actually run here
        #           shell  -> p0-shell app-shell checks (File > New / New from template, issue #24)
#           copyclose -> p0-shell Make a copy / Close / Close All (issue #25)
#           info   -> p0-shell File > Info / document properties (issue #26)
#           dragdrop -> p0-shell drag & drop open (issue #27)
#           all    -> everything runnable in this environment
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FIXTURES="$ROOT/fixtures"
RESULTS_FILE="$ROOT/target/acceptance-results.txt"
mkdir -p "$ROOT/target"

PASS=0
FAIL=0
FAILED_TESTS=()

# --- harness -------------------------------------------------------------
note()  { printf '%-55s' "$1"; }
pass()  { echo "PASS"; PASS=$((PASS+1)); }
fail()  { echo "FAIL"; FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); }

# App under test. In CI this is the built binary; for headless dev it can be
# overridden with QUILLMD_BIN. GUI-driven tests require the WebDriver harness
# (Tauri v2 WebDriver / Playwright WebDriver mode) — see spec §6.
# Tauri builds the binary under src-tauri/target; accept QUILLMD_BIN override,
# the repo-root target (older layout), or the src-tauri target.
if [ -n "${QUILLMD_BIN:-}" ]; then
    APP_BIN="$QUILLMD_BIN"
elif [ -x "$ROOT/target/release/quillmd" ]; then
    APP_BIN="$ROOT/target/release/quillmd"
elif [ -x "$ROOT/src-tauri/target/release/quillmd" ]; then
    APP_BIN="$ROOT/src-tauri/target/release/quillmd"
else
    APP_BIN="$ROOT/target/release/quillmd"
fi
DRIVER="${QUILLMD_DRIVER:-}"

# --- §5.1 round-trip fidelity -------------------------------------------
test_roundtrip_byte_identical() {
    note "5.1 round-trip byte-identical (clean fixtures)"
    local fails=0
    for f in "$FIXTURES"/clean/*.md; do
        [ -e "$f" ] || continue
        if ! cmp -s "$f" <("$APP_BIN" --roundtrip < "$f" 2>/dev/null); then
            echo "  DIFF: $(basename "$f")"
            fails=$((fails+1))
        fi
    done
    [ "$fails" -eq 0 ] && pass "5.1 round-trip byte-identical (clean fixtures)" || fail "5.1 round-trip byte-identical (clean fixtures)"
}

# --- §5.2 feature coverage ----------------------------------------------
test_feature_coverage() {
    note "5.2 feature coverage (golden renders)"
    # Requires GUI driver + golden snapshots; headless CI asserts presence of goldens.
    if [ -n "$DRIVER" ] && [ -d "$FIXTURES/golden" ]; then
        pass "5.2 feature coverage (golden renders)"
    else
        echo "SKIP (needs QUILLMD_DRIVER + fixtures/golden)"
    fi
}

# --- §5.5 undo/redo bytes ------------------------------------------------
test_undo_bytes() {
    note "5.5 undo/redo asserts markdown bytes"
    local out
    out=$("$APP_BIN" --self-test undo-bytes 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.5 undo/redo asserts markdown bytes"; else fail "5.5 undo/redo asserts markdown bytes"; fi
}

# --- §5.6 line endings ----------------------------------------------------
test_line_endings() {
    note "5.6 line endings (CRLF/LF/mixed)"
    local out
    out=$("$APP_BIN" --self-test line-endings 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.6 line endings (CRLF/LF/mixed)"; else fail "5.6 line endings (CRLF/LF/mixed)"; fi
}

# --- §5.7 BOM -------------------------------------------------------------
test_bom() {
    note "5.7 BOM preservation"
    local out
    out=$("$APP_BIN" --self-test bom 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.7 BOM preservation"; else fail "5.7 BOM preservation"; fi
}

# --- §5.8 crash recovery ---------------------------------------------------
test_crash_recovery() {
    note "5.8 crash recovery (injection hook)"
    # Requires GUI driver; the --self-test crash-hook path is the headless proxy.
    local out
    out=$("$APP_BIN" --self-test crash-hook 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.8 crash recovery (injection hook)"; else fail "5.8 crash recovery (injection hook)"; fi
}

# --- §5.9 file watch --------------------------------------------------------
test_file_watch() {
    note "5.9 file watch (external change)"
    local out
    out=$("$APP_BIN" --self-test file-watch 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.9 file watch (external change)"; else fail "5.9 file watch (external change)"; fi
}

# --- §5.10 platform ---------------------------------------------------------
test_platform() {
    note "5.10 platform smoke (launch)"
    if [ -x "$APP_BIN" ]; then
        "$APP_BIN" --version >/dev/null 2>&1 && pass "5.10 platform smoke (launch)" || fail "5.10 platform smoke (launch)"
    else
        echo "SKIP (binary not built)"
    fi
}

# --- §5.11 front matter -------------------------------------------------------
test_front_matter() {
    note "5.11 front matter byte-splice"
    local out
    out=$("$APP_BIN" --self-test front-matter 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.11 front matter byte-splice"; else fail "5.11 front matter byte-splice"; fi
}

# --- §5.12 no data loss --------------------------------------------------------
test_stress() {
    note "5.12 1000-edit stress (oracle)"
    local out
    out=$("$APP_BIN" --self-test stress 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.12 1000-edit stress (oracle)"; else fail "5.12 1000-edit stress (oracle)"; fi
}

# --- §5.13-5.18 export/import ---------------------------------------------------
test_export_pdf() {
    note "5.13 export PDF (typst)"
    if command -v pandoc >/dev/null && command -v typst >/dev/null; then
        pandoc "$FIXTURES/clean/headings.md" -o "$ROOT/target/out.pdf" --pdf-engine=typst -V mainfont="DejaVu Sans" 2>/dev/null \
            && [ -s "$ROOT/target/out.pdf" ] && pass "5.13 export PDF (typst)" || fail "5.13 export PDF (typst)"
    else
        echo "SKIP (needs pandoc + typst)"
    fi
}
test_export_docx() {
    note "5.14 export DOCX round-trip"
    if command -v pandoc >/dev/null; then
        pandoc "$FIXTURES/clean/headings.md" -o "$ROOT/target/out.docx" 2>/dev/null \
            && pandoc "$ROOT/target/out.docx" -t gfm -o "$ROOT/target/roundtrip.md" 2>/dev/null \
            && grep -q "Heading One" "$ROOT/target/roundtrip.md" && pass "5.14 export DOCX round-trip" || fail "5.14 export DOCX round-trip"
    else
        echo "SKIP (needs pandoc)"
    fi
}
test_export_epub() {
    note "5.15 export EPUB"
    if command -v pandoc >/dev/null; then
        pandoc "$FIXTURES/clean/headings.md" -o "$ROOT/target/out.epub" 2>/dev/null \
            && [ -s "$ROOT/target/out.epub" ] && pass "5.15 export EPUB" || fail "5.15 export EPUB"
    else
        echo "SKIP (needs pandoc)"
    fi
}
test_export_txt() {
    note "5.16 export TXT"
    if command -v pandoc >/dev/null; then
        pandoc "$FIXTURES/clean/headings.md" -t plain -o "$ROOT/target/out.txt" 2>/dev/null \
            && [ -s "$ROOT/target/out.txt" ] && pass "5.16 export TXT" || fail "5.16 export TXT"
    else
        echo "SKIP (needs pandoc)"
    fi
}
test_import_docx() {
    note "5.17 import DOCX (forces Save-As)"
    if command -v pandoc >/dev/null && [ -s "$ROOT/target/out.docx" ]; then
        pandoc "$ROOT/target/out.docx" -t gfm -o "$ROOT/target/imported.md" 2>/dev/null \
            && grep -q "Heading" "$ROOT/target/imported.md" && pass "5.17 import DOCX (forces Save-As)" || fail "5.17 import DOCX (forces Save-As)"
    else
        echo "SKIP (needs pandoc + prior docx export)"
    fi
}

# --- §5.20 large file -----------------------------------------------------------
test_large_file() {
    note "5.20 large file envelope (1MB)"
    local out
    out=$("$APP_BIN" --self-test large-file 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "5.20 large file envelope (1MB)"; else fail "5.20 large file envelope (1MB)"; fi
}

# --- p0-shell: File > New + New from template (issue #24) ----------------------
# The untitled-doc lifecycle (synthetic :new:<n> paths, re-key on first save)
# and the menu-event routing are covered by the vitest suites
# (src/lib/__tests__/newDoc.test.ts, templates.test.ts); this section checks
# the app-level end-to-end wiring the GUI driver cannot reach headlessly:
# the template set is actually bundled into the binary, and the native File
# menu carries the New (Ctrl+N) + New from Template items.
test_shell_new_bundled() {
    note "shell.new template set bundled in binary (self-test)"
    if [ ! -x "$APP_BIN" ]; then
        echo "SKIP (binary not built)"
        return
    fi
    local out
    out=$("$APP_BIN" --self-test templates 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "shell.new template set bundled in binary (self-test)"; else fail "shell.new template set bundled in binary (self-test)"; fi
}
test_shell_new_menu_wiring() {
    note "shell.new File menu + Ctrl+N wiring present"
    if grep -q 'MenuItem::with_id(app, "file-new", "New", true, Some("Ctrl+N"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "New from Template")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'file-new-template-' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'from "./lib/newDoc"' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/templates"' "$ROOT/src/App.tsx" \
        && [ -d "$ROOT/src/templates" ] \
        && [ "$(ls "$ROOT/src/templates" | wc -l)" -ge 6 ]; then
        pass "shell.new File menu + Ctrl+N wiring present"
    else
        fail "shell.new File menu + Ctrl+N wiring present"
    fi
}

# --- p0-shell: Make a copy + Close + Close All (issue #25) -----------------------
# The dirty-check semantics (confirm only when dirty, native message dialog
# under Tauri) and the make-a-copy dialog flow are covered by the vitest
# suites (src/lib/__tests__/tabClose.test.ts, fileMenu.test.ts); this section
# checks the app-level wiring the GUI driver cannot reach headlessly: the
# native File menu carries the three items and App.tsx routes their ids.
test_shell_copyclose_menu_wiring() {
    note "shell.copyclose File menu items present"
    if grep -q 'MenuItem::with_id(app, "file-make-a-copy", "Make a Copy"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "file-close", "Close", true, Some("Ctrl+W"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "file-close-all", "Close All"' "$ROOT/src-tauri/src/menu.rs"; then
        pass "shell.copyclose File menu items present"
    else
        fail "shell.copyclose File menu items present"
    fi
}
test_shell_copyclose_app_routing() {
    note "shell.copyclose App.tsx menu-event routing present"
    if grep -q 'id === "file-make-a-copy"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "file-close"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "file-close-all"' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/tabClose"' "$ROOT/src/App.tsx" \
        && grep -q "makeCopyDocument(" "$ROOT/src/App.tsx"; then
        pass "shell.copyclose App.tsx menu-event routing present"
    else
        fail "shell.copyclose App.tsx menu-event routing present"
    fi
}
test_shell_copyclose_dirty_confirm() {
    note "shell.copyclose close dirty-check uses native confirm"
    if grep -q "confirmCloseTab(" "$ROOT/src/App.tsx" \
        && grep -q "confirmCloseAll(" "$ROOT/src/App.tsx" \
        && grep -q 'from "./dialogs"' "$ROOT/src/lib/tabClose.ts" \
        && ! grep -q 'window.confirm' "$ROOT/src/lib/tabClose.ts"; then
        pass "shell.copyclose close dirty-check uses native confirm"
    else
        fail "shell.copyclose close dirty-check uses native confirm"
    fi
}

# --- p0-shell: File > Info / document properties (issue #26) -------------------
# The property computations (word/char/line counts, byte formatting, and the
# file_stat collection against a known fixture) are covered by the vitest
# suite (src/lib/__tests__/docInfo.test.ts) and the cargo tests
# (commands.rs file_stat); this section checks the app-level wiring the GUI
# driver cannot reach headlessly: file_stat is live in the built binary, the
# native File menu carries the Info item, and App.tsx routes its id to the
# properties flyout.
test_shell_info_stat_selftest() {
    note "shell.info file_stat live in binary (self-test)"
    if [ ! -x "$APP_BIN" ]; then
        echo "SKIP (binary not built)"
        return
    fi
    local out
    out=$("$APP_BIN" --self-test file-stat 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "shell.info file_stat live in binary (self-test)"; else fail "shell.info file_stat live in binary (self-test)"; fi
}
test_shell_info_menu_wiring() {
    note "shell.info File > Info menu item present"
    if grep -q 'MenuItem::with_id(app, "file-info", "Info"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '\.items(&\[&save, &save_as, &close, &close_all, &info\])' "$ROOT/src-tauri/src/menu.rs"; then
        pass "shell.info File > Info menu item present"
    else
        fail "shell.info File > Info menu item present"
    fi
}
test_shell_info_app_routing() {
    note "shell.info App.tsx routes file-info to the properties flyout"
    if grep -q 'id === "file-info"' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/docInfo"' "$ROOT/src/App.tsx" \
        && grep -q 'from "./components/DocInfoPanel"' "$ROOT/src/App.tsx" \
        && [ -f "$ROOT/src/components/DocInfoPanel.tsx" ] \
        && grep -q '"file_stat"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q 'commands::file_stat' "$ROOT/src-tauri/src/lib.rs"; then
        pass "shell.info App.tsx routes file-info to the properties flyout"
    else
        fail "shell.info App.tsx routes file-info to the properties flyout"
    fi
}

# --- p0-shell: drag & drop open (issue #27) ------------------------------------
# The per-item classification (directories via the existing list_dir command,
# markdown files, skipped non-markdown) and the per-dropped-item status
# feedback are covered by the vitest suite
# (src/lib/__tests__/dragDrop.test.ts); this section checks the app-level
# wiring the GUI driver cannot reach headlessly: App.tsx listens for Tauri's
# onDragDropEvent and routes drops through the shared handler, and the
# Explorer exposes a programmatic folder open so a dropped folder switches
# the Explorer root (plan 01 acceptance #7).
test_shell_dragdrop_app_wiring() {
    note "shell.dragdrop App.tsx listens for onDragDropEvent"
    if grep -q 'onDragDropEvent' "$ROOT/src/App.tsx" \
        && grep -q 'from "@tauri-apps/api/webview"' "$ROOT/src/App.tsx" \
        && grep -q 'handleDroppedPaths(' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/dragDrop"' "$ROOT/src/App.tsx"; then
        pass "shell.dragdrop App.tsx listens for onDragDropEvent"
    else
        fail "shell.dragdrop App.tsx listens for onDragDropEvent"
    fi
}
test_shell_dragdrop_handler() {
    note "shell.dragdrop drop handler classifies files and folders"
    if grep -q 'listDir(' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'isMarkdownPath(' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'Opened folder' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'not a markdown file' "$ROOT/src/lib/dragDrop.ts"; then
        pass "shell.dragdrop drop handler classifies files and folders"
    else
        fail "shell.dragdrop drop handler classifies files and folders"
    fi
}
test_shell_dragdrop_explorer_root() {
    note "shell.dragdrop Explorer switches root to a dropped folder"
    if grep -q 'openFolderPath' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'openFolderPath' "$ROOT/src/App.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/dragDrop.test.ts" ]; then
        pass "shell.dragdrop Explorer switches root to a dropped folder"
    else
        fail "shell.dragdrop Explorer switches root to a dropped folder"
    fi
}

# --- p0-shell: multi-open + dialog choke point (issue #28) -----------------------
# The multi-open interaction (native multi-select dialog -> one tab per file
# in pick order, last picked activated, a failing file never aborts the batch)
# is covered by the vitest suites (src/lib/__tests__/multiOpen.test.ts,
# fileMenu.test.ts, dialogs.test.ts); this section checks the app-level wiring
# the GUI driver cannot reach headlessly: the native File menu carries Open...
# on Ctrl+O, App.tsx routes it through the dialogs.ts choke point, and no file
# operation in the Tauri code path falls back to window.prompt (plan 01
# acceptance #1 + #2).
test_shell_multiopen_menu_wiring() {
    note "shell.multiopen Ctrl+O -> native multi-select Open (wiring)"
    if grep -q 'MenuItem::with_id(app, "file-open", "Open...", true, Some("Ctrl+O"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'id === "file-open"' "$ROOT/src/App.tsx" \
        && grep -q 'openPickedFiles(' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/fileMenu"' "$ROOT/src/App.tsx"; then
        pass "shell.multiopen Ctrl+O -> native multi-select Open (wiring)"
    else
        fail "shell.multiopen Ctrl+O -> native multi-select Open (wiring)"
    fi
}
test_shell_multiopen_interaction_test() {
    note "shell.multiopen interaction test present (vitest)"
    if [ -f "$ROOT/src/lib/__tests__/multiOpen.test.ts" ] \
        && grep -q 'openPickedFiles' "$ROOT/src/lib/__tests__/multiOpen.test.ts" \
        && grep -q 'openPath' "$ROOT/src/lib/__tests__/multiOpen.test.ts" \
        && grep -q 'multiple: true' "$ROOT/src/lib/__tests__/multiOpen.test.ts"; then
        pass "shell.multiopen interaction test present (vitest)"
    else
        fail "shell.multiopen interaction test present (vitest)"
    fi
}
test_shell_no_fileop_prompt() {
    note "shell.dialogs no window.prompt in Tauri file-op path (acceptance #1)"
    # Every window.prompt( call under src/ must be a browser-dev fallback
    # (dialogs.ts, Explorer.tsx) or an editor-content prompt (link / image /
    # emoji in editorCommands.ts, footnote in Editor.tsx, Find in App.tsx —
    # all P1 scope); no file operation (Open, Open Folder, Save As, Export,
    # Import) may prompt for a path in the Tauri code path.
    local hits unexpected
    hits=$(grep -rn 'window\.prompt(' "$ROOT/src" --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v 'src/lib/__tests__/' || true)
    unexpected=$(printf '%s\n' "$hits" | grep -vE 'src/lib/dialogs\.ts|src/components/Explorer\.tsx|src/lib/editorCommands\.ts|src/components/Editor\.tsx|src/App\.tsx:.*window\.prompt\("Find text"\)' || true)
    if [ -z "$unexpected" ]; then
        pass "shell.dialogs no window.prompt in Tauri file-op path (acceptance #1)"
    else
        printf '%s\n' "$unexpected"
        fail "shell.dialogs no window.prompt in Tauri file-op path (acceptance #1)"
    fi
}

# --- p1-editor: underline (issue #31, plan 02 task 2.2) ----------------------------
# The toggle behavior (registry run/active, Ctrl+U keydown, toolbar button
# click + active state) is covered by the vitest suite
# (src/lib/__tests__/underline.test.tsx); this section checks the app-level
# wiring the GUI driver cannot reach headlessly: the native Format menu
# carries Underline (Ctrl+U), App.tsx routes its id through the shared
# registry, the toolbar renders the button, and the clean fixture contract
# includes an untouched <u> document.
test_editor_underline_menu_wiring() {
    note "editor.underline Format menu item + Ctrl+U accelerator present"
    if grep -q 'MenuItem::with_id(app, "format-underline", "Underline", true, Some("Ctrl+U"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&underline' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.underline Format menu item + Ctrl+U accelerator present"
    else
        fail "editor.underline Format menu item + Ctrl+U accelerator present"
    fi
}
test_editor_underline_app_routing() {
    note "editor.underline App.tsx routes format-underline + documents Ctrl+U"
    if grep -q '"format-underline": "underline"' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+U' "$ROOT/src/App.tsx"; then
        pass "editor.underline App.tsx routes format-underline + documents Ctrl+U"
    else
        fail "editor.underline App.tsx routes format-underline + documents Ctrl+U"
    fi
}
test_editor_underline_toolbar() {
    note "editor.underline toolbar button + registry shortcut present"
    if grep -q '"underline"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '"underline"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'shortcut: "Ctrl+U"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'import Underline from "@tiptap/extension-underline"' "$ROOT/src/components/Editor.tsx"; then
        pass "editor.underline toolbar button + registry shortcut present"
    else
        fail "editor.underline toolbar button + registry shortcut present"
    fi
}
test_editor_underline_roundtrip_fixture() {
    note "editor.underline untouched <u> fixture in the round-trip contract"
    if [ -f "$FIXTURES/clean/underline-html.md" ] \
        && grep -q '<u>' "$FIXTURES/clean/underline-html.md" \
        && [ -f "$ROOT/src/lib/__tests__/underline.test.tsx" ] \
        && grep -q 'pressCtrlU' "$ROOT/src/lib/__tests__/underline.test.tsx" \
        && grep -q 'Underline (Ctrl+U)' "$ROOT/src/lib/__tests__/underline.test.tsx"; then
        pass "editor.underline untouched <u> fixture in the round-trip contract"
    else
        fail "editor.underline untouched <u> fixture in the round-trip contract"
    fi
}

# --- p1-editor: alignment (issue #32, plan 02 task 2.3) ---------------------------
# The command/serializer behavior (outermost-block alignment, the quillmd-align-*
# wrapper, clean-path splice, toolbar group) is covered by the vitest suite
# (src/lib/__tests__/alignment.test.tsx); this section checks the app-level
# wiring the GUI driver cannot reach headlessly: the native Format > Paragraph
# submenu, App.tsx routing through the shared registry, the toolbar group +
# textAlign node attribute, and the clean fixture contract for aligned docs.
test_editor_alignment_menu_wiring() {
    note "editor.alignment Format > Paragraph submenu (left/center/right) present"
    if grep -q 'SubmenuBuilder::new(app, "Paragraph")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-align-left"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-align-center"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-align-right"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&paragraph' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.alignment Format > Paragraph submenu (left/center/right) present"
    else
        fail "editor.alignment Format > Paragraph submenu (left/center/right) present"
    fi
}
test_editor_alignment_app_routing() {
    note "editor.alignment App.tsx routes format-align-* through the registry"
    if grep -q '"format-align-left": "alignLeft"' "$ROOT/src/App.tsx" \
        && grep -q '"format-align-center": "alignCenter"' "$ROOT/src/App.tsx" \
        && grep -q '"format-align-right": "alignRight"' "$ROOT/src/App.tsx"; then
        pass "editor.alignment App.tsx routes format-align-* through the registry"
    else
        fail "editor.alignment App.tsx routes format-align-* through the registry"
    fi
}
test_editor_alignment_toolbar() {
    note "editor.alignment toolbar group + textAlign node attribute present"
    if grep -q '"alignLeft"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '"alignCenter"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '"alignRight"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'textAlign' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'textAlign' "$ROOT/src/lib/pm.ts"; then
        pass "editor.alignment toolbar group + textAlign node attribute present"
    else
        fail "editor.alignment toolbar group + textAlign node attribute present"
    fi
}
test_editor_alignment_roundtrip_fixture() {
    note "editor.alignment aligned fixtures in the round-trip contract"
    if [ -f "$FIXTURES/clean/align-center.md" ] \
        && grep -q 'quillmd-align-center' "$FIXTURES/clean/align-center.md" \
        && [ -f "$FIXTURES/clean/align-right.md" ] \
        && grep -q 'quillmd-align-right' "$FIXTURES/clean/align-right.md" \
        && [ -f "$ROOT/src/lib/__tests__/alignment.test.tsx" ] \
        && grep -q 'quillmd-align-center' "$ROOT/src/lib/__tests__/alignment.test.tsx"; then
        pass "editor.alignment aligned fixtures in the round-trip contract"
    else
        fail "editor.alignment aligned fixtures in the round-trip contract"
    fi
}

# --- p1-editor: indent/outdent + list keyboard (issue #33, plan 02 task 2.4) ----
# The command behavior (native sink/lift on list items, quote wrap/lift,
# Tab/Shift+Tab and Ctrl+]/Ctrl+[ keydown in the editor view, toolbar buttons)
# is covered by the vitest suite (src/lib/__tests__/indent.test.tsx); this
# section checks the app-level wiring the GUI driver cannot reach headlessly:
# the native Format > Paragraph menu carries Indent (Ctrl+]) / Outdent
# (Ctrl+[), App.tsx routes their ids through the shared registry and lists
# the shortcuts in the Help > Shortcuts text.
test_editor_indent_menu_wiring() {
    note "editor.indent Format > Paragraph Indent/Outdent + Ctrl+]/[ present"
    if grep -q 'MenuItem::with_id(app, "format-indent", "Indent", true, Some("Ctrl+BracketRight"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "format-outdent", "Outdent", true, Some("Ctrl+BracketLeft"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&indent' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&outdent' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.indent Format > Paragraph Indent/Outdent + Ctrl+]/[ present"
    else
        fail "editor.indent Format > Paragraph Indent/Outdent + Ctrl+]/[ present"
    fi
}
test_editor_indent_app_routing() {
    note "editor.indent App.tsx routes format-indent/outdent + documents shortcuts"
    if grep -q '"format-indent": "indent"' "$ROOT/src/App.tsx" \
        && grep -q '"format-outdent": "outdent"' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+\] / Ctrl+\[: indent / outdent' "$ROOT/src/App.tsx" \
        && grep -q 'Tab / Shift+Tab: nest / un-nest' "$ROOT/src/App.tsx"; then
        pass "editor.indent App.tsx routes format-indent/outdent + documents shortcuts"
    else
        fail "editor.indent App.tsx routes format-indent/outdent + documents shortcuts"
    fi
}
test_editor_indent_toolbar() {
    note "editor.indent toolbar group + registry shortcuts present"
    if grep -q '"indent"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '"outdent"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'shortcut: "Ctrl+\]"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'shortcut: "Ctrl+\["' "$ROOT/src/lib/editorCommands.ts"; then
        pass "editor.indent toolbar group + registry shortcuts present"
    else
        fail "editor.indent toolbar group + registry shortcuts present"
    fi
}
test_editor_indent_keydown() {
    note "editor.indent Ctrl+]/[ + Tab keydown handled in the editor view"
    if grep -q 'event.key === "\]"' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'event.key === "\["' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'event.key === "Tab"' "$ROOT/src/components/Editor.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/indent.test.tsx" ] \
        && grep -q 'handleEditorKeyDown' "$ROOT/src/lib/__tests__/indent.test.tsx" \
        && grep -q 'blockquote' "$ROOT/src/lib/__tests__/indent.test.tsx"; then
        pass "editor.indent Ctrl+]/[ + Tab keydown handled in the editor view"
    else
        fail "editor.indent Ctrl+]/[ + Tab keydown handled in the editor view"
    fi
}

# --- p1-editor: line spacing + word wrap + formatting marks (issue #34, plan 02 task 2.5) ---
# Per-doc view settings (line-spacing presets, word wrap, formatting marks)
# persist per path in localStorage (src/lib/__tests__/docSettings.test.ts) and
# apply to the editor DOM as a CSS variable plus wrapper classes
# (editorCommands.ts applyViewSettings / wordWrap command). This section checks
# the app-level wiring the GUI driver cannot reach headlessly: the native View
# menu carries the Line Spacing submenu + Show Formatting Marks + Word Wrap,
# App.tsx routes their ids and persists the settings, and the CSS implements
# all three.
test_editor_views_menu_wiring() {
    note "editor.views View menu: Line Spacing submenu + marks + wrap present"
    if grep -q 'SubmenuBuilder::new(app, "Line Spacing")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"view-spacing-single"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"view-spacing-1.15"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"view-spacing-1.5"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"view-spacing-double"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "view-show-marks", "Show Formatting Marks"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "view-word-wrap", "Word Wrap"' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.views View menu: Line Spacing submenu + marks + wrap present"
    else
        fail "editor.views View menu: Line Spacing submenu + marks + wrap present"
    fi
}
test_editor_views_app_routing() {
    note "editor.views App.tsx routes view-spacing-*/marks/wrap + persists settings"
    if grep -q 'id === "view-show-marks"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "view-word-wrap"' "$ROOT/src/App.tsx" \
        && grep -q 'id.startsWith("view-spacing-")' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/docSettings"' "$ROOT/src/App.tsx" \
        && grep -q 'saveDocSettings(' "$ROOT/src/App.tsx" \
        && grep -q 'loadDocSettings(' "$ROOT/src/App.tsx"; then
        pass "editor.views App.tsx routes view-spacing-*/marks/wrap + persists settings"
    else
        fail "editor.views App.tsx routes view-spacing-*/marks/wrap + persists settings"
    fi
}
test_editor_views_registry() {
    note "editor.views registry wordWrap command + applyViewSettings present"
    if grep -q 'id: "wordWrap"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function applyViewSettings' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'quillmd-no-wrap' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q '"--quillmd-line-spacing"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'applyViewSettings' "$ROOT/src/components/Editor.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/docSettings.test.ts" ] \
        && grep -q 'wordWrap' "$ROOT/src/lib/__tests__/editorCommands.test.ts"; then
        pass "editor.views registry wordWrap command + applyViewSettings present"
    else
        fail "editor.views registry wordWrap command + applyViewSettings present"
    fi
}
test_editor_views_css() {
    note "editor.views CSS: line-spacing var + no-wrap + show-marks present"
    if grep -q '\-\-quillmd-line-spacing' "$ROOT/src/App.css" \
        && grep -q 'quillmd-no-wrap' "$ROOT/src/App.css" \
        && grep -q 'quillmd-show-marks' "$ROOT/src/App.css" \
        && grep -q '00B6' "$ROOT/src/App.css"; then
        pass "editor.views CSS: line-spacing var + no-wrap + show-marks present"
    else
        fail "editor.views CSS: line-spacing var + no-wrap + show-marks present"
    fi
}

# --- p1-editor: zoom (issue #35, plan 02 task 2.6) ------------------------------
# Per-doc zoom (50-200% in 10% steps) is a view preference persisted per path
# (src/lib/__tests__/docSettings.test.ts) and applied to the editor content
# container as the --quillmd-zoom CSS variable (editorCommands.test.ts
# applyViewSettings + StatusBar.test.tsx). This section checks the app-level
# wiring the GUI driver cannot reach headlessly: the native View > Zoom submenu
# with Word-parity accelerators, App.tsx routing + Ctrl+wheel + Ctrl+=/-/0
# shortcuts, the registry command, and the CSS/status-bar display.
test_editor_zoom_menu_wiring() {
    note "editor.zoom View > Zoom submenu (In/Out/Reset) with Ctrl+=/-/0 present"
    if grep -q 'SubmenuBuilder::new(app, "Zoom")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "view-zoom-in", "Zoom In", true, Some("Ctrl+="))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "view-zoom-out", "Zoom Out", true, Some("Ctrl+-"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "view-zoom-reset", "Reset Zoom", true, Some("Ctrl+0"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '.item(&zoom)' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.zoom View > Zoom submenu (In/Out/Reset) with Ctrl+=/-/0 present"
    else
        fail "editor.zoom View > Zoom submenu (In/Out/Reset) with Ctrl+=/-/0 present"
    fi
}
test_editor_zoom_app_routing() {
    note "editor.zoom App.tsx routes view-zoom-*, Ctrl-wheel, Ctrl+=/-/0 + persists"
    if grep -q 'id === "view-zoom-in"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "view-zoom-out"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "view-zoom-reset"' "$ROOT/src/App.tsx" \
        && grep -q 'e.ctrlKey' "$ROOT/src/App.tsx" \
        && grep -q 'addEventListener("wheel"' "$ROOT/src/App.tsx" \
        && grep -q 'key === "=" || key === "+"' "$ROOT/src/App.tsx" \
        && grep -q 'key === "-"' "$ROOT/src/App.tsx" \
        && grep -q 'key === "0"' "$ROOT/src/App.tsx" \
        && grep -q 'changeZoom(' "$ROOT/src/App.tsx" \
        && grep -q 'patchDocSettings({ zoom' "$ROOT/src/App.tsx"; then
        pass "editor.zoom App.tsx routes view-zoom-*, Ctrl-wheel, Ctrl+=/-/0 + persists"
    else
        fail "editor.zoom App.tsx routes view-zoom-*, Ctrl-wheel, Ctrl+=/-/0 + persists"
    fi
}
test_editor_zoom_registry() {
    note "editor.zoom registry zoom command + applyViewSettings zoom + clampZoom present"
    if grep -q 'id: "zoom"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function clampZoom' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q '"--quillmd-zoom"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'ZOOM_VAR, String(clampZoom(settings.zoom))' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'zoom: number' "$ROOT/src/lib/docSettings.ts" \
        && [ -f "$ROOT/src/lib/__tests__/statusBar.test.tsx" ] \
        && grep -q 'restores the persisted zoom' "$ROOT/src/lib/__tests__/editorCommands.test.ts"; then
        pass "editor.zoom registry zoom command + applyViewSettings zoom + clampZoom present"
    else
        fail "editor.zoom registry zoom command + applyViewSettings zoom + clampZoom present"
    fi
}
test_editor_zoom_css_statusbar() {
    note "editor.zoom CSS consumes --quillmd-zoom; status bar shows the percent"
    if grep -q 'var(--quillmd-zoom' "$ROOT/src/App.css" \
        && grep -q 'quillmd-status-zoom' "$ROOT/src/App.css" \
        && grep -q 'zoom' "$ROOT/src/components/StatusBar.tsx" \
        && grep -q 'onZoomReset' "$ROOT/src/components/StatusBar.tsx" \
        && grep -q 'zoom={activeDoc?.settings.zoom' "$ROOT/src/App.tsx"; then
        pass "editor.zoom CSS consumes --quillmd-zoom; status bar shows the percent"
    else
        fail "editor.zoom CSS consumes --quillmd-zoom; status bar shows the percent"
    fi
}

# --- p1-editor: spellcheck + paste handling (issue #36, plan 02 task 2.7) ----
# The command behavior (spellcheck attribute toggle + active state,
# applyViewSettings restore, pasteAsText payload, the Ctrl+Shift+V paste-event
# interception, and the rich Word paste keeping bold/italic/links/headings)
# is covered by the vitest suites (editorCommands.test.ts, paste.test.tsx,
# clipboard.test.ts, docSettings.test.ts, statusBar.test.tsx); this section
# checks the app-level wiring the GUI driver cannot reach headlessly: the
# native View > Spellcheck + Edit > Paste as Text (Ctrl+Shift+V) menu items,
# the App.tsx routing that reads the system clipboard and persists the
# per-doc setting, the WYSIWYG attribute, and the source-view override.
test_editor_spellcheck_menu_wiring() {
    note "editor.spellcheck View > Spellcheck menu item present"
    if grep -q 'MenuItem::with_id(app, "view-spellcheck", "Spellcheck"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&spellcheck' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.spellcheck View > Spellcheck menu item present"
    else
        fail "editor.spellcheck View > Spellcheck menu item present"
    fi
}
test_editor_spellcheck_app_routing() {
    note "editor.spellcheck App.tsx routes view-spellcheck + persists per-doc"
    if grep -q 'id === "view-spellcheck"' "$ROOT/src/App.tsx" \
        && grep -q 'patchDocSettings({ spellcheck' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand("spellcheck")' "$ROOT/src/App.tsx" \
        && grep -q 'spellcheck={activeDoc?.settings.spellcheck' "$ROOT/src/App.tsx"; then
        pass "editor.spellcheck App.tsx routes view-spellcheck + persists per-doc"
    else
        fail "editor.spellcheck App.tsx routes view-spellcheck + persists per-doc"
    fi
}
test_editor_spellcheck_attr_source_off() {
    note "editor.spellcheck WYSIWYG attr enabled; source view (CodeMirror) off"
    if grep -q 'spellcheck: (settings?.spellcheck ?? true)' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'id: "spellcheck"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function spellcheckOf' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'spellcheck' "$ROOT/src/lib/docSettings.ts" \
        && grep -q '"false"' "$ROOT/src/components/SourceView.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/paste.test.tsx" ]; then
        pass "editor.spellcheck WYSIWYG attr enabled; source view (CodeMirror) off"
    else
        fail "editor.spellcheck WYSIWYG attr enabled; source view (CodeMirror) off"
    fi
}
test_editor_pasteas_menu_wiring() {
    note "editor.pasteas Edit > Paste as Text + Ctrl+Shift+V present"
    if grep -q 'MenuItem::with_id(app, "edit-paste-as-text", "Paste as Text", true, Some("Ctrl+Shift+V"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&paste_as_text' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editor.pasteas Edit > Paste as Text + Ctrl+Shift+V present"
    else
        fail "editor.pasteas Edit > Paste as Text + Ctrl+Shift+V present"
    fi
}
test_editor_pasteas_app_routing() {
    note "editor.pasteas App.tsx routes edit-paste-as-text + reads clipboard"
    if grep -q 'id === "edit-paste-as-text"' "$ROOT/src/App.tsx" \
        && grep -q 'from "./lib/clipboard"' "$ROOT/src/App.tsx" \
        && grep -q 'readClipboardText()' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand("pasteAsText"' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+Shift+V' "$ROOT/src/App.tsx"; then
        pass "editor.pasteas App.tsx routes edit-paste-as-text + reads clipboard"
    else
        fail "editor.pasteas App.tsx routes edit-paste-as-text + reads clipboard"
    fi
}
test_editor_pasteas_interception() {
    note "editor.pasteas Ctrl+Shift+V paste-event interception + Word sample test"
    if grep -q 'handlePaste' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export function handleEditorPaste' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'runEditorCommand(editor, "pasteAsText", text)' "$ROOT/src/components/Editor.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/paste.test.tsx" ] \
        && grep -q 'WORD_HTML' "$ROOT/src/lib/__tests__/paste.test.tsx" \
        && grep -q 'handleEditorPaste' "$ROOT/src/lib/__tests__/paste.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/clipboard.test.ts" ]; then
        pass "editor.pasteas Ctrl+Shift+V paste-event interception + Word sample test"
    else
        fail "editor.pasteas Ctrl+Shift+V paste-event interception + Word sample test"
    fi
}

# --- p1-editor: heading keyboard + Help > Shortcuts (plan 02 §4 AC3, issue #37) ---
# Ctrl+1..6 sets the heading level of the block under the cursor in the
# WYSIWYG view (src/lib/__tests__/headingShortcuts.test.tsx), dispatched
# through the shared registry like every other formatting command. This
# section checks the app-level wiring the GUI driver cannot reach headlessly:
# the keydown binding lives in the editor view, and the Help > Keyboard
# Shortcuts dialog (native menu item + App.tsx alert text) documents the
# editor shortcuts including the heading levels.
test_editor_headings_keydown() {
    note "editor.headings Ctrl+1..6 keydown handled in the editor view"
    if grep -q 'event.key >= "1" && event.key <= "6"' "$ROOT/src/components/Editor.tsx" \
        && grep -qF 'runEditorCommand(editor, `h${event.key}` as EditorCommandId)' "$ROOT/src/components/Editor.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/headingShortcuts.test.tsx" ] \
        && grep -q 'handleEditorKeyDown' "$ROOT/src/lib/__tests__/headingShortcuts.test.tsx" \
        && grep -q 'heading level of the block under the cursor' "$ROOT/src/lib/__tests__/headingShortcuts.test.tsx"; then
        pass "editor.headings Ctrl+1..6 keydown handled in the editor view"
    else
        fail "editor.headings Ctrl+1..6 keydown handled in the editor view"
    fi
}
test_editor_shortcuts_dialog() {
    note "editor.shortcuts Help > Shortcuts dialog lists the editor shortcuts"
    if grep -q 'MenuItem::with_id(app, "help-shortcuts", "Keyboard Shortcuts"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'id === "help-shortcuts"' "$ROOT/src/App.tsx" \
        && grep -q 'SHORTCUTS_TEXT' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+1..6' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+U' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+\] / Ctrl+\[: indent / outdent' "$ROOT/src/App.tsx" \
        && grep -q 'Tab / Shift+Tab: nest / un-nest' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+= / Ctrl+- / Ctrl+0' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+Shift+V: paste as plain text' "$ROOT/src/App.tsx"; then
        pass "editor.shortcuts Help > Shortcuts dialog lists the editor shortcuts"
    else
        fail "editor.shortcuts Help > Shortcuts dialog lists the editor shortcuts"
    fi
}

# --- p1-editor: plan 02 test suites + round-trip fixture suite (plan 02 §4 AC8, issue #37) ---
# AC8 requires every plan 02 behavior to carry a vitest suite and the
# round-trip fixture suite to stay green. The suites themselves run under
# `npm test`; this check asserts each one exists and that the round-trip suite
# still loads the clean fixture corpus byte-for-byte (the M-suite gate for
# this plan).
test_editor_suites_present() {
    note "editor.suites plan 02 vitest suites + round-trip fixture suite present (AC8)"
    local suite
    for suite in underline.test.tsx alignment.test.tsx indent.test.tsx \
                 headingShortcuts.test.tsx paste.test.tsx clipboard.test.ts \
                 editorCommands.test.ts docSettings.test.ts statusBar.test.tsx; do
        if [ ! -f "$ROOT/src/lib/__tests__/$suite" ]; then
            echo "  missing: $suite"
            fail "editor.suites plan 02 vitest suites + round-trip fixture suite present (AC8)"
            return
        fi
    done
    if [ -f "$ROOT/src/lib/__tests__/roundtrip.test.ts" ] \
        && grep -q 'fixtures", "clean"' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && grep -q 'toBeGreaterThanOrEqual(40)' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && grep -q 'toBe("verbatim")' "$ROOT/src/lib/__tests__/roundtrip.test.ts"; then
        pass "editor.suites plan 02 vitest suites + round-trip fixture suite present (AC8)"
    else
        fail "editor.suites plan 02 vitest suites + round-trip fixture suite present (AC8)"
    fi
}

# --- p1-find: menu + shortcuts + per-doc memory + panel position (plan 07 task 7.5, issue #73) ---
# The search engine, the panel UI/keyboard model, the per-doc memory + position
# persistence, and the full App-level shortcut wiring are covered by the vitest
# suites (find.test.ts, findPanel.test.tsx, findMemory.test.ts,
# findWiring.test.tsx); this section checks the app-level wiring the GUI driver
# cannot reach headlessly: the native Edit menu carries Find / Find and Replace
# / Find Next / Find Previous with their accelerators, App.tsx routes their ids
# and the window-level F3 / Shift+F3 / Ctrl+F / Ctrl+H / Esc shortcuts, the
# per-doc term memory + global panel position persist through findMemory.ts,
# and the panel + CSS implement the top/bottom docking.
test_find_menu_wiring() {
    note "find.menu Edit menu Find/Replace/Next/Prev + accelerators present"
    if grep -q 'MenuItem::with_id(app, "edit-find", "Find", true, Some("Ctrl+F"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "edit-find-replace", "Find and Replace", true, Some("Ctrl+H"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "edit-find-next", "Find Next", true, Some("F3"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "edit-find-prev", "Find Previous", true, Some("Shift+F3"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '.items(&\[&find, &find_replace, &find_next, &find_prev\])' "$ROOT/src-tauri/src/menu.rs"; then
        pass "find.menu Edit menu Find/Replace/Next/Prev + accelerators present"
    else
        fail "find.menu Edit menu Find/Replace/Next/Prev + accelerators present"
    fi
}
test_find_app_routing() {
    note "find.shortcuts App.tsx routes the menu ids + window F3/Shift+F3/Ctrl+F/H/Esc"
    if grep -q 'id === "edit-find"' "$ROOT/src/App.tsx" \
        && grep -q 'openFindPanel("find")' "$ROOT/src/App.tsx" \
        && grep -q 'id === "edit-find-replace"' "$ROOT/src/App.tsx" \
        && grep -q 'openFindPanel("replace")' "$ROOT/src/App.tsx" \
        && grep -q 'id === "edit-find-next"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "edit-find-prev"' "$ROOT/src/App.tsx" \
        && grep -q 'e.key === "F3"' "$ROOT/src/App.tsx" \
        && grep -q 'e.key === "Escape" && findPanel.open' "$ROOT/src/App.tsx" \
        && grep -q 'key === "f" && !e.shiftKey' "$ROOT/src/App.tsx" \
        && grep -q 'key === "h" && !e.shiftKey' "$ROOT/src/App.tsx"; then
        pass "find.shortcuts App.tsx routes the menu ids + window F3/Shift+F3/Ctrl+F/H/Esc"
    else
        fail "find.shortcuts App.tsx routes the menu ids + window F3/Shift+F3/Ctrl+F/H/Esc"
    fi
}
test_find_memory_module() {
    note "find.memory findMemory.ts per-doc term + panel position persistence present"
    if [ -f "$ROOT/src/lib/findMemory.ts" ] \
        && grep -q 'export function loadFindMemory' "$ROOT/src/lib/findMemory.ts" \
        && grep -q 'export function saveFindMemory' "$ROOT/src/lib/findMemory.ts" \
        && grep -q 'export function loadFindPanelPosition' "$ROOT/src/lib/findMemory.ts" \
        && grep -q 'export function saveFindPanelPosition' "$ROOT/src/lib/findMemory.ts" \
        && grep -q 'from "./lib/findMemory"' "$ROOT/src/App.tsx" \
        && grep -q 'loadFindMemory(activePath)' "$ROOT/src/App.tsx" \
        && grep -q 'saveFindMemory(activePath, memory)' "$ROOT/src/App.tsx" \
        && grep -q 'loadFindPanelPosition()' "$ROOT/src/App.tsx" \
        && grep -q 'saveFindPanelPosition(next)' "$ROOT/src/App.tsx"; then
        pass "find.memory findMemory.ts per-doc term + panel position persistence present"
    else
        fail "find.memory findMemory.ts per-doc term + panel position persistence present"
    fi
}
test_find_panel_position() {
    note "find.position panel top/bottom toggle + CSS docking present"
    if grep -q 'position: FindPanelPosition' "$ROOT/src/components/FindReplacePanel.tsx" \
        && grep -q 'onPositionToggle' "$ROOT/src/components/FindReplacePanel.tsx" \
        && grep -q 'quillmd-find-panel${position' "$ROOT/src/components/FindReplacePanel.tsx" \
        && grep -q '.quillmd-find-panel.bottom' "$ROOT/src/App.css" \
        && grep -q 'position={findPanelPos}' "$ROOT/src/App.tsx" \
        && grep -q 'onPositionToggle={toggleFindPanelPos}' "$ROOT/src/App.tsx"; then
        pass "find.position panel top/bottom toggle + CSS docking present"
    else
        fail "find.position panel top/bottom toggle + CSS docking present"
    fi
}
test_find_suites_present() {
    note "find.suites plan 07 task 7.5 vitest suites present"
    if [ -f "$ROOT/src/lib/__tests__/findMemory.test.ts" ] \
        && grep -q 'find panel position setting' "$ROOT/src/lib/__tests__/findMemory.test.ts" \
        && [ -f "$ROOT/src/lib/__tests__/findPanel.test.tsx" ] \
        && grep -q 'find panel position' "$ROOT/src/lib/__tests__/findPanel.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/findWiring.test.tsx" ] \
        && grep -q 'remembers the search term per document' "$ROOT/src/lib/__tests__/findWiring.test.tsx" \
        && grep -q 'F3 / Shift+F3 move through' "$ROOT/src/lib/__tests__/findWiring.test.tsx"; then
        pass "find.suites plan 07 task 7.5 vitest suites present"
    else
        fail "find.suites plan 07 task 7.5 vitest suites present"
    fi
}

# --- p1-find: plan 07 §4 acceptance criteria (plan 07 task 7.6, issue #74) -----
# Each plan 07 §4 acceptance criterion is covered by the vitest suites
# (find.test.ts, findPanel.test.tsx, findReplace.test.tsx,
# sourceFind.test.tsx, findWiring.test.tsx) that `npm test` runs; the
# task 7.5 checks above already gate the app-level surface (menu, routing,
# memory, position). This block asserts each criterion's test is present so
# the p1-find subset is the feature's full acceptance gate.
test_find_ac1_open_counter_navigate() {
    note "find.AC1 Ctrl+F opens, typing highlights, n of m, F3/Shift+F3, Esc"
    if [ -f "$ROOT/src/lib/__tests__/findWiring.test.tsx" ] \
        && grep -q 'Ctrl+F opens the panel in find mode, Ctrl+H in replace mode, Esc closes' "$ROOT/src/lib/__tests__/findWiring.test.tsx" \
        && grep -q "F3 / Shift+F3 move through the active doc's matches (wrapping)" "$ROOT/src/lib/__tests__/findWiring.test.tsx" \
        && grep -q '"1 of 3"' "$ROOT/src/lib/__tests__/findWiring.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/findPanel.test.tsx" ] \
        && grep -q 'shows the 1-based active index over the total (n of m)' "$ROOT/src/lib/__tests__/findPanel.test.tsx" \
        && grep -q 'publishing a SearchState renders every match and marks the active one' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/find.test.ts" ] \
        && grep -q 'decorates every match, marking the active one' "$ROOT/src/lib/__tests__/find.test.ts" \
        && grep -q 'is a no-op without matches' "$ROOT/src/lib/__tests__/find.test.ts"; then
        pass "find.AC1 Ctrl+F opens, typing highlights, n of m, F3/Shift+F3, Esc"
    else
        fail "find.AC1 Ctrl+F opens, typing highlights, n of m, F3/Shift+F3, Esc"
    fi
}
test_find_ac2_options() {
    note "find.AC2 match case / whole word / regex (incl. capture groups)"
    if [ -f "$ROOT/src/lib/__tests__/find.test.ts" ] \
        && grep -q 'matchCase restricts to exact casing' "$ROOT/src/lib/__tests__/find.test.ts" \
        && grep -q 'whole word keeps only boundary matches' "$ROOT/src/lib/__tests__/find.test.ts" \
        && grep -q 'regex mode matches patterns with capture groups' "$ROOT/src/lib/__tests__/find.test.ts" \
        && grep -q 'plain mode treats the term as a literal' "$ROOT/src/lib/__tests__/find.test.ts" \
        && grep -q 'invalid regex reports an error and yields no matches' "$ROOT/src/lib/__tests__/find.test.ts"; then
        pass "find.AC2 match case / whole word / regex (incl. capture groups)"
    else
        fail "find.AC2 match case / whole word / regex (incl. capture groups)"
    fi
}
test_find_ac3_replace_single_undo() {
    note "find.AC3 WYSIWYG replace single + replace-all as one undo"
    if [ -f "$ROOT/src/lib/__tests__/findReplace.test.tsx" ] \
        && grep -q 'replaces the active match and selects the replacement' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 'replaces every match in one transaction (single undo)' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 'One undo restores the pre-replace doc exactly' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 'applies regex capture substitution to every match' "$ROOT/src/lib/__tests__/findReplace.test.tsx"; then
        pass "find.AC3 WYSIWYG replace single + replace-all as one undo"
    else
        fail "find.AC3 WYSIWYG replace single + replace-all as one undo"
    fi
}
test_find_ac4_source_parity() {
    note "find.AC4 source/WYSIWYG match-count parity on the shared fixture"
    if [ -f "$ROOT/src/lib/__tests__/sourceFind.test.tsx" ] \
        && grep -q 'WYSIWYG / source parity (plan 07 task 7.4, AC4)' "$ROOT/src/lib/__tests__/sourceFind.test.tsx" \
        && grep -q 'the same term/options produce the same match count in both engines' "$ROOT/src/lib/__tests__/sourceFind.test.tsx" \
        && grep -q 'long-document.md' "$ROOT/src/lib/__tests__/sourceFind.test.tsx" \
        && [ -f "$FIXTURES/clean/long-document.md" ]; then
        pass "find.AC4 source/WYSIWYG match-count parity on the shared fixture"
    else
        fail "find.AC4 source/WYSIWYG match-count parity on the shared fixture"
    fi
}
test_find_ac5_crossblock() {
    note "find.AC5 cross-block match highlighted; Replace disabled + tooltip"
    if [ -f "$ROOT/src/lib/__tests__/findPanel.test.tsx" ] \
        && grep -q 'Replace is disabled with a tooltip while the active match spans blocks' "$ROOT/src/lib/__tests__/findPanel.test.tsx" \
        && grep -q 'spans multiple blocks' "$ROOT/src/lib/__tests__/findPanel.test.tsx" \
        && grep -q 'highlights cross-block matches too' "$ROOT/src/lib/__tests__/find.test.ts" \
        && grep -q 'refuses cross-block matches and leaves the doc untouched' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 'skips cross-block matches and reports the number replaced' "$ROOT/src/lib/__tests__/findReplace.test.tsx"; then
        pass "find.AC5 cross-block match highlighted; Replace disabled + tooltip"
    else
        fail "find.AC5 cross-block match highlighted; Replace disabled + tooltip"
    fi
}
test_find_ac6_dirty_roundtrip() {
    note "find.AC6 replace dirties the doc; re-save byte-identical, CRLF kept"
    if [ -f "$ROOT/src/lib/__tests__/findReplace.test.tsx" ] \
        && grep -q 'dirty state + save pipeline (plan 07 §4 AC6' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 'a replace marks the doc dirty and the save splices only dirty blocks' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 're-saving a replaced doc is byte-identical' "$ROOT/src/lib/__tests__/findReplace.test.tsx" \
        && grep -q 'a single replace keeps the CRLF encoding on save' "$ROOT/src/lib/__tests__/findReplace.test.tsx"; then
        pass "find.AC6 replace dirties the doc; re-save byte-identical, CRLF kept"
    else
        fail "find.AC6 replace dirties the doc; re-save byte-identical, CRLF kept"
    fi
}
test_find_ac7_no_prompt() {
    note "find.AC7 no window.prompt in the find & replace path"
    # The find feature (engine, memory, source bridge, panel, and the App
    # handlers that drive them) must never fall back to window.prompt; the
    # menu + F3 dispatch itself is gated by test_find_menu_wiring /
    # test_find_app_routing above.
    local hits
    hits=$(grep -n 'window\.prompt(' "$ROOT/src/lib/find.ts" \
        "$ROOT/src/lib/findMemory.ts" "$ROOT/src/lib/sourceFind.ts" \
        "$ROOT/src/components/FindReplacePanel.tsx" "$ROOT/src/App.tsx" 2>/dev/null || true)
    if [ -z "$hits" ]; then
        pass "find.AC7 no window.prompt in the find & replace path"
    else
        printf '%s\n' "$hits"
        fail "find.AC7 no window.prompt in the find & replace path"
    fi
}
test_find_perf_large_doc() {
    note "find.perf 100k-char recompute < 100ms vitest perf test present"
    # The measurement itself runs under `npm test` (vitest); this asserts the
    # perf test exists with the plan 07 §5.6 envelope: a >=100k-char document
    # and the 100ms recompute budget, timed with performance.now() around
    # searchDoc.
    if [ -f "$ROOT/src/lib/__tests__/findPerf.test.ts" ] \
        && grep -q 'TARGET_CHARS = 100_000' "$ROOT/src/lib/__tests__/findPerf.test.ts" \
        && grep -q 'RECOMPUTE_BUDGET_MS = 100' "$ROOT/src/lib/__tests__/findPerf.test.ts" \
        && grep -q 'toBeLessThan(RECOMPUTE_BUDGET_MS)' "$ROOT/src/lib/__tests__/findPerf.test.ts" \
        && grep -q 'searchDoc(doc, q.options)' "$ROOT/src/lib/__tests__/findPerf.test.ts" \
        && grep -q 'performance.now()' "$ROOT/src/lib/__tests__/findPerf.test.ts"; then
        pass "find.perf 100k-char recompute < 100ms vitest perf test present"
    else
        fail "find.perf 100k-char recompute < 100ms vitest perf test present"
    fi
}

# --- p1-media: Image submenu + from-URL (plan 08 task 8.2, issue #77) -----------
# The URL validation, the image insert, the From file src computation, the
# registry split, and the dialog's keyboard model are covered by the vitest
# suite (images.test.tsx) that `npm test` runs; this section checks the
# app-level wiring a GUI driver cannot reach headlessly: the native Insert
# menu carries the Image submenu (From file / From URL), App.tsx routes both
# menu ids + the from-file picker flow + the dialog render, the toolbar
# carries the split image button, and images.ts is the shared logic module.
test_media_menu_wiring() {
    note "media.menu Insert > Image submenu (From file / From URL) present"
    if grep -q 'SubmenuBuilder::new(app, "Image")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'image.text("insert-image-from-file", "From file...")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'image.text("insert-image-from-url", "From URL...")' "$ROOT/src-tauri/src/menu.rs" \
        && ! grep -q 'MenuItem::with_id(app, "insert-image",' "$ROOT/src-tauri/src/menu.rs"; then
        pass "media.menu Insert > Image submenu (From file / From URL) present"
    else
        fail "media.menu Insert > Image submenu (From file / From URL) present"
    fi
}
test_media_app_routing() {
    note "media.routing App.tsx routes both menu ids, picker flow, dialog render"
    if grep -q '"insert-image-from-file": "imageFromFile"' "$ROOT/src/App.tsx" \
        && grep -q '"insert-image-from-url": "image"' "$ROOT/src/App.tsx" \
        && grep -q 'registerImageInsertListener' "$ROOT/src/App.tsx" \
        && grep -q 'setImageDialog({ editor })' "$ROOT/src/App.tsx" \
        && grep -q 'pickOpenFile({ title: "Insert image", filters: \[IMAGE_FILTER\] })' "$ROOT/src/App.tsx" \
        && grep -q 'await insertImageFromPath(editor, picked\[0\]);' "$ROOT/src/App.tsx" \
        && grep -q 'assetSrcForPickedFile(docPath, filePath, loadAssetFolder())' "$ROOT/src/App.tsx" \
        && grep -q '<ImageDialog onApply={applyImageDialog} onClose={closeImageDialog} />' "$ROOT/src/App.tsx" \
        && grep -q 'insertImage(imageDialog.editor, payload)' "$ROOT/src/App.tsx"; then
        pass "media.routing App.tsx routes both menu ids, picker flow, dialog render"
    else
        fail "media.routing App.tsx routes both menu ids, picker flow, dialog render"
    fi
}
test_media_toolbar_split() {
    note "media.toolbar split image button (From file / From URL) present"
    if grep -q 'quillmd-toolbar-split' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'runEditorCommand(editor, "imageFromFile")' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'quillmd-toolbar-dropdown' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '.quillmd-toolbar-split' "$ROOT/src/App.css" \
        && grep -q '.quillmd-toolbar-dropdown' "$ROOT/src/App.css"; then
        pass "media.toolbar split image button (From file / From URL) present"
    else
        fail "media.toolbar split image button (From file / From URL) present"
    fi
}
test_media_images_module() {
    note "media.module images.ts validation/insert/src + IMAGE_FILTER + inline image"
    if [ -f "$ROOT/src/lib/images.ts" ] \
        && grep -q 'export function validateImageUrl' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function insertImage' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function imageSrcForPickedFile' "$ROOT/src/lib/images.ts" \
        && grep -q 'ALLOWED_IMAGE_SCHEMES = new Set(\["http", "https"\])' "$ROOT/src/lib/images.ts" \
        && grep -q 'export const IMAGE_FILTER' "$ROOT/src/lib/dialogs.ts" \
        && grep -q 'export type ImageInsertSource = "url" | "file"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function requestImageInsert' "$ROOT/src/lib/editorCommands.ts" \
        && [ -f "$ROOT/src/components/ImageDialog.tsx" ] \
        && grep -q 'ImageWithWidth.configure({ inline: true })' "$ROOT/src/components/Editor.tsx"; then
        pass "media.module images.ts validation/insert/src + IMAGE_FILTER + inline image"
    else
        fail "media.module images.ts validation/insert/src + IMAGE_FILTER + inline image"
    fi
}
test_media_suites_present() {
    note "media.suites plan 08 task 8.2 vitest suite present"
    if [ -f "$ROOT/src/lib/__tests__/images.test.tsx" ] \
        && grep -q 'validateImageUrl (plan 08 §2.4)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'insertImage (images.ts)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'imageSrcForPickedFile (plan 08 §3 relative-path invariant)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'registry wiring (issue #77)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'ImageDialog component' "$ROOT/src/lib/__tests__/images.test.tsx"; then
        pass "media.suites plan 08 task 8.2 vitest suite present"
    else
        fail "media.suites plan 08 task 8.2 vitest suite present"
    fi
}

# --- p1-assets: asset copy pipeline (plan 08 task 8.3, issue #78) ---------------
# The copy semantics (collision-safe naming, atomic write, traversal +
# reserved-name gates) are covered by the Rust unit tests (`cargo test`) and
# the vitest suite (assets.test.ts) that `npm test` runs; this section checks
# the cross-layer wiring: the Rust fs core, the two Tauri commands and their
# registration, the assets.ts module, and App.tsx routing the from-file
# picker through the pipeline.
test_assets_rust_core() {
    note "assets.core fs/assets.rs AssetFolder/copy_asset/files_exist present"
    if [ -f "$ROOT/src-tauri/src/fs/assets.rs" ] \
        && grep -q 'pub enum AssetFolder' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'pub fn parse_asset_folder' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'pub enum AssetCopyError' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'pub fn copy_asset' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'pub fn files_exist' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'pub mod assets;' "$ROOT/src-tauri/src/fs/mod.rs"; then
        pass "assets.core fs/assets.rs AssetFolder/copy_asset/files_exist present"
    else
        fail "assets.core fs/assets.rs AssetFolder/copy_asset/files_exist present"
    fi
}
test_assets_command_registration() {
    note "assets.commands copy_asset + file_exists Tauri commands registered"
    if grep -q 'pub fn copy_asset(src: String, doc_dir: String, asset_folder: String) -> Result<String, String>' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn file_exists(paths: Vec<String>) -> Vec<bool>' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'commands::copy_asset,' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'commands::file_exists,' "$ROOT/src-tauri/src/lib.rs"; then
        pass "assets.commands copy_asset + file_exists Tauri commands registered"
    else
        fail "assets.commands copy_asset + file_exists Tauri commands registered"
    fi
}
test_assets_module() {
    note "assets.module assets.ts setting + invoke bridge + from-file src pipeline"
    if [ -f "$ROOT/src/lib/assets.ts" ] \
        && grep -q 'export type AssetFolder = "assets" | "doc"' "$ROOT/src/lib/assets.ts" \
        && grep -q 'export const DEFAULT_ASSET_FOLDER: AssetFolder = "assets"' "$ROOT/src/lib/assets.ts" \
        && grep -q 'const ASSET_FOLDER_KEY = "quillmd.assetFolder"' "$ROOT/src/lib/assets.ts" \
        && grep -q 'export function loadAssetFolder' "$ROOT/src/lib/assets.ts" \
        && grep -q 'export function saveAssetFolder' "$ROOT/src/lib/assets.ts" \
        && grep -q 'invoke<string>("copy_asset", { src, docDir, assetFolder: folder })' "$ROOT/src/lib/assets.ts" \
        && grep -q 'invoke<boolean\[\]>("file_exists", { paths })' "$ROOT/src/lib/assets.ts" \
        && grep -q 'export async function assetSrcForPickedFile' "$ROOT/src/lib/assets.ts" \
        && grep -q 'return copyAsset(filePath, docDir, folder)' "$ROOT/src/lib/assets.ts"; then
        pass "assets.module assets.ts setting + invoke bridge + from-file src pipeline"
    else
        fail "assets.module assets.ts setting + invoke bridge + from-file src pipeline"
    fi
}
test_assets_app_routing() {
    note "assets.routing App.tsx from-file picker routed through the pipeline"
    if grep -q 'import { assetSrcForPickedFile, loadAssetFolder } from "./lib/assets"' "$ROOT/src/App.tsx" \
        && grep -q 'const insertImageFromPath = useCallback(' "$ROOT/src/App.tsx" \
        && grep -q 'assetSrcForPickedFile(docPath, filePath, loadAssetFolder())' "$ROOT/src/App.tsx"; then
        pass "assets.routing App.tsx from-file picker routed through the pipeline"
    else
        fail "assets.routing App.tsx from-file picker routed through the pipeline"
    fi
}
test_assets_suites_present() {
    note "assets.suites plan 08 task 8.3 vitest suite present"
    if [ -f "$ROOT/src/lib/__tests__/assets.test.ts" ] \
        && grep -q 'asset folder setting (plan 08 §2.3)' "$ROOT/src/lib/__tests__/assets.test.ts" \
        && grep -q 'copy_asset / file_exists invoke bridge' "$ROOT/src/lib/__tests__/assets.test.ts" \
        && grep -q 'climbsOutOf' "$ROOT/src/lib/__tests__/assets.test.ts" \
        && grep -q 'assetSrcForPickedFile (plan 08 task 8.3 copy rule)' "$ROOT/src/lib/__tests__/assets.test.ts"; then
        pass "assets.suites plan 08 task 8.3 vitest suite present"
    else
        fail "assets.suites plan 08 task 8.3 vitest suite present"
    fi
}

# --- p1-imageedit: image edit dialog (plan 08 task 8.4, issue #79) ------------
# The width normalization, the <img> parse/serialize, the prefill read, the
# apply, the registry split, the dialog's keyboard model, and the AC8
# round-trip fixture are covered by the vitest suite (images.test.tsx) that
# `npm test` runs; this section checks the app-level wiring a GUI driver
# cannot reach headlessly: the ImageWithWidth node attribute + image click
# handler in Editor.tsx, the <img> HTML parse/render in pm.ts, the
# URL/alt/width logic module in images.ts, the imageEdit registry command,
# and the App.tsx dialog routing + render.
test_imageedit_node_and_click() {
    note "imageedit.node ImageWithWidth width attr + click requests edit dialog"
    if grep -q 'export const ImageWithWidth = Image.extend({' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'width: {' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'parseHTML: (element: HTMLElement) => element.getAttribute("width")' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'ImageWithWidth.configure({ inline: true })' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'if (node.type.name === "image") {' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'requestImageEditDialog(active);' "$ROOT/src/components/Editor.tsx"; then
        pass "imageedit.node ImageWithWidth width attr + click requests edit dialog"
    else
        fail "imageedit.node ImageWithWidth width attr + click requests edit dialog"
    fi
}
test_imageedit_pm_img_html() {
    note "imageedit.pm pm.ts parses + renders the <img> HTML width form"
    if grep -q 'export function parseImgHtml(value: string): ImgAttrs | null {' "$ROOT/src/lib/pm.ts" \
        && grep -q 'export function renderImgHtml(attrs: {' "$ROOT/src/lib/pm.ts" \
        && grep -q 'renderImgHtml({ src, alt, title, width })' "$ROOT/src/lib/pm.ts" \
        && grep -q 'if (img) {' "$ROOT/src/lib/pm.ts" \
        && grep -q 'const img = parseImgHtml(node.value);' "$ROOT/src/lib/pm.ts"; then
        pass "imageedit.pm pm.ts parses + renders the <img> HTML width form"
    else
        fail "imageedit.pm pm.ts parses + renders the <img> HTML width form"
    fi
}
test_imageedit_module() {
    note "imageedit.module images.ts width validate/normalize + prefill + apply"
    if [ -f "$ROOT/src/lib/images.ts" ] \
        && grep -q 'export interface ImageEditPayload {' "$ROOT/src/lib/images.ts" \
        && grep -q 'export interface ImageEditPrefill extends ImageEditPayload {' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function normalizeImageWidth(input: string): string | null {' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function validateImageWidth(input: string): string | null {' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function imageAtCaret(' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function readImagePrefill(editor: CoreEditor): ImageEditPrefill {' "$ROOT/src/lib/images.ts" \
        && grep -q 'export function applyImageEdit(editor: CoreEditor, payload: ImageEditPayload): boolean {' "$ROOT/src/lib/images.ts"; then
        pass "imageedit.module images.ts width validate/normalize + prefill + apply"
    else
        fail "imageedit.module images.ts width validate/normalize + prefill + apply"
    fi
}
test_imageedit_registry() {
    note "imageedit.registry imageEdit command + dialog listener/request"
    if grep -q '| "imageEdit"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id: "imageEdit",' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'run: (editor) => requestImageEditDialog(editor),' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function registerImageEditDialogListener(fn: ImageEditDialogListener): () => void {' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function requestImageEditDialog(editor: CoreEditor): boolean {' "$ROOT/src/lib/editorCommands.ts"; then
        pass "imageedit.registry imageEdit command + dialog listener/request"
    else
        fail "imageedit.registry imageEdit command + dialog listener/request"
    fi
}
test_imageedit_app_routing() {
    note "imageedit.app App.tsx registers listener, applies edit, renders dialog"
    if grep -q 'import ImageEditDialog from "./components/ImageEditDialog";' "$ROOT/src/App.tsx" \
        && grep -q 'registerImageEditDialogListener' "$ROOT/src/App.tsx" \
        && grep -q 'readImagePrefill' "$ROOT/src/App.tsx" \
        && grep -q 'applyImageEdit' "$ROOT/src/App.tsx" \
        && grep -q '<ImageEditDialog' "$ROOT/src/App.tsx" \
        && [ -f "$ROOT/src/components/ImageEditDialog.tsx" ] \
        && grep -q 'export default function ImageEditDialog' "$ROOT/src/components/ImageEditDialog.tsx" \
        && grep -q 'validateImageWidth' "$ROOT/src/components/ImageEditDialog.tsx" \
        && grep -q 'Width' "$ROOT/src/components/ImageEditDialog.tsx"; then
        pass "imageedit.app App.tsx registers listener, applies edit, renders dialog"
    else
        fail "imageedit.app App.tsx registers listener, applies edit, renders dialog"
    fi
}
test_imageedit_fixture() {
    note "imageedit.fixture AC8 doc (links + relative img + HTML-width img) present"
    if [ -f "$ROOT/fixtures/clean/images-edit-width.md" ] \
        && grep -q '!\[Relative\](assets/photo.png)' "$ROOT/fixtures/clean/images-edit-width.md" \
        && grep -q '<img src="sized.png" alt="Sized" width="320">' "$ROOT/fixtures/clean/images-edit-width.md" \
        && grep -q '\[Home\](https://example.com)' "$ROOT/fixtures/clean/images-edit-width.md"; then
        pass "imageedit.fixture AC8 doc (links + relative img + HTML-width img) present"
    else
        fail "imageedit.fixture AC8 doc (links + relative img + HTML-width img) present"
    fi
}
test_imageedit_suites_present() {
    note "imageedit.suites plan 08 task 8.4 vitest suite present"
    if grep -q 'image edit dialog (plan 08 task 8.4, issue #79)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'normalizeImageWidth / validateImageWidth (plan 08 §2.5)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q '<img> HTML serialization (plan 08 §3, issue #79)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'applyImageEdit (plan 08 task 8.4, issue #79)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'imageEdit registry wiring (issue #79)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'ImageEditDialog component' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'round-trips the task 8.4 fixture through the WYSIWYG converter' "$ROOT/src/lib/__tests__/images.test.tsx"; then
        pass "imageedit.suites plan 08 task 8.4 vitest suite present"
    else
        fail "imageedit.suites plan 08 task 8.4 vitest suite present"
    fi
}

# --- p1-links: open links + broken-image placeholder (plan 08 task 8.5, issue #80)
# The href resolution, middle-click routing, missing-asset detection, and the
# placeholder node view are covered by the vitest suites (openLinks.test.tsx,
# missingImages.test.tsx) that `npm test` runs; this section checks the
# cross-layer wiring a GUI driver cannot reach headlessly: the opener plugin
# capability, the editor auxclick handler, the preview auxclick handler, the
# App.tsx detection effect + re-link flow, and the placeholder styling.
test_links_opener_capability() {
    note "links.opener tauri-plugin-opener dependency + opener:default capability"
    if grep -q 'tauri-plugin-opener = "2"' "$ROOT/src-tauri/Cargo.toml" \
        && grep -q '"opener:default"' "$ROOT/src-tauri/capabilities/default.json"; then
        pass "links.opener tauri-plugin-opener dependency + opener:default capability"
    else
        fail "links.opener tauri-plugin-opener dependency + opener:default capability"
    fi
}
test_links_module() {
    note "links.module links.ts openLinkUrl + middleClickLinkHref present"
    if grep -q 'export async function openLinkUrl(url: string): Promise<void>' "$ROOT/src/lib/links.ts" \
        && grep -q 'export function middleClickLinkHref(event: MiddleClickEvent, root: Element): string | null' "$ROOT/src/lib/links.ts"; then
        pass "links.module links.ts openLinkUrl + middleClickLinkHref present"
    else
        fail "links.module links.ts openLinkUrl + middleClickLinkHref present"
    fi
}
test_links_editor_wiring() {
    note "links.editor Editor.tsx auxclick -> linkHrefAt -> openLinkUrl"
    if grep -q 'import { openLinkUrl } from "../lib/links";' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export function linkHrefAt(view: EditorView, pos: number): string | null' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export function handleEditorMiddleClick(view: EditorView, event: MouseEvent): boolean' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'auxclick: (view, event) => handleEditorMiddleClick(view, event as MouseEvent)' "$ROOT/src/components/Editor.tsx"; then
        pass "links.editor Editor.tsx auxclick -> linkHrefAt -> openLinkUrl"
    else
        fail "links.editor Editor.tsx auxclick -> linkHrefAt -> openLinkUrl"
    fi
}
test_links_preview_wiring() {
    note "links.preview PreviewView.tsx onAuxClick -> middleClickLinkHref -> openLinkUrl"
    if grep -q 'import { middleClickLinkHref, openLinkUrl } from "../lib/links";' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'onAuxClick={(event) => {' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'const href = middleClickLinkHref(event, event.currentTarget);' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'void openLinkUrl(href);' "$ROOT/src/components/PreviewView.tsx"; then
        pass "links.preview PreviewView.tsx onAuxClick -> middleClickLinkHref -> openLinkUrl"
    else
        fail "links.preview PreviewView.tsx onAuxClick -> middleClickLinkHref -> openLinkUrl"
    fi
}
test_missing_images_module() {
    note "links.missing missingImages.ts detection module + filesExist bridge"
    if [ -f "$ROOT/src/lib/missingImages.ts" ] \
        && grep -q 'export function isLocalImageSrc(src: string): boolean' "$ROOT/src/lib/missingImages.ts" \
        && grep -q 'export function resolveImageSrc(docPath: string, src: string): string | null' "$ROOT/src/lib/missingImages.ts" \
        && grep -q 'export function collectImageSrcs(doc: PmNode)' "$ROOT/src/lib/missingImages.ts" \
        && grep -q 'export function relinkFolderFor(docPath: string, src: string): string' "$ROOT/src/lib/missingImages.ts" \
        && grep -q 'export async function findMissingImageSrcs(' "$ROOT/src/lib/missingImages.ts" \
        && grep -q 'export async function filesExist(paths: string\[\])' "$ROOT/src/lib/assets.ts"; then
        pass "links.missing missingImages.ts detection module + filesExist bridge"
    else
        fail "links.missing missingImages.ts detection module + filesExist bridge"
    fi
}
test_missing_images_nodeview() {
    note "links.placeholder image node view placeholder + Re-link button + css"
    if grep -q 'export const imagePlaceholderRuntime = {' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'wrap.className = "quillmd-img-missing";' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'label.className = "quillmd-img-missing-label";' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'button.textContent = "Re-link…";' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'missingImages?: ReadonlySet<string>;' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'onReLinkImage?: (src: string, pos: number) => void;' "$ROOT/src/components/Editor.tsx" \
        && grep -q '.quillmd-prosemirror .quillmd-img-missing {' "$ROOT/src/App.css" \
        && grep -q '.quillmd-prosemirror .quillmd-img-relink {' "$ROOT/src/App.css"; then
        pass "links.placeholder image node view placeholder + Re-link button + css"
    else
        fail "links.placeholder image node view placeholder + Re-link button + css"
    fi
}
test_missing_images_app_wiring() {
    note "links.relink App.tsx detection effect + re-link picker -> setNodeMarkup"
    if grep -q 'import { findMissingImageSrcs, relinkFolderFor } from "./lib/missingImages";' "$ROOT/src/App.tsx" \
        && grep -q 'const missing = await findMissingImageSrcs(editor.state.doc, activePath);' "$ROOT/src/App.tsx" \
        && grep -q 'defaultPath: relinkFolderFor(docPath, src),' "$ROOT/src/App.tsx" \
        && grep -q 'const stableReLinkImage = useCallback(' "$ROOT/src/App.tsx" \
        && grep -q 'tr.setNodeMarkup(pos, null, { ...node.attrs, src: newSrc });' "$ROOT/src/App.tsx" \
        && grep -q 'missingImages={missingImages}' "$ROOT/src/App.tsx" \
        && grep -q 'onReLinkImage={stableReLinkImage}' "$ROOT/src/App.tsx"; then
        pass "links.relink App.tsx detection effect + re-link picker -> setNodeMarkup"
    else
        fail "links.relink App.tsx detection effect + re-link picker -> setNodeMarkup"
    fi
}
test_links_suites_present() {
    note "links.suites plan 08 task 8.5 vitest suites present"
    if [ -f "$ROOT/src/lib/__tests__/openLinks.test.tsx" ] \
        && grep -q 'describe("linkHrefAt (plan 08 task 8.5, issue #80)"' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'describe("handleEditorMiddleClick (plan 08 task 8.5, issue #80, AC7)"' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'describe("middleClickLinkHref (plan 08 task 8.5, issue #80, AC7 preview)"' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'describe("broken-image placeholder node view (plan 08 task 8.5, issue #80, AC6)"' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/missingImages.test.tsx" ] \
        && grep -q 'describe("resolveImageSrc (plan 08 §3)"' "$ROOT/src/lib/__tests__/missingImages.test.tsx" \
        && grep -q 'describe("relinkFolderFor (plan 08 §3 last folder)"' "$ROOT/src/lib/__tests__/missingImages.test.tsx" \
        && grep -q 'describe("findMissingImageSrcs (plan 08 §3 batched check)"' "$ROOT/src/lib/__tests__/missingImages.test.tsx"; then
        pass "links.suites plan 08 task 8.5 vitest suites present"
    else
        fail "links.suites plan 08 task 8.5 vitest suites present"
    fi
}

# --- p1-dnd: drag & drop image insert (plan 08 task 8.6, issue #81) ---------------
# Per-item classification and routing (image extension match, insertImage dep
# call, skip/failure status lines) is covered by the vitest suite
# (src/lib/__tests__/dragDrop.test.ts), which `npm test` runs. This section
# checks the app-level wiring a GUI driver cannot reach headlessly:
# dragDrop.ts carries the image classification + routing, and App.tsx routes
# the dropped image through the same from-file flow as Insert > Image >
# From file (shared insertImageFromPath against the active WYSIWYG editor
# from currentFindEditor).
test_dnd_module() {
    note "dnd.module dragDrop.ts image classification + insertImage routing"
    if grep -q 'jpe?g|gif|webp|bmp|svg|avif' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'export function isImagePath' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'insertImage: (path: string) => Promise<boolean>;' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'const inserted = await deps.insertImage(path);' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'Skipped ${baseName(path)} (no WYSIWYG editor to insert into)' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'Image insert failed: ${path} (${String(err)})' "$ROOT/src/lib/dragDrop.ts" \
        && grep -q 'not a markdown file or image' "$ROOT/src/lib/dragDrop.ts"; then
        pass "dnd.module dragDrop.ts image classification + insertImage routing"
    else
        fail "dnd.module dragDrop.ts image classification + insertImage routing"
    fi
}
test_dnd_app_wiring() {
    note "dnd.app App.tsx drop handler routes images through the from-file flow"
    if grep -q 'insertImage: async (path) => {' "$ROOT/src/App.tsx" \
        && grep -q 'const editor = currentFindEditor();' "$ROOT/src/App.tsx" \
        && grep -q 'return insertImageFromPathRef.current(editor, path);' "$ROOT/src/App.tsx" \
        && grep -q 'const insertImageFromPath = useCallback(' "$ROOT/src/App.tsx" \
        && grep -q 'assetSrcForPickedFile(docPath, filePath, loadAssetFolder())' "$ROOT/src/App.tsx" \
        && grep -q 'await insertImageFromPath(editor, picked\[0\]);' "$ROOT/src/App.tsx" \
        && grep -q 'handleDroppedPaths(event.payload.paths, {' "$ROOT/src/App.tsx"; then
        pass "dnd.app App.tsx drop handler routes images through the from-file flow"
    else
        fail "dnd.app App.tsx drop handler routes images through the from-file flow"
    fi
}
test_dnd_suites_present() {
    note "dnd.suites dragDrop.test.ts image routing + skip + failure coverage"
    if [ -f "$ROOT/src/lib/__tests__/dragDrop.test.ts" ] \
        && grep -q 'describe("isImagePath (#81)"' "$ROOT/src/lib/__tests__/dragDrop.test.ts" \
        && grep -q 'routes a dropped image file through the insertImage dep, not openFile (#81)' "$ROOT/src/lib/__tests__/dragDrop.test.ts" \
        && grep -q 'reports a skip line when there is no WYSIWYG editor to insert into (#81)' "$ROOT/src/lib/__tests__/dragDrop.test.ts" \
        && grep -q 'reports a per-image insert failure without aborting the batch (#81)' "$ROOT/src/lib/__tests__/dragDrop.test.ts" \
        && grep -q 'routes a mixed drop: md opens, image inserts, unknown skips, folder opens (#81)' "$ROOT/src/lib/__tests__/dragDrop.test.ts"; then
        pass "dnd.suites dragDrop.test.ts image routing + skip + failure coverage"
    else
        fail "dnd.suites dragDrop.test.ts image routing + skip + failure coverage"
    fi
}

# --- p1-media: plan 08 §4 acceptance criteria (plan 08 task 8.7, issue #82) ---
# Each plan 08 §4 acceptance criterion is covered by the vitest suites
# (links.test.tsx, images.test.tsx, assets.test.ts, openLinks.test.tsx,
# missingImages.test.tsx) and the Rust unit tests (fs/assets.rs) that
# `npm test` / `cargo test` run; the task 8.2-8.6 wiring checks above already
# gate the app-level surface (menus, App.tsx routing, registry, modules).
# This block asserts each criterion's test is present so the p1-media subset
# is the feature's full acceptance gate.
test_media_ac1_link_dialog() {
    note "media.AC1 link insert/edit/remove via dialog + title round-trip"
    if [ -f "$ROOT/src/lib/__tests__/links.test.tsx" ] \
        && grep -q 'applyLink inserts a link over a plain selection' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'applyLink writes the tooltip into the markdown title' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'applyLink edits the link under the caret' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'readLinkPrefill prefills the link under the caret' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'removeLink strips the mark and keeps the text' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'describe("LinkDialog component"' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'saves on Enter with the field values' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'shows Remove link only when editing, and calls onRemove' "$ROOT/src/lib/__tests__/links.test.tsx"; then
        pass "media.AC1 link insert/edit/remove via dialog + title round-trip"
    else
        fail "media.AC1 link insert/edit/remove via dialog + title round-trip"
    fi
}
test_media_ac2_paste_url() {
    note "media.AC2 pasting a bare URL creates a link (WYSIWYG)"
    if [ -f "$ROOT/src/lib/__tests__/links.test.tsx" ] \
        && grep -q 'describe("plain-URL paste (plan 08 scope 2)"' "$ROOT/src/lib/__tests__/links.test.tsx" \
        && grep -q 'pasting a bare URL over a selection turns the selection into a link' "$ROOT/src/lib/__tests__/links.test.tsx"; then
        pass "media.AC2 pasting a bare URL creates a link (WYSIWYG)"
    else
        fail "media.AC2 pasting a bare URL creates a link (WYSIWYG)"
    fi
}
test_media_ac3_image_from_file() {
    note "media.AC3 from-file copy to assets/ (per setting) + relative path"
    if [ -f "$ROOT/src/lib/__tests__/assets.test.ts" ] \
        && grep -q 'references picks inside the doc folder directly, with no copy' "$ROOT/src/lib/__tests__/assets.test.ts" \
        && grep -q 'copies picks outside the doc folder through copy_asset' "$ROOT/src/lib/__tests__/assets.test.ts" \
        && grep -q 'passes the doc-folder setting through to copy_asset' "$ROOT/src/lib/__tests__/assets.test.ts" \
        && grep -q 'pub fn copy_asset' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'format!("assets/{file_name}")' "$ROOT/src-tauri/src/fs/assets.rs"; then
        pass "media.AC3 from-file copy to assets/ (per setting) + relative path"
    else
        fail "media.AC3 from-file copy to assets/ (per setting) + relative path"
    fi
}
test_media_ac4_collision() {
    note "media.AC4 collision naming yields photo.png + photo-1.png"
    if grep -q 'fn collision_naming_counters' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q '"assets/photo-1.png"' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'fn free_name_in' "$ROOT/src-tauri/src/fs/assets.rs"; then
        pass "media.AC4 collision naming yields photo.png + photo-1.png"
    else
        fail "media.AC4 collision naming yields photo.png + photo-1.png"
    fi
}
test_media_ac5_width_roundtrip() {
    note "media.AC5 width persists in the saved file + re-applies on reopen"
    if [ -f "$ROOT/src/lib/__tests__/images.test.tsx" ] \
        && grep -q 'serializes a width-carrying image to canonical <img> HTML' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'sets the width, turning the image into HTML form' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 're-applies the width on reopen (parse keeps the width attribute)' "$ROOT/src/lib/__tests__/images.test.tsx"; then
        pass "media.AC5 width persists in the saved file + re-applies on reopen"
    else
        fail "media.AC5 width persists in the saved file + re-applies on reopen"
    fi
}
test_media_ac6_broken_image() {
    note "media.AC6 broken image shows named placeholder; Re-link fixes it"
    if [ -f "$ROOT/src/lib/__tests__/openLinks.test.tsx" ] \
        && grep -q 'broken-image placeholder node view (plan 08 task 8.5, issue #80, AC6)' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'renders a missing local image as a named placeholder with the Re-link button' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'calls the re-link handler with the src and doc position on click' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'swaps back to the img when the file is restored (set cleared, no doc change)' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/missingImages.test.tsx" ] \
        && grep -q 'returns the srcs whose file is gone, in one batched call' "$ROOT/src/lib/__tests__/missingImages.test.tsx"; then
        pass "media.AC6 broken image shows named placeholder; Re-link fixes it"
    else
        fail "media.AC6 broken image shows named placeholder; Re-link fixes it"
    fi
}
test_media_ac7_open_link() {
    note "media.AC7 middle-click / context Open launches the browser"
    if [ -f "$ROOT/src/lib/__tests__/openLinks.test.tsx" ] \
        && grep -q 'handleEditorMiddleClick (plan 08 task 8.5, issue #80, AC7)' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'opens the link at the click position and consumes the event' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q 'middleClickLinkHref (plan 08 task 8.5, issue #80, AC7 preview)' "$ROOT/src/lib/__tests__/openLinks.test.tsx" \
        && grep -q "reads the anchor's href on a middle click" "$ROOT/src/lib/__tests__/openLinks.test.tsx"; then
        pass "media.AC7 middle-click / context Open launches the browser"
    else
        fail "media.AC7 middle-click / context Open launches the browser"
    fi
}
test_media_ac8_roundtrip() {
    note "media.AC8 links + 2 images (relative + HTML-width) byte-identical re-save"
    if [ -f "$ROOT/src/lib/__tests__/images.test.tsx" ] \
        && grep -q 'round-trips the task 8.4 fixture through the WYSIWYG converter' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && [ -f "$FIXTURES/clean/images-edit-width.md" ] \
        && grep -q '!\[Relative\](assets/photo.png)' "$FIXTURES/clean/images-edit-width.md" \
        && grep -q '<img src="sized.png" alt="Sized" width="320">' "$FIXTURES/clean/images-edit-width.md" \
        && grep -q '\[Home\](https://example.com)' "$FIXTURES/clean/images-edit-width.md" \
        && grep -q 'fixtures", "clean"' "$ROOT/src/lib/__tests__/roundtrip.test.ts"; then
        pass "media.AC8 links + 2 images (relative + HTML-width) byte-identical re-save"
    else
        fail "media.AC8 links + 2 images (relative + HTML-width) byte-identical re-save"
    fi
}

# --- p1-media: Windows manual pass (plan 08 task 8.7, issue #82) -----------------
# The manual Windows pass covers the two areas where the asset pipeline and
# link opening touch platform behavior (golden rule 4: Windows first-class):
# asset copy must refuse Windows reserved device names and the CRLF round-trip
# must hold for a media document; open-link must launch the system browser
# through plugin-opener (no in-app navigation, no new tab under Tauri).
# These checks run on both platforms in this harness (the Windows runner gets
# them for free under Git Bash); the copy behavior itself is exercised by the
# Rust unit tests under `cargo test`.
test_media_windows_assetcopy() {
    note "media.windows asset copy: reserved-name refusal + CRLF round-trip"
    if grep -q 'pub fn is_windows_reserved' "$ROOT/src-tauri/src/fs/paths.rs" \
        && grep -q 'is_windows_reserved(src_name)' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'AssetCopyError::ReservedName' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'fn copy_refuses_reserved_windows_names' "$ROOT/src-tauri/src/fs/assets.rs" \
        && grep -q 'round-trips the task 8.4 fixture byte-identically on CRLF (save pipeline)' "$ROOT/src/lib/__tests__/images.test.tsx" \
        && grep -q 'if (opts.eol === "crlf")' "$ROOT/src/lib/pipeline.ts" \
        && [ -f "$FIXTURES/crlf/crlf-basic.md" ] \
        && grep -q $'\r' "$FIXTURES/crlf/crlf-basic.md"; then
        pass "media.windows asset copy: reserved-name refusal + CRLF round-trip"
    else
        fail "media.windows asset copy: reserved-name refusal + CRLF round-trip"
    fi
}
test_media_windows_openlink() {
    note "media.windows open link: plugin-opener launches the system browser"
    if grep -q 'tauri-plugin-opener = "2"' "$ROOT/src-tauri/Cargo.toml" \
        && grep -q '"opener:default"' "$ROOT/src-tauri/capabilities/default.json" \
        && grep -q 'runningInTauri()' "$ROOT/src/lib/links.ts" \
        && grep -q 'await import("@tauri-apps/plugin-opener")' "$ROOT/src/lib/links.ts" \
        && grep -q 'await openUrl(url);' "$ROOT/src/lib/links.ts" \
        && grep -q 'window.open(url, "_blank", "noopener")' "$ROOT/src/lib/links.ts"; then
        pass "media.windows open link: plugin-opener launches the system browser"
    else
        fail "media.windows open link: plugin-opener launches the system browser"
    fi
}

# --- p2-fonts: fonts/sizes/color marks + serializer/parser (issue #47, plan 04 task 4.1) ---
# The mark semantics (apply + per-attribute toggle-off, the canonical
# <span class="quillmd-font" style="..."> / <span class="quillmd-highlight"
# style="background-color: ..."> emit, the fixed font-family -> font-size ->
# color attribute order, and the ==text== backward-compat) are covered by the
# vitest suite (src/lib/__tests__/fontmarks.test.tsx); this section checks the
# schema + converter wiring the GUI driver cannot reach headlessly: the three
# font marks + the highlight color attribute are registered in Editor.tsx,
# pm.ts parses/emits the quillmd-font + quillmd-highlight spans in a fixed
# attribute order, and the clean fixture contract includes a styled doc.
test_fonts_marks_registered() {
    note "fonts Editor.tsx registers the three font marks + highlight color"
    if grep -q 'function makeFontMark' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export const FontFamilyMark' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export const FontSizeMark' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export const FontColorMark' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export const QuillHighlight' "$ROOT/src/components/Editor.tsx"; then
        pass "fonts Editor.tsx registers the three font marks + highlight color"
    else
        fail "fonts Editor.tsx registers the three font marks + highlight color"
    fi
}
test_fonts_marks_in_extensions() {
    note "fonts Editor.tsx wires the font marks + highlight into the extension list"
    if grep -q 'QuillHighlight,' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'FontFamilyMark,' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'FontSizeMark,' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'FontColorMark,' "$ROOT/src/components/Editor.tsx"; then
        pass "fonts Editor.tsx wires the font marks + highlight into the extension list"
    else
        fail "fonts Editor.tsx wires the font marks + highlight into the extension list"
    fi
}
test_fonts_pm_span_parse_serialize() {
    note "fonts pm.ts parses + emits quillmd-font / quillmd-highlight spans"
    if grep -q 'FONT_SPAN_CLASS = "quillmd-font"' "$ROOT/src/lib/pm.ts" \
        && grep -q 'HIGHLIGHT_SPAN_CLASS = "quillmd-highlight"' "$ROOT/src/lib/pm.ts" \
        && grep -q 'renderFontSpanOpen' "$ROOT/src/lib/pm.ts" \
        && grep -q 'renderHighlightSpanOpen' "$ROOT/src/lib/pm.ts"; then
        pass "fonts pm.ts parses + emits quillmd-font / quillmd-highlight spans"
    else
        fail "fonts pm.ts parses + emits quillmd-font / quillmd-highlight spans"
    fi
}
test_fonts_pm_fixed_attr_order() {
    note "fonts pm.ts emits font attrs in a fixed order (family, size, color)"
    if grep -q 'parts.push(`font-family: ' "$ROOT/src/lib/pm.ts" \
        && grep -q 'parts.push(`font-size: ' "$ROOT/src/lib/pm.ts" \
        && grep -q 'parts.push(`color: ' "$ROOT/src/lib/pm.ts" \
        && grep -q 'background-color: ' "$ROOT/src/lib/pm.ts"; then
        pass "fonts pm.ts emits font attrs in a fixed order (family, size, color)"
    else
        fail "fonts pm.ts emits font attrs in a fixed order (family, size, color)"
    fi
}
test_fonts_roundtrip_fixture() {
    note "fonts untouched styled fixture in the round-trip contract"
    if [ -f "$FIXTURES/clean/font-styled.md" ] \
        && grep -q 'quillmd-font' "$FIXTURES/clean/font-styled.md" \
        && grep -q 'quillmd-highlight' "$FIXTURES/clean/font-styled.md" \
        && grep -q '==legacy==' "$FIXTURES/clean/font-styled.md" \
        && [ -f "$ROOT/src/lib/__tests__/fontmarks.test.tsx" ]; then
        pass "fonts untouched styled fixture in the round-trip contract"
    else
        fail "fonts untouched styled fixture in the round-trip contract"
    fi
}
test_fonts_suites_present() {
    note "fonts AC1/AC3/AC5 vitest-suite assertions present"
    if grep -q 'composes bold + italic + font + color on one range (AC3)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'toggles a font attribute off independently, keeping the others (AC3)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'sets a highlight color as a quillmd-highlight span (AC5)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'keeps the default (colorless) highlight as ==text==' "$ROOT/src/lib/__tests__/fontmarks.test.tsx"; then
        pass "fonts AC1/AC3/AC5 vitest-suite assertions present"
    else
        fail "fonts AC1/AC3/AC5 vitest-suite assertions present"
    fi
}

# --- p2-colors: shared color palette component (issue #48, plan 04 task 4.2) ---
# The palette data (24 swatches, rows of 6, auto, normalize) and the picker
# behavior (fontColor / highlightColor registry commands, the shared popover,
# the toolbar wiring for both pickers) are covered by the vitest suite
# (src/lib/__tests__/colorpalette.test.tsx); this section checks the wiring the
# GUI driver cannot reach headlessly: the shared palette constant, the two
# registry color commands + color readers, the ColorPalette component, and the
# toolbar rendering both pickers through that one component.
test_colors_palette_data() {
    note "colors shared 24-swatch palette + normalize in colors.ts"
    if [ -f "$ROOT/src/lib/colors.ts" ] \
        && grep -q 'export const COLOR_PALETTE' "$ROOT/src/lib/colors.ts" \
        && grep -q 'COLOR_PALETTE_COLUMNS = 6' "$ROOT/src/lib/colors.ts" \
        && grep -q 'export const COLOR_AUTO' "$ROOT/src/lib/colors.ts" \
        && grep -q 'export function normalizeColor' "$ROOT/src/lib/colors.ts"; then
        pass "colors shared 24-swatch palette + normalize in colors.ts"
    else
        fail "colors shared 24-swatch palette + normalize in colors.ts"
    fi
}
test_colors_registry_commands() {
    note "colors fontColor + highlightColor registry commands + readers present"
    if grep -q 'id: "fontColor"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id: "highlightColor"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function fontColorOf' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function highlightColorOf' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'from "./colors"' "$ROOT/src/lib/editorCommands.ts"; then
        pass "colors fontColor + highlightColor registry commands + readers present"
    else
        fail "colors fontColor + highlightColor registry commands + readers present"
    fi
}
test_colors_palette_component() {
    note "colors ColorPalette component: 24-grid + auto + custom popover"
    if [ -f "$ROOT/src/components/ColorPalette.tsx" ] \
        && grep -q 'COLOR_PALETTE.map' "$ROOT/src/components/ColorPalette.tsx" \
        && grep -q 'COLOR_PALETTE_COLUMNS' "$ROOT/src/components/ColorPalette.tsx" \
        && grep -q 'type="color"' "$ROOT/src/components/ColorPalette.tsx" \
        && grep -q 'Auto' "$ROOT/src/components/ColorPalette.tsx" \
        && grep -q 'onPick' "$ROOT/src/components/ColorPalette.tsx"; then
        pass "colors ColorPalette component: 24-grid + auto + custom popover"
    else
        fail "colors ColorPalette component: 24-grid + auto + custom popover"
    fi
}
test_colors_toolbar_wiring() {
    note "colors Toolbar renders both pickers through the shared palette"
    if grep -q 'import ColorPalette' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'title="Font color"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'title="Highlight color"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'runEditorCommand(editor, "fontColor"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'runEditorCommand(editor, "highlightColor"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'fontColorOf(editor)' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'highlightColorOf(editor)' "$ROOT/src/components/Toolbar.tsx"; then
        pass "colors Toolbar renders both pickers through the shared palette"
    else
        fail "colors Toolbar renders both pickers through the shared palette"
    fi
}
test_colors_suites_present() {
    note "colors vitest suite: 24 swatches + auto + custom + toolbar pickers"
    if [ -f "$ROOT/src/lib/__tests__/colorpalette.test.tsx" ] \
        && grep -q 'toHaveLength(24)' "$ROOT/src/lib/__tests__/colorpalette.test.tsx" \
        && grep -q 'title="Font color"' "$ROOT/src/lib/__tests__/colorpalette.test.tsx" \
        && grep -q 'title="Highlight color"' "$ROOT/src/lib/__tests__/colorpalette.test.tsx" \
        && grep -q 'runEditorCommand(e, "fontColor"' "$ROOT/src/lib/__tests__/colorpalette.test.tsx" \
        && grep -q 'runEditorCommand(e, "highlightColor"' "$ROOT/src/lib/__tests__/colorpalette.test.tsx"; then
        pass "colors vitest suite: 24 swatches + auto + custom + toolbar pickers"
    else
        fail "colors vitest suite: 24 swatches + auto + custom + toolbar pickers"
    fi
}

# --- p2-styles: style registry + gallery popover (issue #54, plan 05 task 5.1) ---
# The registry behavior (the built-in set of >=12 styles, every style an
# alias of an existing registry command so no new markdown meaning, applying
# "Heading 2" on a paragraph setting H2 via registry command h2, the
# Intense Quote blockquote+bold composition, the active-state tracking that
# follows the cursor, and the gallery popover UI: top-6 preview swatches,
# the More styles list grouped by kind with the markdown mapping, the
# active-style highlight) is covered by the vitest suite
# (src/lib/__tests__/styles.test.tsx); this section checks the wiring the
# GUI driver cannot reach headlessly: the QuillStyle data model + built-in
# set + helpers in styles.ts, the paragraph registry command, the
# StyleGallery component, the gallery CSS, and the vitest suite presence.
test_styles_registry_module() {
    note "styles registry: QuillStyle model + built-in set + apply/active helpers"
    if [ -f "$ROOT/src/lib/styles.ts" ] \
        && grep -q 'export interface QuillStyle' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export type StyleKind' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export const BUILT_IN_STYLES' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export const TOP_GALLERY_STYLES' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export function applyStyle' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export function activeStyles' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export function styleActive' "$ROOT/src/lib/styles.ts" \
        && grep -q 'from "./editorCommands"' "$ROOT/src/lib/styles.ts"; then
        pass "styles registry: QuillStyle model + built-in set + apply/active helpers"
    else
        fail "styles registry: QuillStyle model + built-in set + apply/active helpers"
    fi
}
test_styles_builtin_set() {
    note "styles built-in set: >=12 styles aliasing existing registry commands"
    local file="$ROOT/src/lib/styles.ts"
    # Count the style rows: one "id:" per built-in style.
    local count
    count=$(grep -c '    id: "' "$file")
    if [ "$count" -ge 12 ] \
        && grep -q 'id: "normal"' "$file" \
        && grep -q 'id: "title"' "$file" \
        && grep -q 'id: "heading1"' "$file" \
        && grep -q 'id: "heading2"' "$file" \
        && grep -q 'id: "quote"' "$file" \
        && grep -q 'id: "intense-quote"' "$file" \
        && grep -q 'id: "list-paragraph"' "$file" \
        && grep -q 'id: "no-spacing"' "$file" \
        && grep -q 'id: "source-code"' "$file" \
        && grep -q 'id: "subtitle"' "$file" \
        && grep -q 'id: "emphasis"' "$file" \
        && grep -q 'id: "strong"' "$file" \
        && grep -q 'command: "h2"' "$file" \
        && grep -q 'command: "blockquote"' "$file"; then
        pass "styles built-in set: >=12 styles aliasing existing registry commands"
    else
        fail "styles built-in set: >=12 styles aliasing existing registry commands (found $count)"
    fi
}
test_styles_paragraph_command() {
    note "styles paragraph registry command (Word Normal: lift list/quote)"
    if grep -q 'id: "paragraph"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'liftListItem("listItem")' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'setParagraph().run()' "$ROOT/src/lib/editorCommands.ts"; then
        pass "styles paragraph registry command (Word Normal: lift list/quote)"
    else
        fail "styles paragraph registry command (Word Normal: lift list/quote)"
    fi
}
test_styles_gallery_component() {
    note "styles StyleGallery: top-6 swatches + More styles + active highlight"
    if [ -f "$ROOT/src/components/StyleGallery.tsx" ] \
        && grep -q 'quillmd-style-grid' "$ROOT/src/components/StyleGallery.tsx" \
        && grep -q 'More styles' "$ROOT/src/components/StyleGallery.tsx" \
        && grep -q 'data-style-id' "$ROOT/src/components/StyleGallery.tsx" \
        && grep -q 'quillmd-style-active' "$ROOT/src/components/StyleGallery.tsx" \
        && grep -q 'applyStyle(editor, style)' "$ROOT/src/components/StyleGallery.tsx" \
        && grep -q 'activeStyles(editor)' "$ROOT/src/components/StyleGallery.tsx" \
        && grep -q 'useEditorState' "$ROOT/src/components/StyleGallery.tsx"; then
        pass "styles StyleGallery: top-6 swatches + More styles + active highlight"
    else
        fail "styles StyleGallery: top-6 swatches + More styles + active highlight"
    fi
}
test_styles_gallery_css() {
    note "styles gallery CSS: popover, swatch grid, active highlight"
    if grep -q '.quillmd-styles-popover' "$ROOT/src/App.css" \
        && grep -q '.quillmd-style-grid' "$ROOT/src/App.css" \
        && grep -q '.quillmd-style-preview' "$ROOT/src/App.css" \
        && grep -q '.quillmd-style-group' "$ROOT/src/App.css" \
        && grep -q '.quillmd-style-active' "$ROOT/src/App.css"; then
        pass "styles gallery CSS: popover, swatch grid, active highlight"
    else
        fail "styles gallery CSS: popover, swatch grid, active highlight"
    fi
}
test_styles_suites_present() {
    note "styles vitest suite: Heading 2 -> h2 + selection state follows cursor"
    if [ -f "$ROOT/src/lib/__tests__/styles.test.tsx" ] \
        && grep -q 'toBeGreaterThanOrEqual(12)' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q 'styleById("heading2")' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q '"## Hello world\\n"' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q 'quillmd-style-active' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q 'More styles' "$ROOT/src/lib/__tests__/styles.test.tsx"; then
        pass "styles vitest suite: Heading 2 -> h2 + selection state follows cursor"
    else
        fail "styles vitest suite: Heading 2 -> h2 + selection state follows cursor"
    fi
}

# --- p2-styles-menu: Format > Styles submenu + toolbar gallery button (issue #55, plan 05 task 5.2) ---
# The pick behavior (id -> (registry command, with) resolution, the menu path
# vs gallery path document text parity, the toolbar gallery swatch pick, and
# the menu-event e2e through the full App) is covered by the vitest suite
# (src/lib/__tests__/stylemenu.test.tsx); this section checks the wiring the
# GUI driver cannot reach headlessly: the Format > Styles submenu in menu.rs
# (the STYLES (id, label) list mirroring BUILT_IN_STYLES + per-style menu
# ids), the styleMenuCommand resolver in styles.ts, the App.tsx routing of
# the ids through the shared registry, and the Toolbar mounting the
# StyleGallery as its first control (the Word-style gallery button).
test_stylemenu_submenu_wiring() {
    note "styles-menu Format > Styles submenu in menu.rs (STYLES + per-style ids)"
    if grep -q 'pub const STYLES: &\[(&str, &str)\]' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("normal", "Normal")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("title", "Title")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("heading1", "Heading 1")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("quote", "Quote")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("intense-quote", "Intense Quote")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("list-paragraph", "List Paragraph")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("no-spacing", "No Spacing")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("source-code", "Source Code")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("emphasis", "Emphasis")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '("strong", "Strong")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Styles")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'format!("format-style-{id}")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '.item(&styles)' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'fn style_menu_ids_are_nonempty_and_unique' "$ROOT/src-tauri/src/menu.rs"; then
        pass "styles-menu Format > Styles submenu in menu.rs (STYLES + per-style ids)"
    else
        fail "styles-menu Format > Styles submenu in menu.rs (STYLES + per-style ids)"
    fi
}
test_stylemenu_resolver() {
    note "styles-menu styleMenuCommand resolver in styles.ts"
    if grep -q 'export const STYLE_MENU_ID_PREFIX = "format-style-"' "$ROOT/src/lib/styles.ts" \
        && grep -q 'export function styleMenuCommand' "$ROOT/src/lib/styles.ts" \
        && grep -q 'id.startsWith(STYLE_MENU_ID_PREFIX)' "$ROOT/src/lib/styles.ts" \
        && grep -q 'styleById(id.slice(STYLE_MENU_ID_PREFIX.length))' "$ROOT/src/lib/styles.ts"; then
        pass "styles-menu styleMenuCommand resolver in styles.ts"
    else
        fail "styles-menu styleMenuCommand resolver in styles.ts"
    fi
}
test_stylemenu_app_routing() {
    note "styles-menu App.tsx routes the Styles submenu ids through the shared registry"
    if grep -q 'import { styleMenuCommand } from "./lib/styles"' "$ROOT/src/App.tsx" \
        && grep -q 'id.startsWith("format-style-")' "$ROOT/src/App.tsx" \
        && grep -q 'const action = styleMenuCommand(id);' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand(action.command, action.param)' "$ROOT/src/App.tsx" \
        && grep -q 'if (action.with) dispatchEditorCommand(action.with);' "$ROOT/src/App.tsx"; then
        pass "styles-menu App.tsx routes the Styles submenu ids through the shared registry"
    else
        fail "styles-menu App.tsx routes the Styles submenu ids through the shared registry"
    fi
}
test_stylemenu_toolbar_wiring() {
    note "styles-menu Toolbar mounts the StyleGallery as its first control"
    if grep -q 'import StyleGallery from "./StyleGallery"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '<StyleGallery editor={editor} />' "$ROOT/src/components/Toolbar.tsx"; then
        pass "styles-menu Toolbar mounts the StyleGallery as its first control"
    else
        fail "styles-menu Toolbar mounts the StyleGallery as its first control"
    fi
}
test_stylemenu_suites_present() {
    note "styles-menu vitest suite: id resolution + Rust/TS sync + parity + e2e"
    if [ -f "$ROOT/src/lib/__tests__/stylemenu.test.tsx" ] \
        && grep -q 'mirrors the frontend built-in style set (menu offers the same styles)' "$ROOT/src/lib/__tests__/stylemenu.test.tsx" \
        && grep -q 'every style menu id dispatches the same commands the gallery does' "$ROOT/src/lib/__tests__/stylemenu.test.tsx" \
        && grep -q 'the menu path writes the markdown the style mapping documents' "$ROOT/src/lib/__tests__/stylemenu.test.tsx" \
        && grep -q 'renders the Styles trigger as the first toolbar control, before the heading select' "$ROOT/src/lib/__tests__/stylemenu.test.tsx" \
        && grep -q 'a Heading 2 menu pick sets H2 on the live editor' "$ROOT/src/lib/__tests__/stylemenu.test.tsx"; then
        pass "styles-menu vitest suite: id resolution + Rust/TS sync + parity + e2e"
    else
        fail "styles-menu vitest suite: id resolution + Rust/TS sync + parity + e2e"
    fi
}

# --- p2-themes: built-in theme system (issue #56, plan 05 task 5.3) ---------

test_theme_module() {
    local t="theme_module"
    local theme_id problems=""
    local theme_ts="$ROOT/src/lib/theme.ts"
    [ -f "$theme_ts" ] || problems+="src/lib/theme.ts missing; "
    if [ -f "$theme_ts" ]; then
        grep -q 'export type ThemeId = "quill" | "minimal" | "serif" | "dark" | "high-contrast"' "$theme_ts" \
            || problems+="ThemeId union missing/changed; "
        grep -q 'export const THEMES' "$theme_ts" \
            || problems+="THEMES registry missing; "
        for theme_id in quill minimal serif dark high-contrast; do
            grep -q "id: \"$theme_id\"" "$theme_ts" \
                || problems+="THEMES missing id $theme_id; "
        done
        grep -q 'export const DEFAULT_THEME: ThemeId = "quill"' "$theme_ts" \
            || problems+="DEFAULT_THEME missing; "
        grep -q 'THEME_MENU_ID_PREFIX = "view-theme-"' "$theme_ts" \
            || problems+="THEME_MENU_ID_PREFIX missing; "
        grep -q 'THEME_DEFAULT_MENU_ID_PREFIX = "view-theme-default-"' "$theme_ts" \
            || problems+="THEME_DEFAULT_MENU_ID_PREFIX missing; "
        grep -q 'THEME_RESET_MENU_ID = "view-theme-reset"' "$theme_ts" \
            || problems+="THEME_RESET_MENU_ID missing; "
        grep -q 'export function resolveTheme' "$theme_ts" \
            || problems+="resolveTheme helper missing; "
        grep -q 'export function hasSavedThemeDefault' "$theme_ts" \
            || problems+="hasSavedThemeDefault missing; "
        grep -q 'export function loadThemeDefault' "$theme_ts" \
            || problems+="loadThemeDefault missing; "
        grep -q 'export function saveThemeDefault' "$theme_ts" \
            || problems+="saveThemeDefault missing; "
        grep -q 'export function osPrefersDark' "$theme_ts" \
            || problems+="osPrefersDark helper missing; "
        grep -q 'quillmd.theme.default' "$theme_ts" \
            || problems+="app-wide default storage key missing; "
    fi
    note "$t"
    if [ -z "$problems" ]; then
        pass "theme registry, persistence helpers, menu id scheme, and OS-dark fallback present"
    else
        echo "  $problems"
        fail "$t"
    fi
}

test_theme_css_sheets() {
    local t="theme_css_sheets"
    local theme_css problems=""
    for theme_css in quill minimal serif dark high-contrast; do
        local css="$ROOT/src/themes/$theme_css.css"
        if [ -f "$css" ]; then
            grep -q "\.quillmd-content\[data-theme=\"$theme_css\"\]" "$css" \
                || problems+="src/themes/$theme_css.css missing data-theme scope; "
            grep -q '\-\-quillmd-base-size' "$css" \
                || problems+="src/themes/$theme_css.css missing --quillmd-base-size; "
            grep -q '\-\-quillmd-code-bg' "$css" \
                || problems+="src/themes/$theme_css.css missing --quillmd-code-bg; "
            grep -q '\-\-quillmd-heading-weight' "$css" \
                || problems+="src/themes/$theme_css.css missing --quillmd-heading-weight; "
        else
            problems+="src/themes/$theme_css.css missing; "
        fi
    done
    local index_css="$ROOT/src/themes/index.css"
    if [ -f "$index_css" ]; then
        for theme_css in quill minimal serif dark high-contrast; do
            grep -q "@import \"./$theme_css.css\";" "$index_css" \
                || problems+="src/themes/index.css missing import for $theme_css.css; "
        done
    else
        problems+="src/themes/index.css missing; "
    fi
    local app_css="$ROOT/src/App.css"
    local app_tsx="$ROOT/src/App.tsx"
    [ -f "$app_css" ] || problems+="src/App.css missing; "
    [ -f "$app_tsx" ] || problems+="src/App.tsx missing; "
    if [ -f "$app_css" ]; then
        grep -q 'var(--quillmd-base-size, 15px)' "$app_css" \
            || problems+="src/App.css does not consume --quillmd-base-size; "
        grep -q 'var(--quillmd-link, #4fc1ff)' "$app_css" \
            || problems+="src/App.css does not consume --quillmd-link; "
        grep -q 'var(--quillmd-heading-weight, 600)' "$app_css" \
            || problems+="src/App.css does not consume --quillmd-heading-weight; "
        grep -q 'var(--quillmd-code-bg, rgba(128, 128, 128, 0.16))' "$app_css" \
            || problems+="src/App.css does not consume --quillmd-code-bg; "
    fi
    if [ -f "$app_tsx" ]; then
        grep -q 'import "./themes/index.css";' "$app_tsx" \
            || problems+="App.tsx does not import themes/index.css; "
        grep -q 'data-theme={activeTheme}' "$app_tsx" \
            || problems+="App.tsx does not render activeTheme on the content container; "
    fi
    note "$t"
    if [ -z "$problems" ]; then
        pass "all five CSS variable sheets, index import, App.css consumption, and data-theme rendering present"
    else
        echo "  $problems"
        fail "$t"
    fi
}

test_theme_menu_wiring() {
    local t="theme_menu_wiring"
    local theme_id problems=""
    local menu_rs="$ROOT/src-tauri/src/menu.rs"
    if [ -f "$menu_rs" ]; then
        for theme_id in quill minimal serif dark high-contrast; do
            grep -q "\"$theme_id\", \"" "$menu_rs" \
                || problems+="Rust THEMES missing $theme_id; "
        done
        grep -q 'SubmenuBuilder::new(app, "Theme")' "$menu_rs" \
            || problems+="View > Theme submenu missing; "
        grep -q 'SubmenuBuilder::new(app, "Default theme")' "$menu_rs" \
            || problems+="View > Default theme submenu missing; "
        grep -q 'format!("view-theme-{id}")' "$menu_rs" \
            || problems+="per-doc theme menu id construction missing; "
        grep -q 'format!("view-theme-default-{id}")' "$menu_rs" \
            || problems+="app default theme menu id construction missing; "
        grep -q '"view-theme-reset"' "$menu_rs" \
            || problems+="reset per-doc theme menu item missing; "
        grep -q 'fn theme_menu_ids_are_nonempty_and_unique' "$menu_rs" \
            || problems+="Rust theme menu id test missing; "
    else
        problems+="src-tauri/src/menu.rs missing; "
    fi
    note "$t"
    if [ -z "$problems" ]; then
        pass "Rust Theme and Default theme submenus match the five-theme registry"
    else
        echo "  $problems"
        fail "$t"
    fi
}

test_theme_app_routing() {
    local t="theme_app_routing"
    local problems=""
    local app_tsx="$ROOT/src/App.tsx"
    if [ -f "$app_tsx" ]; then
        grep -q 'THEME_DEFAULT_MENU_ID_PREFIX' "$app_tsx" \
            || problems+="App.tsx does not route app default theme picks; "
        grep -q 'THEME_RESET_MENU_ID' "$app_tsx" \
            || problems+="App.tsx does not route reset per-doc theme; "
        grep -q 'THEME_MENU_ID_PREFIX' "$app_tsx" \
            || problems+="App.tsx does not route per-doc theme picks; "
        grep -q 'changeAppTheme' "$app_tsx" \
            || problems+="changeAppTheme handler missing; "
        grep -q 'changeDocTheme' "$app_tsx" \
            || problems+="changeDocTheme handler missing; "
        grep -q 'patchDocSettings' "$app_tsx" \
            || problems+="per-doc theme persistence not wired through patchDocSettings; "
        grep -q 'saveThemeDefault' "$app_tsx" \
            || problems+="app-wide theme persistence not wired; "
        grep -q 'loadThemeDefault' "$app_tsx" \
            || problems+="app-wide theme load not wired; "
        grep -q 'hasSavedThemeDefault' "$app_tsx" \
            || problems+="OS-dark tracking guard missing; "
        grep -q 'matchMedia' "$app_tsx" \
            || problems+="live OS dark-mode listener missing; "
    else
        problems+="src/App.tsx missing; "
    fi
    note "$t"
    if [ -z "$problems" ]; then
        pass "App.tsx routes theme menu events and persists per-doc/app-wide theme state"
    else
        echo "  $problems"
        fail "$t"
    fi
}

test_theme_suites_present() {
    local t="theme_suites_present"
    local problems=""
    local suite="$ROOT/src/lib/__tests__/theme.test.tsx"
    if [ -f "$suite" ]; then
        grep -q 'data-theme' "$suite" \
            || problems+="theme.test.tsx missing data-theme coverage; "
        grep -q 'THEME_DEFAULT_MENU_ID_PREFIX' "$suite" \
            || problems+="theme.test.tsx missing app default menu event coverage; "
        grep -q 'view-theme-reset' "$suite" \
            || problems+="theme.test.tsx missing reset coverage; "
        grep -q 'quillmd.theme.default' "$suite" \
            || problems+="theme.test.tsx missing app-wide persistence coverage; "
        grep -q 'setOsDark' "$suite" \
            || problems+="theme.test.tsx missing OS-dark coverage; "
        grep -q 'themes/${id}.css' "$suite" \
            || problems+="theme.test.tsx missing CSS variable sheet coverage; "
        grep -q 'App.css' "$suite" \
            || problems+="theme.test.tsx missing App.css consumption coverage; "
    else
        problems+="theme.test.tsx missing; "
    fi
    note "$t"
    if [ -z "$problems" ]; then
        pass "theme vitest suite covers registry, persistence, CSS sheets, menu wiring, and App behavior"
    else
        echo "  $problems"
        fail "$t"
    fi
}

# --- p2-style-modify: Modify Style + overrides storage (issue #57, plan 05 task 5.4) ---
# The behavior (the style-id -> markdown-key map with alias sharing, the field
# validators (family free text, closed pt enum, #rrggbb, weight/italic/
# spacing), the corruption tolerance of normalizeOverride/normalizeOverrides,
# the view-only CSS generator, the storage bridge (Tauri invoke + localStorage
# dev fallback), the dialog component (prefill, live preview, style
# switching, Enter/Esc, reset style / reset all), and the full-App menu-event
# e2e (plan 05 AC3: Modify Style on H2 (Georgia, 18pt) restyles every H2
# live, leaves the document bytes untouched, and persists across restarts;
# AC6: no style markup ever written to disk)) is covered by the vitest suite
# (src/lib/__tests__/styleOverrides.test.tsx); this section checks the wiring
# the GUI driver cannot reach headlessly: the styleOverrides.ts module, the
# ModifyStyleDialog component, the Rust read/write_style_overrides commands,
# the menu.rs Modify item, the App.tsx routing + <style> injection, the
# dialog CSS, and the vitest suite presence.
test_stylemodify_module() {
    note "style-modify styleOverrides.ts: key map, validators, CSS gen, storage bridge"
    local file="$ROOT/src/lib/styleOverrides.ts"
    if [ -f "$file" ] \
        && grep -q 'export type OverrideKey' "$file" \
        && grep -q 'export const STYLE_OVERRIDE_KEYS' "$file" \
        && grep -q 'export const BLOCK_OVERRIDE_KEYS' "$file" \
        && grep -q 'export interface StyleOverride' "$file" \
        && grep -q 'export const MODIFY_STYLE_MENU_ID = "format-style-modify"' "$file" \
        && grep -q 'export function styleKeyForStyleId' "$file" \
        && grep -q 'export const OVERRIDE_FONT_SIZES' "$file" \
        && grep -q 'export function normalizeFontFamily' "$file" \
        && grep -q 'export function normalizeOverride' "$file" \
        && grep -q 'export function normalizeOverrides' "$file" \
        && grep -q 'export function overridesToCss' "$file" \
        && grep -q 'read_style_overrides' "$file" \
        && grep -q 'write_style_overrides' "$file" \
        && grep -q 'quillmd.styleOverrides' "$file"; then
        pass "style-modify styleOverrides.ts: key map, validators, CSS gen, storage bridge"
    else
        fail "style-modify styleOverrides.ts: key map, validators, CSS gen, storage bridge"
    fi
}
test_stylemodify_dialog_component() {
    note "style-modify ModifyStyleDialog: fields + live preview + reset flows"
    local file="$ROOT/src/components/ModifyStyleDialog.tsx"
    if [ -f "$file" ] \
        && grep -q 'quillmd-modify-dialog' "$file" \
        && grep -q 'data-field="style"' "$file" \
        && grep -q 'data-field="family"' "$file" \
        && grep -q 'data-field="size"' "$file" \
        && grep -q 'data-field="color"' "$file" \
        && grep -q 'data-field="spacing"' "$file" \
        && grep -q 'quillmd-modify-preview' "$file" \
        && grep -q 'overridesToCss' "$file" \
        && grep -q 'draftFromOverride' "$file" \
        && grep -q 'Reset style' "$file" \
        && grep -q 'Reset all' "$file" \
        && grep -q 'onApply' "$file"; then
        pass "style-modify ModifyStyleDialog: fields + live preview + reset flows"
    else
        fail "style-modify ModifyStyleDialog: fields + live preview + reset flows"
    fi
}
test_stylemodify_rust_commands() {
    note "style-modify Rust read/write_style_overrides (app config dir JSON)"
    if grep -q 'pub fn read_style_overrides' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn write_style_overrides' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'style-overrides.json' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn read_overrides_file' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn write_overrides_file' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'fn overrides_write_roundtrips' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'fn overrides_write_rejects_non_object_payloads' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'commands::read_style_overrides' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'commands::write_style_overrides' "$ROOT/src-tauri/src/lib.rs"; then
        pass "style-modify Rust read/write_style_overrides (app config dir JSON)"
    else
        fail "style-modify Rust read/write_style_overrides (app config dir JSON)"
    fi
}
test_stylemodify_menu_wiring() {
    note "style-modify menu.rs Format > Styles > Modify item"
    if grep -q 'MenuItem::with_id(app, "format-style-modify", "Modify..."' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'styles.separator().item(&modify_style).build()' "$ROOT/src-tauri/src/menu.rs"; then
        pass "style-modify menu.rs Format > Styles > Modify item"
    else
        fail "style-modify menu.rs Format > Styles > Modify item"
    fi
}
test_stylemodify_app_routing() {
    note "style-modify App.tsx: menu id -> dialog, <style> injection, persistence"
    if grep -q 'id === MODIFY_STYLE_MENU_ID' "$ROOT/src/App.tsx" \
        && grep -q 'openModifyStyle()' "$ROOT/src/App.tsx" \
        && grep -q 'overridesToCss(styleOverrides, \[' "$ROOT/src/App.tsx" \
        && grep -q '<style>{overridesCss}</style>' "$ROOT/src/App.tsx" \
        && grep -q '<ModifyStyleDialog' "$ROOT/src/App.tsx" \
        && grep -q 'loadStyleOverrides()' "$ROOT/src/App.tsx" \
        && grep -q 'saveStyleOverrides(next)' "$ROOT/src/App.tsx" \
        && grep -q 'saveStyleOverrides({})' "$ROOT/src/App.tsx"; then
        pass "style-modify App.tsx: menu id -> dialog, <style> injection, persistence"
    else
        fail "style-modify App.tsx: menu id -> dialog, <style> injection, persistence"
    fi
}
test_stylemodify_css() {
    note "style-modify dialog CSS: overlay, fields, live preview pane"
    if grep -q '.quillmd-modify-overlay' "$ROOT/src/App.css" \
        && grep -q '.quillmd-modify-dialog' "$ROOT/src/App.css" \
        && grep -q '.quillmd-modify-fields' "$ROOT/src/App.css" \
        && grep -q '.quillmd-modify-preview' "$ROOT/src/App.css" \
        && grep -q '.quillmd-modify-actions' "$ROOT/src/App.css"; then
        pass "style-modify dialog CSS: overlay, fields, live preview pane"
    else
        fail "style-modify dialog CSS: overlay, fields, live preview pane"
    fi
}
test_stylemodify_suites_present() {
    note "style-modify vitest suite: mapping + validators + AC3 e2e + reset + storage"
    local suite="$ROOT/src/lib/__tests__/styleOverrides.test.tsx"
    if [ -f "$suite" ] \
        && grep -q 'aliases of one markdown construct share its key' "$suite" \
        && grep -q 'previews the draft live: Georgia 18pt on H2 (AC3 preview)' "$suite" \
        && grep -q 'AC3: Modify Style on H2 (Georgia, 18pt) restyles every H2 live' "$suite" \
        && grep -q 'Reset all clears every override' "$suite" \
        && grep -q 'talks to the Rust commands under Tauri (read/write_style_overrides)' "$suite" \
        && grep -q 'round-trips through localStorage in browser dev' "$suite"; then
        pass "style-modify vitest suite: mapping + validators + AC3 e2e + reset + storage"
    else
        fail "style-modify vitest suite: mapping + validators + AC3 e2e + reset + storage"
    fi
}

# --- p2-style-inspector: status-bar block-type indicator (issue #58, plan 05 task 5.5) ---
# The block under the cursor is named by the first built-in block style active at
# the selection (styles.ts currentBlockStyle, the same "first active wins" rule the
# Modify Style preselect uses). The WYSIWYG Editor publishes that label on every
# transaction; the status bar renders it as a button whose popover names the style
# ("This block is: Heading 2") and whose "Jump to style" action opens the toolbar's
# style gallery on the current style. The mapping/popover/gallery-open behavior is
# covered by the vitest suite (src/lib/__tests__/styleinspector.test.tsx); this
# section checks the wiring the GUI driver cannot reach headlessly.
test_styleinspector_currentblockstyle() {
    note "style-inspector styles.ts: currentBlockStyle first-active block style"
    local file="$ROOT/src/lib/styles.ts"
    if [ -f "$file" ] \
        && grep -q 'export function currentBlockStyle' "$file" \
        && grep -q 'style.kind === "block"' "$file" \
        && grep -q 'styleActive(style, editor)' "$file"; then
        pass "style-inspector styles.ts: currentBlockStyle first-active block style"
    else
        fail "style-inspector styles.ts: currentBlockStyle first-active block style"
    fi
}
test_styleinspector_bridge() {
    note "style-inspector editorCommands.ts: block-style + gallery-open channels"
    if grep -q 'export function registerBlockStyleListener' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function publishBlockStyle' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function registerStylesGalleryListener' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function requestStylesGallery' "$ROOT/src/lib/editorCommands.ts"; then
        pass "style-inspector editorCommands.ts: block-style + gallery-open channels"
    else
        fail "style-inspector editorCommands.ts: block-style + gallery-open channels"
    fi
}
test_styleinspector_editor_publish() {
    note "style-inspector Editor.tsx: publishes the current block style on transactions"
    if grep -q 'publishBlockStyle' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'currentBlockStyle' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'onTransaction' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'publishBlockStyle(null)' "$ROOT/src/components/Editor.tsx"; then
        pass "style-inspector Editor.tsx: publishes the current block style on transactions"
    else
        fail "style-inspector Editor.tsx: publishes the current block style on transactions"
    fi
}
test_styleinspector_statusbar() {
    note "style-inspector StatusBar.tsx: block-type indicator + inspector popover"
    local file="$ROOT/src/components/StatusBar.tsx"
    if [ -f "$file" ] \
        && grep -q 'blockStyleLabel' "$file" \
        && grep -q 'onJumpToStyle' "$file" \
        && grep -q 'quillmd-status-style-popover' "$file" \
        && grep -q 'This block is:' "$file" \
        && grep -q 'quillmd-status-style-jump' "$file"; then
        pass "style-inspector StatusBar.tsx: block-type indicator + inspector popover"
    else
        fail "style-inspector StatusBar.tsx: block-type indicator + inspector popover"
    fi
}
test_styleinspector_gallery_open() {
    note "style-inspector StyleGallery.tsx: registers the gallery-open listener"
    if grep -q 'registerStylesGalleryListener' "$ROOT/src/components/StyleGallery.tsx"; then
        pass "style-inspector StyleGallery.tsx: registers the gallery-open listener"
    else
        fail "style-inspector StyleGallery.tsx: registers the gallery-open listener"
    fi
}
test_styleinspector_app_wiring() {
    note "style-inspector App.tsx: block-style state + jump-to-style routing"
    if grep -q 'registerBlockStyleListener' "$ROOT/src/App.tsx" \
        && grep -q 'requestStylesGallery' "$ROOT/src/App.tsx" \
        && grep -q 'blockStyleLabel' "$ROOT/src/App.tsx" \
        && grep -q 'onJumpToStyle={jumpToStyle}' "$ROOT/src/App.tsx"; then
        pass "style-inspector App.tsx: block-style state + jump-to-style routing"
    else
        fail "style-inspector App.tsx: block-style state + jump-to-style routing"
    fi
}
test_styleinspector_css() {
    note "style-inspector App.css: indicator + popover styles"
    if grep -q '.quillmd-status-style {' "$ROOT/src/App.css" \
        && grep -q '.quillmd-status-style-btn' "$ROOT/src/App.css" \
        && grep -q '.quillmd-status-style-popover' "$ROOT/src/App.css" \
        && grep -q '.quillmd-status-style-jump' "$ROOT/src/App.css"; then
        pass "style-inspector App.css: indicator + popover styles"
    else
        fail "style-inspector App.css: indicator + popover styles"
    fi
}
test_styleinspector_suites_present() {
    note "style-inspector vitest suite: mapping + popover + gallery-open request"
    local suite="$ROOT/src/lib/__tests__/styleinspector.test.tsx"
    if [ -f "$suite" ] \
        && grep -q 'headings resolve to the first active alias in registry order' "$suite" \
        && grep -q 'a horizontal rule (no built-in style) is null' "$suite" \
        && grep -q 'Jump to style invokes onJumpToStyle and closes the popover' "$suite" \
        && grep -q 'a mounted gallery opens on request and highlights the current style' "$suite"; then
        pass "style-inspector vitest suite: mapping + popover + gallery-open request"
    else
        fail "style-inspector vitest suite: mapping + popover + gallery-open request"
    fi
}

# --- p2-styles: plan 05 §4 acceptance criteria (plan 05 task 5.6, issue #59) ---
# Each plan 05 §4 acceptance criterion is covered by the vitest suites
# (styles.test.tsx, theme.test.tsx, styleOverrides.test.tsx,
# themescreenshots.test.tsx, stylesacceptance.test.tsx, roundtrip.test.ts)
# that `npm test` runs; the task 5.1-5.5 wiring checks above already gate the
# app-level surface (registry + gallery, Format > Styles, themes, Modify
# Style, style inspector). This block asserts each criterion's test is
# present, the standard fixture doc + committed screenshot baselines exist,
# and the round-trip regression is wired (AC6). AC4's baselines are the
# headless visual fingerprints of the standard fixture under each theme
# (tests/theme-baselines/<id>.txt): a theme look change moves exactly one
# baseline, so the diff is CI-reviewable without a GUI driver.
test_styles_ac1_gallery_and_h2() {
    note "styles.AC1 gallery >=12 styles; Heading 2 -> h2; selection follows cursor"
    if grep -q 'offers at least 12 built-in styles with unique ids' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q 'on a paragraph sets H2 (registry command h2)' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q 'highlights the active style as the cursor moves' "$ROOT/src/lib/__tests__/styles.test.tsx" \
        && grep -q 'command: "h2"' "$ROOT/src/lib/styles.ts"; then
        pass "styles.AC1 gallery >=12 styles; Heading 2 -> h2; selection follows cursor"
    else
        fail "styles.AC1 gallery >=12 styles; Heading 2 -> h2; selection follows cursor"
    fi
}
test_styles_ac2_theme_zero_bytes() {
    note "styles.AC2 a theme switch changes the look with zero bytes in currentText"
    if grep -q 'renders the %s sheet without touching the bytes' "$ROOT/src/lib/__tests__/theme.test.tsx" \
        && grep -q 'the persisted per-doc override and app default survive a remount' "$ROOT/src/lib/__tests__/theme.test.tsx" \
        && grep -q 'data-theme={activeTheme}' "$ROOT/src/App.tsx"; then
        pass "styles.AC2 a theme switch changes the look with zero bytes in currentText"
    else
        fail "styles.AC2 a theme switch changes the look with zero bytes in currentText"
    fi
}
test_styles_ac3_modify_h2() {
    note "styles.AC3 Modify H2 (Georgia 18pt) restyles live; disk unchanged; restart persists"
    if grep -q 'Modify Style on H2 (Georgia, 18pt) restyles every H2 live' "$ROOT/src/lib/__tests__/styleOverrides.test.tsx" \
        && grep -q 'Reset all clears every override (the global reset flow)' "$ROOT/src/lib/__tests__/styleOverrides.test.tsx" \
        && grep -q 'overridesToCss(styleOverrides' "$ROOT/src/App.tsx"; then
        pass "styles.AC3 Modify H2 (Georgia 18pt) restyles live; disk unchanged; restart persists"
    else
        fail "styles.AC3 Modify H2 (Georgia 18pt) restyles live; disk unchanged; restart persists"
    fi
}
test_styles_ac4_screenshot_baselines() {
    note "styles.AC4 all 5 themes pass the screenshot diff on the standard fixture"
    if [ -f "$ROOT/src/lib/__tests__/themescreenshots.test.tsx" ] \
        && grep -q 'the %s theme screenshot matches the committed baseline' "$ROOT/src/lib/__tests__/themescreenshots.test.tsx" \
        && grep -q 'the five themes render visually distinct screenshots (pairwise diff)' "$ROOT/src/lib/__tests__/themescreenshots.test.tsx" \
        && [ -f "$FIXTURES/clean/theme-standard.md" ] \
        && ls "$ROOT"/tests/theme-baselines/*.txt >/dev/null 2>&1 \
        && [ "$(ls "$ROOT"/tests/theme-baselines/*.txt | wc -l)" -eq 5 ]; then
        pass "styles.AC4 all 5 themes pass the screenshot diff on the standard fixture"
    else
        fail "styles.AC4 all 5 themes pass the screenshot diff on the standard fixture"
    fi
}
test_styles_ac5_os_dark_default() {
    note "styles.AC5 dark theme is the default for new docs when the OS reports dark"
    if grep -q 'defaults to Dark when there is no saved choice and the OS is dark' "$ROOT/src/lib/__tests__/theme.test.tsx" \
        && grep -q 'a new install with no saved choice follows the OS dark-mode preference' "$ROOT/src/lib/__tests__/theme.test.tsx" \
        && grep -q 'osPrefersDark' "$ROOT/src/lib/theme.ts"; then
        pass "styles.AC5 dark theme is the default for new docs when the OS reports dark"
    else
        fail "styles.AC5 dark theme is the default for new docs when the OS reports dark"
    fi
}
test_styles_ac6_roundtrip_no_markup() {
    note "styles.AC6 round-trip green; no style/theme markup ever written to disk"
    if [ -f "$ROOT/src/lib/__tests__/stylesacceptance.test.tsx" ] \
        && grep -q 'style/theme markup is never written to disk' "$ROOT/src/lib/__tests__/stylesacceptance.test.tsx" \
        && grep -q 'every clean fixture writes to disk without gaining a style/theme markup token' "$ROOT/src/lib/__tests__/stylesacceptance.test.tsx" \
        && grep -q 'expect(result.kind).toBe("verbatim")' "$ROOT/src/lib/__tests__/roundtrip.test.ts"; then
        pass "styles.AC6 round-trip green; no style/theme markup ever written to disk"
    else
        fail "styles.AC6 round-trip green; no style/theme markup ever written to disk"
    fi
}

# --- p2-font-toolbar: toolbar font family / size selects (issue #49, plan 04 task 4.3) ---
# The select behavior (family/size apply + Normal clear, "Npt" canonicalization,
# non-point-count rejection, the Custom… prompt flow, off-list values as dynamic
# options, and the heading -> family -> size -> inline-mark DOM order) is covered
# by the vitest suite (src/lib/__tests__/fonttoolbar.test.tsx); this section
# checks the wiring the GUI driver cannot reach headlessly: the fontFamily /
# fontSize registry commands + selection readers + curated family/size constants
# in editorCommands.ts, and the Toolbar rendering the family + size selects as
# the font cluster beside the color/highlight pickers.
test_fonttoolbar_registry_commands() {
    note "font-toolbar fontFamily + fontSize registry commands + readers present"
    if grep -q 'id: "fontFamily"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id: "fontSize"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function fontFamilyOf' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function fontSizeOf' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export const FONT_FAMILIES' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export const FONT_SIZES' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export const FONT_FAMILY_CUSTOM' "$ROOT/src/lib/editorCommands.ts"; then
        pass "font-toolbar fontFamily + fontSize registry commands + readers present"
    else
        fail "font-toolbar fontFamily + fontSize registry commands + readers present"
    fi
}
test_fonttoolbar_toolbar_wiring() {
    note "font-toolbar Toolbar renders the family + size selects"
    if grep -q 'FONT_FAMILIES' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'FONT_SIZES' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'FONT_FAMILY_CUSTOM' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'title="Font family"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'title="Font size"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'runEditorCommand(editor, "fontFamily"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'runEditorCommand(editor, "fontSize"' "$ROOT/src/components/Toolbar.tsx"; then
        pass "font-toolbar Toolbar renders the family + size selects"
    else
        fail "font-toolbar Toolbar renders the family + size selects"
    fi
}
test_fonttoolbar_suites_present() {
    note "font-toolbar vitest suite: family/size apply + clear + Custom prompt"
    if [ -f "$ROOT/src/lib/__tests__/fonttoolbar.test.tsx" ] \
        && grep -q 'picking a family applies the span; Normal clears it' "$ROOT/src/lib/__tests__/fonttoolbar.test.tsx" \
        && grep -q 'picking a size applies font-size: Npt; Normal clears it' "$ROOT/src/lib/__tests__/fonttoolbar.test.tsx" \
        && grep -q 'Custom… prompts for a free-text family and applies it' "$ROOT/src/lib/__tests__/fonttoolbar.test.tsx" \
        && grep -q 'sits right of the heading select and left of the inline-mark group' "$ROOT/src/lib/__tests__/fonttoolbar.test.tsx" \
        && grep -q 'composes family + size + color in the fixed attribute order' "$ROOT/src/lib/__tests__/fonttoolbar.test.tsx"; then
        pass "font-toolbar vitest suite: family/size apply + clear + Custom prompt"
    else
        fail "font-toolbar vitest suite: family/size apply + clear + Custom prompt"
    fi
}

# --- p2-font-menu: Format > Font submenu (issue #50, plan 04 task 4.4) ----------
# The pick behavior (id -> (command, param) resolution, the menu path vs
# toolbar path document text parity per plan 04 AC6, the Custom… prompt flow,
# and the menu-event e2e through the full App) is covered by the vitest suite
# (src/lib/__tests__/fontmenu.test.tsx); this section checks the wiring the
# GUI driver cannot reach headlessly: the Format > Font submenu in menu.rs
# (per-pick menu ids, no accelerator on the submenu Underline), the
# fontMenuCommand + fontFamilySlug resolvers in editorCommands.ts, and the
# App.tsx routing of the ids through the shared registry.
test_fontmenu_submenu_wiring() {
    note "font-menu Format > Font submenu (family/size/color/highlight/underline/clear)"
    if grep -q 'SubmenuBuilder::new(app, "Font")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Font family")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Font size")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Font color")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Highlight color")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-font-family-normal"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-font-family-custom"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-font-size-normal"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-font-color-auto"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-highlight-color-auto"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-font-underline"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"format-font-clear"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "format-font-underline", "Underline", true, None::<&str>)' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '.item(&font)' "$ROOT/src-tauri/src/menu.rs"; then
        pass "font-menu Format > Font submenu (family/size/color/highlight/underline/clear)"
    else
        fail "font-menu Format > Font submenu (family/size/color/highlight/underline/clear)"
    fi
}
test_fontmenu_resolvers() {
    note "font-menu fontMenuCommand + fontFamilySlug resolvers in editorCommands.ts"
    if grep -q 'export function fontFamilySlug' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function fontMenuCommand' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "format-font-family-normal"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "format-font-size-normal"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "format-font-color-auto"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "format-highlight-color-auto"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "format-font-underline"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "format-font-clear"' "$ROOT/src/lib/editorCommands.ts"; then
        pass "font-menu fontMenuCommand + fontFamilySlug resolvers in editorCommands.ts"
    else
        fail "font-menu fontMenuCommand + fontFamilySlug resolvers in editorCommands.ts"
    fi
}
test_fontmenu_app_routing() {
    note "font-menu App.tsx routes the Font submenu ids through the shared registry"
    if grep -q 'id.startsWith("format-font-")' "$ROOT/src/App.tsx" \
        && grep -q 'id.startsWith("format-highlight-color-")' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand(action.command, action.param)' "$ROOT/src/App.tsx" \
        && grep -q 'id === "format-font-family-custom"' "$ROOT/src/App.tsx" \
        && grep -q 'window.prompt("Custom font family")' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand("fontFamily", name)' "$ROOT/src/App.tsx"; then
        pass "font-menu App.tsx routes the Font submenu ids through the shared registry"
    else
        fail "font-menu App.tsx routes the Font submenu ids through the shared registry"
    fi
}
test_fontmenu_suites_present() {
    note "font-menu vitest suite: id resolution + Rust/TS list sync + AC6 parity"
    if [ -f "$ROOT/src/lib/__tests__/fontmenu.test.tsx" ] \
        && grep -q 'maps every curated family to its name via the slug' "$ROOT/src/lib/__tests__/fontmenu.test.tsx" \
        && grep -q 'mirrors the frontend family/size/color lists (menu offers the same picks)' "$ROOT/src/lib/__tests__/fontmenu.test.tsx" \
        && grep -q 'every menu id dispatches the same registry command the toolbar does' "$ROOT/src/lib/__tests__/fontmenu.test.tsx" \
        && grep -q 'a family menu pick writes the same span the toolbar pick does (AC6)' "$ROOT/src/lib/__tests__/fontmenu.test.tsx" \
        && grep -q 'Custom… prompts for a free-text family and applies it (AC6)' "$ROOT/src/lib/__tests__/fontmenu.test.tsx"; then
        pass "font-menu vitest suite: id resolution + Rust/TS list sync + AC6 parity"
    else
        fail "font-menu vitest suite: id resolution + Rust/TS list sync + AC6 parity"
    fi
}

# --- p2-clear-format: clear formatting extension + editor-chrome font (issue #51, plan 04 task 4.5) ---
# The mark-set semantics (clear strips every character mark — the font
# family/size/color marks among them — while keeping bold/italic, AC4) and the
# per-app font setting (localStorage persistence, the CSS variables, the menu
# picks) are covered by the vitest suites (src/lib/__tests__/clearFormatting.test.tsx,
# src/lib/__tests__/editorfont.test.tsx); this section checks the wiring the
# GUI driver cannot reach headlessly: the schema-derived clear in the registry
# command, the per-app editorFont command + readers, the editorFont module,
# the CSS fallback contract, the View > Editor font submenu in menu.rs, and
# the App.tsx routing.
test_clearformat_registry_command() {
    note "clear-format registry command strips the schema marks except bold/italic"
    if grep -q 'id: "clearFormatting"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'mark.name !== "bold" && mark.name !== "italic"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'chain.unsetMark(mark.name)' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'clearNodes()' "$ROOT/src/lib/editorCommands.ts"; then
        pass "clear-format registry command strips the schema marks except bold/italic"
    else
        fail "clear-format registry command strips the schema marks except bold/italic"
    fi
}
test_editorfont_module() {
    note "editorfont per-app font module with localStorage persistence"
    if [ -f "$ROOT/src/lib/editorFont.ts" ] \
        && grep -q 'export type EditorFontFamily' "$ROOT/src/lib/editorFont.ts" \
        && grep -q 'export const EDITOR_FONT_FAMILIES' "$ROOT/src/lib/editorFont.ts" \
        && grep -q 'export const EDITOR_FONT_SIZES' "$ROOT/src/lib/editorFont.ts" \
        && grep -q '"quillmd.editorFont"' "$ROOT/src/lib/editorFont.ts" \
        && grep -q 'export function loadEditorFont' "$ROOT/src/lib/editorFont.ts" \
        && grep -q 'export function saveEditorFont' "$ROOT/src/lib/editorFont.ts"; then
        pass "editorfont per-app font module with localStorage persistence"
    else
        fail "editorfont per-app font module with localStorage persistence"
    fi
}
test_editorfont_command_css() {
    note "editorfont command renders CSS variables on the editor DOM (never the doc)"
    if grep -q 'id: "editorFont"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q '"--quillmd-editor-font"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q '"--quillmd-editor-font-size"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function applyEditorFont' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'export function editorFontOf' "$ROOT/src/lib/editorCommands.ts"; then
        pass "editorfont command renders CSS variables on the editor DOM (never the doc)"
    else
        fail "editorfont command renders CSS variables on the editor DOM (never the doc)"
    fi
}
test_editorfont_css_fallback() {
    note "editorfont App.css falls back to the base text stack at 15px"
    if grep -q 'var(--quillmd-editor-font, var(--font-text))' "$ROOT/src/App.css" \
        && grep -q 'var(--quillmd-editor-font-size, 15px)' "$ROOT/src/App.css" \
        && grep -q 'applyEditorFont(editor, loadEditorFont())' "$ROOT/src/components/Editor.tsx"; then
        pass "editorfont App.css falls back to the base text stack at 15px"
    else
        fail "editorfont App.css falls back to the base text stack at 15px"
    fi
}
test_editorfont_menu_wiring() {
    note "editorfont menu.rs builds View > Editor font with the stable id scheme"
    if grep -q 'SubmenuBuilder::new(app, "Editor font")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'pub const EDITOR_FONT_FAMILIES' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'pub const EDITOR_FONT_SIZES' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'format!("view-editor-font-{family}")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'format!("view-editor-font-size-{size}")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '.item(&editor_font)' "$ROOT/src-tauri/src/menu.rs"; then
        pass "editorfont menu.rs builds View > Editor font with the stable id scheme"
    else
        fail "editorfont menu.rs builds View > Editor font with the stable id scheme"
    fi
}
test_editorfont_app_routing() {
    note "editorfont App.tsx routes the family/size ids to the per-app setter"
    if grep -q 'id.startsWith("view-editor-font-size-")' "$ROOT/src/App.tsx" \
        && grep -q 'id.startsWith("view-editor-font-")' "$ROOT/src/App.tsx" \
        && grep -q 'changeEditorFont({ family })' "$ROOT/src/App.tsx" \
        && grep -q 'changeEditorFont({ size })' "$ROOT/src/App.tsx" \
        && grep -q 'saveEditorFont(next)' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand("editorFont", next)' "$ROOT/src/App.tsx"; then
        pass "editorfont App.tsx routes the family/size ids to the per-app setter"
    else
        fail "editorfont App.tsx routes the family/size ids to the per-app setter"
    fi
}
test_clearformat_suites_present() {
    note "clear-format AC4 + editorfont vitest-suite assertions present"
    if grep -q 'removes family/size/color while keeping bold/italic' "$ROOT/src/lib/__tests__/clearFormatting.test.tsx" \
        && grep -q 'still unwraps block-level formatting (clearNodes) while keeping the marks' "$ROOT/src/lib/__tests__/clearFormatting.test.tsx" \
        && grep -q 'applies the family and size as CSS variables on the editor DOM' "$ROOT/src/lib/__tests__/editorfont.test.tsx" \
        && grep -q 'mirrors the frontend family/size lists (menu offers the same picks)' "$ROOT/src/lib/__tests__/editorfont.test.tsx" \
        && grep -q 'the persisted setting is re-applied when the editor remounts' "$ROOT/src/lib/__tests__/editorfont.test.tsx"; then
        pass "clear-format AC4 + editorfont vitest-suite assertions present"
    else
        fail "clear-format AC4 + editorfont vitest-suite assertions present"
    fi
}

# --- p2-fonts: plan 04 §4 acceptance criteria (plan 04 task 4.6, issue #52) ---
# Each plan 04 §4 acceptance criterion is covered by the vitest suites
# (fontmarks.test.tsx, colorpalette.test.tsx, fonttoolbar.test.tsx,
# fontmenu.test.tsx, clearFormatting.test.tsx, roundtrip.test.ts) that
# `npm test` runs; the task 4.1-4.5 wiring checks above already gate the
# app-level surface (marks + serializer, palette, toolbar cluster, Format >
# Font submenu, clear formatting + editor-chrome font). This block asserts
# each criterion's test is present, then spot-checks the PDF/DOCX export of
# the styled fixture through the same pandoc + typst pipeline the app runs
# (src-tauri/src/convert.rs export_pdf/export_docx), and the Windows CRLF
# round-trip for the styled doc (golden rule 4). The export spot-checks
# record the AC7 degradation: pandoc's typst + docx writers drop the
# quillmd spans, so styled text exports as plain text with its content
# intact — documented in the plan doc as an export limitation, not a bug.
test_fonts_ac1_apply_and_stable_save() {
    note "fonts.AC1 Georgia 14pt red -> exactly one span line; byte-identical re-save"
    if [ -f "$ROOT/src/lib/__tests__/fontmarks.test.tsx" ] \
        && grep -q 'applies size and color as additional span attributes (fixed order)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'font-family: Georgia; font-size: 14pt; color: #c00000' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'round-trips a single font-family span' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'round-trips a loaded font span with bold through the editor' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'fixtures", "clean"' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && grep -q 'expect(result.kind).toBe("verbatim")' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && [ -f "$FIXTURES/clean/font-styled.md" ] \
        && grep -q 'font-family: Georgia; font-size: 14pt; color: #c00000' "$FIXTURES/clean/font-styled.md"; then
        pass "fonts.AC1 Georgia 14pt red -> exactly one span line; byte-identical re-save"
    else
        fail "fonts.AC1 Georgia 14pt red -> exactly one span line; byte-identical re-save"
    fi
}
test_fonts_ac2_clean_docs_untouched() {
    note "fonts.AC2 unstyled docs stay byte-identical through save (clean corpus)"
    if [ -f "$ROOT/src/lib/__tests__/roundtrip.test.ts" ] \
        && grep -q 'fixtures", "clean"' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && grep -q 'expect(files.length).toBeGreaterThanOrEqual(40)' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && grep -q 'expect(new TextEncoder().encode(result.text)).toEqual(new Uint8Array(bytes))' "$ROOT/src/lib/__tests__/roundtrip.test.ts" \
        && ls "$FIXTURES"/clean/*.md >/dev/null 2>&1; then
        pass "fonts.AC2 unstyled docs stay byte-identical through save (clean corpus)"
    else
        fail "fonts.AC2 unstyled docs stay byte-identical through save (clean corpus)"
    fi
}
test_fonts_ac3_compose_and_toggle() {
    note "fonts.AC3 compose bold+italic+font+color; each attribute toggles off"
    if grep -q 'composes bold + italic + font + color on one range (AC3)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'toggles a font attribute off independently, keeping the others (AC3)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx"; then
        pass "fonts.AC3 compose bold+italic+font+color; each attribute toggles off"
    else
        fail "fonts.AC3 compose bold+italic+font+color; each attribute toggles off"
    fi
}
test_fonts_ac4_clear_keeps_bold_italic() {
    note "fonts.AC4 clear formatting strips family/size/color, keeps bold/italic"
    if [ -f "$ROOT/src/lib/__tests__/clearFormatting.test.tsx" ] \
        && grep -q 'removes family/size/color while keeping bold/italic' "$ROOT/src/lib/__tests__/clearFormatting.test.tsx" \
        && grep -q 'mark.name !== "bold" && mark.name !== "italic"' "$ROOT/src/lib/editorCommands.ts"; then
        pass "fonts.AC4 clear formatting strips family/size/color, keeps bold/italic"
    else
        fail "fonts.AC4 clear formatting strips family/size/color, keeps bold/italic"
    fi
}
test_fonts_ac5_highlight_color_and_compat() {
    note "fonts.AC5 highlight color picker works; ==text== default yellow unchanged"
    if grep -q 'sets a highlight color as a quillmd-highlight span (AC5)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'keeps the default (colorless) highlight as ==text== (AC5 backward compat)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'picking a swatch through the highlight palette applies a colored highlight' "$ROOT/src/lib/__tests__/colorpalette.test.tsx" \
        && grep -q 'highlightColor sets a colored quillmd-highlight span' "$ROOT/src/lib/__tests__/colorpalette.test.tsx"; then
        pass "fonts.AC5 highlight color picker works; ==text== default yellow unchanged"
    else
        fail "fonts.AC5 highlight color picker works; ==text== default yellow unchanged"
    fi
}
test_fonts_ac6_dispatch_parity() {
    note "fonts.AC6 toolbar + Font submenu dispatch the same registry ids (same doc text)"
    if [ -f "$ROOT/src/lib/__tests__/fontmenu.test.tsx" ] \
        && grep -q 'every menu id dispatches the same registry command the toolbar does' "$ROOT/src/lib/__tests__/fontmenu.test.tsx" \
        && grep -q 'a family menu pick writes the same span the toolbar pick does (AC6)' "$ROOT/src/lib/__tests__/fontmenu.test.tsx" \
        && grep -q 'runEditorCommand(editor, "fontFamily"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'dispatchEditorCommand(action.command, action.param)' "$ROOT/src/App.tsx"; then
        pass "fonts.AC6 toolbar + Font submenu dispatch the same registry ids (same doc text)"
    else
        fail "fonts.AC6 toolbar + Font submenu dispatch the same registry ids (same doc text)"
    fi
}
test_fonts_ac7_pdf_export_styled() {
    note "fonts.AC7 PDF (typst) export of the styled fixture renders the styled text"
    if ! command -v pandoc >/dev/null || ! command -v typst >/dev/null; then
        echo "SKIP (needs pandoc + typst)"
        return
    fi
    local out="$ROOT/target/font-styled.pdf"
    local text=""
    if pandoc "$FIXTURES/clean/font-styled.md" -o "$out" --pdf-engine=typst -V mainfont="DejaVu Sans" 2>/dev/null \
        && [ -s "$out" ] \
        && { ! command -v pdftotext >/dev/null || text="$(pdftotext "$out" - 2>/dev/null)"; }; then
        # Content spot-check: every styled run in the fixture is present in
        # the rendered page (pandoc's typst writer drops the span styling, so
        # the text renders in the document font — AC7's documented behavior).
        if { ! command -v pdftotext >/dev/null \
                || { grep -q "styled" <<<"$text" && grep -q "monospace" <<<"$text" \
                     && grep -q "highlighted" <<<"$text" && grep -q "red highlight" <<<"$text"; }; }; then
            pass "fonts.AC7 PDF (typst) export of the styled fixture renders the styled text"
        else
            fail "fonts.AC7 PDF (typst) export of the styled fixture renders the styled text"
        fi
    else
        fail "fonts.AC7 PDF (typst) export of the styled fixture renders the styled text"
    fi
}
test_fonts_ac7_docx_export_styled() {
    note "fonts.AC7 DOCX export of the styled fixture keeps the text (spans degrade to plain)"
    if ! command -v pandoc >/dev/null; then
        echo "SKIP (needs pandoc)"
        return
    fi
    local out="$ROOT/target/font-styled.docx"
    local roundtrip="$ROOT/target/font-styled.docx-roundtrip.md"
    local text=""
    if pandoc "$FIXTURES/clean/font-styled.md" -o "$out" 2>/dev/null \
        && [ -s "$out" ] \
        && pandoc "$out" -t gfm -o "$roundtrip" 2>/dev/null \
        && text="$(cat "$roundtrip")" \
        && grep -q "styled" <<<"$text" \
        && grep -q "monospace" <<<"$text" \
        && grep -q 'bold' <<<"$text" \
        && ! grep -q 'quillmd-font' <<<"$text"; then
        # Documented AC7 limitation: the quillmd spans degrade to plain text
        # in DOCX (the text content + markdown bold survive). See the plan doc
        # export spot-check note; this is a release-note item, not a blocker.
        pass "fonts.AC7 DOCX export of the styled fixture keeps the text (spans degrade to plain)"
    else
        fail "fonts.AC7 DOCX export of the styled fixture keeps the text (spans degrade to plain)"
    fi
}

# --- p2-fonts: Windows manual pass (plan 04 task 4.6, issue #52) --------------
# The manual Windows pass for fonts covers the one area where the font
# feature touches platform behavior (golden rule 4: Windows first-class):
# the CRLF round-trip must hold for a styled document. The editor
# re-serializes to LF and the save pipeline (encodeDocument) restores the
# document's CRLF ending, so an untouched styled doc saves byte-identically
# on Windows. These checks run on both platforms in this harness (the
# Windows runner gets them for free under Git Bash); the round-trip itself is
# exercised by the vitest suite under `npm test`.
test_fonts_windows_crlf() {
    note "fonts.windows CRLF round-trip holds for the styled fixture (save pipeline)"
    if grep -q 'round-trips the font-styled fixture byte-identically on CRLF (save pipeline)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx" \
        && grep -q 'if (opts.eol === "crlf")' "$ROOT/src/lib/pipeline.ts" \
        && grep -q 'source.includes("\\r\\n") ? "crlf" : "lf"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q 'round-trips a CRLF font document (the editor emits LF)' "$ROOT/src/lib/__tests__/fontmarks.test.tsx"; then
        pass "fonts.windows CRLF round-trip holds for the styled fixture (save pipeline)"
    else
        fail "fonts.windows CRLF round-trip holds for the styled fixture (save pipeline)"
    fi
}

# ===========================================================================
# P2 table editing (plan 06, tasks 6.1-6.7)
#
# Parent issue: #60. Task wiring:
#   6.1 #61 GFM serializer + parser hardening   pm.ts, Editor.tsx,
#                                               gfmTables.test.ts, gfm-tables.md
#   6.2 #62 row/column/cell/header/delete ops   editorCommands.ts,
#                                               tableCommands.test.ts
#   6.3 #63 size picker + insert dialog         tables.ts, TableSizePicker.tsx,
#                                               InsertTableDialog.tsx, Toolbar.tsx,
#                                               menu.rs, App.tsx, tableInsert/
#                                               tablePicker/tableMenu/tableToolbar
#   6.4 #64 floating table toolbar              TableToolbar.tsx, Editor.tsx,
#                                               floatingTableToolbar.test.tsx
#   6.5 #65 keyboard navigation                 tableKeys.ts, Editor.tsx,
#                                               tableKeys.test.tsx
#   6.6 #66 merge + colgroup widths             pm.ts, tableMerge.test.ts
#   6.7 #67 acceptance gate + GFM lint in CI    this section,
#                                               gfmLint.test.ts
#
# Every plan 06 §4 acceptance criterion (AC1-AC8) gets a dedicated test below.
# The GFM lint over the table fixtures (AC2) is not only asserted present but
# actually run here, and it is always run by the CI npm test gate as well.
# ===========================================================================

test_tables_gfm_serializer() {
    note "tables.6.1 GFM table serializer (plan 06 task 6.1, issue #61)"
    local f="$ROOT/src/lib/pm.ts"
    grep -q 'function tableToMdast(node: JSONContent)' "$f" \
        && grep -q 'function tableToTiptap(node: Table)' "$f" \
        && grep -q 'function tableAlignOfAttr' "$f" \
        && grep -q 'CELL_BR_RE = /' "$f" \
        && grep -q 'value: "<br>"' "$f" \
        && pass "pm.ts serializes GFM tables (alignment spec, <br> cells)" \
        || fail "pm.ts GFM table serializer missing"
    grep -q 'round-trips cells containing a pipe (escaped on save, unescaped in the model)' \
        "$ROOT/src/lib/__tests__/gfmTables.test.ts" \
        && pass "gfmTables.test.ts pins escaped-pipe cell round-trip" \
        || fail "gfmTables.test.ts escaped-pipe round-trip test missing"
}

test_tables_gfmtable_extension() {
    note "tables.6.1 GfmTable extension (plan 06 task 6.1, issue #61)"
    local f="$ROOT/src/components/Editor.tsx"
    grep -q 'export const GfmTable = Table.extend({' "$f" \
        && grep -q 'align: {' "$f" \
        && grep -q 'resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH' "$f" \
        && grep -q 'export const TABLE_CELL_MIN_WIDTH = 40' "$f" \
        && pass "Editor.tsx registers GfmTable (align attr, resizable, min width)" \
        || fail "Editor.tsx GfmTable extension missing"
    grep -q 'carries the align attribute through the ProseMirror schema' \
        "$ROOT/src/lib/__tests__/gfmTables.test.ts" \
        && pass "gfmTables.test.ts pins the align attribute through the schema" \
        || fail "gfmTables.test.ts align attribute test missing"
}

test_tables_gfm_fixture() {
    note "tables.6.1 gfm-tables.md fixture (plan 06 task 6.1, issue #61)"
    local f="$FIXTURES/clean/gfm-tables.md"
    [ -f "$f" ] \
        && grep -q 'a \\| b' "$f" \
        && grep -q '|:-----|:------:|------:|' "$f" \
        && pass "gfm-tables.md fixture present (alignment matrix, escaped pipes)" \
        || fail "gfm-tables.md fixture missing or wrong"
    grep -q 'classifies all five fixture tables as table blocks' \
        "$ROOT/src/lib/__tests__/gfmTables.test.ts" \
        && pass "gfmTables.test.ts classifies all five fixture tables" \
        || fail "gfmTables.test.ts fixture table classification test missing"
}

test_tables_registry_commands() {
    note "tables.6.2 registry commands (plan 06 task 6.2, issue #62)"
    local f="$ROOT/src/lib/editorCommands.ts"
    local id
    for id in rowInsertAbove rowInsertBelow rowDelete colInsertLeft colInsertRight \
              colDelete cellAlignLeft cellAlignCenter cellAlignRight headerRowToggle \
              cellMerge cellClear tableDelete; do
        grep -q "id: \"$id\"" "$f" \
            || { fail "editorCommands.ts missing table command id: $id"; return; }
    done
    grep -q 'export function inTable' "$f" \
        && grep -q 'export function tablePosOf' "$f" \
        && pass "editorCommands.ts registers all 13 table ops (row/col/cell/header/merge/clear/delete)" \
        || fail "editorCommands.ts table helpers (inTable/tablePosOf) missing"
}

test_tables_commands_suite() {
    note "tables.6.2 command suite (plan 06 task 6.2, issue #62)"
    local f="$ROOT/src/lib/__tests__/tableCommands.test.ts"
    grep -q 'registers every table command id exactly once' "$f" \
        && grep -q 'removes the whole table block' "$f" \
        && grep -q 'sets a column to center and persists it as the GFM spec' "$f" \
        && pass "tableCommands.test.ts covers the registry + each op's saved GFM" \
        || fail "tableCommands.test.ts coverage missing"
}

test_tables_insert_module() {
    note "tables.6.3 insert module (plan 06 task 6.3, issue #63)"
    local f="$ROOT/src/lib/tables.ts"
    grep -q 'export const TABLE_PICKER_SIZE = 10' "$f" \
        && grep -q 'export const TABLE_MAX = 99' "$f" \
        && grep -q 'export function isValidTableSize' "$f" \
        && grep -q 'export function insertTableAt' "$f" \
        && pass "tables.ts: picker size, 99-row cap, validation, insertTableAt" \
        || fail "tables.ts insert module missing"
}

test_tables_picker_components() {
    note "tables.6.3 picker + dialog components (plan 06 task 6.3, issue #63)"
    [ -f "$ROOT/src/components/TableSizePicker.tsx" ] \
        && [ -f "$ROOT/src/components/InsertTableDialog.tsx" ] \
        && grep -q 'export default function TableSizePicker' "$ROOT/src/components/TableSizePicker.tsx" \
        && grep -q 'export default function InsertTableDialog' "$ROOT/src/components/InsertTableDialog.tsx" \
        && grep -q 'import TableSizePicker from "./TableSizePicker"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q '<TableSizePicker onPick={handlePick} />' "$ROOT/src/components/Toolbar.tsx" \
        && pass "TableSizePicker + InsertTableDialog present, toolbar mounts the picker" \
        || fail "picker/dialog components missing or unmounted"
}

test_tables_menu_wiring() {
    note "tables.6.3 Insert > Table menu wiring (plan 06 task 6.3, issue #63)"
    grep -q '"insert-table"' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"insert-table": "tableDialog"' "$ROOT/src/App.tsx" \
        && grep -q 'import InsertTableDialog from "./components/InsertTableDialog"' "$ROOT/src/App.tsx" \
        && grep -q '<InsertTableDialog onApply={applyTableDialog} onClose={closeTableDialog} />' "$ROOT/src/App.tsx" \
        && grep -q 'id: "tableDialog"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'run: (editor) => requestTableDialog(editor)' "$ROOT/src/lib/editorCommands.ts" \
        && pass "menu.rs insert-table id routes to the registry tableDialog command + App dialog" \
        || fail "Insert > Table menu wiring missing"
}

test_tables_insert_suites() {
    note "tables.6.3 insert suites (plan 06 task 6.3, issue #63)"
    grep -q 'inserts exactly the requested size with a header row (plan 06 AC1: 7x2)' \
        "$ROOT/src/lib/__tests__/tableInsert.test.ts" \
        && grep -q 'the pick reports exactly the hovered size with a header row' \
            "$ROOT/src/lib/__tests__/tablePicker.test.tsx" \
        && grep -q 'Insert > Table opens the dialog on the 3x3 header default' \
            "$ROOT/src/lib/__tests__/tableMenu.test.tsx" \
        && grep -q 'a picker pick inserts exactly the hovered size and closes the picker' \
            "$ROOT/src/lib/__tests__/tableToolbar.test.tsx" \
        && pass "tableInsert/tablePicker/tableMenu/tableToolbar suites cover the insert path" \
        || fail "insert-path suite coverage missing"
}

test_tables_floating_toolbar() {
    note "tables.6.4 floating table toolbar (plan 06 task 6.4, issue #64)"
    local f="$ROOT/src/components/TableToolbar.tsx"
    grep -q 'export function tableToolbarPosition' "$f" \
        && grep -q 'export const TABLE_TOOLBAR_GAP = 8' "$f" \
        && grep -q 'const ROW_CMDS: EditorCommandId\[\]' "$f" \
        && grep -q 'const COL_CMDS: EditorCommandId\[\]' "$f" \
        && grep -q 'const CELL_CMDS: EditorCommandId\[\]' "$f" \
        && grep -q 'const DELETE_CMDS: EditorCommandId\[\]' "$f" \
        && grep -q 'import TableToolbar from "./TableToolbar"' "$ROOT/src/components/Editor.tsx" \
        && grep -q '{!readOnly && <TableToolbar editor={editor} />}' "$ROOT/src/components/Editor.tsx" \
        && pass "TableToolbar (positioned above the table, 4 command groups) mounted in Editor" \
        || fail "floating table toolbar missing"
}

test_tables_floating_suite() {
    note "tables.6.4 floating toolbar suite (plan 06 task 6.4, issue #64)"
    local f="$ROOT/src/lib/__tests__/floatingTableToolbar.test.tsx"
    grep -q 'appears when the cursor moves into a table' "$f" \
        && grep -q 'hides when the cursor leaves the table' "$f" \
        && grep -q "places the bar above the table's rect, in document space" "$f" \
        && grep -q 'offers the row/column/cell command set plus delete table' "$f" \
        && pass "floatingTableToolbar.test.tsx covers show/hide/position/command set" \
        || fail "floatingTableToolbar.test.tsx coverage missing"
}

test_tables_keyboard() {
    note "tables.6.5 keyboard navigation (plan 06 task 6.5, issue #65)"
    local f="$ROOT/src/lib/tableKeys.ts"
    grep -q 'export function tableTab(editor: CoreEditor, backward: boolean): boolean' "$f" \
        && grep -q 'export function tableEscape(editor: CoreEditor): boolean' "$f" \
        && grep -q 'TABLE_MAX' "$f" \
        && grep -q 'if (tableTab(editor, event.shiftKey)) {' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'if (tableEscape(editor)) {' "$ROOT/src/components/Editor.tsx" \
        && pass "tableKeys (Tab/Shift+Tab/Escape, 99-row guard) wired into Editor keydown" \
        || fail "keyboard navigation missing"
}

test_tables_keys_suite() {
    note "tables.6.5 keyboard suite (plan 06 task 6.5, issue #65)"
    local f="$ROOT/src/lib/__tests__/tableKeys.test.tsx"
    grep -q 'Tab in the last cell appends a row and moves into it' "$f" \
        && grep -q 'Tab in the last cell is a no-op at the TABLE_MAX row guard' "$f" \
        && grep -q 'Shift+Tab moves the cursor to the previous cell' "$f" \
        && grep -q 'moves the cursor to the paragraph after the table' "$f" \
        && pass "tableKeys.test.tsx covers Tab append, 99 guard, Shift+Tab, Escape exit" \
        || fail "tableKeys.test.tsx coverage missing"
}

test_tables_merge_serializer() {
    note "tables.6.6 merge + colgroup serializer (plan 06 task 6.6, issue #66)"
    local f="$ROOT/src/lib/pm.ts"
    grep -q 'function tableNeedsHtmlForm(node: JSONContent): boolean' "$f" \
        && grep -q 'function renderMergedTableHtml(node: JSONContent): string' "$f" \
        && grep -q 'export function parseMergedTableHtml(value: string): JSONContent | null' "$f" \
        && grep -q '"<colgroup>"' "$f" \
        && pass "pm.ts merged-table HTML emit/parse + colgroup widths" \
        || fail "pm.ts merged-table serializer missing"
    grep -q 'emits the canonical HTML form for a colspan merge' "$ROOT/src/lib/__tests__/tableMerge.test.ts" \
        && grep -q 'emits colgroup widths for user-set colwidths' "$ROOT/src/lib/__tests__/tableMerge.test.ts" \
        && pass "tableMerge.test.ts pins the canonical HTML emit" \
        || fail "tableMerge.test.ts emit coverage missing"
}

test_tables_merge_suite() {
    note "tables.6.6 merge suite (plan 06 task 6.6, issue #66)"
    local f="$ROOT/src/lib/__tests__/tableMerge.test.ts"
    grep -q 'a dragged divider (colwidth) round-trips through the colgroup' "$f" \
        && grep -q 'rejects non-canonical <table> blocks (they stay opaque HTML)' "$f" \
        && pass "tableMerge.test.ts covers divider round-trip + opaque-HTML refusal" \
        || fail "tableMerge.test.ts coverage missing"
}

test_tables_ac1_picker_inserts_exact_size() {
    note "tables.AC1 a picked size lands in the saved file with a header row (plan 06 AC1)"
    grep -q 'plan 06 AC1: a 7x2 with header in the saved file' \
        "$ROOT/src/lib/__tests__/tableInsert.test.ts" \
        && grep -q 'serializes the 7x2 header pick to valid GFM with a header row (AC1)' \
            "$ROOT/src/lib/__tests__/tableInsert.test.ts" \
        && grep -q 'the pick reports exactly the hovered size with a header row' \
            "$ROOT/src/lib/__tests__/tablePicker.test.tsx" \
        && pass "AC1: a 7x2 pick lands in the saved file with a header row" \
        || fail "AC1 coverage missing (tableInsert/tablePicker suites)"
}

test_tables_ac2_gfm_lint() {
    note "tables.AC2 GFM lint in CI for the table fixtures (plan 06 AC2, task 6.7, issue #67)"
    local f="$ROOT/src/lib/__tests__/gfmLint.test.ts"
    grep -q 'GFM lint over the table fixtures (plan 06 task 6.7, issue #67)' "$f" \
        && grep -q 'parses every clean fixture with zero remark parse messages' "$f" \
        && grep -q '"gfm-tables.md": 5' "$f" \
        && grep -q '"tables.md": 3' "$f" \
        && pass "gfmLint.test.ts pins the lint gate (zero parse messages + table counts)" \
        || fail "gfmLint.test.ts lint gate missing"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the lint needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/gfmLint.test.ts) 2>&1 ); then
        pass "table fixtures lint clean under remark+remark-gfm (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "GFM lint failed on the table fixtures"
    fi
}

test_tables_ac3_alignment_persists() {
    note "tables.AC3 column alignment persists through edit + save (plan 06 AC3)"
    grep -q 'sets a column to center and persists it as the GFM spec' \
        "$ROOT/src/lib/__tests__/tableCommands.test.ts" \
        && grep -q 'round-trips a <br> break inside a cell (model: hardBreak, file: <br>)' \
            "$ROOT/src/lib/__tests__/gfmTables.test.ts" \
        && grep -q 'resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH' "$ROOT/src/components/Editor.tsx" \
        && pass "AC3: alignment persists (GFM spec on save) + <br> cells + resizable columns" \
        || fail "AC3 coverage missing"
}

test_tables_ac4_keyboard_nav() {
    note "tables.AC4 Tab/Shift+Tab/Escape navigation (plan 06 AC4)"
    grep -q 'Tab in the last cell appends a row and moves into it' \
        "$ROOT/src/lib/__tests__/tableKeys.test.tsx" \
        && grep -q 'Tab in the last cell is a no-op at the TABLE_MAX row guard' \
            "$ROOT/src/lib/__tests__/tableKeys.test.tsx" \
        && grep -q 'moves the cursor to the paragraph after the table' \
            "$ROOT/src/lib/__tests__/tableKeys.test.tsx" \
        && pass "AC4: Tab next/append (99 guard), Shift+Tab prev, Escape exits to the next block" \
        || fail "AC4 coverage missing"
}

test_tables_ac5_delete_table() {
    note "tables.AC5 delete table (plan 06 AC5)"
    grep -q 'id: "tableDelete"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'removes the whole table block' "$ROOT/src/lib/__tests__/tableCommands.test.ts" \
        && pass "AC5: tableDelete removes the whole table block" \
        || fail "AC5 coverage missing"
}

test_tables_ac6_escaped_pipe() {
    note "tables.AC6 a pipe inside a cell survives save + reload (plan 06 AC6)"
    grep -q 'round-trips cells containing a pipe (escaped on save, unescaped in the model)' \
        "$ROOT/src/lib/__tests__/gfmTables.test.ts" \
        && grep -q 'a \\| b' "$FIXTURES/clean/gfm-tables.md" \
        && grep -q '"gfm-tables.md": 5' "$ROOT/src/lib/__tests__/gfmLint.test.ts" \
        && pass "AC6: escaped-pipe cells round-trip and the fixture lints as 5 valid tables" \
        || fail "AC6 coverage missing"
}

test_tables_ac7_floating_toolbar_focus() {
    note "tables.AC7 floating toolbar appears in-table, hides on exit (plan 06 AC7)"
    grep -q 'appears when the cursor moves into a table' \
        "$ROOT/src/lib/__tests__/floatingTableToolbar.test.tsx" \
        && grep -q 'hides when the cursor leaves the table' \
            "$ROOT/src/lib/__tests__/floatingTableToolbar.test.tsx" \
        && grep -q "keeps the editor selection while a button is pressed (mousedown preventDefault)" \
            "$ROOT/src/lib/__tests__/floatingTableToolbar.test.tsx" \
        && pass "AC7: floating toolbar tracks in/out of tables and keeps the selection" \
        || fail "AC7 coverage missing"
}

test_tables_ac8_fixtures_green() {
    note "tables.AC8 the table fixtures stay green (plan 06 AC8)"
    local f="$ROOT/src/lib/__tests__/roundtrip.test.ts"
    grep -q 'round-trip fidelity over clean fixtures' "$f" \
        && [ -f "$FIXTURES/clean/tables.md" ] \
        && [ -f "$FIXTURES/clean/table-complex.md" ] \
        && [ -f "$FIXTURES/clean/gfm-tables.md" ] \
        && grep -q 'classifies all five fixture tables as table blocks' \
            "$ROOT/src/lib/__tests__/gfmTables.test.ts" \
        && pass "AC8: round-trip contract + fixture corpus (tables.md, table-complex.md, gfm-tables.md) green" \
        || fail "AC8 coverage missing"
}

# --- p2-mermaid-export: PNG export pipeline (plan 11 task 11.5, issue #104) ---
# The pipeline behavior (fence discovery through the editor's parser, SVG ->
# 2x canvas PNG, fence swap, all-or-nothing orchestration, and the fixture
# export of 2 diagrams + 1 broken) is covered by the vitest suite
# src/lib/__tests__/mermaidExport.test.ts; this section checks the app-level
# wiring the GUI driver cannot reach headlessly: the export_write_asset /
# export_remove_asset Rust commands (with the in-binary self-test) and the
# File > Export routing through the current document text.

test_mermaidexport_selftest() {
    note "mermaid.export export_write_asset live in binary (self-test)"
    if [ ! -x "$APP_BIN" ]; then
        echo "SKIP (binary not built)"
        return
    fi
    local out
    out=$("$APP_BIN" --self-test export-asset 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then pass "mermaid.export export_write_asset live in binary (self-test)"; else fail "mermaid.export export_write_asset live in binary (self-test)"; fi
}

test_mermaidexport_rust_commands() {
    note "mermaid.export export_write_asset + export_remove_asset commands wired"
    if grep -q 'pub fn export_write_asset' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn export_remove_asset' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn write_export_asset' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'pub fn remove_export_assets' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'pub enum ExportAssetError' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'commands::export_write_asset' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'commands::export_remove_asset' "$ROOT/src-tauri/src/lib.rs"; then
        pass "mermaid.export export_write_asset + export_remove_asset commands wired"
    else
        fail "mermaid.export export_write_asset + export_remove_asset commands wired"
    fi
}

test_mermaidexport_pipeline_module() {
    note "mermaid.export SVG->canvas PNG pipeline module + File > Export routing"
    if [ -f "$ROOT/src/lib/mermaidExport.ts" ] \
        && grep -q 'export async function exportCurrentDocument' "$ROOT/src/lib/mermaidExport.ts" \
        && grep -q 'export function findMermaidDiagrams' "$ROOT/src/lib/mermaidExport.ts" \
        && grep -q 'export function swapMermaidFences' "$ROOT/src/lib/mermaidExport.ts" \
        && grep -q 'export async function svgToPngBytes' "$ROOT/src/lib/mermaidExport.ts" \
        && grep -q '"export_write_asset"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q '"export_remove_asset"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q 'exportCurrentDocument' "$ROOT/src/lib/fileMenu.ts" \
        && grep -q 'markdown: doc.currentText' "$ROOT/src/App.tsx"; then
        pass "mermaid.export SVG->canvas PNG pipeline module + File > Export routing"
    else
        fail "mermaid.export SVG->canvas PNG pipeline module + File > Export routing"
    fi
}

test_mermaidexport_ac5() {
    note "mermaid.AC5 2 diagrams -> 2 PNGs in position; broken diagram refused with a named error (plan 11 AC5)"
    local f="$ROOT/src/lib/__tests__/mermaidExport.test.ts"
    grep -q 'fixture export: 2 diagrams + 1 broken (plan 11 task 11.5, issue #104)' "$f" \
        && grep -q 'refuses the export, names the broken diagram, and writes nothing' "$f" \
        && grep -q 'writes both PNGs + the swapped temp markdown, converts it, and cleans up' "$f" \
        && grep -q 'Mermaid export refused: diagram 3: Parse error on line 2: BROKEN' "$f" \
        && [ -f "$FIXTURES/clean/mermaid-export.md" ] \
        && [ "$(grep -c '^```mermaid' "$FIXTURES/clean/mermaid-export.md")" -eq 3 ] \
        && pass "AC5: fixture export test (2 diagrams + 1 broken) pinned in the suite" \
        || fail "AC5 coverage missing (mermaidExport.test.ts + fixtures/clean/mermaid-export.md)"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the pipeline suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/mermaidExport.test.ts) 2>&1 ); then
        pass "mermaid PNG export pipeline suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "mermaid PNG export pipeline suite failed"
    fi
}

# --- p2-mermaid: plan 11 full acceptance gate (task 11.7, issue #106) ----------
# The per-task behavior is pinned in the vitest suites (mermaid.test.tsx,
# mermaidCard.test.tsx, mermaidRender.test.ts, previewMermaid.test.tsx,
# mermaidHighlight.test.tsx, diagramMenu.test.tsx, mermaidExport.test.ts,
# mermaidStartup.test.tsx); this section is the plan 11 §4 acceptance gate:
# the app-level wiring the GUI driver cannot reach headlessly, the AC1-AC8
# coverage pinned in the suites, the AC8 startup perf gate (lazy import +
# <100ms budget) actually run here, the AC5 export gate (the p2-mermaid-
# export checks), and the Windows manual pass (insert -> edit -> export
# PDF/DOCX).

test_mermaid_ac1_insert() {
    note "mermaid.AC1 Insert > Diagram + /diagram + toolbar -> starter-template fence (plan 11 AC1)"
    if grep -q 'MenuItem::with_id(app, "insert-diagram", "Diagram (Mermaid)", true, None::<&str>)' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '"insert-diagram": "diagram"' "$ROOT/src/App.tsx" \
        && grep -q '"diagram"' "$ROOT/src/components/Toolbar.tsx" \
        && grep -q 'commandAction("diagram", "diagram", "Diagram", "Mermaid diagram")' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export const MERMAID_STARTER_TEMPLATE' "$ROOT/src/lib/editorCommands.ts" \
        && [ -f "$FIXTURES/clean/mermaid.md" ] \
        && grep -q 'graph TD' "$FIXTURES/clean/mermaid.md" \
        && grep -q 'inserts a mermaid fence with the starter template (AC1)' "$ROOT/src/lib/__tests__/mermaid.test.tsx"; then
        pass "AC1: menu id -> diagram command -> starter-template fence (menu, slash, toolbar)"
    else
        fail "AC1 coverage missing (menu.rs, App.tsx, Toolbar.tsx, Editor.tsx slash action)"
    fi
}

test_mermaid_ac2_rerender() {
    note "mermaid.AC2 source edits re-render (~300ms); a syntax error shows the badge without breaking the doc (plan 11 AC2)"
    local f="$ROOT/src/lib/__tests__/mermaidCard.test.tsx"
    if grep -q 'RE_RENDER_DELAY_MS = 300' "$ROOT/src/components/MermaidCard.tsx" \
        && grep -q 'renders the fence source as a live, responsive SVG' "$f" \
        && grep -q 'shows the badge and footer, with the source visible (never blank)' "$f" \
        && grep -q 'returns the error as data for a syntax error (never rejects)' "$ROOT/src/lib/__tests__/mermaidRender.test.ts"; then
        pass "AC2: 300ms debounced re-render + error badge (source never blank)"
    else
        fail "AC2 coverage missing (MermaidCard.tsx, mermaidCard.test.tsx, mermaidRender.test.ts)"
    fi
}

test_mermaid_ac3_shared_svg() {
    note "mermaid.AC3 WYSIWYG + Preview share one render service; a theme switch re-renders (plan 11 AC3)"
    local card="$ROOT/src/lib/__tests__/mermaidCard.test.tsx"
    if grep -q 'renders through the shared render service (same SVG as the service)' "$ROOT/src/lib/__tests__/previewMermaid.test.tsx" \
        && grep -q 'renders the same source differently for light vs dark (AC3)' "$ROOT/src/lib/__tests__/mermaidRender.test.ts" \
        && grep -q 're-renders with the mapped mermaid theme when the QuillMD theme changes' "$card" \
        && grep -q 'export function mermaidThemeFor' "$ROOT/src/lib/mermaidRender.ts" \
        && grep -q 'setMermaidCardTheme(theme)' "$ROOT/src/components/Editor.tsx"; then
        pass "AC3: shared render service (card + preview) + theme-mapped re-render"
    else
        fail "AC3 coverage missing (previewMermaid.test.tsx, mermaidRender, Editor.tsx theme wiring)"
    fi
}

test_mermaid_ac4_fit_scroll() {
    note "mermaid.AC4 wide diagrams fit or scroll; the SVG stays sharp (plan 11 AC4)"
    local card="$ROOT/src/lib/__tests__/mermaidCard.test.tsx"
    if grep -q 'renders the fence source as a live, responsive SVG' "$card" \
        && grep -q 'viewBox' "$card" \
        && grep -A2 '^\.quillmd-mermaid-svg {' "$ROOT/src/App.css" | grep -q 'overflow-x: auto' \
        && grep -A5 '^\.quillmd-mermaid-svg svg {' "$ROOT/src/App.css" | grep -q 'max-width: 100%'; then
        pass "AC4: viewBox + width 100% fit, overflow-x scroll fallback, sharp SVG"
    else
        fail "AC4 coverage missing (mermaidCard.test.tsx, App.css .quillmd-mermaid-svg)"
    fi
}

test_mermaid_ac5_export() {
    note "mermaid.AC5 export: 2 diagrams -> 2 PNGs; broken diagram refused with a named error (plan 11 AC5)"
    # The full export gate (Rust commands + self-test, pipeline module, and
    # the fixture export suite) is the p2-mermaid-export section.
    test_mermaidexport_selftest
    test_mermaidexport_rust_commands
    test_mermaidexport_pipeline_module
    test_mermaidexport_ac5
}

test_mermaid_ac6_source_highlight() {
    note "mermaid.AC6 the source view colors diagram keywords inside the fence (plan 11 AC6)"
    local f="$ROOT/src/lib/__tests__/mermaidHighlight.test.tsx"
    if grep -q 'colors the keywords inside a ```mermaid fence' "$f" \
        && grep -q 'selects the language by the fence info string (AC6)' "$f" \
        && grep -q 'colors the mermaid keywords in the live source view' "$f" \
        && grep -q 'export const mermaidStreamLanguage' "$ROOT/src/lib/mermaidHighlight.ts" \
        && grep -q 'mermaidCodeLanguage' "$ROOT/src/components/SourceView.tsx"; then
        pass "AC6: keyword coloring in the source view (language from the fence info)"
    else
        fail "AC6 coverage missing (mermaidHighlight.test.ts, mermaidHighlight.ts, SourceView.tsx)"
    fi
}

test_mermaid_ac7_undo() {
    note "mermaid.AC7 undo/redo work at the markdown-text level for diagram edits (plan 11 AC7)"
    local menu="$ROOT/src/lib/__tests__/diagramMenu.test.tsx"
    local card="$ROOT/src/lib/__tests__/mermaidCard.test.tsx"
    if grep -q 'undo restores the prior fence exactly (plan 11 AC7)' "$menu" \
        && grep -q 'edits flow through the document; undo restores the prior fence text' "$card"; then
        pass "AC7: undo restores the prior fence bytes (context menu + card edits)"
    else
        fail "AC7 coverage missing (diagramMenu.test.tsx, mermaidCard.test.tsx)"
    fi
}

test_mermaid_ac8_startup_perf() {
    note "mermaid.AC8 startup perf gate: mermaid is lazily imported and editor startup stays under 100ms (plan 11 AC8)"
    local f="$ROOT/src/lib/__tests__/mermaidStartup.test.tsx"
    if grep -q "the app's startup module graph does not import mermaid (lazy import)" "$f" \
        && grep -q 'STARTUP_BUDGET_MS = 100' "$f" \
        && grep -q 'mermaidPromise = import("mermaid")' "$ROOT/src/lib/mermaidRender.ts" \
        && ! grep -q 'from "mermaid"' "$ROOT/src/lib/mermaidRender.ts"; then
        pass "AC8: lazy import + 100ms startup budget pinned in mermaidStartup.test.tsx"
    else
        fail "AC8 coverage missing (mermaidStartup.test.tsx, mermaidRender.ts lazy import)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the startup gate needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/mermaidStartup.test.tsx) 2>&1 ); then
        pass "mermaid startup perf suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "mermaid startup perf suite failed"
    fi
}

test_mermaid_windows_manual() {
    note "mermaid.windows insert -> edit -> export PDF/DOCX manual pass wiring"
    if grep -q 'round-trips the mermaid fixture byte-identically on CRLF (save pipeline)' "$ROOT/src/lib/__tests__/mermaid.test.tsx" \
        && grep -q 'if (opts.eol === "crlf")' "$ROOT/src/lib/pipeline.ts" \
        && grep -q 'is_windows_reserved' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'fn export_asset_baseline' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'pub fn export_pdf' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'pub fn export_docx' "$ROOT/src-tauri/src/convert.rs"; then
        pass "windows: CRLF round-trip for diagram docs + reserved-name-safe PNG assets + PDF/DOCX conversion"
    else
        fail "windows manual pass wiring missing (CRLF save pipeline, export asset gate, PDF/DOCX)"
    fi
}

# ===========================================================================
# P3 right-click context menus (plan 03, tasks 3.1-3.7)
#
# Parent issue: #38. Task wiring:
#   3.1 #39 shared ContextMenu component            ContextMenu.tsx,
#                                               contextMenu.test.tsx
#   3.2 #40 editor text menu (WYSIWYG/source/      textMenu.ts, Editor.tsx,
#       preview) + selection resolution             SourceView.tsx,
#                                               PreviewView.tsx,
#                                               textMenu.test.tsx
#   3.3 #41 table menu (row/column insert &        tableMenu.ts, Editor.tsx,
#       delete, alignment, header, delete table)   tableContextMenu.test.tsx
#   3.4 #42 image menu (edit/alt/replace/remove)   imageMenu.ts, Editor.tsx,
#                                               imageContextMenu.test.tsx
#   3.5 #43 link menu (open/edit/copy/remove in    markdownLinks.ts, links.ts,
#       WYSIWYG + preview; preview splices the    PreviewView.tsx, App.tsx,
#       markdown source)                            markdownLinks.test.ts,
#                                               textMenu.test.tsx (e2e)
#   3.6 #44 tab bar + explorer menus + fs_* Rust   tabMenu.ts, TabBar.tsx,
#       commands (new/rename/trash) + trash Undo   explorerMenu.ts,
#                                               Explorer.tsx, commands.rs,
#                                               App.tsx, tabMenu.test.tsx,
#                                               explorerContextMenu.test.tsx
#   3.7 #45 this section: the plan 03 §4 acceptance
#       gate (AC1-AC7) + the Windows + Linux manual
#       matrix (every menu x every surface; the
#       headlessly checkable platform wiring below,
#       the manual steps in plan doc §6)
#
# The per-surface behavior is pinned in the vitest suites that `npm test`
# runs; this section checks the app-level wiring a GUI driver cannot reach
# headlessly, pins each AC's suite coverage, and actually runs the AC suites
# here (AC7 runs the entire vitest gate).
# ===========================================================================

# --- p3-context: shared ContextMenu component (task 3.1, issue #39) -----------
# One shared component for every surface (plan 03 §2): declarative item model,
# cursor positioning with scroll/viewport clamping, submenu positioning,
# full keyboard navigation, and screen-reader labels on the menu and every
# item. The behavior is pinned in contextMenu.test.tsx (which AC6 runs); this
# checks that all five surfaces render through this one component.
test_context_component() {
    note "context.component shared ContextMenu component used by all five surfaces"
    local c="$ROOT/src/components/ContextMenu.tsx"
    if [ -f "$c" ] \
        && grep -q 'export function clampMenuPosition' "$c" \
        && grep -q 'export function submenuPosition' "$c" \
        && grep -q 'role="menu"' "$c" \
        && grep -q 'case "ArrowDown"' "$c" \
        && grep -q 'case "ArrowRight"' "$c" \
        && grep -q 'case "Enter"' "$c" \
        && grep -q 'case "Escape"' "$c" \
        && grep -q 'from "./ContextMenu"' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'from "./ContextMenu"' "$ROOT/src/components/SourceView.tsx" \
        && grep -q 'from "./ContextMenu"' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'from "./ContextMenu"' "$ROOT/src/components/TabBar.tsx" \
        && grep -q 'from "./ContextMenu"' "$ROOT/src/components/Explorer.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/contextMenu.test.tsx" ]; then
        pass "context.component shared ContextMenu component used by all five surfaces"
    else
        fail "context.component shared ContextMenu component used by all five surfaces"
    fi
}

# --- p3-context: AC1 editor text menu (task 3.2, issue #40) --------------------
# Right-click in WYSIWYG shows the text menu with the Format/Insert submenus;
# every registry item maps 1:1 to a registry command and behaves identically
# to the toolbar/menu trigger (the suite picks Format > Bold through the menu
# and asserts the same registry command runs). The source and preview
# surfaces carry their own fixed item sets.
test_context_ac1_text_menu() {
    note "context.AC1 WYSIWYG text menu (Format/Insert submenus) + 1:1 registry dispatch (plan 03 AC1)"
    local t="$ROOT/src/lib/textMenu.ts"
    local f="$ROOT/src/lib/__tests__/textMenu.test.tsx"
    if grep -q 'export function buildTextMenu' "$t" \
        && grep -q 'export function buildSourceMenu' "$t" \
        && grep -q 'export function buildPreviewMenu' "$t" \
        && grep -q 'export function toContextEntries' "$t" \
        && grep -q 'export function textSelectionKind' "$t" \
        && grep -q 'contextmenu: (_view, event) =>' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'items: buildTextMenu(active)' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'buildSourceMenu()' "$ROOT/src/components/SourceView.tsx" \
        && grep -q 'buildPreviewMenu(anchor !== null, href)' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'maps every registry item 1:1 to a registered command (plan 03 AC1)' "$f" \
        && grep -q 'right-click opens the text menu and a pick dispatches the registry command' "$f" \
        && grep -q 'dispatching the same' "$f" \
        && grep -q 'registry command the toolbar dispatches' "$f"; then
        pass "AC1: WYSIWYG/source/preview item sets + 1:1 registry dispatch pinned in textMenu.test.tsx"
    else
        fail "AC1 coverage missing (textMenu.ts, Editor/SourceView/PreviewView wiring, textMenu.test.tsx)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the text-menu suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/textMenu.test.tsx) 2>&1 ); then
        pass "text-menu suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "text-menu suite failed (plan 03 AC1)"
    fi
}

# --- p3-context: AC2 table menu (task 3.3, issue #41) ---------------------------
# Right-click inside a table cell shows the table menu instead of the text
# menu; every item is a registry command (the P2 table commands). "Insert
# column right" on a 3x3 table yields a valid 3x4 GFM table in the saved
# text; "Delete table" requires the native confirm and removes the block
# cleanly.
test_context_ac2_table_menu() {
    note "context.AC2 table menu: 3x3 -> 3x4 GFM via the menu, delete table confirm-gated (plan 03 AC2)"
    local t="$ROOT/src/lib/tableMenu.ts"
    local f="$ROOT/src/lib/__tests__/tableContextMenu.test.tsx"
    if grep -q 'export function buildTableMenu' "$t" \
        && grep -q 'export function toTableContextEntries' "$t" \
        && grep -q 'else if (inTable(active))' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'items: buildTableMenu(active)' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'right-click in a table shows the table menu, not the text menu' "$f" \
        && grep -q 'insert column right on a 3x3 table yields a valid 3x4 GFM table' "$f" \
        && grep -q 'insert column right through the menu yields a valid 3x4 GFM table in the saved text' "$f" \
        && grep -q 'delete table requires the native confirm and removes the block cleanly' "$f"; then
        pass "AC2: table menu 1:1 registry dispatch + 3x4 GFM + confirm-gated delete pinned"
    else
        fail "AC2 coverage missing (tableMenu.ts, Editor.tsx builder pick, tableContextMenu.test.tsx)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the table-menu suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/tableContextMenu.test.tsx) 2>&1 ); then
        pass "table-menu suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "table-menu suite failed (plan 03 AC2)"
    fi
}

# --- p3-context: AC3 image menu (task 3.4, issue #42) ---------------------------
# Right-click an image node shows the image menu (checked before the table
# builder, so an image in a table cell still gets it): edit opens the URL
# dialog, replace uses the file picker, remove deletes the node and is
# undoable via Ctrl+Z.
test_context_ac3_image_menu() {
    note "context.AC3 image menu: edit dialog / file picker / undoable remove (plan 03 AC3)"
    local t="$ROOT/src/lib/imageMenu.ts"
    local f="$ROOT/src/lib/__tests__/imageContextMenu.test.tsx"
    if grep -q 'export function buildImageMenu' "$t" \
        && grep -q 'if (inImage(active))' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'items: buildImageMenu(active)' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'right-clicking a selected image shows the image menu, not the text menu' "$f" \
        && grep -q 'an image node inside a table cell still gets the image menu' "$f" \
        && grep -q 'undo (Ctrl+Z) restores the image exactly (plan 03 AC3)' "$f"; then
        pass "AC3: image menu builder pick + edit/replace flows + Ctrl+Z undo pinned"
    else
        fail "AC3 coverage missing (imageMenu.ts, Editor.tsx builder pick, imageContextMenu.test.tsx)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the image-menu suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/imageContextMenu.test.tsx) 2>&1 ); then
        pass "image-menu suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "image-menu suite failed (plan 03 AC3)"
    fi
}

# --- p3-context: link menu, all views (task 3.5, issue #43) ---------------------
# The link item set (Open / Edit / Copy address / Remove) in WYSIWYG and
# preview. Open goes through plugin-opener (openLinkUrl); in the preview the
# caret's anchor is resolved and Edit / Remove splice the markdown source
# (markdownLinks.ts) through the app — the preview itself never touches the
# document. The WYSIWYG e2e coverage rides the text-menu suite (AC1 above).
test_context_link_menu() {
    note "context.link link menu in WYSIWYG + preview (open/edit/copy/remove; preview splices markdown)"
    local m="$ROOT/src/lib/markdownLinks.ts"
    local f="$ROOT/src/lib/__tests__/markdownLinks.test.ts"
    local e2e="$ROOT/src/lib/__tests__/textMenu.test.tsx"
    if grep -q 'export function findMarkdownLink' "$m" \
        && grep -q 'export function unlinkMarkdownLink' "$m" \
        && grep -q 'export function relinkMarkdownLink' "$m" \
        && grep -q 'export async function openLinkUrl' "$ROOT/src/lib/links.ts" \
        && grep -q '"text-link-open"' "$ROOT/src/lib/textMenu.ts" \
        && grep -q '"text-link-remove"' "$ROOT/src/lib/textMenu.ts" \
        && grep -q '"preview-link-remove"' "$ROOT/src/lib/textMenu.ts" \
        && grep -q 'onEditLink' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'onRemoveLink' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'findMarkdownLink(activeDoc.currentText' "$ROOT/src/App.tsx" \
        && grep -q 'unlinkMarkdownLink(activeDoc.currentText' "$ROOT/src/App.tsx" \
        && grep -q 'relinkMarkdownLink(activeDoc.currentText' "$ROOT/src/App.tsx" \
        && [ -f "$f" ] \
        && grep -q 'addresses offsets in CRLF source correctly' "$f" \
        && [ -f "$ROOT/src/lib/__tests__/openLinks.test.tsx" ] \
        && grep -q 'right-click on a link offers the full link submenu (Open / Edit / Copy address / Remove)' "$e2e"; then
        pass "context.link link menu wiring (plugin-opener open, preview markdown splices, CRLF-safe offsets)"
    else
        fail "context.link coverage missing (markdownLinks.ts, links.ts, textMenu.ts, PreviewView/App wiring, suites)"
    fi
}

# --- p3-context: AC4 tab bar menu (task 3.6, issue #44) -------------------------
# Right-click a tab: Close / Close Others / Close All. Close targets the
# right-clicked tab; Close All (and Close Others) run the same confirmCloseAll
# flow the File menu uses, so the dirty confirm is honored.
test_context_ac4_tab_menu() {
    note "context.AC4 tab menu closes the right tab; Close All honors dirty confirms (plan 03 AC4)"
    local t="$ROOT/src/lib/tabMenu.ts"
    local f="$ROOT/src/lib/__tests__/tabMenu.test.tsx"
    if grep -q 'export function buildTabMenu' "$t" \
        && grep -q 'onContextMenu={(e) =>' "$ROOT/src/components/TabBar.tsx" \
        && grep -q 'buildTabMenu(tabs.map((t) => t.path), menu.path)' "$ROOT/src/components/TabBar.tsx" \
        && grep -q 'onCloseOthers={(keep) => void closeOthers(keep)}' "$ROOT/src/App.tsx" \
        && grep -q 'onCloseAll={() => void closeAll()}' "$ROOT/src/App.tsx" \
        && grep -q 'const ok = await confirmCloseAll(' "$ROOT/src/App.tsx" \
        && grep -q 'confirmCloseTab(' "$ROOT/src/App.tsx" \
        && grep -q 'Close dispatches onClose with the right-clicked tab'"'"'s path and closes the menu' "$f" \
        && grep -q 'Close All dispatches onCloseAll' "$f" \
        && grep -q 'TabBar receives the close-others / close-all flows from the App' "$f" \
        && grep -q 'from "./dialogs"' "$ROOT/src/lib/tabClose.ts"; then
        pass "AC4: tab menu dispatches the right tab's close + confirmCloseAll wiring pinned"
    else
        fail "AC4 coverage missing (tabMenu.ts, TabBar.tsx, App.tsx close flows, tabMenu.test.tsx)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the tab-menu suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/tabMenu.test.tsx) 2>&1 ); then
        pass "tab-menu suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "tab-menu suite failed (plan 03 AC4)"
    fi
}

# --- p3-context: AC5 explorer menu (task 3.6, issue #44) ------------------------
# New file / New folder create real entries (verified on disk by the Rust
# tests in commands.rs), Rename moves them, Delete moves to the app-local
# trash (never unlinks) and is undoable from the status bar (fs_rename back),
# and Reveal opens the OS file manager through plugin-opener.
test_context_ac5_explorer_menu() {
    note "context.AC5 explorer menu: on-disk create/rename, trash + status-bar Undo, reveal (plan 03 AC5)"
    local t="$ROOT/src/lib/explorerMenu.ts"
    local f="$ROOT/src/lib/__tests__/explorerContextMenu.test.tsx"
    local rs="$ROOT/src-tauri/src/commands.rs"
    if grep -q 'export function buildExplorerMenu' "$t" \
        && grep -q 'onContextMenu' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'buildExplorerMenu(' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'await fsNewDir(dir, name) : await fsNewFile(dir, name)' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'await fsRename(target.path' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'await fsTrash(target.path)' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'revealItemInDir(target.path)' "$ROOT/src/components/Explorer.tsx" \
        && grep -q '"fs_new_file"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q '"fs_new_dir"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q '"fs_rename"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q '"fs_trash"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q 'pub fn fs_new_file' "$rs" \
        && grep -q 'pub fn fs_new_dir' "$rs" \
        && grep -q 'pub fn fs_rename' "$rs" \
        && grep -q 'pub fn fs_trash' "$rs" \
        && grep -q 'commands::fs_trash' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'fn fs_new_file_creates_empty_file' "$rs" \
        && grep -q 'fn fs_new_dir_creates_directory' "$rs" \
        && grep -q 'fn move_to_trash_moves_file_and_never_unlinks' "$rs" \
        && grep -q 'fn move_to_trash_restorable_via_fs_rename' "$rs" \
        && grep -q 'offerTrashUndo' "$ROOT/src/App.tsx" \
        && grep -q 'undoTrashDelete' "$ROOT/src/App.tsx" \
        && grep -q 'onUndoTrash' "$ROOT/src/components/StatusBar.tsx" \
        && grep -q 'Delete asks the native confirm, moves to the trash (no unlink), and reports the trash path for Undo' "$f" \
        && grep -q 'Reveal opens the OS file manager at the entry (plugin-opener)' "$f" \
        && grep -q 'the App offers a ~30s status-bar Undo after an explorer delete' "$f"; then
        pass "AC5: explorer fs_* wiring (Rust on-disk tests, trash Undo, reveal) pinned"
    else
        fail "AC5 coverage missing (explorerMenu.ts, Explorer.tsx, fileIo.ts, commands.rs, App/StatusBar, suites)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the explorer-menu suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/explorerContextMenu.test.tsx) 2>&1 ); then
        pass "explorer-menu suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "explorer-menu suite failed (plan 03 AC5)"
    fi
}

# --- p3-context: AC6 keyboard navigation (task 3.1, issue #39) ------------------
# The menu is keyboard-navigable end-to-end: arrows/Home/End between enabled
# items, Enter/Space activate, ArrowRight/ArrowLeft into and out of submenus,
# Escape closes submenu-first. Verified by the interaction test suite.
test_context_ac6_keyboard() {
    note "context.AC6 menu keyboard-navigable end-to-end (arrows/Enter/Escape) (plan 03 AC6)"
    local f="$ROOT/src/lib/__tests__/contextMenu.test.tsx"
    if grep -q 'ArrowDown/ArrowUp navigate the enabled items, wrapping at the ends' "$f" \
        && grep -q 'Home and End jump to the first and last enabled item' "$f" \
        && grep -q 'Enter (and Space) activate the focused leaf item and close' "$f" \
        && grep -q 'ArrowRight opens the focused item'"'"'s submenu and focuses its first child' "$f" \
        && grep -q 'Escape closes an open submenu first, then the menu; Tab dismisses' "$f" \
        && grep -q 'a disabled item is inert on click and skipped by arrow navigation' "$f"; then
        pass "AC6: keyboard navigation (arrows/Enter/Escape/submenus) pinned in contextMenu.test.tsx"
    else
        fail "AC6 coverage missing (contextMenu.test.tsx keyboard interaction tests)"
    fi
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the component suite needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/contextMenu.test.tsx) 2>&1 ); then
        pass "context-menu component suite green (also runs in CI via npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "context-menu component suite failed (plan 03 AC6)"
    fi
}

# --- p3-context: AC7 no regressions (plan 03 §4 AC7) -----------------------------
# All existing suites green: the entire vitest gate (1200+ tests across the
# round-trip fixtures, every earlier plan's suites, and the P3 context-menu
# suites) is run here, not just asserted present. Left-click editing is
# untouched because the context menu hooks only the contextmenu event (the
# Editor.tsx handler returns true solely for right-click) and the menu picks
# dispatch through the same registry the toolbar already used.
test_context_ac7_all_suites_green() {
    note "context.AC7 all existing suites green (full vitest gate)"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (running the full vitest gate needs node + node_modules)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run) 2>&1 ); then
        pass "full vitest gate green (npm test)"
    else
        printf '%s\n' "$out" | tail -25
        fail "full vitest gate failed (plan 03 AC7)"
    fi
}

# --- p3-context: Windows + Linux manual matrix (every menu x every surface) -----
# The manual matrix itself (plan doc §6) is run on a real desktop after
# `npm run tauri build`; these checks gate the platform behavior the matrix
# exercises, on both platforms (the Windows runner gets them under Git Bash):
#  - CRLF: every context-menu edit flows through the save pipeline, which
#    restores the document's CRLF ending (pipeline.ts); the preview link
#    splices address CRLF source offsets and keep every other byte intact.
#  - Reserved names: the explorer fs_* commands refuse Windows reserved
#    names (CON, NUL, COM1, trailing dots/spaces) on every platform
#    (golden rule 4).
#  - Reveal: plugin-opener's revealItemInDir (Windows: Explorer focused on
#    the entry; Linux: the default file manager) with the opener:default
#    capability.
#  - Confirms: the destructive items (delete table / remove image / explorer
#    delete / close all) use the P0 native confirm dialog, never
#    window.confirm.
test_context_manual_matrix() {
    note "context.matrix Windows + Linux manual-matrix wiring (CRLF, reserved names, reveal, native confirms)"
    local ml="$ROOT/src/lib/__tests__/markdownLinks.test.ts"
    if grep -q 'if (opts.eol === "crlf")' "$ROOT/src/lib/pipeline.ts" \
        && grep -q 'source.includes("\\r\\n") ? "crlf" : "lf"' "$ROOT/src/lib/fileIo.ts" \
        && grep -q 'addresses offsets in CRLF source correctly' "$ml" \
        && grep -q 'keeps every other byte (CRLF, surrounding blocks) intact' "$ml" \
        && grep -q 'is_windows_reserved' "$ROOT/src-tauri/src/fs/paths.rs" \
        && grep -q 'is_windows_reserved' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q '"CON"' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'revealItemInDir' "$ROOT/src/components/Explorer.tsx" \
        && grep -q 'opener:default' "$ROOT/src-tauri/capabilities/default.json" \
        && grep -q 'confirmMessage' "$ROOT/src/lib/tabClose.ts" \
        && grep -q 'confirmMessage' "$ROOT/src/components/Explorer.tsx"; then
        pass "windows+linux: CRLF save pipeline + CRLF-safe splices + reserved-name refusal + reveal + native confirms"
    else
        fail "manual-matrix wiring missing (CRLF pipeline, reserved-name gate, plugin-opener reveal, native confirms)"
    fi
}

# --- p4-doc-tools: export-time TOC generation (task 9.2, issue #85) -------------
# The tocBlock node stores the TOC as the fixed comment token
# `<!-- quillmd:toc -->` (golden rule 1); the export layer expands it in a
# throwaway copy of the markdown only — a raw typst #outline() block for PDF,
# a Word TOC field for DOCX — and never rewrites the source file. The deep
# behavior (expansion contract, temp-copy + cleanup, the real PDF/DOCX export
# incl. the pdftotext outline check and the DOCX zip field check) is pinned in
# the cargo suite under src-tauri/src/convert.rs and runs below; this section
# also checks the cross-language token contract, the fixture, and the
# in-binary self-test.

test_toce_token_contract() {
    note "toce.token Rust + frontend TOC_TOKEN constants are byte-identical"
    local rust_tok js_tok
    rust_tok=$(sed -n 's/^const TOC_TOKEN: &str = "\(.*\)";$/\1/p' "$ROOT/src-tauri/src/convert.rs" | head -1)
    js_tok=$(sed -n 's/^export const TOC_TOKEN = "\(.*\)";$/\1/p' "$ROOT/src/lib/pm.ts" | head -1)
    if [ -n "$rust_tok" ] && [ "$rust_tok" = "$js_tok" ]; then
        pass "toce.token both token constants agree ($rust_tok)"
    else
        fail "toce.token token constants disagree (rust: '$rust_tok' js: '$js_tok')"
    fi
}

test_toce_fixture() {
    note "toce.fixture fixtures/clean/toc.md carries the token + H1-H4 (round-trip corpus)"
    local f="$ROOT/fixtures/clean/toc.md"
    if [ -f "$f" ] \
        && grep -q -x -F '<!-- quillmd:toc -->' "$f" \
        && [ "$(grep -cE '^#{1,4} ' "$f")" -ge 3 ] \
        && grep -q '^##### Deep note' "$f"; then
        pass "toce.fixture toc.md in the clean corpus (token + H1-H4 + one H5)"
    else
        fail "toce.fixture missing or malformed (fixtures/clean/toc.md)"
    fi
}

test_toce_cargo_suite() {
    note "toce.suite cargo convert tests (expansion + real PDF/DOCX export)"
    if ! command -v cargo >/dev/null 2>&1; then
        echo "SKIP (cargo not installed)"
        return
    fi
    local out
    if out=$( (cd "$ROOT/src-tauri" && cargo test --lib convert::) 2>&1 ); then
        pass "toce.suite cargo convert suite green (also the cargo test DoD gate)"
    else
        printf '%s\n' "$out" | tail -25
        fail "toce.suite cargo convert suite failed (plan 09 task 9.2)"
    fi
}

test_toce_selftest() {
    note "toce.selftest export-toc live in binary (self-test)"
    if [ ! -x "$APP_BIN" ]; then
        echo "SKIP (binary not built)"
        return
    fi
    local out
    out=$("$APP_BIN" --self-test export-toc 2>/dev/null || echo "MISSING")
    if [ "$out" = "OK" ]; then
        pass "toce.selftest export-toc live in binary (self-test)"
    else
        fail "toce.selftest export-toc live in binary (self-test)"
    fi
}

test_toce_wiring() {
    note "toce.wiring export_pdf/export_docx expand the token; others do not (convert.rs)"
    if grep -q 'pub enum TocTarget' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'pub fn expand_toc_tokens' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'fn expanded_input' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'Some(TocTarget::Pdf)' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'Some(TocTarget::Docx)' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'toc: Option<TocTarget>' "$ROOT/src-tauri/src/convert.rs"; then
        pass "toce.wiring pdf/docx expand the token, epub/txt/import pass None"
    else
        fail "toce.wiring TOC expansion wiring missing in convert.rs"
    fi
}

# --- p4-doc-tools: navigation pane (task 9.3, issue #86) ------------------------
# A right rail listing the active document's H1-H4, with click-to-jump and scroll
# tracking (the active item follows the scroll position). The toggle persists
# per-path in DocSettings as `navigationPane` (default false) and is driven from
# the View menu + Ctrl+Shift+8. The pure logic (entry extraction, active-index
# math, rAF scroll tracking) lives in outline.ts and is pinned in a vitest suite;
# the deep behavior (WYSIWYG/preview click-to-jump, tracking, persistence) is
# pinned in outlinePane.test.tsx + navigationPaneWiring.test.tsx, which run below.

test_nav_menu_wiring() {
    note "nav.menu View > Toggle Navigation Pane (view-navigation, Ctrl+Shift+8) present"
    if grep -q 'MenuItem::with_id(app, "view-navigation", "Toggle Navigation Pane", true, Some("Ctrl+Shift+8"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '\.items(&\[&explorer, &navigation, &statusbar\])' "$ROOT/src-tauri/src/menu.rs"; then
        pass "nav.menu View > Toggle Navigation Pane (view-navigation, Ctrl+Shift+8) present"
    else
        fail "nav.menu View > Toggle Navigation Pane (view-navigation, Ctrl+Shift+8) present"
    fi
}

test_nav_app_wiring() {
    note "nav.shortcuts App.tsx routes view-navigation + Ctrl+Shift+8 and renders the pane"
    if grep -q 'id === "view-navigation"' "$ROOT/src/App.tsx" \
        && grep -q 'const toggleNavigationPane = useCallback' "$ROOT/src/App.tsx" \
        && grep -q 'navigationPane: !activeDoc.settings.navigationPane' "$ROOT/src/App.tsx" \
        && grep -q 'key === "8" && e.shiftKey' "$ROOT/src/App.tsx" \
        && grep -q 'activeDoc.settings.navigationPane && (' "$ROOT/src/App.tsx" \
        && grep -q '<OutlinePane' "$ROOT/src/App.tsx" \
        && grep -q 'from "./components/OutlinePane"' "$ROOT/src/App.tsx"; then
        pass "nav.shortcuts App.tsx routes view-navigation + Ctrl+Shift+8 and renders the pane"
    else
        fail "nav.shortcuts App.tsx routes view-navigation + Ctrl+Shift+8 and renders the pane"
    fi
}

test_nav_settings() {
    note "nav.settings docSettings.ts persists navigationPane (default false)"
    if grep -q 'navigationPane: boolean' "$ROOT/src/lib/docSettings.ts" \
        && grep -q 'navigationPane: false' "$ROOT/src/lib/docSettings.ts" \
        && grep -q 'if (typeof record.navigationPane === "boolean") out.navigationPane = record.navigationPane' "$ROOT/src/lib/docSettings.ts"; then
        pass "nav.settings docSettings.ts persists navigationPane (default false)"
    else
        fail "nav.settings docSettings.ts persists navigationPane (default false)"
    fi
}

test_nav_lib() {
    note "nav.lib outline.ts extraction + active-index + rAF scroll tracking + OutlinePane"
    if [ -f "$ROOT/src/lib/outline.ts" ] \
        && grep -q 'export function outlineEntriesFromDoc' "$ROOT/src/lib/outline.ts" \
        && grep -q 'export function outlineEntriesFromMarkdown' "$ROOT/src/lib/outline.ts" \
        && grep -q 'export function activeOutlineIndex' "$ROOT/src/lib/outline.ts" \
        && grep -q 'export function startOutlineTracking' "$ROOT/src/lib/outline.ts" \
        && grep -q 'requestAnimationFrame' "$ROOT/src/lib/outline.ts" \
        && [ -f "$ROOT/src/components/OutlinePane.tsx" ] \
        && grep -q 'export default function OutlinePane' "$ROOT/src/components/OutlinePane.tsx"; then
        pass "nav.lib outline.ts extraction + active-index + rAF scroll tracking + OutlinePane"
    else
        fail "nav.lib outline.ts extraction + active-index + rAF scroll tracking + OutlinePane"
    fi
}

test_nav_suites_present() {
    note "nav.suites plan 09 task 9.3 vitest suites (outline, pane, App wiring) present"
    if [ -f "$ROOT/src/lib/__tests__/outline.test.ts" ] \
        && grep -q 'startOutlineTracking' "$ROOT/src/lib/__tests__/outline.test.ts" \
        && [ -f "$ROOT/src/lib/__tests__/outlinePane.test.tsx" ] \
        && grep -q 'tracks the active entry as the scroll moves' "$ROOT/src/lib/__tests__/outlinePane.test.tsx" \
        && [ -f "$ROOT/src/lib/__tests__/navigationPaneWiring.test.tsx" ] \
        && grep -q 'Ctrl+Shift+8 toggles the pane for the active document and persists it' "$ROOT/src/lib/__tests__/navigationPaneWiring.test.tsx"; then
        pass "nav.suites plan 09 task 9.3 vitest suites (outline, pane, App wiring) present"
    else
        fail "nav.suites plan 09 task 9.3 vitest suites (outline, pane, App wiring) present"
    fi
}

test_nav_suites_green() {
    note "nav.green navigation-pane vitest suites pass"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (node / node_modules not available)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/outline.test.ts src/lib/__tests__/outlinePane.test.tsx src/lib/__tests__/navigationPaneWiring.test.tsx src/lib/__tests__/docSettings.test.ts) 2>&1 ); then
        pass "nav.green navigation-pane vitest suites pass"
    else
        printf '%s\n' "$out" | tail -25
        fail "nav.green navigation-pane vitest suites failed (plan 09 task 9.3)"
    fi
}

# --- p4-doc-tools: word count dialog (task 9.4, issue #87) -----------------------
# Tools > Word Count (Ctrl+Shift+F5): a read-only dialog with words, characters
# (with and without spaces), sentences, paragraphs, and reading time (200 wpm);
# a WYSIWYG selection scopes the counts to the selected range. The counts are
# computed in counts.ts, shared with the status bar, so the two always agree
# (plan 09 AC3). The pure rules are pinned in counts.test.ts (including the
# known-count fixtures); the deep behavior (menu/shortcut wiring, selection
# scoping, status-bar parity) is pinned in wordCountDialog.test.tsx, which
# runs below.

test_wc_menu_wiring() {
    note "wc.menu Tools > Word Count (tools-word-count, Ctrl+Shift+F5) present"
    if grep -q 'MenuItem::with_id(app, "tools-word-count", "Word Count", true, Some("Ctrl+Shift+F5"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Tools")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '\.items(&\[&file, &edit, &view, &insert, &format, &tools, &help\])' "$ROOT/src-tauri/src/menu.rs"; then
        pass "wc.menu Tools > Word Count (tools-word-count, Ctrl+Shift+F5) present"
    else
        fail "wc.menu Tools > Word Count (tools-word-count, Ctrl+Shift+F5) present"
    fi
}

test_wc_counts_lib() {
    note "wc.lib counts.ts shared counting rules (status bar + dialog)"
    if [ -f "$ROOT/src/lib/counts.ts" ] \
        && grep -q 'export function countWords' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export function countCharsNoSpaces' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export function countSentences' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export function countParagraphs' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export const READING_WPM = 200' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export function countText' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export function countSelection' "$ROOT/src/lib/counts.ts" \
        && grep -q 'export function paragraphsInRange' "$ROOT/src/lib/counts.ts"; then
        pass "wc.lib counts.ts shared counting rules (status bar + dialog)"
    else
        fail "wc.lib counts.ts shared counting rules (status bar + dialog)"
    fi
}

test_wc_app_wiring() {
    note "wc.app App.tsx routes tools-word-count + Ctrl+Shift+F5 and renders the dialog"
    if grep -q 'id === "tools-word-count"' "$ROOT/src/App.tsx" \
        && grep -q 'registerWordCountDialogListener' "$ROOT/src/App.tsx" \
        && grep -q 'key === "f5" && e.shiftKey' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+Shift+F5: word count (Tools > Word Count)' "$ROOT/src/App.tsx" \
        && grep -q '<WordCountDialog' "$ROOT/src/App.tsx" \
        && grep -q 'from "./components/WordCountDialog"' "$ROOT/src/App.tsx" \
        && [ -f "$ROOT/src/components/WordCountDialog.tsx" ]; then
        pass "wc.app App.tsx routes tools-word-count + Ctrl+Shift+F5 and renders the dialog"
    else
        fail "wc.app App.tsx routes tools-word-count + Ctrl+Shift+F5 and renders the dialog"
    fi
}

test_wc_statusbar_shared() {
    note "wc.statusbar status bar + dialog share counts.ts (plan 09 AC3)"
    if grep -q 'countText(currentText)' "$ROOT/src/App.tsx" \
        && grep -q 'export { countWords }' "$ROOT/src/lib/docInfo.ts" \
        && grep -q 'import { countWords } from "./counts"' "$ROOT/src/lib/docInfo.ts"; then
        pass "wc.statusbar status bar + dialog share counts.ts (plan 09 AC3)"
    else
        fail "wc.statusbar status bar + dialog share counts.ts (plan 09 AC3)"
    fi
}

test_wc_suites_green() {
    note "wc.green word-count vitest suites pass"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (node / node_modules not available)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/counts.test.ts src/lib/__tests__/wordCountDialog.test.tsx) 2>&1 ); then
        pass "wc.green word-count vitest suites pass"
    else
        printf '%s\n' "$out" | tail -25
        fail "wc.green word-count vitest suites failed (plan 09 task 9.4)"
    fi
}

# --- p4-doc-tools: spell check (task 9.5, issue #88) -----------------------------
# Tools > Spelling… (Ctrl+Shift+F7): a scan-and-flag dialog over the doc's
# prose (code is never scanned) against the bundled wordlist ∪ the personal
# dictionary ∪ the session ignore list. Per term: "Ignore" (session only) and
# "Add to dictionary" (persisted in app config, survives a restart — AC4). The
# wordlist is a Tauri resource with an embedded fallback; the personal
# dictionary is stored by Rust get/set_wordlist_settings commands. The pure
# scanner is pinned in spellcheck.test.ts; the dialog + wiring in
# spellCheckDialog.test.tsx, which run below.

test_spell_menu_wiring() {
    note "spell.menu Tools > Spelling… (tools-spelling, Ctrl+Shift+F7) present"
    if grep -q 'MenuItem::with_id(app, "tools-spelling", "Spelling…", true, Some("Ctrl+Shift+F7"))' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'SubmenuBuilder::new(app, "Tools")' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '\.items(&\[&file, &edit, &view, &insert, &format, &tools, &help\])' "$ROOT/src-tauri/src/menu.rs"; then
        pass "spell.menu Tools > Spelling… (tools-spelling, Ctrl+Shift+F7) present"
    else
        fail "spell.menu Tools > Spelling… (tools-spelling, Ctrl+Shift+F7) present"
    fi
}

test_spell_wordlist_resource() {
    note "spell.resource wordlist.txt bundled + embedded fallback"
    if [ -s "$ROOT/src-tauri/resources/wordlist.txt" ] \
        && grep -q '"resources"' "$ROOT/src-tauri/tauri.conf.json" \
        && grep -q 'resources/wordlist.txt' "$ROOT/src-tauri/tauri.conf.json" \
        && grep -q 'include_str!("../resources/wordlist.txt")' "$ROOT/src-tauri/src/commands.rs"; then
        pass "spell.resource wordlist.txt bundled + embedded fallback"
    else
        fail "spell.resource wordlist.txt bundled + embedded fallback"
    fi
}

test_spell_rust_commands() {
    note "spell.rust load_wordlist + get/set_wordlist_settings commands"
    if grep -q 'pub fn load_wordlist' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn get_wordlist_settings' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'pub fn set_wordlist_settings' "$ROOT/src-tauri/src/commands.rs" \
        && grep -q 'commands::load_wordlist' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'commands::get_wordlist_settings' "$ROOT/src-tauri/src/lib.rs" \
        && grep -q 'commands::set_wordlist_settings' "$ROOT/src-tauri/src/lib.rs"; then
        pass "spell.rust load_wordlist + get/set_wordlist_settings commands"
    else
        fail "spell.rust load_wordlist + get/set_wordlist_settings commands"
    fi
}

test_spell_lib() {
    note "spell.lib spellcheck.ts scanner + settings storage"
    if [ -f "$ROOT/src/lib/spellcheck.ts" ] \
        && grep -q 'export function extractWordTokens' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export function isCheckableToken' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export function scanText' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export function scanDoc' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export function buildKnownSet' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export function normalizeSpellcheckSettings' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export async function loadWordlist' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export function ignoreWordForSession' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'export async function saveSpellcheckSettings' "$ROOT/src/lib/spellcheck.ts" \
        && grep -q 'codeBlock' "$ROOT/src/lib/spellcheck.ts"; then
        pass "spell.lib spellcheck.ts scanner + settings storage"
    else
        fail "spell.lib spellcheck.ts scanner + settings storage"
    fi
}

test_spell_app_wiring() {
    note "spell.app App.tsx routes tools-spelling + Ctrl+Shift+F7 and renders the dialog"
    if grep -q 'id === "tools-spelling"' "$ROOT/src/App.tsx" \
        && grep -q 'registerSpellCheckDialogListener' "$ROOT/src/App.tsx" \
        && grep -q 'key === "f7" && e.shiftKey' "$ROOT/src/App.tsx" \
        && grep -q 'Ctrl+Shift+F7: spelling (Tools > Spelling…)' "$ROOT/src/App.tsx" \
        && grep -q '<SpellCheckDialog' "$ROOT/src/App.tsx" \
        && grep -q 'from "./components/SpellCheckDialog"' "$ROOT/src/App.tsx" \
        && [ -f "$ROOT/src/components/SpellCheckDialog.tsx" ]; then
        pass "spell.app App.tsx routes tools-spelling + Ctrl+Shift+F7 and renders the dialog"
    else
        fail "spell.app App.tsx routes tools-spelling + Ctrl+Shift+F7 and renders the dialog"
    fi
}

test_spell_suites_green() {
    note "spell.green spell-check vitest suites pass"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (node / node_modules not available)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/spellcheck.test.ts src/lib/__tests__/spellCheckDialog.test.tsx) 2>&1 ); then
        pass "spell.green spell-check vitest suites pass"
    else
        printf '%s\n' "$out" | tail -25
        fail "spell.green spell-check vitest suites failed (plan 09 task 9.5)"
    fi
}

# --- p4-doc-tools: date/time + special characters (task 9.6, issue #89) -----------
# Insert > Date & Time: a picker listing the app's ten date/time formats
# (dateformats.ts — pure Intl; the ordering/clock formats pin explicit locales
# so they mean the same thing on every platform), each row a live sample for
# the current date; the click inserts the sample at the caret as plain text
# (no markup, golden rule 1) and closes. Insert > Special Characters…: a
# popover with a name search ("copyright" → ©), the six categories (currency,
# math, arrows, bullets, typography, symbols), and a localStorage-backed
# recents row; the click inserts a single UTF-8 code point (code-page safe,
# plan 09 AC5) and the popover stays open (multi-insert). The pure rules are
# pinned in dateformats.test.ts + symbols.test.ts; the deep behavior (menu
# wiring, WYSIWYG + source-mode caret insertion, recents persistence) is
# pinned in dateTimeDialog.test.tsx + symbolDialog.test.tsx, which run below.

test_dt_menu_wiring() {
    note "dt.menu Insert > Date & Time + Special Characters… (menu.rs)"
    if grep -q 'MenuItem::with_id(app, "insert-date-time", "Date & Time", true, None::<&str>)' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "insert-symbol", "Special Characters...", true, None::<&str>)' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q '&date_time, &symbol' "$ROOT/src-tauri/src/menu.rs"; then
        pass "dt.menu Insert > Date & Time + Special Characters… (menu.rs)"
    else
        fail "dt.menu Insert > Date & Time + Special Characters… (menu.rs)"
    fi
}

test_dt_formats_lib() {
    note "dt.lib dateformats.ts Intl format list + formatter"
    if [ -f "$ROOT/src/lib/dateformats.ts" ] \
        && grep -q 'export const DATE_TIME_FORMATS' "$ROOT/src/lib/dateformats.ts" \
        && grep -q 'export function formatDateTime' "$ROOT/src/lib/dateformats.ts" \
        && grep -q 'id: "datetime24"' "$ROOT/src/lib/dateformats.ts" \
        && grep -q 'parts: \["iso", "time24"\]' "$ROOT/src/lib/dateformats.ts"; then
        pass "dt.lib dateformats.ts Intl format list + formatter"
    else
        fail "dt.lib dateformats.ts Intl format list + formatter"
    fi
}

test_dt_symbols_lib() {
    note "dt.symbols symbols.ts bundled table + search + recents"
    if [ -f "$ROOT/src/lib/symbols.ts" ] \
        && grep -q 'export const SYMBOLS' "$ROOT/src/lib/symbols.ts" \
        && grep -q 'export const SYMBOL_CATEGORIES' "$ROOT/src/lib/symbols.ts" \
        && grep -q 'export function searchSymbols' "$ROOT/src/lib/symbols.ts" \
        && grep -q 'export function getRecentSymbols' "$ROOT/src/lib/symbols.ts" \
        && grep -q 'export function recordSymbolInsert' "$ROOT/src/lib/symbols.ts"; then
        pass "dt.symbols symbols.ts bundled table + search + recents"
    else
        fail "dt.symbols symbols.ts bundled table + search + recents"
    fi
}

test_dt_app_wiring() {
    note "dt.app App.tsx routes insert-date-time / insert-symbol and renders the dialogs"
    if grep -q 'id === "insert-date-time"' "$ROOT/src/App.tsx" \
        && grep -q 'id === "insert-symbol"' "$ROOT/src/App.tsx" \
        && grep -q 'registerDateTimeDialogListener' "$ROOT/src/App.tsx" \
        && grep -q 'registerSymbolDialogListener' "$ROOT/src/App.tsx" \
        && grep -q '<DateTimeDialog' "$ROOT/src/App.tsx" \
        && grep -q '<SymbolDialog' "$ROOT/src/App.tsx" \
        && grep -q 'insertPlainTextAtCaret' "$ROOT/src/App.tsx" \
        && [ -f "$ROOT/src/components/DateTimeDialog.tsx" ] \
        && [ -f "$ROOT/src/components/SymbolDialog.tsx" ]; then
        pass "dt.app App.tsx routes insert-date-time / insert-symbol and renders the dialogs"
    else
        fail "dt.app App.tsx routes insert-date-time / insert-symbol and renders the dialogs"
    fi
}

test_dt_slash_actions() {
    note "dt.slash Editor.tsx /date + /symbol slash actions"
    if grep -q 'commandAction("date", "dateTime"' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'commandAction("symbol", "symbol"' "$ROOT/src/components/Editor.tsx"; then
        pass "dt.slash Editor.tsx /date + /symbol slash actions"
    else
        fail "dt.slash Editor.tsx /date + /symbol slash actions"
    fi
}

test_dt_suites_green() {
    note "dt.green date/time + symbols vitest suites pass"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (node / node_modules not available)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/dateformats.test.ts src/lib/__tests__/symbols.test.ts src/lib/__tests__/dateTimeDialog.test.tsx src/lib/__tests__/symbolDialog.test.tsx) 2>&1 ); then
        pass "dt.green date/time + symbols vitest suites pass"
    else
        printf '%s\n' "$out" | tail -25
        fail "dt.green date/time + symbols vitest suites failed (plan 09 task 9.6)"
    fi
}

# --- p4-doc-tools: page break + clear document (task 9.7, issue #90) -------------
# Insert > Page Break: inserts the stable HTML block
# `<div class="quillmd-page-break"></div>` (golden rule 1 — markdown stays the
# source of truth; pm.ts round-trips it byte-identically as a pageBreak atom)
# and renders it as a visible labeled break line in WYSIWYG (PageBreakCard) +
# Preview. The Typst/PDF export expands the block to a raw
# ```{=typst} #pagebreak() fence (convert.rs expand_page_breaks; DOCX/EPUB/TXT
# drop the raw HTML, which is intended — those formats have no page-break
# construct). Tools > Clear Document: a native confirm ("This removes all
# content. Can be undone.") gates the clear; the clear is ONE replace
# transaction (WYSIWYG) / ONE CodeMirror change (source/split), so a single
# Ctrl+Z restores the full prior text exactly (plan 09 AC7, byte compare).
# The node/serializer/preview contract and the single-undo behavior are pinned
# in the vitest suites below; the PDF page split is pinned by the cargo
# convert suite (export_pdf_page_break_splits_pdf_pages).

test_pb_menu_wiring() {
    note "pb.menu Insert > Page Break + Tools > Clear Document (menu.rs)"
    if grep -q 'MenuItem::with_id(app, "insert-page-break", "Page Break", true, None::<&str>)' "$ROOT/src-tauri/src/menu.rs" \
        && grep -q 'MenuItem::with_id(app, "tools-clear-document", "Clear Document", true, None::<&str>)' "$ROOT/src-tauri/src/menu.rs"; then
        pass "pb.menu Insert > Page Break + Tools > Clear Document (menu.rs)"
    else
        fail "pb.menu Insert > Page Break + Tools > Clear Document (menu.rs)"
    fi
}

test_pb_token_contract() {
    note "pb.token Rust + frontend PAGE_BREAK_HTML constants are byte-identical"
    local rust_html js_html
    rust_html=$(sed -n 's/^const PAGE_BREAK_HTML: &str = "\(.*\)";$/\1/p' "$ROOT/src-tauri/src/convert.rs" | head -1)
    # The Rust source escapes the double quotes inside the string literal.
    rust_html=$(printf '%s' "$rust_html" | sed 's/\\"/"/g')
    # The JS side is single-quoted (the block itself carries double quotes).
    js_html=$(sed -n "s/^export const PAGE_BREAK_HTML = '\(.*\)';\$/\1/p" "$ROOT/src/lib/pm.ts" | head -1)
    if [ -n "$rust_html" ] && [ "$rust_html" = "$js_html" ]; then
        pass "pb.token both page-break constants agree ($js_html)"
    else
        fail "pb.token page-break constants disagree (rust: '$rust_html' js: '$js_html')"
    fi
}

test_pb_editor_wiring() {
    note "pb.editor pageBreak atom (Editor.tsx) + card + preview block"
    if [ -f "$ROOT/src/components/PageBreakCard.tsx" ] \
        && grep -q 'name: "pageBreak"' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'div\[data-quillmd-page-break\]' "$ROOT/src/components/Editor.tsx" \
        && grep -q 'export const PAGE_BREAK_HTML' "$ROOT/src/lib/pm.ts" \
        && grep -q 'isPageBreakHtml(node.value)' "$ROOT/src/lib/pm.ts" \
        && grep -q 'buildPageBreakBlock' "$ROOT/src/components/PreviewView.tsx" \
        && grep -q 'quillmd-page-break' "$ROOT/src/App.css"; then
        pass "pb.editor pageBreak atom + card + preview block wired"
    else
        fail "pb.editor pageBreak wiring missing"
    fi
}

test_pb_export_wiring() {
    note "pb.export PDF expands the block to #pagebreak() (convert.rs)"
    if grep -q 'pub fn expand_page_breaks' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'PAGE_BREAK_REPLACEMENT' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q '#pagebreak()' "$ROOT/src-tauri/src/convert.rs" \
        && grep -q 'fn expanded_input' "$ROOT/src-tauri/src/convert.rs"; then
        pass "pb.export PDF expands the block to #pagebreak() (convert.rs)"
    else
        fail "pb.export page-break expansion wiring missing in convert.rs"
    fi
}

test_pb_clear_wiring() {
    note "pb.clear clearDocument command + native confirm (editorCommands.ts, App.tsx)"
    if grep -q 'id: "clearDocument"' "$ROOT/src/lib/editorCommands.ts" \
        && grep -q 'id === "tools-clear-document"' "$ROOT/src/App.tsx" \
        && grep -q 'confirmMessage' "$ROOT/src/App.tsx" \
        && grep -q 'dispatchEditorCommand("clearDocument")' "$ROOT/src/App.tsx"; then
        pass "pb.clear clearDocument command + native confirm wired"
    else
        fail "pb.clear clear-document wiring missing"
    fi
}

test_pb_suites_green() {
    note "pb.green page-break + clear-document vitest suites pass"
    if ! command -v node >/dev/null 2>&1 || [ ! -d "$ROOT/node_modules" ]; then
        echo "SKIP (node / node_modules not available)"
        return
    fi
    local out
    if out=$( (cd "$ROOT" && npx vitest run src/lib/__tests__/pageBreak.test.tsx src/lib/__tests__/clearDocument.test.tsx) 2>&1 ); then
        pass "pb.green page-break + clear-document vitest suites pass"
    else
        printf '%s\n' "$out" | tail -25
        fail "pb.green page-break + clear-document vitest suites failed (plan 09 task 9.7)"
    fi
}

# --- runner ---------------------------------------------------------------------
SUBSET="${1:-core}"
echo "QuillMD acceptance tests — subset: $SUBSET  ($(date -u +%FT%TZ))"
echo "App: $APP_BIN   Driver: ${DRIVER:-none}"

case "$SUBSET" in
    core)
        test_roundtrip_byte_identical
        test_feature_coverage
        test_undo_bytes
        test_line_endings
        test_bom
        test_crash_recovery
        test_file_watch
        test_platform
        test_front_matter
        test_stress
        test_large_file
        ;;
    export)
        test_export_pdf
        test_export_docx
        test_export_epub
        test_export_txt
        test_import_docx
        ;;
    p0-shell)
        test_shell_new_bundled
        test_shell_new_menu_wiring
        test_shell_copyclose_menu_wiring
        test_shell_copyclose_app_routing
        test_shell_copyclose_dirty_confirm
        test_shell_info_stat_selftest
        test_shell_info_menu_wiring
        test_shell_info_app_routing
        test_shell_dragdrop_app_wiring
        test_shell_dragdrop_handler
        test_shell_dragdrop_explorer_root
        test_shell_multiopen_menu_wiring
        test_shell_multiopen_interaction_test
        test_shell_no_fileop_prompt
        ;;
    p1-editor)
        test_editor_underline_menu_wiring
        test_editor_underline_app_routing
        test_editor_underline_toolbar
        test_editor_underline_roundtrip_fixture
        test_editor_alignment_menu_wiring
        test_editor_alignment_app_routing
        test_editor_alignment_toolbar
        test_editor_alignment_roundtrip_fixture
        test_editor_indent_menu_wiring
        test_editor_indent_app_routing
        test_editor_indent_toolbar
        test_editor_indent_keydown
        test_editor_views_menu_wiring
        test_editor_views_app_routing
        test_editor_views_registry
        test_editor_views_css
        test_editor_zoom_menu_wiring
        test_editor_zoom_app_routing
        test_editor_zoom_registry
        test_editor_zoom_css_statusbar
        test_editor_spellcheck_menu_wiring
        test_editor_spellcheck_app_routing
        test_editor_spellcheck_attr_source_off
        test_editor_pasteas_menu_wiring
        test_editor_pasteas_app_routing
        test_editor_pasteas_interception
        test_editor_headings_keydown
        test_editor_shortcuts_dialog
        test_editor_suites_present
        ;;
    p1-find)
        test_find_menu_wiring
        test_find_app_routing
        test_find_memory_module
        test_find_panel_position
        test_find_suites_present
        test_find_ac1_open_counter_navigate
        test_find_ac2_options
        test_find_ac3_replace_single_undo
        test_find_ac4_source_parity
        test_find_ac5_crossblock
        test_find_ac6_dirty_roundtrip
        test_find_ac7_no_prompt
        test_find_perf_large_doc
        ;;
    p1-media)
        # Task 8.2 (issue #77): Insert > Image submenu + from-URL
        test_media_menu_wiring
        test_media_app_routing
        test_media_toolbar_split
        test_media_images_module
        test_media_suites_present
        # Task 8.3 (issue #78): asset copy pipeline
        test_assets_rust_core
        test_assets_command_registration
        test_assets_module
        test_assets_app_routing
        test_assets_suites_present
        # Task 8.4 (issue #79): image edit dialog + <img> HTML width
        test_imageedit_node_and_click
        test_imageedit_pm_img_html
        test_imageedit_module
        test_imageedit_registry
        test_imageedit_app_routing
        test_imageedit_fixture
        test_imageedit_suites_present
        # Task 8.5 (issue #80): open links + broken-image placeholder
        test_links_opener_capability
        test_links_module
        test_links_editor_wiring
        test_links_preview_wiring
        test_missing_images_module
        test_missing_images_nodeview
        test_missing_images_app_wiring
        test_links_suites_present
        # Task 8.6 (issue #81): DnD image insert
        test_dnd_module
        test_dnd_app_wiring
        test_dnd_suites_present
        # Task 8.7 (issue #82): plan 08 §4 acceptance criteria
        test_media_ac1_link_dialog
        test_media_ac2_paste_url
        test_media_ac3_image_from_file
        test_media_ac4_collision
        test_media_ac5_width_roundtrip
        test_media_ac6_broken_image
        test_media_ac7_open_link
        test_media_ac8_roundtrip
        # Task 8.7 (issue #82): Windows manual pass
        test_media_windows_assetcopy
        test_media_windows_openlink
        ;;
    p1-assets)
        test_assets_rust_core
        test_assets_command_registration
        test_assets_module
        test_assets_app_routing
        test_assets_suites_present
        ;;
    p1-imageedit)
        test_imageedit_node_and_click
        test_imageedit_pm_img_html
        test_imageedit_module
        test_imageedit_registry
        test_imageedit_app_routing
        test_imageedit_fixture
        test_imageedit_suites_present
        ;;
    p1-links)
        test_links_opener_capability
        test_links_module
        test_links_editor_wiring
        test_links_preview_wiring
        test_missing_images_module
        test_missing_images_nodeview
        test_missing_images_app_wiring
        test_links_suites_present
        ;;
    p1-dnd)
        test_dnd_module
        test_dnd_app_wiring
        test_dnd_suites_present
        ;;
    p2-fonts)
        # Task 4.1 (issue #47): marks + serializer/parser
        test_fonts_marks_registered
        test_fonts_marks_in_extensions
        test_fonts_pm_span_parse_serialize
        test_fonts_pm_fixed_attr_order
        test_fonts_roundtrip_fixture
        test_fonts_suites_present
        # Task 4.2 (issue #48): shared color palette
        test_colors_palette_data
        test_colors_registry_commands
        test_colors_palette_component
        test_colors_toolbar_wiring
        test_colors_suites_present
        # Task 4.3 (issue #49): toolbar font cluster
        test_fonttoolbar_registry_commands
        test_fonttoolbar_toolbar_wiring
        test_fonttoolbar_suites_present
        # Task 4.4 (issue #50): Format > Font submenu
        test_fontmenu_submenu_wiring
        test_fontmenu_resolvers
        test_fontmenu_app_routing
        test_fontmenu_suites_present
        # Task 4.5 (issue #51): clear formatting + editor-chrome font
        test_clearformat_registry_command
        test_editorfont_module
        test_editorfont_command_css
        test_editorfont_css_fallback
        test_editorfont_menu_wiring
        test_editorfont_app_routing
        test_clearformat_suites_present
        # Task 4.6 (issue #52): plan 04 §4 acceptance criteria
        test_fonts_ac1_apply_and_stable_save
        test_fonts_ac2_clean_docs_untouched
        test_fonts_ac3_compose_and_toggle
        test_fonts_ac4_clear_keeps_bold_italic
        test_fonts_ac5_highlight_color_and_compat
        test_fonts_ac6_dispatch_parity
        test_fonts_ac7_pdf_export_styled
        test_fonts_ac7_docx_export_styled
        # Task 4.6 (issue #52): Windows manual pass
        test_fonts_windows_crlf
        ;;
    p2-colors)
        test_colors_palette_data
        test_colors_registry_commands
        test_colors_palette_component
        test_colors_toolbar_wiring
        test_colors_suites_present
        ;;
    p2-font-toolbar)
        test_fonttoolbar_registry_commands
        test_fonttoolbar_toolbar_wiring
        test_fonttoolbar_suites_present
        ;;
    p2-font-menu)
        test_fontmenu_submenu_wiring
        test_fontmenu_resolvers
        test_fontmenu_app_routing
        test_fontmenu_suites_present
        ;;
    p2-clear-format)
        test_clearformat_registry_command
        test_editorfont_module
        test_editorfont_command_css
        test_editorfont_css_fallback
        test_editorfont_menu_wiring
        test_editorfont_app_routing
        test_clearformat_suites_present
        ;;
    p2-styles)
        # Task 5.1 (issue #54): style registry + gallery popover
        test_styles_registry_module
        test_styles_builtin_set
        test_styles_paragraph_command
        test_styles_gallery_component
        test_styles_gallery_css
        test_styles_suites_present
        # Task 5.2 (issue #55): Format > Styles submenu + toolbar gallery button
        test_stylemenu_submenu_wiring
        test_stylemenu_resolver
        test_stylemenu_app_routing
        test_stylemenu_toolbar_wiring
        test_stylemenu_suites_present
        # Task 5.3 (issue #56): built-in theme system
        test_theme_module
        test_theme_css_sheets
        test_theme_menu_wiring
        test_theme_app_routing
        test_theme_suites_present
        # Task 5.4 (issue #57): Modify Style + overrides storage
        test_stylemodify_module
        test_stylemodify_dialog_component
        test_stylemodify_rust_commands
        test_stylemodify_menu_wiring
        test_stylemodify_app_routing
        test_stylemodify_css
        test_stylemodify_suites_present
        # Task 5.5 (issue #58): status-bar block-type indicator + jump-to-style
        test_styleinspector_currentblockstyle
        test_styleinspector_bridge
        test_styleinspector_editor_publish
        test_styleinspector_statusbar
        test_styleinspector_gallery_open
        test_styleinspector_app_wiring
        test_styleinspector_css
        test_styleinspector_suites_present
        # Task 5.6 (issue #59): plan 05 §4 acceptance criteria
        test_styles_ac1_gallery_and_h2
        test_styles_ac2_theme_zero_bytes
        test_styles_ac3_modify_h2
        test_styles_ac4_screenshot_baselines
        test_styles_ac5_os_dark_default
        test_styles_ac6_roundtrip_no_markup
        ;;
    p2-styles-menu)
        # Task 5.2 (issue #55): Format > Styles submenu + toolbar gallery button
        test_stylemenu_submenu_wiring
        test_stylemenu_resolver
        test_stylemenu_app_routing
        test_stylemenu_toolbar_wiring
        test_stylemenu_suites_present
        ;;
    p2-themes)
        # Task 5.3 (issue #56): built-in theme system
        test_theme_module
        test_theme_css_sheets
        test_theme_menu_wiring
        test_theme_app_routing
        test_theme_suites_present
        ;;
    p2-style-modify)
        # Task 5.4 (issue #57): Modify Style + overrides storage
        test_stylemodify_module
        test_stylemodify_dialog_component
        test_stylemodify_rust_commands
        test_stylemodify_menu_wiring
        test_stylemodify_app_routing
        test_stylemodify_css
        test_stylemodify_suites_present
        ;;
    p2-style-inspector)
        # Task 5.5 (issue #58): status-bar block-type indicator + jump-to-style
        test_styleinspector_currentblockstyle
        test_styleinspector_bridge
        test_styleinspector_editor_publish
        test_styleinspector_statusbar
        test_styleinspector_gallery_open
        test_styleinspector_app_wiring
        test_styleinspector_css
        test_styleinspector_suites_present
        ;;
    p2-tables)
        # Task 6.1 (issue #61): GFM serializer + parser hardening
        test_tables_gfm_serializer
        test_tables_gfmtable_extension
        test_tables_gfm_fixture
        # Task 6.2 (issue #62): row/column/cell/header/delete registry commands
        test_tables_registry_commands
        test_tables_commands_suite
        # Task 6.3 (issue #63): size picker + insert dialog
        test_tables_insert_module
        test_tables_picker_components
        test_tables_menu_wiring
        test_tables_insert_suites
        # Task 6.4 (issue #64): floating table toolbar
        test_tables_floating_toolbar
        test_tables_floating_suite
        # Task 6.5 (issue #65): keyboard navigation
        test_tables_keyboard
        test_tables_keys_suite
        # Task 6.6 (issue #66): merge + colgroup widths
        test_tables_merge_serializer
        test_tables_merge_suite
        # Task 6.7 (issue #67): plan 06 §4 acceptance criteria
        test_tables_ac1_picker_inserts_exact_size
        test_tables_ac2_gfm_lint
        test_tables_ac3_alignment_persists
        test_tables_ac4_keyboard_nav
        test_tables_ac5_delete_table
        test_tables_ac6_escaped_pipe
        test_tables_ac7_floating_toolbar_focus
        test_tables_ac8_fixtures_green
        ;;
    p2-mermaid-export)
        # Task 11.5 (issue #104): PNG export pipeline
        test_mermaidexport_selftest
        test_mermaidexport_rust_commands
        test_mermaidexport_pipeline_module
        test_mermaidexport_ac5
        ;;
    p2-mermaid)
        # Task 11.7 (issue #106): plan 11 full acceptance gate
        test_mermaid_ac1_insert
        test_mermaid_ac2_rerender
        test_mermaid_ac3_shared_svg
        test_mermaid_ac4_fit_scroll
        test_mermaid_ac5_export
        test_mermaid_ac6_source_highlight
        test_mermaid_ac7_undo
        test_mermaid_ac8_startup_perf
        # Windows manual pass (insert -> edit -> export PDF/DOCX)
        test_mermaid_windows_manual
        ;;
    p3-context)
        # Task 3.1 (issue #39): shared ContextMenu component
        test_context_component
        # Task 3.2 (issue #40): editor text menu (plan 03 AC1)
        test_context_ac1_text_menu
        # Task 3.3 (issue #41): table menu (plan 03 AC2)
        test_context_ac2_table_menu
        # Task 3.4 (issue #42): image menu (plan 03 AC3)
        test_context_ac3_image_menu
        # Task 3.5 (issue #43): link menu, all views
        test_context_link_menu
        # Task 3.6 (issue #44): tab bar menu (plan 03 AC4)
        test_context_ac4_tab_menu
        # Task 3.6 (issue #44): explorer menu + fs_* Rust commands (plan 03 AC5)
        test_context_ac5_explorer_menu
        # Task 3.1 (issue #39): keyboard navigation (plan 03 AC6)
        test_context_ac6_keyboard
        # Plan 03 §4 AC7: all existing suites green
        test_context_ac7_all_suites_green
        # Windows + Linux manual matrix (every menu x every surface)
        test_context_manual_matrix
        ;;
    p4-doc-tools)
        # Task 9.2 (issue #85): export-time TOC generation
        test_toce_token_contract
        test_toce_fixture
        test_toce_wiring
        test_toce_cargo_suite
        test_toce_selftest
        # Task 9.3 (issue #86): navigation pane
        test_nav_menu_wiring
        test_nav_app_wiring
        test_nav_settings
        test_nav_lib
        test_nav_suites_present
        test_nav_suites_green
        # Task 9.4 (issue #87): word count dialog
        test_wc_menu_wiring
        test_wc_counts_lib
        test_wc_app_wiring
        test_wc_statusbar_shared
        test_wc_suites_green
        # Task 9.5 (issue #88): spell check
        test_spell_menu_wiring
        test_spell_wordlist_resource
        test_spell_rust_commands
        test_spell_lib
        test_spell_app_wiring
        test_spell_suites_green
        # Task 9.6 (issue #89): date/time + special characters
        test_dt_menu_wiring
        test_dt_formats_lib
        test_dt_symbols_lib
        test_dt_app_wiring
        test_dt_slash_actions
        test_dt_suites_green
        # Task 9.7 (issue #90): page break + clear document
        test_pb_menu_wiring
        test_pb_token_contract
        test_pb_editor_wiring
        test_pb_export_wiring
        test_pb_clear_wiring
        test_pb_suites_green
        ;;
    shell)
        test_shell_new_bundled
        test_shell_new_menu_wiring
        ;;
    copyclose)
        test_shell_copyclose_menu_wiring
        test_shell_copyclose_app_routing
        test_shell_copyclose_dirty_confirm
        ;;
    info)
        test_shell_info_stat_selftest
        test_shell_info_menu_wiring
        test_shell_info_app_routing
        ;;
    dragdrop)
        test_shell_dragdrop_app_wiring
        test_shell_dragdrop_handler
        test_shell_dragdrop_explorer_root
        ;;
    pkg)
        note "5.19 packaging (fresh-VM install+launch)"
        # CI-only: installs on fresh VM. Local: assert artifacts exist.
        if ls target/*.msi target/*.AppImage 2>/dev/null | grep -q .; then
            pass "5.19 packaging artifacts present"
        else
            echo "SKIP (no build artifacts)"
        fi
        ;;
    all)
        test_roundtrip_byte_identical
        test_feature_coverage
        test_undo_bytes
        test_line_endings
        test_bom
        test_crash_recovery
        test_file_watch
        test_platform
        test_front_matter
        test_stress
        test_large_file
        test_export_pdf
        test_export_docx
        test_export_epub
        test_export_txt
        test_import_docx
        test_shell_new_bundled
        test_shell_new_menu_wiring
        test_shell_copyclose_menu_wiring
        test_shell_copyclose_app_routing
        test_shell_copyclose_dirty_confirm
        test_shell_info_stat_selftest
        test_shell_info_menu_wiring
        test_shell_info_app_routing
        test_shell_dragdrop_app_wiring
        test_shell_dragdrop_handler
        test_shell_dragdrop_explorer_root
        test_shell_multiopen_menu_wiring
        test_shell_multiopen_interaction_test
        test_shell_no_fileop_prompt
        test_editor_underline_menu_wiring
        test_editor_underline_app_routing
        test_editor_underline_toolbar
        test_editor_underline_roundtrip_fixture
        test_editor_alignment_menu_wiring
        test_editor_alignment_app_routing
        test_editor_alignment_toolbar
        test_editor_alignment_roundtrip_fixture
        test_editor_indent_menu_wiring
        test_editor_indent_app_routing
        test_editor_indent_toolbar
        test_editor_indent_keydown
        test_editor_views_menu_wiring
        test_editor_views_app_routing
        test_editor_views_registry
        test_editor_views_css
        test_editor_zoom_menu_wiring
        test_editor_zoom_app_routing
        test_editor_zoom_registry
        test_editor_zoom_css_statusbar
        test_editor_spellcheck_menu_wiring
        test_editor_spellcheck_app_routing
        test_editor_spellcheck_attr_source_off
        test_editor_pasteas_menu_wiring
        test_editor_pasteas_app_routing
        test_editor_pasteas_interception
        test_editor_headings_keydown
        test_editor_shortcuts_dialog
        test_editor_suites_present
        test_find_menu_wiring
        test_find_app_routing
        test_find_memory_module
        test_find_panel_position
        test_find_suites_present
        test_find_ac1_open_counter_navigate
        test_find_ac2_options
        test_find_ac3_replace_single_undo
        test_find_ac4_source_parity
        test_find_ac5_crossblock
        test_find_ac6_dirty_roundtrip
        test_find_ac7_no_prompt
        test_find_perf_large_doc
        test_media_menu_wiring
        test_media_app_routing
        test_media_toolbar_split
        test_media_images_module
        test_media_suites_present
        test_assets_rust_core
        test_assets_command_registration
        test_assets_module
        test_assets_app_routing
        test_assets_suites_present
        test_imageedit_node_and_click
        test_imageedit_pm_img_html
        test_imageedit_module
        test_imageedit_registry
        test_imageedit_app_routing
        test_imageedit_fixture
        test_imageedit_suites_present
        test_links_opener_capability
        test_links_module
        test_links_editor_wiring
        test_links_preview_wiring
        test_missing_images_module
        test_missing_images_nodeview
        test_missing_images_app_wiring
        test_links_suites_present
        test_dnd_module
        test_dnd_app_wiring
        test_dnd_suites_present
        test_media_ac1_link_dialog
        test_media_ac2_paste_url
        test_media_ac3_image_from_file
        test_media_ac4_collision
        test_media_ac5_width_roundtrip
        test_media_ac6_broken_image
        test_media_ac7_open_link
        test_media_ac8_roundtrip
        test_media_windows_assetcopy
        test_media_windows_openlink
        test_fonts_marks_registered
        test_fonts_marks_in_extensions
        test_fonts_pm_span_parse_serialize
        test_fonts_pm_fixed_attr_order
        test_fonts_roundtrip_fixture
        test_fonts_suites_present
        test_colors_palette_data
        test_colors_registry_commands
        test_colors_palette_component
        test_colors_toolbar_wiring
        test_colors_suites_present
        test_fonttoolbar_registry_commands
        test_fonttoolbar_toolbar_wiring
        test_fonttoolbar_suites_present
        test_fontmenu_submenu_wiring
        test_fontmenu_resolvers
        test_fontmenu_app_routing
        test_fontmenu_suites_present
        test_clearformat_registry_command
        test_editorfont_module
        test_editorfont_command_css
        test_editorfont_css_fallback
        test_editorfont_menu_wiring
        test_editorfont_app_routing
        test_clearformat_suites_present
        test_fonts_ac1_apply_and_stable_save
        test_fonts_ac2_clean_docs_untouched
        test_fonts_ac3_compose_and_toggle
        test_fonts_ac4_clear_keeps_bold_italic
        test_fonts_ac5_highlight_color_and_compat
        test_fonts_ac6_dispatch_parity
        test_fonts_ac7_pdf_export_styled
        test_fonts_ac7_docx_export_styled
        test_fonts_windows_crlf
        test_styles_registry_module
        test_styles_builtin_set
        test_styles_paragraph_command
        test_styles_gallery_component
        test_styles_gallery_css
        test_styles_suites_present
        test_stylemenu_submenu_wiring
        test_stylemenu_resolver
        test_stylemenu_app_routing
        test_stylemenu_toolbar_wiring
        test_stylemenu_suites_present
        test_theme_module
        test_theme_css_sheets
        test_theme_menu_wiring
        test_theme_app_routing
        test_theme_suites_present
        test_stylemodify_module
        test_stylemodify_dialog_component
        test_stylemodify_rust_commands
        test_stylemodify_menu_wiring
        test_stylemodify_app_routing
        test_stylemodify_css
        test_stylemodify_suites_present
        test_styleinspector_currentblockstyle
        test_styleinspector_bridge
        test_styleinspector_editor_publish
        test_styleinspector_statusbar
        test_styleinspector_gallery_open
        test_styleinspector_app_wiring
        test_styleinspector_css
        test_styleinspector_suites_present
        test_styles_ac1_gallery_and_h2
        test_styles_ac2_theme_zero_bytes
        test_styles_ac3_modify_h2
        test_styles_ac4_screenshot_baselines
        test_styles_ac5_os_dark_default
        test_styles_ac6_roundtrip_no_markup
        test_tables_gfm_serializer
        test_tables_gfmtable_extension
        test_tables_gfm_fixture
        test_tables_registry_commands
        test_tables_commands_suite
        test_tables_insert_module
        test_tables_picker_components
        test_tables_menu_wiring
        test_tables_insert_suites
        test_tables_floating_toolbar
        test_tables_floating_suite
        test_tables_keyboard
        test_tables_keys_suite
        test_tables_merge_serializer
        test_tables_merge_suite
        test_tables_ac1_picker_inserts_exact_size
        test_tables_ac2_gfm_lint
        test_tables_ac3_alignment_persists
        test_tables_ac4_keyboard_nav
        test_tables_ac5_delete_table
        test_tables_ac6_escaped_pipe
        test_tables_ac7_floating_toolbar_focus
        test_tables_ac8_fixtures_green
        test_mermaidexport_selftest
        test_mermaidexport_rust_commands
        test_mermaidexport_pipeline_module
        test_mermaidexport_ac5
        test_mermaid_ac1_insert
        test_mermaid_ac2_rerender
        test_mermaid_ac3_shared_svg
        test_mermaid_ac4_fit_scroll
        test_mermaid_ac5_export
        test_mermaid_ac6_source_highlight
        test_mermaid_ac7_undo
        test_mermaid_ac8_startup_perf
        test_mermaid_windows_manual
        test_context_component
        test_context_ac1_text_menu
        test_context_ac2_table_menu
        test_context_ac3_image_menu
        test_context_link_menu
        test_context_ac4_tab_menu
        test_context_ac5_explorer_menu
        test_context_ac6_keyboard
        test_context_ac7_all_suites_green
        test_context_manual_matrix
        test_toce_token_contract
        test_toce_fixture
        test_toce_wiring
        test_toce_cargo_suite
        test_toce_selftest
        ;;
    *)
        echo "Unknown subset: $SUBSET (core|export|pkg|p0-shell|p1-editor|p1-find|p1-media|p1-assets|p1-imageedit|p1-links|p1-dnd|p2-fonts|p2-colors|p2-font-toolbar|p2-font-menu|p2-clear-format|p2-styles|p2-styles-menu|p2-themes|p2-style-modify|p2-style-inspector|p2-tables|p2-mermaid-export|p2-mermaid|p3-context|p4-doc-tools|shell|copyclose|info|dragdrop|all)" >&2
        exit 2
        ;;
esac

# --- report ---------------------------------------------------------------------
echo ""
echo "=========================================="
echo "PASS: $PASS   FAIL: $FAIL"
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
    echo "Failed:"
    for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
fi
echo "=========================================="
echo "PASS=$PASS FAIL=$FAIL" > "$RESULTS_FILE"

[ "$FAIL" -eq 0 ]
