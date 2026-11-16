# Shared installation onboarding

Used by source installation, plugin setup and legacy installed applications.

<!-- installation-onboarding:start -->
## Installation-success reply

Every successful Agent-led OpenMotion installation opens the editor's template library in the current conversation. Do not ask whether to experience a recommended template or wait for a yes/no reply before opening the library. Respect an explicit request not to open it, or a previous refusal/deferment. If the user already explicitly requested creation with an exact template, continue that authorized task directly.

For Codex, complete the persistent welcome, three full-video cards and visible right-hand library in the same installation turn. Installation is one user request, including onboarding. Use the supported inline renderer or an already working native presentation tool. `host_action_required` and `refresh_requested` remain incomplete when neither presentation route works, even if CLI setup exits zero and the library works. Report the concrete host limitation and preserve this installation for recovery.

### Codex inline document presentation without host hot reload

Source setup and retained legacy npm setup return the prepared result directly to the installing Agent. Continue delivery in that turn; never inject internal instructions as a user message through `codex queue` or end early to await a follow-up. Plain `codex plugin add` still depends on the desktop invoking its packaged setup Skill. A standalone CLI without a renderer reports installed files and the real library link, without claiming visible onboarding.

Source setup, npm setup and the desktop plugin setup Skill use the same default `prepareInstallationFlow`. Codex setup prepares a verified welcome/cards fragment under the selected data directory's `onboarding/` folder without user presentation flags. `--onboarding-output` is an optional npm path override for hosts that need a particular readable artifact directory. The plugin Skill invokes `node --experimental-strip-types scripts/install-onboarding.mjs` from the installed root only when no setup result was provided; it preserves the connection's workspace and never reinstalls. Use this fragment only when the actual host supports inline HTML references; preparing a file does not add that capability or trigger a host callback. It does not reload, restart or alter host security settings.

Setup returns `onboarding.inlinePresentation` with the prepared path/hash and `publicationRequired: true`, not a visualization reference to its runtime/data path. Deliver the two surfaces together:

1. **Prepare before showing.** Read required instructions, resolve the host route and finish installation checks before opening the visible library. Card preparation and the headless library startup run in parallel. Initialize the browser and inspect this chat's tabs now, while preparation runs; retain a matching library tab if present. For inline delivery, publish with `node scripts/inline-onboarding.mjs --publish-from PATH --sha256 SHA256 --host-directory DIRECTORY` using this chat's explicitly permitted visualization directory. Keep the returned `contentReference` ready. The publisher verifies the hash and copies identical bytes without overwriting another document; runtime write permission alone does not prove chat read access.
2. **Present at the end.** Use the direct IAB route below when available, with the exact `preview.previewUrl`. Its returned initial page state is the visibility/content check when it already contains the loaded template library; do not request another AX snapshot or screenshot of that same state. Complete any mandatory browser-tool completion bookkeeping next, then immediately emit the ready `contentReference` as the final reply, or call the already discovered native presentation tool once. Keep file reads, publication, probes and unrelated investigation out of this interval. The welcome and three cards belong to that presentation; add no separate success message or trailing status reply.

This minimizes the gap between the library and chat content. The host owns their rendering and does not expose an atomic two-surface display operation; do not claim exact simultaneous rendering. Preserve the production component and full videos, use only one presentation route, and distinguish prepared/published content from actual display.

The inline document context has no negotiated composer extension, so Recreate uses the production component's existing selectable brief fallback. It does not send a task. The user copies/edits and submits the brief before creation. Continue operations through this installation's `directAccess`, including its selected profile environment when supplied. Do not require a host restart or reconnect to use this mode. The native pending-state rules below continue to apply when neither a working native tool nor an actual inline renderer is available.

Codex plugin setup reaches this same contract through the packaged `extensions.com.openai.onboardingSkill` entry. Its directory must also appear in the plugin's `skills` roots: a shipped file and an extension declaration alone return `onboardingSkill: null` from Codex's `plugin/read`. The additional setup root stays outside the five production Skill folders. Reuse the installed connection; onboarding does not run setup again. The desktop controls whether it offers or starts setup; Skill discovery alone does not prove automatic presentation after the Install button.

### CLI installation: attach the calling chat before presentation

CLI registration does not run the desktop install callback. Source and npm Codex setup return `onboarding.hostHandoff` after registration. They use an existing Codex app-server control socket to request `config/mcpServer/reload`, then inspect `mcpServerStatus/list` with the calling `CODEX_THREAD_ID` and read `openmotion_get_project` through that same thread. An unrelated daemon is refused before refresh. They never start another app-server to simulate a connected chat. `OPENMOTION_CODEX_SOCKET` may select an explicitly known local control socket; do not guess sockets or change the host's listener/security configuration.

