import type { Model } from './gateway.ts';

export type GenerationOption = {
  key: string; label: string; kind: 'choice' | 'number' | 'boolean' | 'text';
  choices?: { value: string | number; label: string; requires?: Record<string, string | number> }[];
  default?: string | number | boolean; min?: number; max?: number; step?: number;
  presentation?: 'ratio' | 'count'; required?: boolean;
  /** The choices are suggestions: any other non-empty string is also accepted. */
  allowCustom?: boolean;
};
export type GenerationOptions = { delivery: 'provider' | 'prompt'; fields: GenerationOption[] };
const choice = (key: string, label: string, values: (string | number)[], value?: string | number, presentation?: GenerationOption['presentation']): GenerationOption => ({ key, label, kind: 'choice', choices: values.map(value => ({ value, label: String(value) })), default: value, presentation });
const number = (key: string, label: string, value?: number, min?: number, max?: number, step = 1): GenerationOption => ({ key, label, kind: 'number', default: value, min, max, step });
const toggle = (key: string, label: string, value = false): GenerationOption => ({ key, label, kind: 'boolean', default: value });
const text = (key: string, label: string, required = false): GenerationOption => ({ key, label, kind: 'text', required });

/** OpenDesign speech voices that produced audio through the media API on 2026-11-16; the first is the default.
 * Other voice IDs pass through unchecked: the media API publishes no voice list. Seed TTS 2.0 accepts only its
 * 2.0 (`*_uranus_bigtts`) speakers; 1.0 speakers fail upstream with a resource mismatch. */
const cloudSpeechVoices: Record<string, { value: string; label: string }[]> = {
  'byteplus-tts-2': [{ value: 'zh_female_vv_uranus_bigtts', label: 'Vivi · Chinese female' }],
  'elevenlabs-v3': [
    ['21m00Tcm4TlvDq8ikWAM', 'Rachel · Female'], ['JBFqnCBsd6RMkjVDRZzb', 'George · Male'], ['EXAVITQu4vr4xnSDxMaL', 'Sarah · Female'],
    ['pNInz6obpgDQGcFmaJgB', 'Adam · Male'], ['nPczCjzI2devNBz1zQrb', 'Brian · Male'], ['pFZP5JQG7iQjIQuC4Bku', 'Lily · Female'],
  ].map(([value, label]) => ({ value, label })),
};
const cloudSpeech = (model: Model) => ['opendesign', 'account'].includes(model.provider) && model.mode === 'text-to-speech';
// Own keys only: a model ID such as `constructor` must not resolve to an Object prototype member.
const checkedVoices = (model: Model) => Object.hasOwn(cloudSpeechVoices, model.modelId) ? cloudSpeechVoices[model.modelId] : undefined;
/** Parameters a request starts from: the model's saved defaults, and for OpenDesign speech its first checked voice.
 * The voice stays out of `model.defaults`, so Settings never shows or saves it as a user override. */
export function modelDefaults(model: Model): Record<string, unknown> {
  const voice = cloudSpeech(model) ? checkedVoices(model)?.[0].value : undefined;
  return voice ? { voice, ...model.defaults } : { ...model.defaults };
}

/** These Cloud models derive first-frame video geometry from the input image. */
export function usesInputImageRatio(model: Model, hasInputImage: boolean, parameters: Record<string, unknown> = {}): boolean {
  const images = { ...model.defaults, ...parameters }.images;
  const firstFrame = Array.isArray(images) && images.some(image => image && typeof image === 'object' && image.role === 'first_frame');
  return (hasInputImage || firstFrame) && model.modality === 'video' && ['opendesign', 'account'].includes(model.provider)
    && ['wan-2.7', 'doubao-seedance-2-5-260628', 'doubao-seedance-2-5-flash-261115'].includes(model.modelId);
}

/** Resolve defaults without carrying a text-to-video ratio into a first-frame request. */
export function resolveGenerationParameters(model: Model, parameters: Record<string, unknown>, hasInputImage = false): Record<string, unknown> {
  const resolved = { ...modelDefaults(model), ...parameters };
  if (usesInputImageRatio(model, hasInputImage, parameters)) {
    // An explicit fixed ratio is a conflicting instruction, not a default to silently replace.
    if (parameters.ratio !== undefined && parameters.ratio !== 'adaptive') throw new Error('First-frame video follows the input image ratio. Remove parameters.ratio or set it to "adaptive".');
    if (resolved.ratio !== 'adaptive') delete resolved.ratio;
  }
  return resolved;
}

function publishedDurations(nativeOptions: Record<string, unknown> | undefined): { values: number[]; default?: number; contiguous: boolean } | undefined {
  const raw = nativeOptions?.durations;
  const envelope = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  const rawValues = Array.isArray(raw) ? raw : Array.isArray(envelope?.values) ? envelope.values : undefined;
  if (!rawValues) return undefined;
  const unique = [...new Set(rawValues.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0))];
  if (!unique.length) return undefined;
  // Extract default before sorting since AMR places the default duration first (e.g. [5, 4, 6, ...]).
  const fallback = typeof envelope?.default === 'number' && unique.includes(envelope.default)
    ? envelope.default
    : Array.isArray(raw) ? unique[0] : undefined;
  const values = unique.sort((a, b) => a - b);
  const contiguous = values.length > 4 && values.every((v, i) => v === values[0] + i);
  return { values, ...(fallback !== undefined ? { default: fallback } : {}), contiguous };
}

