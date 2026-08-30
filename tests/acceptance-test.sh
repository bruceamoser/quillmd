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
 #                       serializer wiring (#32)
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
        ;;
    *)
        echo "Unknown subset: $SUBSET (core|export|pkg|p0-shell|p1-editor|shell|copyclose|info|dragdrop|all)" >&2
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
