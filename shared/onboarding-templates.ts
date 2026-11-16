// Keep the first-run selection ordered and shared by native and inline hosts.
export const onboardingTemplateIds = [
  'motion-664184d9-593e-4984-b473-701248b69cfe',
  'motion-b31d078a-4e5e-461e-8b43-3101ee0a2f93',
  'motion-1e48dea5-903d-48f6-b10e-99a70f1c183d',
] as const;

// Existing clients can still explicitly request the original bundled examples.
export const builtinRecommendationIds = ['product-promo', 'nyt-graph', 'decision-tree'] as const;
export const recommendationTemplateIds = [...builtinRecommendationIds, ...onboardingTemplateIds] as const;

// These small records pin the presentation to its actual catalog/source identity.
// Original reference videos remain at their content-addressed public media URLs.
export const onboardingSourceFiles = onboardingTemplateIds.flatMap(id =>
  ['template.json', 'TEMPLATE.md', 'source/motion.md', 'source/preview.html', 'source/manifest.json']
    .map(file => `library/templates/catalog/${id}/${file}`));
