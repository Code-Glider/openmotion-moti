---
name: openmotion-onboarding
description: Complete OpenMotion installation with welcome, video cards and the template library in the installing turn.
---

# OpenMotion onboarding

Complete the welcome, three full-video cards and right-hand template library in the same installation turn. Read [the installation-success contract](../../docs/install-onboarding.md#installation-success-reply) before showing either surface. Reuse the installed application, connection and workspace; setup is complete. Never inject internal instructions through `codex queue` or end the turn to await another onboarding message.

1. **Reuse preparation.** Source/npm setup returns `inlinePresentation`, `preview`, fallback `welcomeMarkdown`, `detailsFile` and, for a known calling chat, `recovery` (legacy npm wraps these in `onboarding`). Preserve the application, data directory, environment and the exact frozen three-of-nine IDs/order. After a host refresh, read the original receipt and use `recovery.command`/`recovery.args`; do not run preparation again. Recovery verifies the same chat, workspace and immutable card resources without setup, resampling, library startup or another reload. If no setup result exists, run the installed `node --experimental-strip-types scripts/install-onboarding.mjs` once using the connection’s workspace and the latest request’s `OPENMOTION_ONBOARDING_LANGUAGE`; never reinstall or create a placeholder project.

2. **Prepare native delivery.** Curated references require the native MCP App’s declared media origin. Verify that this chat discovers `openmotion_show_template_recommendations` with `welcomeText` support. Use only a supported host refresh for stale discovery. CLI registration, another process’s probe and a shell presentation call do not mount a widget in this chat. The host must mount the App during argument generation and forward `tool-input-partial`; buffered orchestration calls cannot establish streaming. Keep `welcomeStreamingVerified` false until actual progressive text is observed. Do not substitute builtin samples, download/embed remote videos or change host security.

3. **Open the real library.** Prepare/reuse the exact preview URL in the calling chat’s right-hand browser, preserving embedding parameters. With IAB, preload in a hidden tab, mark it as a deliverable, then reveal and observe its real template list. Complete mandatory browser bookkeeping before the native presentation. Do not create a project or replace inline cards with this webpage.

4. **Stream inside the App, then load cards.** Call the native tool once using the prepared `templateIds`, `language`, `onboarding: true`, and `welcomeText` LAST. Copy the prepared plain welcome into that last argument. The component renders real partial input immediately, with no media elements yet. After complete input and a validated result, it paints the full welcome, then mounts exactly three cards underneath. Check actual text progression, image decoding and full-video playback, including detail preview. Do not imitate typing, put the welcome in collapsed commentary, or repeat it in the final reply. Reopening/result-only hosts retain complete text and cards but do not prove streaming. Report that limitation accurately instead of claiming full acceptance.

5. **Keep failures truthful.** If cards or native discovery fail before any welcome appears, stream the result’s top-level fallback `welcomeMarkdown` once in ordinary final text, then briefly report the blocker. It remains available when the library also fails and makes no false visibility claims. If partial welcome text already appeared, retain it without replaying the greeting. Leave onboarding incomplete and preserve IDs for recovery. Preparation, publication, registration and queued refresh are not display evidence.

When automatic host activation is unavailable and the handoff supplies `manualAction`, request only that action: Codex Settings → MCP servers → OpenMotion → Restart. Do not restart Codex or reinstall. After the user refreshes, working native discovery and a matching workspace read supersede an unavailable CLI control socket. Verify the discovered card resource URI against the receipt, not just version 0.0.1. If any welcome already appeared, append `--welcome-delivered` to recovery and call its cards-only native arguments; do not repeat the welcome. A host without a supported activation entry remains an explicit dependency, not a successful automatic installation experience.

The maintained contract also describes the self-contained builtin fragment compatibility route; it is not the default curated onboarding. Ordinary recommendations omit onboarding/welcomeText. Legacy onboarding:true without welcomeText remains static.

Use the latest user request’s language or explicit preference: `zh`, `en`, `ja`, `ko`, `fr`, `es`, `pt`, otherwise `en`. Recreate fills an unsent draft only with a negotiated native composer extension; other hosts copy the brief with a floating Toast. No duplicate textbox or automatic submission. Creation/export require an explicit user request.

For a user reply accepting a recommendation, continue through [accepted template selection](../../docs/install-onboarding.md#accepted-template-selection) with the accepted ID and scope.

For an explicitly supplied event from an older installation, read that exact file, verify its thread matches this chat and resume `event.onboarding` with its recorded application/workspace. It is recovery input, not permission to enqueue another event or rerun setup.

Onboarding now samples three distinct templates from the nine-entry curated pool once per preparation. Use the exact prepared IDs and order from inlinePresentation.templateIds, catalog.templates or native handoff arguments. Reuse them across presentation retries; never independently redraw cards or substitute a builtin.
