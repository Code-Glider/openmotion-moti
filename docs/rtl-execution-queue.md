# OpenMotion RTL/BiDi — resumable execution queue

Last synchronized: 2026-11-24. This is an **execution contract**, not a claim of qualification or release readiness. Always refresh live GitHub state before using the historical references below.

## Policy / non-negotiable gates

- Work on `Code-Glider/openmotion-moti` only; leave `main` unchanged until every release requirement and the final independent evidence matrix pass.
- Keep existing main CI, RTL CI, standalone CI and all Windows/macOS/Linux assertions. No removed tests, relaxed thresholds, fabricated artifacts, force pushes or history destruction.
- **Temporary macOS deferral:** no macOS-specific implementation, runner repair, reruns, artifact retrieval or macOS-centric diagnosis now. Record as **DEFERRED — NOT PASSED**. Continue Windows/Linux and OS-agnostic development on isolated or stacked draft PRs. Do not integrate to Phase 4 without the original full three-OS gates; defer that integration when macOS is unavailable. Re-enable macOS qualification before the final release PR can be qualified.
- A green CI status alone is not acceptance. Inspect actual screenshot pixels, decoded MP4 frames, ZIP bytes, original/font/license hashes, logical Unicode and genuine interaction receipts.
- Preserve authored HTML DOM/Unicode, legacy projects and import/export semantics; do not reverse media timelines, charts, playback controls or transport direction.
- Every development iteration must either implement and test one bounded change or explain an external blocker requiring action; no CI-only monitoring iteration. Keep a resumable evidence ledger in `docs/rtl-roadmap.md` and maintain this queue.
- Completion notification is issued **once**, only after fully qualified final acceptance, and the ongoing automation is disabled only then.

## Resume point and dependency queue

Open PRs observed 2026-11-24: #1, #3, #4, #5, #47, #54, #55, #56, #57, #58, #59 (11 total). The historical #2 caption PR was closed but its expectations must remain reconciled against #3; #7 was merged into the feature-branch stack. Requery before selecting work.

1. **Existing #59** — serialized sidecar/native caption-save transactions: validate changed model ownership, ETag ACK, native HTML, ordered drag/undo/redo. Latest observed head `88694da598cf72b87fb980ca9cb92d72ff60250b`, base `feat/rtl-native-caption-source-roundtrip` at `f576432fa15cc030545ac6f29947c9a6c2caa2e8`. These are referents, not perpetual locks.
2. **Existing #56** — distinct undo step per completed pointer gesture, reconciled with #59 save serialisation; retain cancellation/return-to-origin expectations from #55. Do not duplicate.
3. **Existing #47/#54/#55/#57/#58** — integrate source/inspector safety, independently validated native write ACKs, interrupted pointer cancellation, trusted Chromium movement and managed native-caption source round-trip on the *stacked draft chain* with no Phase 4 promotion absent macOS. Preserve independent histories/PRs.
4. **Existing phase PRs #1/#3/#4/#5** — audit all inherited work, #2/#3 overlap, maintain exact acceptance gaps; no unrelated merge to main.
5. **Package A — Native caption persistence**: all he/ar/fa/ur/syr Unicode, stable word IDs, source writes, ETags, separate undo/redo transactions, native reload and archived project bytes.
6. **Package B — Studio pointer gestures**: trusted Chromium drag/scale/rotate/cancel, multi-pointer ownership, stale selection defense, exact word identity, timeline and transformed source replay, offline reimport.
7. **Package C — Animated preview/MP4 parity**: independent actual decoded MP4 frames and Chromium screenshots at multiple seek/playback times; static/animated glyph geometry and hidden-caption ink thresholds, unchanged siblings.
8. **Package D — UAX #9 caret and selection**: mixed RTL/LTR runs, neutral punctuation, visual affinity, wraps, Home/End and Shift navigation, bidi isolation, grapheme-safe boundaries.
9. **Package E — IME**: compositionstart/update/end, cancellation, replacements, history, selection, physical OS input evidence distinguished from simulated browser events.
10. **Package F — Subtitle interoperability**: SRT, WebVTT and native format import/export/reimport and loss semantics; languages he/ar/fa/ur/syr/am/en, diacritics, punctuation and timing.
11. **Package G — Fonts/shaping**: licensed real TTF/OTF/WOFF/WOFF2, GSUB/GPOS joining/marks/ligatures and language coverage; browser, native H.264 and offline ZIP byte provenance; retain English/Ethiopic.
12. **Package H — Hebrew Studio UI locale**: complete opt-in dictionary, isolation, responsive/mobile, accessibility and untranslated-string coverage.
13. **Package I — Arabic Studio UI locale**: same isolated architecture with Arabic strings/formatting/plurals and no timeline reversal.
14. **Package J — Backward compatibility**: legacy LTR/Ethiopic golden projects, undo/export/import semantics, no destructive migrations.
15. **Package K — Independent qualification harness**: cross-platform native project, font, ZIP, screenshot and decoded MP4 audit; adversarial negative cases; exact SHA/commit artifact matrix; fail closed.
16. **Package L — Final release-qualification PR**: all inherited and added requirements across Windows, Linux AND macOS, full acceptance documentation and inspected evidence, reviewable code, required checks green. No main merge until qualified.

## Iteration procedure

1. Read this queue, `docs/rtl-roadmap.md`, all current PR statuses and exact base/head/blob SHAs.
2. Inspect current relevant Windows/Linux failing job logs before changing code. Do not rerun obsolete or cancelled macOS lanes while deferral is active.
3. Choose the first unblocked dependency. Reuse existing PR and branch; for independent work create a small stacked draft PR. Keep exact SHA leases and avoid overlapping edits.
4. Implement source + adversarial regression, run fast deterministic checks and required CI. Examine real Linux/Windows Studio edits and current-run artifacts including fonts/licenses, ZIP, decoded MP4 and browser screenshots.
5. Classify results as PASSED / FAILED / DEFERRED / NOT RUN, with no inference from earlier heads. Record actual SHA, job URLs, artifact hashes and next task in the roadmap.
6. Integrate only into the intended feature base if *all original required checks* (including macOS) and evidence pass. Otherwise keep draft and advance the next ready isolated or stacked development task.
7. Repeat autonomously until the final fully qualified PR; then disable the existing automation and send exactly one completion notification.

## Acceptance ledger schema

For each work item record `id, dependency_ids, pr_url, head_sha, base_sha, changed_blob_shas, test_commit_sha, windows_state, linux_state, macos_state=DEFERRED|PASS|FAIL, standalone_state, rtl_state, evidence_artifact_urls, inspected_hashes, acceptance_gaps, next_action`. Never report a missing evidence item as passed.
