# Shared installation onboarding

Used by source installation, npm application installation and plugin setup.

<!-- installation-onboarding:start -->
## Installation-success reply

Installation has four completion conditions in the same calling conversation:

1. Open the actual local template library once, without creating a project. Detailed library inspection is unnecessary.
2. Display the maintained welcome in the persistent conversation flow.
3. Put exactly three full-video recommendation cards below the welcome, sampled without replacement from the nine-entry pool in `shared/onboarding-templates.ts` (the catalog IDs referenced by PR #472).
4. Automatically load OpenMotion's native tools and verify the installed workspace through this same chat's MCP connection. Registration, a separate process's handshake and a queued refresh do not satisfy this condition.

### Native reference cards

Default preparation freezes three IDs/order once across `catalog`, `inlinePresentation`, `hostHandoff` and recovery. It returns `native_required`, the immutable `resourceUri`/`resourceVersion`, and native Tool arguments with `onboarding:true`. Open the library, then call the natively discovered `openmotion_show_template_recommendations` with those exact arguments and the latest request's language. The existing component displays its maintained welcome above the three cards. Do not repeat that welcome in the final reply or put it only in collapsed commentary. Ordinary recommendations omit onboarding; `onboarding:false` is for cards after a welcome already delivered.

The reference posters and complete videos retain their content-addressed public URLs and native App media policy. The fixed-CSP document renderer cannot inherit that policy. It cannot guarantee these video cards independently of native discovery. Do not replace them with text cards, a right-hand browser page, builtin examples, downloaded-media embedding or a security change. A shell presentation call does not mount a native conversation component. Reference playback requires network access; actual audiovisual acceptance is separate from basic installation checks.

### Automatic current-chat activation

Source and npm setup use `prepareInstallationFlow`. After registration, an existing supported Codex control connection checks `thread/loaded/list` for the calling `CODEX_THREAD_ID`. A healthy native connection is reused. Missing/stale tool discovery, an outdated application version or a mismatching immutable card resource requests one `config/mcpServer/reload`. The refresh is queued for a host tool boundary; an immediate status read is not its completion.

After that tool step finishes, execute the returned `recovery.command`/`recovery.args` in this same turn. The private immutable receipt preserves the chat, application, workspace, language, three IDs/order and library URL. Recovery performs verification only: no reinstall, library startup, resampling or additional reload. Native discovery and `openmotion_get_project` must verify the expected workspace through the calling thread before `hostSessionVerified` is true. They do not prove visible welcome/cards.

`OPENMOTION_CODEX_SOCKET` may identify an explicitly known existing control socket. Do not guess endpoints, start another app-server to simulate this chat, alter host listeners/security, inject instructions through `codex queue`, restart Codex or substitute a user connection-restart instruction for automatic activation. A private-stdio host with no supported reload capability is a blocking host integration dependency. Keep onboarding incomplete and report it accurately. Already working native tools can supersede a missing script control socket; use them directly and preserve the receipt.

Codex plugin setup reaches this contract through `extensions.com.openai.onboardingSkill`. Its directory must also be in the plugin's `skills` roots. CLI registration alone does not invoke the desktop install callback or create a current-chat refresh capability. Installed files, current-chat connection and visible native delivery are separate outcomes.

### Open the library

Use `openmotion_open_preview({target:"templates"})` when loaded, otherwise setup's exact `preview.previewUrl`. Open it in this chat's right-hand browser, preserving embedding parameters and reusing its tab. With CUA, create it using `cua.createBrowserTab('iab', previewUrl, {visible:true})`, mark it as a deliverable and complete mandatory browser bookkeeping. Otherwise use the supported `open_in_codex` browser target with `placement:"right"` and no other thread ID. Opening is sufficient; do not inspect the complete inventory or audit playback. Report queued/unavailable presentation accurately. Never create a placeholder project or submit project display receipts for the library.

### Welcome copy and blocked delivery

The native component uses the shared localized welcome dictionary. The Chinese welcome begins:

```text
🎉 OpenMotion 安装好啦，右侧就是模板库！

我是你的开源视频创作搭档，我有丰富的高水准视频模板，也支持从参考视频或一个灵感出发，和你一起创作精彩的视频。

模板库支持搜索，也可以随意浏览，找到喜欢的点击「复刻模板」就能开始你的创作！

不想自己找？先看看我挑的这 3 个 👇
```

If native cards are blocked, the Agent must still output the maintained introduction as ordinary final-reply text and the exact usable library link, followed by the concrete blocker. Match the opening claim to what actually opened; omit invitations pointing to cards that are absent. Do not replace the welcome with a status-only reply, claim successful onboarding, or discard the receipt. For later recovery after that welcome, append `--welcome-delivered` to the saved recovery command so it returns cards-only arguments. A lack of native full-video presentation has no equivalent text-card fallback.

### Self-contained builtin compatibility

Explicit builtin examples can still use the prepared document route: publish the verified fragment into this chat's permitted directory with `scripts/inline-onboarding.mjs --publish-from PATH --sha256 SHA256 --host-directory DIRECTORY`, then stream `welcomeMarkdown` followed by its returned `contentReference` in the final reply. Keep the document cards-only. This is not the curated-reference default and does not satisfy current-chat MCP activation; Codex activation is required independently of presentation mode.

### Accepted template selection

Use the exact accepted ID and scope through [accepted template selection](../skills/openmotion-production/references/templates.md#accepted-template-selection). A named choice retains that recommendation; a generic agreement to several equal choices still needs a selection. Recreate only fills an unsent editable brief through a negotiated composer bridge, or copies it to the clipboard with a floating Toast. Browsing, playback and copying do not authorize creation/export; the user-sent brief does. Preserve customized requirements and any existing GUI-created project, and never create a duplicate during recovery.
<!-- installation-onboarding:end -->

## Maintained recommendation selection

`shared/onboarding-templates.ts` owns a curated pool of nine references: **Bolt Skills｜团队能力展示**, **A New Era of No-Code**, **Magic Share**, **Glean Agents 发布**, **HyperOS 官网界面动效 1**, **Salsa｜音乐主题 Doodle**, **功能更新｜Voice mode**, **Dia 开放给 Arc 会员**, and **免费语音输入**. Each onboarding preparation samples three distinct entries without replacement. Inline cards, native handoff and the fallback catalog share that exact selection and order. The prepared document keeps its selection while playing, returning from detail or changing host context; only a new preparation draws again. Independent preparations may overlap.

Use the three prepared IDs returned in `inlinePresentation.templateIds`, the ordered `catalog.templates`, or the native handoff arguments. Do not draw a separate set for another surface. Every selected entry is a reference video with motion guidance, not a directly copyable builtin project; read its exact ID through `openmotion_get_template` and follow `openmotion-recreate` after the user submits their brief.

Full reference videos and posters load from existing immutable public `r.open-design.ai` URLs, with the same playback controls, visibility pauses and error fallback as bundled previews. Playback requires network access; installation preparation performs no media download or generation. The three previous builtin examples remain available for explicit recommendations and offline preview. Existing chats retain their frozen presentation; source changes do not update an installed host or previously prepared onboarding document.

Cards show the selected reference's localized `original.promotionalUseCases` value in a persistent top-left media badge, without a field-name prefix. This purpose category stays visible while the video plays and at narrow widths; the bottom-right preview action remains separate. Empty/missing values are omitted. The category does not use the separate `visualPresentation` field or infer a value from the title. The shared design-system media-label recipe supplies its translucent surface and typography.