Working native tool discovery and a matching `openmotion_get_project` read in this chat supersede an earlier pending handoff result. When those native tools are already loaded, use them directly; do not require a control socket or repeat setup to clear a historical pending status.

Set `OPENMOTION_ONBOARDING_LANGUAGE` from the latest user request when running setup; supported codes are listed below. The host Agent must still use that request language for the native presentation, regardless of the terminal/UI locale.

- `ready_for_presentation` confirms the calling chat's workspace read and native presentation-tool discovery. Open the library, then call the discovered tool natively. `presentationVerified` remains false until the welcome and all three video cards are actually visible.
- `refresh_requested` means the host queued a refresh. After the current tool step finishes, run the installed `scripts/codex-host-handoff.mjs --verify-only` once (with Node type stripping enabled and the same data-directory environment). That verification does not request another reload or present duplicate cards.
- `host_action_required` keeps onboarding incomplete and supplies the exact host RPC handoff. A desktop host running only over private stdio may not expose a CLI control socket. Use an available supported host reload action; if none is accessible, explain that concrete limit and request the minimum user action to reload the existing chat. Do not report a complete onboarding, silently substitute a library-only welcome when full onboarding was requested, or repeat installation/probes. Never call the presentation through a shell RPC and claim it appeared in the conversation.

This host handoff does not authorize project creation, export, host restart, or changes to unrelated host settings. Independent MCP diagnostics and ordinary non-UI hosts retain the library-only fallback; they do not establish native onboarding acceptance.

### Open the library without creating a project

1. If the current chat has loaded MCP, call `openmotion_open_preview({target: "templates"})`. Do not supply a projectId/sessionId or create a placeholder project. The result is a page handoff without a project revision/version.
2. Otherwise use `onboarding.preview.previewUrl` and its `previewHandoff` from setup. The installer prepares the same local page independently of current-chat MCP discovery. Do not require a new chat, repeat installation, or create a project to obtain a link. `onboarding.catalog` is compatibility data, not a required recommendation or creation step.
3. Present the exact URL in the calling chat's right panel, preserving embed/query parameters. When CUA exposes this chat's IAB, use it directly rather than first queueing `open_in_codex` and then repeating the opening through CUA. Reuse the matching tab found during preparation and show the browser, or call `cua.createBrowserTab('iab', previewUrl, {visible:true})` and `tab.markDeliverable()` together. Creation/selection already returns the initial page state: loaded library content there is sufficient evidence; request one additional state only if that result is still loading or incomplete. Otherwise, use `open_in_codex` with `placement: "right"`, the exact browser URL and no other threadId; report an unobserved or queued result accurately. Native Codex app automation is unnecessary. Queue only when the host confirms the chat is inactive; a queued acknowledgment alone does not establish visibility. Do not submit project `record_display` receipts for the library.
4. If the host has no browser/panel, provide the actual library link and explain that it could not be opened automatically. If setup returned `onboarding.preview.status=unavailable`, report the installation result and the concrete preview failure; retry with the templates target when MCP is available. Never claim opening succeeded or silently create a fallback project.

### Optional native recommendations in Codex

Resolve native tool discovery before opening the library. If this Codex chat **natively discovers** `openmotion_show_template_recommendations`, keep its arguments ready and call it once immediately after confirming library visibility: `templateIds: ["product-promo", "nyt-graph", "decision-tree"], onboarding: true, language: "zh"` (set `language` from the latest user request, not the host UI). Supported language codes are `zh`, `en`, `ja`, `ko`, `fr`, `es` and `pt`; use the user’s explicit output-language preference when given and `en` for unsupported languages. Always supply `language` for ordinary recommendations too. This first-run component owns the persistent welcome above three approved full-video cards. The Agent does not send that welcome as commentary or final text: Codex collapses commentary after the turn. The ordinary recommendation call omits `onboarding` and keeps its existing cards-only behavior. Preserve the returned card order and exact titles. A numbered reply selects the corresponding card and authorizes the offered editable sample copy unless the user supplies a different scope; carry any requirements forward. A generic yes still needs an exact selection.

The optional presentation is available only when this connection declares the MCP Apps MIME capability and its bundled resources pass verification. Installation registration, the direct CLI client or another chat's successful call does not establish availability in this chat. If the tool is absent, disabled, fails or has not visibly appeared, keep the existing library and text guidance; do not force a reconnect/new chat or delay the installation reply, repeat the presentation call, render a preview or create a placeholder project. Never claim video playback from a cover alone.

