# Council Rounds — QuillMD

Living log of council review rounds, findings, and resolutions. Every round ships a delta.

---

## Round 1 — 2026-08-16 (spec v0.1 → v0.2)

**Scope:** full spec review, five lenses, parallel audit agents (3 + 2 waves).

**Findings:** 64 total — Systems Architect 12, UX/Product Designer 12, Engineering Lead 12, Contrarian 16, Cross-Platform/QA 12.

### Systems Architect (12)
| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Byte-identical round-trip cannot ride on PM serializer — PM normalizes emphasis, lists, ref links, HTML | DESIGN | Clean-path save pipeline: hash on load, verbatim write when unmodified; block-granular re-serialization (§2.1.4) |
| 2 | Inline HTML / reference defs / footnotes / def lists / sub-sup-highlight lack PM node representation | DESIGN | Opaque verbatim leaf nodes; enumerate schema per feature; phasing (CommonMark core first) (§2.1.3, §6.2) |
| 3 | Undo contradiction: §2.1.6 (md-text) vs §6.3 (PM doc-level); two surfaces two stacks | DESIGN | Unified markdown-text undo shared across surfaces (§2.1.6, §6.3) |
| 4 | Front matter verbatim vs structured editing conflict | DESIGN | Byte-splice edits: only the edited field changes, rest verbatim (§2.1.3, §5.11) |
| 5 | No clean-path mechanism specified | MECH | Hash-on-load + verbatim write implemented as the core save path (§2.1.4) |
| 6 | Three writers race (autosave, watch, recovery) with no arbitration | DESIGN | Conflict state machine: hash-compare-before-write, pause on external change, never auto-overwrite (§2.3.3/2.3.6) |
| 7 | Pandoc dual-mode version skew + undecided PDF engine | DESIGN | Pin one bundled Pandoc; Typst for PDF, no LaTeX (§2.5.8, §6.6) |
| 8 | Split-mode cursor mapping undefined | DESIGN | Block-level mapping with documented fidelity budget (§2.2.3) |
| 9 | Normalization exceptions in test file = wrong place | DESIGN | Versioned council-reviewed normalization manifest (§2.1.4, §5.1) |
| 10 | No atomic-write guarantee | MECH | Temp + fsync + atomic rename in Rust fs layer (§2.3.3) |
| 11 | Linux WebKitGTK risk + no fallback trigger | MECH | WebKitGTK bundling check; fallback trigger = 2 blocked release milestones (§7, §6.1) |
| 12 | No performance envelope / large-file strategy | DESIGN | 1MB/~10k-line envelope; block-granular incremental parse; large-file fixture (§2.4.5, §5.20) |

