---
name: open-design-ui
description: Apply an existing Open Design UI component in the OpenMotion Studio source checkout. Use when wiring a shared control into a Studio feature, replacing a native button or range input, or reviewing whether an existing Studio call site reuses the component library.
---

# Apply an Open Design UI component

Start with the requested Studio page or control. Read the repository [instructions](../../../AGENTS.md), the [component registry](../../../packages/design-system/components/registry.json), and the relevant section of the [component guide](../../../packages/design-system/components/README.md). The registry is the source for each component's alias, implementation, and example consumer.

1. Inspect the target call site and the registry's `source` and `consumer`. Identify the current behavior, accessible name, layout and visual states that the replacement needs to preserve. Choose the existing component and variant that fit the use case.
2. Use the registry's import alias, such as `open-design-ui/button` or `open-design-ui/slider`. Keep product state and handlers in the feature, and reuse shared visual roles. Preserve call-site classes that provide needed layout or product styling. If the shared API cannot reproduce a necessary state or interaction, report the gap before replacing the control.
3. Keep the native button `type` when it matters for a form and preserve its handler, disabled behavior and label. For Slider, keep the accessible label, range, step and controlled value. Send transient updates to `onPreview` and persist from `onCommit` when that matches the feature's save behavior.
4. If the change removes a native JSX button or range input tracked by the [Studio baseline](../../../scripts/studio-native-controls.json), lower only the matching count for that file and remove a zero-count entry. Reusing an existing component does not require changing the registry or adding another example.
5. Run `npm run design:check` and the Studio checks required for the changed surface. Exercise the original interaction through the real consumer or its focused test. For visual or interaction changes, review the affected Studio page with the keyboard and in both themes as applicable. The catalogue can preview component states with `npm run components:dev`.

Report the component and the Studio call site changed, what behavior you exercised, and any verification still pending.