The card's **Recreate template** button (Chinese: **复刻模板**) prepares an editable prompt in the active composer, with the selected template title/ID and space for requirements. It uses the negotiated `openai/message` extension with `target: "active", send: false`, preserving the existing draft and attachments. Clicking the button does not submit a task or authorize creation/export. Unsupported clients show a copyable prompt instead of sending. Wait for the user to edit and send their brief, then continue the existing template Skill with the complete requirements and requested delivery. Do not replace a customized brief with the legacy frozen sample `createArgs`. For an explicitly accepted unchanged sample copy, retain the returned stable `requestId` and complete unchanged inputs on retry; do not append a current `sessionId`. Reuse a confirmed project from this experience, and never create a duplicate merely because cards were redisplayed.

For native onboarding, the component renders the installation/library heading, the first-person product introduction, library search/browse guidance, the recommendation invitation and the card-button guidance, followed by three cards. Do not add a Motion.md explanation or numbered-reply invitation. Template titles and descriptions appear only in the cards, without a second numbered description list. The card button fills an unsent draft; a later user-sent brief starts creation. The separate Studio **Open and edit** action remains unchanged.

After a successful native presentation, end without an additional text reply. Keep verification notes, tool visibility uncertainty, acknowledgments and duplicated invitations out of the user-facing onboarding. Verify inline behavior in the test report, not under the cards. Report an actual tool/presentation error briefly when it occurs; do not convert inability to inspect an inline widget into an unsolicited error message. For a non-UI host, use the library-only fallback below. Omit version/environment, configuration paths, MCP/Skill/tool counts, probe results and background preparation. Installation alone does not prove current-chat connection.

Do not ask the user to refresh/reconnect, restart the host or open a new chat by default. When native tools are missing or stale, use setup’s `onboarding.directAccess`: run its `command` with `toolsArgs`, read the public input schemas, then run `callArgs` with the selected Tool and a JSON arguments file. It uses this installation’s actual registered MCP transport, version and data directory, so the current chat can continue without restarting or opening another chat. It does not refresh native discovery. Keep these technical details internal. Never bypass disabled tools, permission denials or host policy. Attempt supported host recovery only if direct access is unavailable or fails. If user action is still necessary, briefly explain the specific blocker and the minimum supported next step. Mention video-component preparation only when it blocks the requested operation. Preserve the accepted template choice and existing work across recovery.

Browsing, filtering, opening template details, playing a preview and closing the library do not authorize project creation. Selecting **Open and edit** creates an independent editable copy through Studio. Do not create a duplicate Agent project after that GUI action; continue the actual project the user selected or provide its exact project link to bind the Agent. External reference-only entries require an explicit reconstruction request rather than pretending they have editable source.

After acceptance, use openmotion-template-to-video only when the user explicitly asks the Agent to create with an exact template. Preserve that template ID, use unchanged sample content unless requested otherwise, and create one independent project with a stable requestId. A generic “yes/体验” without a selected template is insufficient; ask which template. Reuse an already created experience project and preserve existing work. Do not repeat optional material/brand/style questions or silently substitute another template on failure. Open the actual editable project and check loading/playback when the host supports it; otherwise provide its actual link and state the limitation. Export only on request. A refusal/deferment stops the experience. No invitation-state service or “invitation sent/seen” telemetry is implied.

Reference copy rendered inside the native onboarding component, not a separate Agent message:

```text
🎉 **OpenMotion 安装好啦，右侧就是模板库！**

我是你的开源视频创作搭档，我有丰富的高水准视频模板，也支持从参考视频或一个灵感出发，和你一起创作精彩的视频。

模板库支持搜索，也可以随意浏览，找到喜欢的点击「复刻模板」就能开始你的创作！

**不想自己找？先看看我挑的这 3 个 👇**

你可以点击下方卡片上的「复刻模板」，然后补充「我的要求」或添加附件，发送后就开始创作！
```

Example when the right-hand library is visible but native cards are unavailable:

```text
🎉 OpenMotion 安装好啦，右侧就是模板库！

我是你的开源视频创作搭档，我有丰富的高水准视频模板，也支持从参考视频或一个灵感出发，和你一起创作精彩的视频。

模板库支持搜索，也可以随意浏览，找到喜欢的点击「复刻模板」就能开始你的创作！
```

The first example documents component-owned content; never paste it into an Agent progress message. Use the library-only fallback when native presentation is unavailable. If the library is queued, blocked, declined or cannot be observed, replace the opening claim with that actual result and an exact usable link when available. If native presentation is unavailable before the welcome, use the library-only fallback without a card invitation.
<!-- installation-onboarding:end -->
