# OpenMotion RTL/BiDi goal loop
Updated 2026-11-20. This is a tracked engineering checklist, not a claim of finished right-to-left editing or export parity.

## Phase 1 — shared text flow (draft PR #1)
- [x] Semantic language/direction metadata for native captions, text previews and guarded font audits.
- [x] Focused test/typecheck/build/regression gate passed: GitHub Actions 44763841098.
- [ ] Full independent CI and actual preview/MP4 samples on current integration head reviewed.
- [ ] Final merge decision after acceptance gates.

## Phase 2 — captions (stacked development)
- [x] Guard legacy caption fallback: only split when the timed words match exactly and preserve original Unicode, whitespace and line breaks.
- [ ] Eliminate all preview-time DOM rewriting using stable authored word identities and non-mutating measurement.
- [ ] Cover mixed RTL/LTR punctuation, Arabic vowel marks, Hebrew niqqud, seek, scrub, playback, text wrapping and editable word transforms.
- [ ] Round-trip SRT/VTT, native history, per-word timing and imported project resources.

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
