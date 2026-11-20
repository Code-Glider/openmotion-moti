import type { Model } from './gateway.ts';

/**
 * Image features composed from one OpenDesign edit request, per "OpenDesign API image model capabilities, tested"
 * (2026-11-20). Each feature names the models that produced the effect and how its prompt and parameters are built.
 */
export type ImageFeatureId = 'remove-background' | 'relight' | 'character';
type ImageFeature = {
  models: readonly string[]; recommended: string; maxReferences: number;
  parameters?: Record<string, unknown>; promptOptional: boolean;
};
/** The OpenDesign API key and the OpenDesign account reach the same media API. */
const featureProviders = ['opendesign', 'account'];
export const imageFeatures: Record<ImageFeatureId, ImageFeature> = {
  'remove-background': { models: ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'], recommended: 'gpt-image-2.6-sunburst', maxReferences: 1,
    parameters: { background: 'transparent' }, promptOptional: true },
  relight: { models: ['seedream-5.5', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'seedream-5.0-flash'], recommended: 'seedream-5.5', maxReferences: 1,
    promptOptional: true },
  // Seedream 5.5 stays listed: it accepts a single reference, and the reference guard removes it from two upward.
  character: { models: ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'seedream-5.0-flash', 'seedream-5.5'], recommended: 'gpt-image-2.6-sunburst', maxReferences: 5,
    promptOptional: false },
};

export const imageFeatureModel = (feature: ImageFeatureId, model: Model) => model.modality === 'image'
  && featureProviders.includes(model.provider) && imageFeatures[feature].models.includes(model.modelId);

type LightChoice = { value: string; label: string; prompt: string };
export const relightControls: readonly { key: 'direction' | 'temperature' | 'mood'; label: string; choices: readonly [LightChoice, ...LightChoice[]] }[] = [
  { key: 'direction', label: 'Light direction', choices: [
    { value: 'left', label: 'Left side light', prompt: 'key light from the left side' },
    { value: 'right', label: 'Right side light', prompt: 'key light from the right side' },
    { value: 'front', label: 'Front light', prompt: 'soft frontal key light' },
    { value: 'top', label: 'Top light', prompt: 'overhead top light' },
    { value: 'back', label: 'Backlight', prompt: 'backlight with a rim of light around the subject' },
  ] },
  { key: 'temperature', label: 'Color temperature', choices: [
    { value: 'warm', label: 'Warm light', prompt: 'warm color temperature around 3200K' },
    { value: 'neutral', label: 'Neutral daylight', prompt: 'neutral daylight around 5600K' },
    { value: 'cool', label: 'Cool light', prompt: 'cool color temperature around 7500K' },
  ] },
  { key: 'mood', label: 'Lighting mood', choices: [
    { value: 'studio', label: 'Soft studio', prompt: 'soft, even studio lighting with gentle shadows' },
    { value: 'golden-hour', label: 'Golden hour', prompt: 'low golden-hour sunlight with long soft shadows' },
    { value: 'dramatic', label: 'Dramatic contrast', prompt: 'dramatic high-contrast lighting with deep shadows' },
    { value: 'neon', label: 'Neon night', prompt: 'colorful neon night lighting with glowing reflections' },
    { value: 'moonlight', label: 'Moonlight', prompt: 'dim blue moonlight' },
  ] },
];
export type RelightChoices = Partial<Record<typeof relightControls[number]['key'], string>>;

/** The prompt sent to the model: the feature's fixed instruction, then what the user wrote. */
export function imageFeaturePrompt(feature: ImageFeatureId, prompt: string, relight: RelightChoices = {}): string {
  const note = prompt.trim();
  if (feature === 'remove-background') return 'Remove the entire background and isolate only the main subject cleanly on a transparent background. '
    + 'Keep the subject identical in shape, texture, and lighting.' + (note ? ' ' + note : '');
  if (feature === 'relight') {
    const light = relightControls.map(control => (control.choices.find(choice => choice.value === relight[control.key]) ?? control.choices[0]).prompt).join(', ');
    return 'Relight this image. Keep the subject, composition, pose and every detail unchanged; change only the lighting, shadows and reflections. '
      + `Lighting: ${light}.` + (note ? ' ' + note : '');
  }
  return 'Keep the character from the reference images consistent: the same face, hairstyle, body shape, skin tone, outfit and distinguishing features. '
    + note;
}
