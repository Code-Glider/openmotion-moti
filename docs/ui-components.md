# Studio UI examples

Use the [shared design system](design-system.md) for Studio tokens, CSS and interaction guidance. To try the examples, start Vite from the repository root after installing dependencies:

```sh
npm exec vite -- --config studio/vite.config.ts --host 127.0.0.1
```

Open `/component-library.html` on the local URL Vite prints.

## Choose the smallest shared implementation

- **Appearance.** Use shared CSS with native elements when it covers the control. For an ordinary button, use `<button type="button" className="om-button">` and add `data-primary` for a primary action. Use `type="submit"` for form submission. [Asset actions](../studio/src/motion/AssetsPage.tsx) show this in use.
- **Structure or behavior.** Reuse a React control when it owns parts that multiple pages need to maintain together. [SearchField](../studio/src/components/ui/SearchField.tsx) owns the search markup, clear action and focus return. [Templates](../studio/src/motion/TemplateLibraryDialog.tsx) and [assets](../studio/src/motion/AssetGalleryToolbar.tsx) own query timing, keyboard shortcuts and input composition where applicable.
- **A migration.** Compare real call sites and reuse the smallest existing API that covers their behavior. When changing shared appearance or interactions, check two affected product screens in the browser, including keyboard focus and both themes. Update the guide or preview when the recommended usage or demonstrated behavior changes.
