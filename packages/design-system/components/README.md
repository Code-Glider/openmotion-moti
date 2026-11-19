# OpenMotion Components

This directory owns the shared React controls. Open the component site from the repository root after `npm ci`:

```sh
npm run components:dev
```

Use the URL Vite prints. The site renders the same source used by Studio, includes light and dark themes, and links each example to a product consumer. `npm run components:build` generates a static site in `packages/design-system/components/dist`.

## Use from an Agent

Read [registry.json](registry.json) to discover each control's source path, import alias, named export, example and product consumer. The site also serves the same file at `/registry.json`. Use the listed alias in Studio and in the component site:

```tsx
import { Button } from '@openmotion/ui/button';
import { Slider } from '@openmotion/ui/slider';
```

Studio already loads the two shared styles in the registry. Keep the app's Tailwind source scan pointed at the shared controls. The alias resolves to source in this checkout through TypeScript and Vite. Agents can use it with their normal repo tools.

- `Button` supports native button props, `primary`, `secondary`, `ghost` and `danger` variants, three sizes, an optional icon and a loading state. Set the native `type` deliberately. Existing ordinary actions can keep the shared `om-button` recipe.
- `Slider` takes a named, bounded numeric value. Use `onPreview` for temporary feedback and `onCommit` to store a change. Keep provider defaults and validation in the feature.

## Contribute a control

1. In the design or brief, show the actual use, states, keyboard behavior and token choices. Use the [shared design system](../README.md) for color, typography, spacing and motion.
2. Add or update the source, its registry item and an interactive example in [site/main.tsx](site/main.tsx). Prefer an existing component or recipe if it covers the same contract.
3. When migrating, start with a product consumer. Preserve its events, labels, focus and layout. Link the call site in the registry and share the preview in the PR.
4. Run `npm run design:check`, `npm run typecheck:studio`, `npm run components:build` and relevant Studio tests. Check the live sample and the migrated consumer in light and dark themes with keyboard interaction.

### First migration

[GenerationParameters](../../../studio/src/motion/GenerationParameters.tsx) now imports the shared Slider directly. The provider still owns the label, range, step, default and committed value. Existing React Button and Slider callers use the aliases directly. Component implementations depend on their own directory and shared UI dependencies. The preview can also load design system assets. `npm run design:check` checks these import boundaries.
