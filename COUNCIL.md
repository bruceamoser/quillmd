# QuillMD Council

Five-lens software review council, modeled on the Heroes of Legend council. Every change to the spec, architecture, or codebase passes the relevant lenses before merge.

## Members

| Lens | Role | What it audits |
|---|---|---|
| **Systems Architect** | Architecture & data model | Tech stack, markdown round-trip fidelity, complexity budget, cross-module consistency, storage model |
| **UX/Product Designer** | User experience & editor behavior | WYSIWYG feel, discoverability of markdown features, keyboard/editing ergonomics, UI voice and consistency |
| **Engineering Lead** | Code quality & completeness | Build, tests, standards compliance, completeness vs spec, dead code, dependency hygiene, security basics |
| **Contrarian** | Devil's advocate | Edge cases, data-loss scenarios, undo/redo corruption, cross-platform path/encoding traps, "what breaks if a user does X?" |
| **Cross-Platform/QA** | Windows + Linux compatibility | Packaging, file handling on both OSes, CI matrix, rendering parity, install/update paths |

## Workflow

1. **Review rounds** — on demand and at milestones. The council reviews the current artifact (spec, then code as it lands).
2. **Findings format:** `[file:line] SEVERITY — what — fix`
3. **Triage:**
   - **Mechanical** (typos, formatting, dead code, small fixes) → fix in-loop, no approval round.
   - **Design-flavored** (architecture, UX, feature scope) → present to Bruce with a recommended default; silence = proceed, flagged revertible. One decision at a time.
   - **Contrarian findings on data-loss paths** get special weight — never merged without explicit resolution.
4. **Implement-don't-report law:** every review round ships a delta (PR merged, fix landed, spec updated). Reports document what CHANGED, never intentions.
5. **Round log:** each round's findings and resolutions are appended to `docs/council-rounds.md`.

## Relationship to pipeline

- All code changes: issue → branch → opencode implementation → PR → council audit → Bruce veto on design-flavored items → squash merge.
- Spec changes: council review round → Bruce approval → spec.md updated.
