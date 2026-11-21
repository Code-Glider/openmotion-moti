# OpenMotion RTL/BiDi goal loop
Updated 2026-11-21. This is a tracked engineering checklist, not a claim of finished right-to-left editing or export parity.

## Phase 1 — shared text flow (draft PR #1)
- [x] Semantic language/direction metadata for native captions, text previews and guarded font audits.
- [x] Focused test/typecheck/build/regression gate passed: GitHub Actions 44763841098.
- [x] Full independent CI 44763841624 (attempt 2) passed on PR #1's Phase 1 head.
- [ ] Actual preview/MP4 samples on the current integration head reviewed.
- [ ] Final merge decision after acceptance gates.

## Phase 2 — captions (stacked development)
- [x] Guard legacy caption fallback: only split when the timed words match exactly and preserve original Unicode, whitespace and line breaks.
- [x] Replace caption word **measurement** with non-mutating DOM Range geometry; never rewrite text nodes during a layout read (PR #3).
- [x] Refresh overlay boxes when a caption model changes or clears, editing activates, hit geometry resizes, or selectable/editable identity changes. Coverage: captionWordRuns and CaptionOverlay sender tests.
- [x] Bind generated caption groups to exact persisted group IDs during overlay lookup; skipped empty groups no longer shift selectable words onto unrelated DOM nodes. Reject ambiguous duplicate IDs; retain positional lookup for legacy unlabelled compositions.
- [ ] Persist stable authored per-word identities for legacy read-only caption runs where individual transforms are requested.
- [ ] Cover mixed RTL/LTR punctuation, Arabic vowel marks, Hebrew niqqud, seek, scrub, playback, text wrapping and editable word transforms.
- [ ] Round-trip SRT/VTT, native history, per-word timing and imported project resources.

## CI evidence and remaining acceptance risk
- PR #1: focused RTL run 44763841098 and full standalone run 44763841624 passed.
- PR #2: independent non-destructive caption patch; standalone CI 44766340464 passed; overlap with stacked PR #3 needs manual consolidation before merge.
- PR #3: focused RTL CI 44777215170 passed on `b2be5b0`; independent standalone CI 44777215140 failed at Studio regression (2/2), 2 of 5,031 assertions, both sender tests expecting a new RAF while the model-refresh effect had already queued one. The patch retains production coalescing and updates those tests to drain the pending frame; it also adds the sender tests to the dedicated focused RTL gate. Full standalone validation is required again on the new head.
- PR #3 commit `62bc23ef`: focused RTL run 44785036932 passed, while standalone run 44785036943 failed exclusively because the macOS reliability job was cancelled before running. Requested a retry of failed jobs (attempt 2); outcome pending. The group-ID correction below requires a fresh CI pass.
- PR #3 commit `b1bd23881e5fe4d32c59c34777660bf9a078ff4d`: focused RTL run [44796518445](https://github.com/Code-Glider/openmotion-moti/actions/runs/44796518445) **passed**; standalone run [44796518466](https://github.com/Code-Glider/openmotion-moti/actions/runs/44796518466) **passed**, including Windows/macOS and both Studio regression shards. This validates source tests, not real BiDi browser rendering.
- Phase 3 head `b433e1a0a40b50db1174749b3df442283cf84504` passed both dedicated RTL validation [44819332749](https://github.com/Code-Glider/openmotion-moti/actions/runs/44819332749) and full standalone CI [44819332628](https://github.com/Code-Glider/openmotion-moti/actions/runs/44819332628). This iteration adds **authored HTML dir/lang** editing for self-owned text using an existing versioned undoable source patch; revalidate both gates on the new head. Visual mixed-BiDi caret placement remains unqualified.
- JSDOM Range geometry is mocked; BiDi shaping, line wraps, actual Chromium preview and exported MP4 pixel parity remain **unverified**.

## Phase 3 — text editing
- [x] Advanced text inspector now exposes field-scoped LTR/RTL **CSS direction** using the existing undoable per-field source style commit, with no implicit rewrite of logical text alignment or copy. Two focused Studio tests cover no-op selection and multi-field targeting; MVP remains unchanged.
- [x] Add separate semantic HTML `dir` (`inherit`/auto/LTR/RTL) and validated BCP-47 `lang` controls for a **single self-owned text element** in the advanced Studio inspector. The existing undoable source HTML-attribute hook is reused; CSS `direction`, logical alignment and authored Unicode text remain untouched. UI regression covers source patch round-trip, malformed tag rejection, removal, and no writes on no-op.
- [ ] Extend these controls safely to structural child text fields with stable child locators; the parent-only HTML-attribute hook is deliberately **not** offered for child or multiple text fields to prevent misdirected changes.
- [x] Wrapped `End` caret measurement reads complete grapheme clusters (Hebrew niqqud, Arabic/Syriac vowel marks, emoji ZWJ) and refuses interior UTF-16 offsets. Both Phase 3 focused RTL CI [44805786568](https://github.com/Code-Glider/openmotion-moti/actions/runs/44805786568) and independent standalone CI [44805786408](https://github.com/Code-Glider/openmotion-moti/actions/runs/44805786408) passed at `5f9867ef`.
- [x] Correct the visual trailing edge when measuring **unmixed** Hebrew/Arabic/Persian/Urdu/Syriac runs at soft-wrap `End` and formatted-node boundaries. Dedicated RTL CI [44811072963](https://github.com/Code-Glider/openmotion-moti/actions/runs/44811072963) and full standalone CI [44811073043](https://github.com/Code-Glider/openmotion-moti/actions/runs/44811073043) both passed on parent `21a18432`.
- [ ] UAX #9 embedding-level/affinity behavior for mixed scripts, numbers, bidi isolation and CSS overrides remains unverified; the unmixed-run edge correction is deliberately not advertised as full mixed-BiDi caret support.
- [ ] Prove visual caret affinity and selection geometry across mixed BiDi boundaries, wraps and IME in actual Chromium. The limited grapheme fix is **not** full UAX #9 caret behavior.
- [ ] Retain English Studio editing of RTL video and left-to-right media time axis.

## Phase 4 — fonts (stacked draft PR #5)
- [x] Add format-allowlisted Studio prepared-font import (TTF, OTF, WOFF, WOFF2), rejecting missing or unexpected response MIME rather than constructing arbitrary file extensions. Existing server-side font normalization and browser FontFace decoding remain mandatory.
- [x] Add a repository-checked **real WOFF2** Inter fixture regression through fontkit preparation, normalized response, project asset import, local byte copy, CSS path and adjacent pinned license. Frontend tests cover all four prepared MIME variants and reject unsupported types. Add actual Orbitron-vs-Hebrew/Arabic/Syriac glyph-gap checks; missing glyphs are *reported*, not synthesized.
- [x] Previous Phase 4 head `02164ef` passed dedicated RTL CI [44841240422](https://github.com/Code-Glider/openmotion-moti/actions/runs/44841240422) and independent standalone CI [44841240404](https://github.com/Code-Glider/openmotion-moti/actions/runs/44841240404), including Windows/macOS reliability and both Studio regression shards. These are headless/fontkit checks, **not** visual/script shaping qualification.
- [x] Head `cd359260`: real WOFF2 and adjacent-license bytes survive offline project ZIP export and independent reimport; MIME validation rejects inherited object keys (`constructor`, `__proto__`). Dedicated RTL CI [44842304535](https://github.com/Code-Glider/openmotion-moti/actions/runs/44842304535) **passed** and independent standalone CI [44842304617](https://github.com/Code-Glider/openmotion-moti/actions/runs/44842304617) **passed**, including Windows/macOS reliability and both Studio regression shards.
- [x] Sample-based cmap glyph diagnostics for Hebrew, Arabic, Persian-only, Urdu-only, Syriac and Ethiopic/LTR, with combining-mark coverage and format-control exclusions. Previous Phase 4 head `f333b0e2951e194229ef0074db550522fb1c1e74` passed dedicated RTL [44852520953](https://github.com/Code-Glider/openmotion-moti/actions/runs/44852520953) and independent standalone [44852520955](https://github.com/Code-Glider/openmotion-moti/actions/runs/44852520955) on 2026-11-21. Coverage is sample-based cmap evidence only; not a shaping or rendering certificate.
- [x] Share the same codepoint-glyph requirement between offline font audit and catalog-pinned font specimens. Ignore Unicode default-ignorable codepoints (including variation selectors, BiDi controls and joiners) while preserving Hebrew niqqud/Arabic and Syriac mark checks. Add actual-pinned-font specimen and audit regressions and bring specimen tests into focused RTL CI.
- [x] Head `def6ddab` passed dedicated RTL [44856884128](https://github.com/Code-Glider/openmotion-moti/actions/runs/44856884128) and independent standalone [44856884016](https://github.com/Code-Glider/openmotion-moti/actions/runs/44856884016), both completed successfully on 2026-11-21.
- [x] Add per-script fontkit glyph-run diagnostics to offline audit: emitted glyph count, .notdef glyph count, observable positional offsets, and explicit layout errors alongside cmap coverage. Synthetic and real Orbitron-font tests distinguish Unicode coverage from missing glyphs in shaped output. These counts are **evidence, not contextual shaping/mark-positioning certification**.
- [x] Head `7ac48e78` passed dedicated RTL [44862518788](https://github.com/Code-Glider/openmotion-moti/actions/runs/44862518788) and independent standalone [44862518798](https://github.com/Code-Glider/openmotion-moti/actions/runs/44862518798), including Windows/macOS jobs and both Studio regression shards, on 2026-11-21.
- [x] Add an **opt-in fail-closed cmap probe gate** to the offline font auditor: `--require-scripts he,ar,fa,ur,syr,am,en` supports comma-separated required samples and rejects unknown locales and missing glyph coverage, while still emitting complete JSON diagnostics. New programmatic and CLI regressions show Latin-only Orbitron passes `en` and fails Hebrew, Arabic and Syriac. This is only eligibility screening, **not** shaping certification.
- [x] Head `ef6bbd7`: dedicated RTL validation [44869254920](https://github.com/Code-Glider/openmotion-moti/actions/runs/44869254920) and independent standalone CI [44869254947](https://github.com/Code-Glider/openmotion-moti/actions/runs/44869254947) **passed** on 2026-11-21.
- [x] Add opt-in `--require-layout-scripts` combining cmap eligibility with nonempty, error-free fontkit runs without `.notdef`. Explicit OpenType script tags (`hebr`, `arab`, `syrc`, `ethi`, `latn`) plus direction prevent accidental auto-detection in diagnostics. Existing `--require-scripts` remains cmap-only. Real-font/synthetic failure and CLI tests included.
- [x] Head `89fbac0`: dedicated RTL validation [44872205418](https://github.com/Code-Glider/openmotion-moti/actions/runs/44872205418) and independent standalone CI [44872205372](https://github.com/Code-Glider/openmotion-moti/actions/runs/44872205372) **passed**. A clean fontkit run still does **not** certify localized forms, contextual joining, mark positioning, Chromium fallback or MP4 parity.
- [x] Audit probes now explicitly pass OpenType **language-system tags** (`ARA `, `FAR `, `URD `, `IWR `, `SYR `, `AMH `, `ENG `) alongside script and direction. Arabic, Persian, and Urdu share `arab` but must not silently share the same language-dependent GSUB/GPOS selections. Synthetic argument-capture tests and real-font output metadata regression cover tag forwarding; this is diagnostic setup, **not** a rendering certificate.
- [ ] Revalidate dedicated RTL and independent standalone CI on the language-tag head. No actual Semitic font preview/MP4 evidence yet. Do not merge.
- [ ] Verified and license-pinned Hebrew/Arabic/Persian/Urdu/Syriac fonts and fallback coverage; current Inter/Orbitron fixtures do not cover Semitic scripts.
- [ ] Real shaping/mark-position screenshots and complete TTF, OTF, WOFF, WOFF2 and variable font import/export on the five target scripts.
- [ ] Offline project ZIP and deterministic render verification against supplied fonts and licenses.

## Phase 5 — RTL Studio UI (separate draft branch)
- [x] First opt-in, independently persisted RTL **project navigation** direction setting in the existing language menu. Do not infer it from video text or the Studio interface language. Only the navigation aside gets `dir=rtl`; project names use `bdi dir=auto` and search chooses direction automatically. Timeline, preview and root direction are untouched.
- [x] Regression tests cover preference persistence, storage synchronization, inaccessible-storage fallback, locale independence, unchanged authored input/iframe identity and root direction. Dedicated RTL CI now runs the test; current-head verification pending.
- [ ] Hebrew/Arabic translations, comprehensive vocabulary, full UI logical layout, menu accessibility and responsive visual evidence. Existing locales have strict complete-dictionary test coverage; do not register partial translations as supported languages.
- [ ] Verify transport controls, charts, numeric data, dock panels and media time behavior in real Chromium; this navigation-only control is not full RTL UI.

## Phase 6 — cross-platform release gate
- [ ] Chromium preview vs decoded MP4 pixel/geometry parity with pinned scripts and fonts on Windows, macOS and Linux.
- [ ] Real mixed-script cases, legacy/LTR compatibility, regressions and security/license review.
- [ ] No completion claim, promotion or merge until documented evidence covers all required workflows.

## Process
Use SHA-checked GitHub writes, independent small PRs, real CI and actual browser/video evidence. Do not fix failures by hiding assertions or silently editing main.
