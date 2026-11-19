import { describe, expect, it } from 'vitest';
import { componentImportViolation } from '../../../scripts/check-component-imports';

describe('shared component imports', () => {
  const library = 'packages/design-system/components/';
  const consumer = 'studio/src/motion/GenerationParameters.tsx';

  it('keeps component implementations inside the library', () => {
    expect(componentImportViolation(library + 'slider.tsx', './cn')).toBeUndefined();
    expect(componentImportViolation(library + 'slider.tsx', '@base-ui/react/slider')).toBeUndefined();
    expect(componentImportViolation(library + 'slider.tsx', '../../../studio/src/i18n/I18n')).toBeDefined();
    expect(componentImportViolation(library + 'slider.tsx', '../react/BrandLogo')).toBeDefined();
    expect(componentImportViolation(library + 'slider.tsx', './site/main')).toBeDefined();
  });

  it('lets the preview import the alias and reuse design system artwork', () => {
    expect(componentImportViolation(library + 'site/main.tsx', '@openmotion/ui/button')).toBeUndefined();
    expect(componentImportViolation(library + 'site/main.tsx', '../../react/BrandLogo')).toBeUndefined();
    expect(componentImportViolation(library + 'site/main.tsx', '../../../../studio/src/ui')).toBeDefined();
  });

  it('requires Studio consumers to use shared control aliases', () => {
    expect(componentImportViolation(consumer, '@openmotion/ui/slider')).toBeUndefined();
    expect(componentImportViolation(consumer, '../components/ui/Button')).toBeDefined();
    expect(componentImportViolation(consumer, '../../../packages/design-system/components/slider')).toBeDefined();
    expect(componentImportViolation(consumer, '../components/ui/Select')).toBeUndefined();
  });
});
