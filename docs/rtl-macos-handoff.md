# RTL/BiDi development handoff — Apple Silicon macOS

Prepared 2026-11-25 for https://github.com/Code-Glider/openmotion-moti. This handoff is for *source development*, not a signed app or DMG.

## Live branch snapshot (requery before changes)

- Consolidated working branch: fix/rtl-inspector-prop-echo-blur-commit, SHA 57453d7652c4be3e4e8c1e3efc0a4106850279e8, draft PR #47.
- Experimental parity branch: test/rtl-native-caption-exact-history-temporal-parity, SHA 518e9d9985fb0b1708e320622768516fab7a3098, draft PR #62.
- Protected Phase 4: feat/rtl-bidi-phase4-font-portability, SHA e408bf0e95600cf6e4807cd6a5603946be0fd8b8, draft PR #5.
- Main: c6816041ae6486fee361f880f660b8941c086949, unchanged by this handoff.

PR #62 has an **actual failing test**, not a qualification pass: dedicated RTL run https://github.com/Code-Glider/openmotion-moti/actions/runs/45670777439 failed Windows and Linux at "Second Undo failed to restore exact original native project source bytes"; macOS producer was cancelled and cross-OS reducer failed. Standalone https://github.com/Code-Glider/openmotion-moti/actions/runs/45670777449 passed. Preserve and diagnose the second-Undo failure instead of deleting the assertion.

## Clone with complete Git ancestry

The fork has stacked PRs and two-parent history. Do not shallow-clone or use --single-branch. Optional large movies use Git LFS; skip media downloads initially without changing global Git configuration.

~~~bash
mkdir -p ~/Developer
cd ~/Developer
GIT_LFS_SKIP_SMUDGE=1 git -c filter.lfs.process= -c filter.lfs.smudge= \
  -c filter.lfs.required=false clone https://github.com/Code-Glider/openmotion-moti.git
cd openmotion-moti
git fetch origin --prune
git switch --track origin/fix/rtl-inspector-prop-echo-blur-commit
git status --short --branch
git log -1 --format='%H %s'
~~~

Use a separate worktree for the currently failing PR #62 rather than replacing the working branch:

~~~bash
git fetch origin --prune
git worktree add -b macos/rtl-pr62-review ../openmotion-rtl-pr62 \
  origin/test/rtl-native-caption-exact-history-temporal-parity
git worktree list
~~~

Inspect existing local branches and worktrees before reusing a name. The handoff guide/script reside on the handoff/rtl-macos-continuation branch. It may be checked out in a third worktree, leaving project worktrees intact.

## Prerequisites

Source README and CI pin Node 26.11.1 (package minimum Node >=22.18), npm, Git, Xcode Command Line Tools, Homebrew, Google Chrome, FFmpeg and FFprobe. Complete font conversion also uses Python 3.13, fonttools==4.59.0 and Brotli==1.1.0.

~~~bash
xcode-select -p
node --version
npm --version
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
ffmpeg -version | head -n 1
ffprobe -version | head -n 1
~~~

Use your Node version manager to select 26.11.1. If Homebrew ffmpeg@8 is already installed but not on PATH, set PATH to its bin directory without overwriting another installation:

~~~bash
export PATH="$(brew --prefix ffmpeg@8)/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=6144"
export HYPERFRAMES_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export HYPERFRAMES_FFMPEG_PATH="$(command -v ffmpeg)"
export HYPERFRAMES_FFPROBE_PATH="$(command -v ffprobe)"
bash scripts/rtl-macos-preflight.sh
~~~

This read-only preflight reports tools, branch, origin and local changes; it does not qualify the app or alter user projects.

## Install and test incrementally

From the chosen checkout (prefer the separate PR #62 worktree when reproducing its failure):

~~~bash
npm ci --no-audit --no-fund
npm run typecheck:studio
npx vitest run --config studio/vitest.config.ts \
  studio/src/captions/distinctGestureHistory.test.ts \
  studio/src/captions/hooks/nativeGestureHistorySource.test.tsx \
  studio/src/captions/hooks/nativeSourceSync.test.tsx
npm run build:studio
npm run build:tracking
~~~

The real test creates *ephemeral fixture projects* and requires network access for immutable licensed font bytes. Retain the entire evidence directory after a failure:

~~~bash
FONT_DIR="$(mktemp -d -t openmotion-rtl-fonts)"
EVIDENCE_DIR="$(mktemp -d -t openmotion-rtl-evidence)"
node scripts/rtl-reference-fonts.mjs "$FONT_DIR"
node --experimental-strip-types tests/rtl-studio-managed-caption-browser.mjs \
  "$EVIDENCE_DIR" "$FONT_DIR"
echo "Retained evidence: $EVIDENCE_DIR"
~~~

Review result.json, native HTML revision receipts, preserved Unicode/word IDs, font/license SHA-256 values, offline ZIP bytes, Chromium screenshots, decoded H.264 frames and actual browser/MP4 geometry. A single local run does not replace the CI three-OS matrix. For normal Studio use after build: npm start, then open the printed studioUrl; source checkout alone does not register an MCP with Codex. See docs/install.md.

## Priority once on the Mac

1. Reproduce the PR #62 two-drag / second-Undo exact-native-source mismatch. Capture initial, first-drag, second-drag, Undo1, Undo2, Redo1, Redo2 HTML bytes plus guarded ETag/version receipts. Determine if this is a legitimate canonicalization difference, a neutral wrapper, or a lost edit. Fix underlying semantics; do not suppress or relax evidence without an independently justified canonical invariant and regression.
2. Finish real Studio move/scale/rotation/animation through separate undo history, saved native source, offline ZIP reimport, and decoded MP4 parity at entrance, active and exit times (not just static samples).
3. Finish mixed UAX #9 visual caret/selection and physical macOS IME acceptance, retaining logical Unicode.
4. Qualify licensed TTF/OTF/WOFF/WOFF2 GSUB/GPOS shaping for Hebrew/Arabic/Persian/Urdu/Syriac, while preserving English and Ethiopic.
5. Complete SRT/VTT/native caption interchange, optional Hebrew/Arabic Studio UI localization, a11y/responsive/mobile, old-project compatibility and final independent three-OS release qualification.

Use docs/rtl-roadmap.md and docs/rtl-execution-queue.md as the complete ledger. Always recheck GitHub refs before merging. No force pushes, destructive resets, unqualified Phase 4 promotion, main merges or deletion of license/source assets. Previous macOS-specific work was deferred; local Mac testing now does not retroactively waive cancelled jobs. Keep all original CI gates until the final release PR is fully qualified.

## Local agent continuation prompt

Read docs/rtl-macos-handoff.md, docs/rtl-execution-queue.md and latest docs/rtl-roadmap.md. Requery live PR #62, working branch and CI refs. Reproduce the Windows/Linux second-Undo exact-native-source failure locally in real Chromium/Studio; inspect raw HTML/ETag receipts, apply the smallest evidenced source/history fix, add adversarial tests, then rerun local source/unit/build and native ZIP/decoded MP4 checks. Preserve existing user projects, Unicode, font licensing, exact Git history and mandatory CI. Publish only a reviewable PR, never main. Document failures and evidence honestly.
