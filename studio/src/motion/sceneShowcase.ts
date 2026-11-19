import type { StudioDestination, StudioScene } from './creativeStudios';
import { motionSkills } from './skillCatalog';
import lunar from './scene-art/apollo-11.jpg';
import product from './skill-covers/light-shadow-product.jpg';
import relight from './skill-covers/relight-reveal.jpg';
import splash from './skill-covers/splash-float-product.jpg';
import beat from './skill-covers/flat-beat.jpg';
import narration from './skill-covers/talking-head-recreation.jpg';
import camera from './skill-covers/babylon-js.jpg';
import splashClip from './skill-covers/splash-float-product.mp4';
import productClip from './skill-covers/light-shadow-product.mp4';
import welcomeMusic from '../../../template-library/openmotion-welcome/assets/soundtrack.m4a?url';

export interface SceneExample { title: string; prompt: string; poster: string; credit?: string; clip?: string; audio?: string }

const portrait = { title: 'Product portrait', prompt: 'Photograph an amber glass bottle in warm sidelight, with soft leaf shadows on stone.', poster: product };
const cameraStudy = { title: 'Shot still', prompt: 'Frame a vintage camera in soft sidelight. Let the background fall into shadow.', poster: camera };
const moon = { title: 'Lunar portrait', prompt: 'Frame a lone astronaut on a silver lunar plain. Use a low horizon, deep shadows and light reflected in the visor.', poster: lunar, credit: 'NASA · AS11-40-5903' };
const orange = { title: 'Slow motion detail', prompt: 'Film a slow-motion close-up of an orange soda bottle with citrus slices, mint and splashing water.', poster: splash, clip: splashClip };

export const sceneExamples: Record<StudioScene['id'], readonly [SceneExample, ...SceneExample[]]> = {
  'text-to-image': [portrait, moon, cameraStudy],
  'image-edit': [{ title: 'Image editing', prompt: 'Keep the product and its lettering. Light it from the side against a warm amber background.', poster: relight }],
  'shot-image': [moon, cameraStudy, portrait],
  'text-to-video': [orange],
  'image-to-video': [{ title: 'A cinematic opening', prompt: 'Start on the supplied frame. Push in slowly as a band of sunlight moves across the product.', poster: product, clip: productClip }],
  music: [{ title: 'Ambient soundtrack', prompt: 'Compose a quiet instrumental with soft piano and airy synths for a sunrise scene.', poster: beat, audio: welcomeMusic }],
  speech: [{ title: 'Warm narration', prompt: 'Every idea deserves to be seen. This is where our story begins.', poster: narration }],
};

export function studioExamples({ studio, scene }: StudioDestination): readonly SceneExample[] {
  if (studio.surface === 'techniques' && scene.id === 'text-to-video') {
    const skill = motionSkills.find(item => item.id === studio.techniques[0]);
    if (skill?.cover?.poster) return [{
      title: skill.title, poster: skill.cover.poster, clip: skill.cover.video, credit: skill.repository ? skill.name : undefined,
      prompt: studio.id === 'shorts' ? 'Frame a podcast host vertically as she leans into the microphone to deliver her opening line.' : skill.example,
    }];
  }
  return sceneExamples[scene.id];
}

export function sceneLayout(scene: StudioScene) {
  return scene.modality === 'image' && !('requiresImage' in scene) ? 'canvas' : 'workbench';
}
