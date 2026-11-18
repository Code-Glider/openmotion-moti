# Contributing Studio UI components

Use the [design system](design-system.md) for visual decisions, and start with the Studio component library when choosing an interaction.

From the repository root after `npm ci`:

```sh
npm exec vite -- --config studio/vite.config.ts --host 127.0.0.1
```

Open `http://127.0.0.1:5173/component-library.html` using the port Vite prints. The library renders the same React controls used in the application. Try its theme selector, keyboard navigation and feedback states. For token editing, run `npm run design:dev` to open the independent [design workbench](../packages/design-system/README.md#visual-editing-and-agent-editing).

## Choose an existing control

Import from the listed module under `studio/src`. Each component owns its interaction contract. The feature owns copy, data, query timing, permissions, tracking and layout.

| Use case | Start here | Reference |
| --- | --- | --- |
| Run an action or show an icon-only action | `components/ui/Button`, `components/ui/IconButton` | [Assets toolbar](../studio/src/motion/AssetGalleryToolbar.tsx). Name icon-only buttons. Use `size="lg"` (32 px) in standard application rows, `md` (28 px) for a compact application row, and the existing panel density for editor controls. |
| Search an application collection or settings list | `components/ui/SearchField` | [Templates](../studio/src/motion/TemplateLibraryDialog.tsx) and [assets](../studio/src/motion/AssetGalleryToolbar.tsx). Pass an accessible name, placeholder, controlled value and change handler. The field clears the query and restores focus. Keep the shortcut, composition handling and query policy in the feature. |
| Search inside a compact editor panel | `components/ui/SearchInput` | [Blocks panel](../studio/src/components/sidebar/BlocksTab.tsx). Keep panel density and existing keyboard behavior. |
| Select a value, toggle an immediate setting, include an item, or switch between panels | `components/ui/Select`, `Toggle`, `Checkbox`, `Tabs` | Verify the control's keyboard behavior and accessible name. Use pressed buttons for quick filter chips, which update the current results rather than switch content panels. |
| Choose a sort order, open a filter popover | `motion/GalleryFilters` and `components/ui/Menu` | [Brand gallery](../studio/src/motion/BrandCatalogGallery.tsx). Keep instant sort and draft filters distinct. Dismissal discards drafts. |
| Present loading, empty data, a failed section or an action result | `components/ui/Skeleton`, `PanelEmptyState`, `hooks/useToast` and `components/StudioToastViewport` | [Project conversation](../studio/src/motion/ProjectConversation.tsx). Preserve space while loading and show recoverable section or field errors next to the affected content. Use a toast for a copy, save or other transient action result. When the Studio shell already supplies `showToast`, use that owner. |
| Open a standard settings dialog | `motion/settingsPrimitives` | [Agent connection](../studio/src/motion/AgentConnectionDialog.tsx). Verify Escape, focus return and feedback layering. Catalogue the current behavior of native and nested dialogs before migrating them. |

## Maintain visual decisions

- Reuse semantic roles in [`tokens.json`](../packages/design-system/tokens.json). Use the corresponding text/background pairs for both themes, including `action` / `on-action` for the primary neutral action, `danger` / `on-danger` for filled destructive actions, and `selected` for focus. Use shape, labels or icons in addition to color when communicating state.
- Keep ordinary application controls on `control` (32 px), compact controls on `control-sm` (28 px), and app fields on `radius-md` (6 px). The editor's 24/28/32 px button sizes remain available. Use `8/12/16/24` spacing tokens for control groups and sections and the shared type and motion scale. Keep measured layout and authored video properties with their feature.
- To add a shared role, document its use and expected states, supply values for both themes when applicable, then run `npm run design:tokens` and `npm run design:check`. Review the generated outputs and two real consumers. Use an existing role where the interaction semantics match.

## Migrate existing UI incrementally

1. **Inventory by interaction.** Find two live call sites with the same job. Record the files, current API or selector, behavior and remaining consumers in the PR. A shared CSS class can already solve appearance. Extract React only where ownership of state, semantics or events ought to be shared.
2. **Pick and preserve the contract.** Specify accessible names, focus and shortcuts, event and commit timing, disabled and busy behavior, and which state belongs to the page. Keep links as links, preserve host and project boundaries, and keep timeline geometry local.
3. **Move one seam.** Reuse the primitive or extract the repeated markup and interaction from an existing implementation. Migrate two representative consumers, including the one with the most meaningful edge case. Retain compatibility for callers outside the batch. The application search pilot covers a simple assets query and the template library's IME composition and shortcut handling.
4. **Validate and follow up.** Run the relevant deterministic tests and inspect both themes, a narrow viewport, keyboard navigation and applicable loading/error states. Add a runnable example when a new common state or API is introduced. Remove superseded code only after its last caller has migrated.

The next batches are button and switch recipes, then collection toolbars and content states. Treat native top-layer dialogs, nested overlays and host adapters as their own migrations. For a deliberate exception, record the consumer and why it needs different behavior. Progress is measured by migrated live consumers and documented exceptions for each component family.

In the PR validation section, link the component entry and sample consumers, list the interactions actually checked, and include a screenshot or reproduction for a visible change. A maintainer reviewing a shared API or token checks an existing consumer and the new or migrated consumer together.
