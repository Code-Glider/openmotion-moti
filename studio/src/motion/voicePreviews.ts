import type { Model } from '../../../shared/gateway';
import { generationOptions } from '../../../shared/generation-options';
import type { SoundPlayableTrack } from './SoundPlayerDock';
import { deterministicWaveform } from './soundPresets';

export interface VoicePreviewSource {
  src: string;
  /** Fetch through a blob URL when same-origin or CORS-enabled with non-audio Content-Type (e.g. GCS text/plain MP3s). */
  blobSource?: boolean;
}

export interface VoicePreviewTarget {
  value: string;
  name: string;
  detail: string;
  previewUrl?: string;
}

export interface VoicePreviewController {
  activeTrackId?: string;
  playing: boolean;
  loading: boolean;
  resolve: (model: Model, voice: VoicePreviewTarget) => VoicePreviewSource | undefined;
  toggle: (model: Model, voice: VoicePreviewTarget) => void;
}

const kokoroModules = import.meta.glob<string>('./voice-previews/kokoro/kokoro-*.m4a', {
  eager: true,
  query: '?url',
  import: 'default',
});

const kokoroPreviewUrls: Record<string, string> = Object.fromEntries(
  Object.entries(kokoroModules).flatMap(([filePath, url]) => {
    const match = filePath.match(/\/kokoro-([a-z0-9_]+)\.m4a$/i);
    return match ? [[match[1], url]] : [];
  }),
);

const byteplusModules = import.meta.glob<string>('./voice-previews/byteplus/byteplus-*.m4a', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byteplusPreviewUrls: Record<string, string> = Object.fromEntries(
  Object.entries(byteplusModules).flatMap(([filePath, url]) => {
    const match = filePath.match(/\/byteplus-([a-z0-9_]+)\.m4a$/i);
    return match ? [[match[1], url]] : [];
  }),
);

export function voicePreviewTrackId(modelId: string, voiceValue: string): string {
  return `voice:${modelId}:${voiceValue}`;
}

function compiledChoicePreviewUrl(model: Model, voiceValue: string): string | undefined {
  const voiceField = generationOptions(model)?.fields.find(field => field.key === 'voice');
  return voiceField?.choices?.find(choice => String(choice.value) === voiceValue)?.previewUrl;
}

/** Resolve an authentic audition sample for a voice: bundled local sample or official provider preview URL. */
export function resolveVoicePreview(
  model: Model,
  voiceValue: string,
  choicePreviewUrl?: string,
): VoicePreviewSource | undefined {
  if (model.modelId === 'fal-ai/kokoro/american-english') {
    const bundled = Object.hasOwn(kokoroPreviewUrls, voiceValue) ? kokoroPreviewUrls[voiceValue] : undefined;
    if (bundled) return { src: bundled, blobSource: true };
  }

  if (model.modelId === 'byteplus-tts-2') {
    const bundled = Object.hasOwn(byteplusPreviewUrls, voiceValue) ? byteplusPreviewUrls[voiceValue] : undefined;
    if (bundled) return { src: bundled, blobSource: true };
  }

  const remoteUrl = choicePreviewUrl ?? compiledChoicePreviewUrl(model, voiceValue);
  if (remoteUrl && /^https:\/\//i.test(remoteUrl)) {
    const normalizeGcsAudio = remoteUrl.startsWith('https://storage.googleapis.com/eleven-public-prod/');
    return { src: remoteUrl, blobSource: normalizeGcsAudio };
  }

  return undefined;
}

export function buildVoicePreviewTrack(
  model: Model,
  voice: VoicePreviewTarget,
  source: VoicePreviewSource,
  t: (text: string) => string,
): SoundPlayableTrack {
  const subtitle = [model.label, voice.detail ? t(voice.detail) : ''].filter(Boolean).join(' · ');
  return {
    id: voicePreviewTrackId(model.id, voice.value),
    kind: 'voice',
    title: voice.name,
    subtitle,
    src: source.src,
    blobSource: source.blobSource,
    waveform: deterministicWaveform(`voice:${model.id}:${voice.value}`, 44),
  };
}
