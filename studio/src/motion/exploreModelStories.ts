import type { Model } from '../../../shared/gateway';
import { findMediaStudio, findTechniqueStudio } from '../../../shared/studio-catalog';
import { studioDestination, type StudioDestination } from './creativeStudios';
import { sceneExamples, type SceneExample } from './sceneShowcase';
import type { loadGateway } from './gatewayClient';
import { archivedSkillPoster } from './skillCatalog';
import sunset from './scene-art/komona-sunset.webp';
import character from './scene-art/pepper.webp';

const poster = archivedSkillPoster('retro-print-poster');

const cinema = findMediaStudio('cinema')!, design = findMediaStudio('design')!, marketing = findTechniqueStudio('marketing')!;
const artCredit = 'David Revoy · CC BY 4.0';

export interface ModelStory {
  id: string;
  title: string;
  description: string;
  brand: string;
  family: RegExp;
  modality: Model['modality'];
  cases: { destination: StudioDestination; example: SceneExample }[];
}

export const floatingCity: SceneExample = {
  title: 'Fly over a floating city',
  prompt: 'Open on a floating city at sunset. Track a flock of birds past the rooftops as the clouds drift below, in a hand-painted anime style.',
  poster: sunset, credit: artCredit, creditUrl: 'https://www.peppercarrot.com/en/wallpapers/index.html',
};

// Match versioned family names in the installation catalogue, including dated Cloud IDs.
export const seedanceStory: ModelStory = {
  id: 'seedance', modality: 'video', title: 'Seedance 2.5', brand: 'bytedance', family: /seedance[\s._/-]*v?2[.\s_-]5(?!\d|\.\d)/i,
  description: 'Direct an anime opening, freeze a splash or move the light across a product.',
  cases: [
    { destination: studioDestination(cinema, 'text-to-video'), example: floatingCity },
    { destination: studioDestination(marketing, 'text-to-video'), example: sceneExamples['text-to-video'][0] },
    { destination: studioDestination(cinema, 'image-to-video'), example: sceneExamples['image-to-video'][0] },
  ],
};

export const gptImageStory: ModelStory = {
  id: 'gpt-image', modality: 'image', title: 'GPT Image 2.6', brand: 'openai', family: /gpt[\s._/-]*image[\s._/-]*v?2[.\s_-]6(?!\d|\.\d)/i,
  description: 'Design a character, lay out a two-ink gig poster or light a product portrait.',
  cases: [
    { destination: studioDestination(design, 'text-to-image'), example: { title: 'Paint an anime character', prompt: 'Paint a young witch in an oversized hat, lit from below by a shower of sparks. Use a dark teal background and keep the silhouette clear.', poster: character, posterPosition: '50% 32%', credit: artCredit, creditUrl: 'https://www.peppercarrot.com/en/viewer/artworks-src__2021-10-10_Pepper_by-David-Revoy.html' } },
    { destination: studioDestination(design, 'text-to-image'), example: { title: 'Two-ink retro print poster', prompt: 'Design a gig poster in two inks on rough paper. Set the band name in tall condensed type above a halftone illustration.', poster } },
    { destination: studioDestination(marketing, 'image-edit'), example: sceneExamples['image-edit'][0] },
  ],
};

export const modelStories = [seedanceStory, gptImageStory];

export function matchesStory(story: ModelStory, model: Model) {
  return model.modality === story.modality
    && (story.family.test(model.modelId) || story.family.test(model.label));
}

export function storyModels(story: ModelStory, catalog: Awaited<ReturnType<typeof loadGateway>> | undefined) {
  if (!catalog) return [];
  const available = new Set(catalog.status.providers.filter(p => p.available && p.mediaEntitlement !== 'not-included').map(p => p.id));
  return catalog.models.filter(model => matchesStory(story, model))
    .sort((a, b) => Number(available.has(b.provider)) - Number(available.has(a.provider)));
}
