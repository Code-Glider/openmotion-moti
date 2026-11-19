# Open Design UI

This directory owns the shared React controls.

## Preview while designing

From the repository root, install dependencies with `npm ci` once, then start the component site:

```sh
npm run components:dev
```

Open the local URL printed in the terminal. Find the control in the component index, open its detail page, and use the Preview and Code tabs to test and copy an example. Use the toolbar to switch themes. The site also includes a local Contribution guide. Keep the development server running while editing. Saving a component or its example updates the browser. The component site uses the same source as Studio and runs without the Studio backend.

For a new component, add a registry entry and a preview, examples and API notes in [site/examples.tsx](site/examples.tsx). `npm run components:build` generates a static build in `packages/design-system/components/dist`.

Component details use paths such as `/components/slider`. Vite handles direct links during development and preview. For static hosting, serve the build at the origin root and fall back to `index.html` for catalogue page routes.

## Use from an Agent

Ask the Agent to use the repository-local [Open Design UI Skill](../../../.agents/skills/open-design-ui/SKILL.md) and give it the Studio page or control to change. For example, `Use $open-design-ui to replace the retry button in workspace search. Keep its behavior and verify the existing test.`

The component detail page offers **Copy to Agent** for a new use case and **Copy migration prompt** for replacing an existing control. Add the target Studio page or feature to the copied prompt before using it.

Read [registry.json](registry.json) to discover each control's source path, import alias, named export, example and product consumer. The site also serves the same file at `/registry.json`. Use the listed alias in Studio and in the component site:

```tsx
import { Button } from 'open-design-ui/button';
import { Slider } from 'open-design-ui/slider';
```

Studio already loads the two shared styles in the registry. Keep the app's Tailwind source scan pointed at the shared controls. The alias resolves to source in this checkout through TypeScript and Vite. Agents can use it with their normal repo tools.

- `Button` supports native button props, `primary`, `secondary`, `ghost` and `danger` variants, three sizes, an optional icon and a loading state. Set the native `type` deliberately. Use Studio's existing `IconButton` for icon-only actions.
- `Slider` takes a named, bounded numeric value. Use `onPreview` for temporary feedback and `onCommit` to store a change. Keep provider defaults and validation in the feature.

In Studio application code, use these shared controls for new actions and ranges. `npm run design:check` rejects native JSX `<button>` (including `om-button`) and `<input type="range">` that exceed the [per-file legacy baseline](../../../scripts/studio-native-controls.json). When migrating a legacy control, lower its count and remove zero-count entries. CI runs the same rule through `npm run check`.

## Contribute a control

1. In the design or brief, show the actual use, states, keyboard behavior and token choices. Use the [shared design system](../README.md) for color, typography, spacing and motion.
2. Add or update the source, its registry item and interactive examples in [site/examples.tsx](site/examples.tsx). Prefer an existing component or recipe if it covers the same contract.
3. When migrating, start with a product consumer. Preserve its events, labels, focus and layout. Link the call site in the registry and share the preview in the PR.
4. Run `npm run design:check`, `npm run typecheck:studio`, `npm run components:build` and relevant Studio tests. Check the live sample and the migrated consumer in light and dark themes with keyboard interaction.

### First migration

[GenerationParameters](../../../studio/src/motion/GenerationParameters.tsx) now imports the shared Slider directly. The provider still owns the label, range, step, default and committed value. Existing React Button and Slider callers use the aliases directly. Component implementations depend on their own directory and shared UI dependencies. The preview can also load design system assets. `npm run design:check` checks these import boundaries.
