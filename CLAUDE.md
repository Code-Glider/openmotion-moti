# Claude Code

Read and follow [AGENTS.md](AGENTS.md) before working in this repository. It is the shared source of instructions for all Agents.

Use `CLAUDE.md` as the Claude Code instruction entry. Record future repository-rule updates here and keep them aligned with `AGENTS.md`.

## Branch workflow

Branch new work from the latest `main` and target all pull requests at `main`. Merge reviewed changes directly into `main` when authorized; do not use `feature/motion` as an intermediate integration branch.

## Interface styling

Follow the mandatory [shared design system rules](AGENTS.md#shared-design-system--required-for-every-agent) for every style-related change. Read [packages/design-system/README.md](packages/design-system/README.md), reuse its tokens, styles and assets, and extend the package before adding a missing reusable visual role. Feature modules must reference this source rather than maintain independent palettes or copied styles. Apply the same rule when delegating or reviewing work; authored video and domain geometry retain their own styling boundary.
For CI scope and local validation, follow [Local validation](AGENTS.md#local-validation), including the presentation-document allowlist and the full product-content gate.

## Candidate and publication controls

New repository installations use the source bootstrap in install.md. Published npm application installation is retired. Candidate-build, npm-publication and snapshot-recovery workflow roots are disabled; do not re-enable, publish, move npm tags or replace hosted guides without separate authorization. Preserve existing installations, projects, credentials and legacy diagnostic/recovery implementation. Historical release documentation remains available with an archive notice. npm remains the source dependency/build tool.

## UI design system and interaction feedback

Follow [the shared UI rules](AGENTS.md#ui-design-system-and-interaction-feedback) and [the design-system interaction contract](docs/design-system.md#interaction-and-feedback-contract). Transient operation results use `useToast` and `StudioToastViewport` on the floating feedback layer, including inside native dialogs; never insert success or failure notices into the content flow. Reuse semantic light/dark tokens, non-modal dropdowns (immediate quick filters; grouped draft selections with live counts and in-panel Apply), padded rounded hover states, one visible focus treatment, and shared loading/fallback geometry. Verify the actual opened states in the browser without shifting or blocking the working area.

## Product documentation

Follow the [README writing and acknowledgements rule](AGENTS.md#readme-writing-and-acknowledgements) for every README, alternative draft and translation. Keep the main narrative, headings and showcase copy focused on OpenMotion and what each example demonstrates. Put other-product comparisons, inspiration, source-product labels and upstream acknowledgements only in the final **Acknowledgements** section; do not use headings such as "From MotionGit". Preserve licenses and provenance, and keep required setup identifiers, supported agent/model names and explicitly requested example brand names accurate. Verify this placement before finishing README edits.

The design-system workbench is an independent package-owned editing surface. Keep it free of Studio and business-module imports; UI edits and Agent edits update the same design-system source. Run `npm run design:dev` to open it and `npm run design:test` for its save/conflict/independence checks.

## MCP onboarding

Follow [MCP onboarding and capability maintenance](AGENTS.md#mcp-onboarding-and-capability-maintenance). Changes to local MCP, media generation, Agent adapters, templates or optional presentation must keep the Studio connection page, capability descriptions, setup instructions and compatibility boundaries current in the same change.

## Core capabilities and shared APIs

Follow [Core capabilities and shared APIs](AGENTS.md#core-capabilities-and-shared-apis). Every new or extended core capability must support external MCP calls. Product controls and in-app Agents may compose these capabilities according to developer and user needs, using the same API or MCP operations and shared domain implementation. Preserve the same data, job, version, validation and conflict semantics across entry points; keep public discovery, applicable UI consumers, documentation and adapter verification aligned.
