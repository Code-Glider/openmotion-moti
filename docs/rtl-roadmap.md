# OpenMotion RTL/BiDi goal loop
Updated 2026-11-20. This is a tracked engineering checklist, not a claim of finished right-to-left editing or export parity.

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
- JSDOM Range geometry is mocked; BiDi shaping, line wraps, actual Chromium preview and exported MP4 pixel parity remain **unverified**.

## Phase 3 — text editing
- [ ] Editable dir/lang inspector controls, logical alignment and source persistence.
- [ ] Correct visual caret and selection geometry across BiDi boundaries, line wraps, IME and grapheme clusters.
- [ ] Retain English Studio editing of RTL video and left-to-right media time axis.

## Phase 4 — fonts
- [ ] Verified and license-pinned Hebrew/Arabic/Persian/Urdu/Syriac fonts and fallback coverage.
- [ ] Real shaping/mark-position screenshots and TTF, OTF, WOFF, WOFF2 and variable font import/export.
- [ ] Offline project ZIP and deterministic render verification.

## Phase 5 — RTL Studio UI
- [ ] Hebrew/Arabic interface locale, logical layout, accessibility and responsive verification.
- [ ] Preserve transport controls, charts, numeric data and media time behavior.

## Phase 6 — cross-platform release gate
- [ ] Chromium preview vs decoded MP4 pixel/geometry parity with pinned scripts and fonts on Windows, macOS and Linux.
- [ ] Real mixed-script cases, legacy/LTR compatibility, regressions and security/license review.
- [ ] No completion claim, promotion or merge until documented evidence covers all required workflows.

## Process
Use SHA-checked GitHub writes, independent small PRs, real CI and actual browser/video evidence. Do not fix failures by hiding assertions or silently editing main.