### UX/Product Designer (12)
| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | No insert path for tables/code/footnotes/images (can't type blind) | DESIGN | Toolbar + slash-command + insert menu (§2.1.5) |
| 2 | No selection-based formatting; no keyboard map | DESIGN | Ctrl+B/I/K etc.; full keyboard map (§2.1.5, §2.6) |
| 3 | No exit/escape for embedded blocks | DESIGN | Per-block exit keys: ArrowDown, closing backtick, Escape (§2.1.5) |
| 4 | Link/image editing UX absent | DESIGN | Click-to-edit link tooltip; image properties (§2.1.5) |
| 5 | No discoverability (cheatsheet/onboarding) | DESIGN | In-app cheatsheet + first-run empty-state hints (§2.1.5, §2.6) |
| 6 | Undo granularity unspecified | DESIGN | Action-grouped coalescing; one user action = one step (§2.1.6, §5.5) |
| 7 | WYSIWYG vs Preview confusion | DESIGN | Explicit edit chrome + mode labeling in status bar (§2.2) |
| 8 | 'Merge' prompt invites non-existent merge UI | DESIGN | v1 prompt = reload / keep mine / save-as; merge deferred (§2.3.6, §4) |
| 9 | Typing conventions inconsistent with feature list | MECH | 1:1 shortcut set incl. ordered/task lists, HR, footnotes (§2.1.5) |
| 10 | Source mode ambiguity vs Split | MECH | Source = full-window + Ctrl+/; Split = separate mode (§2.2) |
| 11 | Alt-Enter hard-break ambiguity + Win collision | MECH | Shift+Enter = hard break; Alt+Enter reserved (§2.1.5) |
| 12 | No mode-switch shortcut / persistence | MECH | Ctrl+/ or F12; remember last mode per file (§2.2.5) |

### Engineering Lead (12)
| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | §5.2 cross-ref wrong (§2.1.2 vs §2.1.3) | MECH | Repointed |
| 2 | 'Renders correctly' unmeasurable | MECH | Golden DOM/screenshot snapshots per fixture, CI-diffed (§5.2) |
| 3 | §5.12 'matches model state' no oracle | MECH | Reference-serializer/AST oracle; byte-vs-AST semantics (§5.12) |
| 4 | 'Semantically equivalent' escape hatches in DOCX tests | MECH | Shared AST comparator modulo manifest (§5.14/5.17) |
| 5 | Exception list in test file = author defines pass | MECH | Versioned council-reviewed fixture manifest (§5.1) |
| 6 | No test infrastructure section | DESIGN | Test infra: CI matrix, GUI driver, fixture corpus (§5 header, §3, §7) |
| 7 | 'Kill process mid-edit' not CI-runnable | MECH | Crash-injection hook + GUI automation (§5.8) |
| 8 | Front matter byte-identity contradiction | DESIGN | Byte-splice structured editor (§2.1.3, §5.11) |
| 9 | 'Merge' option = scope creep | DESIGN | Deferred; reload/keep/save-as only (§2.3.6) |
| 10 | 18 criteria cover half the features | MECH | Expanded to 20 criteria incl. modes, F&R, outline, packaging, large file (§5) |
| 11 | 'Passes core test suite' circular | MECH | Core subset defined = §5.1–5.12 headless (§5.10) |
| 12 | §5.5 parse-failure criterion vacuous under doc-level undo | MECH | Assert markdown BYTES after each undo; idempotence gate (§5.5) |

### Contrarian (16) — data-loss focus, special weight
| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Undo past autosave loses text (re-based history) | MECH | Never-rebased md-text undo; §5.5 asserts pre-save bytes restorable |
| 2 | Save during external rename/change corrupts/orphans | MECH | Hash-compare-before-write; temp+rename; .bak before overwrite |
| 3 | Non-atomic save truncates source of truth on crash | MECH | Temp → fsync → atomic replace; recovery on parse-fail; 10MB kill test |
| 4 | BOM+CRLF+emoji combined breaks preservation | MECH | Detect-once EOL policy; UTF-16 refuse+convert; combined fixture |
| 5 | Serializer silently mutates un-normalizable constructs | MECH | Opaque verbatim leaves; manifest; dirty-parse → raw write |
| 6 | 'Never lose data' false with autosave OFF | DESIGN | Always-on snapshot cadence decoupled from autosave (§6.7) — Bruce confirmed |
| 7 | Regex F&R can corrupt structure | MECH | F&R on md text w/ preview; excludes code/link URLs; re-validate |
| 8 | Source-mode edits invisible to doc-level undo | MECH | Source edits append md-text undo entries; toggles don't inject |
| 9 | DOCX import has no .md path — Save writes MD into .docx | MECH | Import forces Save-As to .md before editable (§2.5.5) |
| 10 | External file deletion undefined | MECH | Distinct prompted event; never auto-create; confirm on close |
| 11 | Windows path traps (CON/NUL, >260, WTF-8) | MECH | Rust-layer OsStr fs ops; reject reserved names; fixtures |
| 12 | §5.5 vacuous (parsers don't throw) | MECH | Idempotence + byte-equality gate |
| 13 | Task-list toggle re-serializes whole list | MECH | Byte-range splice of checkbox chars; nested fixture |
| 14 | Export dialogs can clobber open .md | MECH | Export target never = open path; temp-first; extension filter |
| 15 | Save reentrancy drops concurrent edits | MECH | Dirty flag loop-until-clean; serialized saves |
| 16 | Recovery snapshot lifecycle undefined | DESIGN | Sidecar association + cleanup-on-save (§2.3.3) |

### Cross-Platform/QA (12)
| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | acceptance-test.sh missing; .sh Unix-only | MECH | Scaffold now; Git Bash on Windows runners; .gitattributes eol=lf |
| 2 | No GUI test driver named | MECH | Tauri v2 WebDriver / Playwright WebDriver; per-OS kill mechanics |
| 3 | CI matrix asserted, not defined | MECH | windows-2022/2025 + ubuntu-24.04; xvfb-run; WebView2 bootstrapper; pinned pandoc |
| 4 | No packaging/installer section | DESIGN | Packaging criterion (§5.19): fresh-VM install+launch; signing/arch pending Bruce |
| 5 | Non-UTF-8 files undefined | DESIGN | Detect → offer conversion, never silent write-back (§2.3.4) — Bruce confirmed |
| 6 | Mixed-ending files ambiguous | MECH | Dominant-EOL policy + manifest entry + fixture (§2.3.5) |
| 7 | No path-separator requirement | MECH | Forward slashes in markdown; Tauri path API; Windows-path fixture |
| 8 | Fixtures not byte-stable across platforms | MECH | .gitattributes pin fixture eol/BOM; CI hash-drift check |
| 9 | No font/rendering parity requirement | DESIGN | Platform font stacks + fallbacks; baseline screenshot tests (deferred detail) |
| 10 | Conversion backend unpinned for tests | MECH | Pin pandoc in CI both legs; lock Typst before §5.13 |
| 11 | File-watch nondeterministic in CI | MECH | App-independent writer process; FILE_SHARE_READ\|WRITE\|DELETE |
| 12 | Win10 EOL + no arch matrix | DESIGN | Win10/11 target confirmed; x64 both, arm64 deferred |

### Decisions taken to Bruce (one at a time)
1. **Tech stack** — CONFIRMED: Tauri 2 + TS/React + ProseMirror (TipTap) + unified, with clean-path save pipeline.
2. **Data-loss posture** — CONFIRMED: always-on snapshot cadence (every ~2s of change), autosave default OFF.

### Net delta (round 1)
- spec.md v0.1 → v0.2 (rewritten; clean-path guarantee, unified undo, manifest, atomic writes, keyboard map, insert affordances, test infra, packaging, performance envelope).
- docs/council-rounds.md created.
- Repo: 2 commits (spec update + this log).

### Open for Bruce (deferred, not blocking)
- Packaging targets + code signing scope (needed before first release, not before first PR).
- Font stack parity detail (baseline screenshot tests).
- Normalization manifest initial entries (frozen before fixture corpus — council + Bruce sign-off).

---

*Next round: after first implementation PR.*