function publishedStrings(nativeOptions: Record<string, unknown> | undefined, key: string): { values: string[]; default?: string } | undefined {
  const raw = nativeOptions?.[key];
  const envelope = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  const rawValues = Array.isArray(raw) ? raw : Array.isArray(envelope?.values) ? envelope.values : undefined;
  if (!rawValues) return undefined;
  const values = [...new Set(rawValues.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
  if (!values.length) return undefined;
  const rawDefault = typeof envelope?.default === 'string' ? envelope.default.trim() : undefined;
  const fallback = rawDefault && values.includes(rawDefault)
    ? rawDefault
    : Array.isArray(raw) ? values[0] : undefined;
  return { values, ...(fallback !== undefined ? { default: fallback } : {}) };
}

function sortResolutions(values: string[]): string[] {
  return values
    .map((value, idx) => {
      const match = /^(\d+)p$/i.exec(value);
      return { value, idx, rank: match ? Number(match[1]) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
    .map(item => item.value);
}

const seedance25Models = new Set(['doubao-seedance-2-5-260628', 'doubao-seedance-2-5-flash-261115']);
const alwaysOnVideoAudioModels = new Set(['wan-2.7']);

function parseAudioBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (['true', 'on', 'with_audio', 'yes', '1'].includes(normalized)) return true;
  if (['false', 'off', 'without_audio', 'no', '0'].includes(normalized)) return false;
  return undefined;
}

function publishedAudioToggle(model: Model): { default: boolean } | undefined {
  const envelope = publishedStrings(model.nativeOptions, 'audio');
  if (envelope) {
    const parsed = envelope.values.map(parseAudioBoolean).filter((v): v is boolean => v !== undefined);
    if (new Set(parsed).size >= 2) {
      const def = envelope.default ? parseAudioBoolean(envelope.default) : undefined;
      return { default: def ?? true };
    }
  }
  if (seedance25Models.has(model.modelId)) return { default: true };
  return undefined;
}

/** Whether an OpenDesign Cloud/account video model permanently generates native audio with no toggle. */
export function videoAudioAlwaysOn(model: Model): boolean {
  return ['opendesign', 'account'].includes(model.provider) && model.modality === 'video' && alwaysOnVideoAudioModels.has(model.modelId);
}

/** Whether an OpenDesign Cloud/account video model enables native audio when `generate_audio` is omitted. */
export function defaultVideoAudioEnabled(model: Model): boolean {
  return ['opendesign', 'account'].includes(model.provider) && model.modality === 'video'
    && (publishedAudioToggle(model)?.default === true || alwaysOnVideoAudioModels.has(model.modelId));
}

/** Exact endpoint profiles, checked 2026-11-15. Sources: docs/generation-options.md.
 * An unknown catalogue model deliberately gets no guessed schema. */
export function generationOptions(model: Model): GenerationOptions | undefined {
  const endpoint = `${model.provider}:${model.modelId}`;
  if (endpoint === 'codex:image-generation' && model.modality === 'image') return { delivery: 'prompt', fields: [
    choice('aspect_ratio', 'Aspect ratio', ['1:1', '4:3', '3:4', '16:9', '9:16'], undefined, 'ratio'),
    choice('background', 'Background', ['opaque', 'transparent']),
  ] };
  let fields: GenerationOption[] | undefined;
  if (endpoint === 'atlascloud:google/nano-banana-2/text-to-image' && model.modality === 'image') fields = [
    choice('aspect_ratio', 'Aspect ratio', ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], undefined, 'ratio'),
    choice('resolution', 'Resolution', ['1k', '2k', '4k']), choice('output_format', 'Output format', ['default', 'png', 'jpeg']),
    choice('thinking_level', 'Thinking level', ['default', 'minimal', 'high']), toggle('enable_web_search', 'Web search'), number('seed', 'Seed', -1),
  ];
  if (endpoint === 'atlascloud:bytedance/seedance-2.0/text-to-video' && model.modality === 'video') fields = [
    choice('ratio', 'Aspect ratio', ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], undefined, 'ratio'),
    { ...choice('resolution', 'Resolution', []), choices: ['480p', '720p', '720p-SR', '1080p', '1080p-SR', '1440p-SR', '4k'].map(value => ({ value, label: value, ...(value === '4k' ? { requires: { ratio: '16:9' } } : {}) })) },
    choice('duration', 'Duration (seconds)', [-1, ...Array.from({ length: 12 }, (_, i) => i + 4)], 5),
    toggle('generate_audio', 'Generate audio', true), choice('bitrate_mode', 'Bitrate', ['standard', 'high']), number('seed', 'Seed'),
  ];
  if (endpoint === 'atlascloud:suno/chirp-v4' && model.modality === 'audio') fields = [toggle('instrumental', 'Instrumental only'), choice('vocal_gender', 'Vocal gender', ['Male', 'Female'])];
  if (endpoint === 'fal:fal-ai/flux/schnell' && model.modality === 'image') fields = [
    { ...choice('image_size', 'Image size', [], 'landscape_4_3', 'ratio'), choices: [
      ['square_hd', '1:1 HD'], ['square', '1:1'], ['portrait_4_3', '3:4'], ['portrait_16_9', '9:16'], ['landscape_4_3', '4:3'], ['landscape_16_9', '16:9'],
    ].map(([value, label]) => ({ value, label })) },
    { ...number('num_images', 'Output count', 1, 1), presentation: 'count' }, choice('output_format', 'Output format', ['jpeg', 'png'], 'jpeg'), number('seed', 'Seed'),
  ];
  if (endpoint === 'fal:fal-ai/wan/v2.2-a14b/text-to-video' && model.modality === 'video') fields = [
    choice('aspect_ratio', 'Aspect ratio', ['16:9', '9:16', '1:1'], '16:9', 'ratio'), choice('resolution', 'Resolution', ['480p', '580p', '720p'], '720p'),
    number('num_frames', 'Frames', 81, 17, 161), number('frames_per_second', 'Frames per second', 16, 4, 60),
    toggle('enable_prompt_expansion', 'Expand prompt'), text('negative_prompt', 'Negative prompt'), number('seed', 'Seed'),
  ];
  if (endpoint === 'fal:fal-ai/kokoro/american-english' && model.modality === 'audio') fields = [
    choice('voice', 'Speech voice', ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa'], 'af_heart'),
    number('speed', 'Speech speed', 1, undefined, undefined, 0.1),
  ];
  // Cloud and account video models publish allowed parameters via `capabilities`.
  if (['opendesign', 'account'].includes(model.provider) && model.modality === 'video') {
    const videoFields: GenerationOption[] = [];
    const ratios = publishedStrings(model.nativeOptions, 'ratios');
    if (ratios) videoFields.push(choice('ratio', 'Aspect ratio', ratios.values, ratios.default, 'ratio'));
    const resolutions = publishedStrings(model.nativeOptions, 'resolutions');
    if (resolutions) videoFields.push(choice('resolution', 'Resolution', sortResolutions(resolutions.values), resolutions.default));
    const durations = publishedDurations(model.nativeOptions);
    if (durations) {
      videoFields.push(
        durations.contiguous
          ? number('duration', 'Duration (seconds)', durations.default, durations.values[0], durations.values.at(-1)!, 1)
          : choice('duration', 'Duration (seconds)', durations.values, durations.default),
      );
    }
    const audio = publishedAudioToggle(model);
    if (audio) videoFields.push(toggle('generate_audio', 'Generate audio', audio.default));
    if (videoFields.length) fields = videoFields;
  }
  // Speech models without checked voices keep a free voice ID: the API publishes no voice list.
  if (cloudSpeech(model)) { const voices = checkedVoices(model); fields = [voices ? { key: 'voice', label: 'Speech voice', kind: 'choice', choices: voices, default: voices[0].value, allowCustom: true } : text('voice', 'Voice ID', true)]; }
  // The connector's `audio music --duration` takes whole seconds; music models publish no duration range.
  if (model.provider === 'account' && model.modality === 'audio' && model.mode === 'text-to-audio') fields = [number('duration', 'Duration (seconds)', undefined, 1)];
  return fields ? { delivery: 'provider', fields } : undefined;
}

/** Validate maintained fields; preserve the advanced provider-native escape hatch. */
export function validateGenerationOptions(model: Model, parameters: Record<string, unknown>) {
  for (const field of generationOptions(model)?.fields ?? []) {
    const value = parameters[field.key];
    if (value === undefined) { if (field.required) throw new Error(`${field.label} is required`); continue; }
    // fal also accepts custom dimensions; the quick picker is only a subset.
    if (field.key === 'image_size' && value && typeof value === 'object' && !Array.isArray(value)) {
      const { width, height } = value as Record<string, unknown>;
      if ([width, height].every(n => typeof n === 'number' && Number.isInteger(n) && n > 0)) continue;
    }
    if (field.allowCustom && typeof value === 'string' && value.trim() && !field.choices?.some(c => c.value === value)) continue;
    const valid = field.kind === 'choice' ? field.choices?.some(c => c.value === value)
      : field.kind === 'boolean' ? typeof value === 'boolean'
      : field.kind === 'text' ? typeof value === 'string' && (!field.required || !!value.trim())
      : typeof value === 'number' && Number.isFinite(value) && (field.step !== 1 || Number.isInteger(value)) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
    if (!valid) throw new Error(`Invalid ${field.label}: ${field.key}`);
    const requires = field.choices?.find(c => c.value === value)?.requires;
    if (requires) for (const [key, required] of Object.entries(requires)) {
      if (parameters[key] !== required) throw new Error(`${field.label} ${value} requires ${key} ${required}`);
    }
  }
}
