import test from 'node:test';
import assert from 'node:assert/strict';
import { generationOptions, modelDefaults, resolveGenerationParameters, usesInputImageRatio, validateGenerationOptions } from '../shared/generation-options.ts';
import { builtinModels } from '../gateway/catalog.ts';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { providerAdapters } from '../gateway/providers.ts';
import type { GenerationJob, Model } from '../shared/gateway.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import type { AccountSummary } from '../shared/provider-directory.ts';

for (const provider of ['opendesign', 'account']) for (const modelId of ['wan-2.7', 'doubao-seedance-2-5-260628']) {
  test(`${provider}:${modelId} first-frame parameters follow the image without inheriting a fixed ratio`, () => {
    const model: Model = { id: `${provider}:${modelId}`, provider, modelId, label: modelId, modality: 'video', mode: 'text-to-video', source: 'live',
      defaults: { ratio: '16:9', duration: 5 }, nativeOptions: { ratios: { default: '16:9' } } };
    const explicit = { ratio: '9:16', duration: 4 };
    assert.throws(() => resolveGenerationParameters(model, explicit, true), /First-frame video.*Remove parameters.ratio.*adaptive/);
    for (const ratio of ['16:9', '', null, 1]) assert.throws(() => resolveGenerationParameters(model, { ratio }, true), /First-frame video/);
    assert.deepEqual(resolveGenerationParameters(model, {}, true), { duration: 5 });
    assert.deepEqual(resolveGenerationParameters(model, { ratio: 'adaptive' }, true), { duration: 5, ratio: 'adaptive' });
    assert.deepEqual(resolveGenerationParameters({ ...model, defaults: { ratio: 'adaptive' } }, {}, true), { ratio: 'adaptive' });
    assert.deepEqual(resolveGenerationParameters({ ...model, defaults: undefined }, {}, true), {});
    // Text-only generation keeps both saved and explicit fixed ratios, without mutating their source.
    assert.deepEqual(resolveGenerationParameters(model, {}), { ratio: '16:9', duration: 5 });
    assert.deepEqual(resolveGenerationParameters(model, explicit), explicit);
    assert.deepEqual(model.defaults, { ratio: '16:9', duration: 5 });
    assert.deepEqual(explicit, { ratio: '9:16', duration: 4 });
    const images = [{ asset_id: 'ma_frame', role: 'first_frame' }];
    assert.equal(usesInputImageRatio(model, false, { images }), true);
    assert.throws(() => resolveGenerationParameters(model, { images, ratio: '16:9' }), /First-frame video/);
    assert.deepEqual(resolveGenerationParameters(model, { images }), { duration: 5, images });
    assert.deepEqual(resolveGenerationParameters({ ...model, defaults: { ...model.defaults, images } }, {}), { duration: 5, images });
  });
}

test('first-frame ratio policy leaves other providers, models and image editing unchanged', () => {
  const base: Model = { id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live', defaults: { ratio: '16:9' } };
  for (const model of [{ ...base, provider: 'fal' }, { ...base, provider: 'atlascloud' }, { ...base, modelId: 'future-video' }, { ...base, modality: 'image' as const }]) {
    assert.equal(usesInputImageRatio(model, true), false);
    assert.deepEqual(resolveGenerationParameters(model, { ratio: '4:3' }, true), { ratio: '4:3' });
  }
});

test('account first-frame ratio rejection makes no connector call and does not enable account video references', () => fixture(async store => {
  let calls = 0;
  const account = new OpenDesignAccount(store.directory, { run: async () => { calls++; throw new Error('unexpected connector call'); } });
  account.identity = async () => 'fixture-session';
  account.summary = async () => ({ state: 'signed-in' } as AccountSummary);
  const model: Model = { id: 'account:wan-2.7', provider: 'account', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live', defaults: { ratio: '16:9' } };
  const job = { model, modality: 'video', providerOrigin: 'fixture-session', parameters: { ratio: '16:9' } } as GenerationJob;
  try {
    const run = (parameters: Record<string, unknown>) => account.generate({ ...job, parameters }, store.directory, new AbortController().signal, async () => {}, 'not-read.png');
    await assert.rejects(run({ ratio: '16:9' }), /First-frame video/);
    for (const parameters of [{}, { ratio: 'adaptive' }]) await assert.rejects(run(parameters), /Account reference images are supported for image editing only/);
    assert.equal(calls, 0);
  } finally { account.close(); }
}));

test('exact endpoint schemas preserve provider types and never guess from a model label', () => {
  const seedance = builtinModels.find(m => m.modelId === 'bytedance/seedance-2.0/text-to-video')!;
  const schema = generationOptions(seedance)!;
  assert.equal(schema.fields.find(f => f.key === 'duration')!.choices![2].value, 5);
  assert.ok(schema.fields.some(f => f.key === 'ratio'));
  assert.ok(!schema.fields.some(f => f.key === 'aspect_ratio'));
  assert.throws(() => validateGenerationOptions(seedance, { duration: '5' }), /Invalid Duration/);
  assert.throws(() => validateGenerationOptions(seedance, { generate_audio: 'true' }), /Invalid Generate audio/);
  validateGenerationOptions(seedance, { duration: 5, generate_audio: true });
  assert.throws(() => validateGenerationOptions(seedance, { resolution: '4k', ratio: '9:16' }), /requires ratio 16:9/);
  validateGenerationOptions(seedance, { resolution: '4k', ratio: '16:9' });
  assert.equal(generationOptions({ ...seedance, modelId: 'unknown', label: seedance.label }), undefined);
  const flux = builtinModels.find(m => m.modelId === 'fal-ai/flux/schnell')!;
  validateGenerationOptions(flux, { image_size: { width: 1280, height: 720 } });
  assert.throws(() => validateGenerationOptions(flux, { num_images: 1.5 }), /Output count/);
  const codex = builtinModels.find(m => m.provider === 'codex')!;
  assert.equal(generationOptions(codex)?.delivery, 'prompt');
});

test('discovery returns the same schema used to reject invalid submissions before queueing', () => fixture(async store => {
  const gateway = gatewayFor(store);
  await gateway.configureProvider('atlascloud', { apiKey: 'fixture-only' });
  const { models } = await gateway.listModels({ provider: 'atlascloud', modality: 'video' });
  const model = models.find(m => m.modelId === 'bytedance/seedance-2.0/text-to-video')!;
  assert.deepEqual(model.generationOptions, generationOptions(model));
  const input = { modality: 'video' as const, prompt: 'Ocean', model: model.id, library: {}, idempotencyKey: 'typed-video' };
  await assert.rejects(gateway.submit({ ...input, parameters: { duration: '5' } }), /Invalid Duration/);
  assert.equal((await gateway.listJobs()).length, 0);
  const original = await gateway.submit({ ...input, parameters: { duration: 5, ratio: '9:16' } });
  assert.deepEqual(original.parameters, { duration: 5, ratio: '9:16' });
  assert.equal((await gateway.submit({ ...input, parameters: original.parameters })).id, original.id);
  assert.equal((await gateway.listJobs()).length, 1);
}));

test('Kokoro sends spoken text in prompt alongside native voice and speed, without retry', async () => {
  const bodies: any[] = [], model = builtinModels.find(m => m.modelId === 'fal-ai/kokoro/american-english')!;
  const job = { model, modality: 'audio', prompt: 'Hello world', parameters: { voice: 'af_heart', speed: 1.2 } } as GenerationJob;
  const urls = await providerAdapters.fal.generate(job, {
    key: 'fixture-only', signal: new AbortController().signal, progress: async () => {}, pollMs: 0,
    fetcher: async (_url, init) => {
      if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return Response.json({ request_id: 'test', status_url: 'https://queue.fal.run/request/status', response_url: 'https://queue.fal.run/request/result' }); }
      return Response.json(String(_url).endsWith('status') ? { status: 'COMPLETED' } : { audio: { url: 'https://cdn.example/voice.wav' } });
    },
  });
  assert.deepEqual(bodies, [{ prompt: 'Hello world', voice: 'af_heart', speed: 1.2 }]);
  assert.deepEqual(urls, ['https://cdn.example/voice.wav']);
});

test('OpenDesign speech offers checked voices with a default, accepts other voice IDs, and keeps a free voice ID for other models', () => fixture(async store => {
  const byteplus = builtinModels.find(m => m.id === 'opendesign:byteplus-tts-2')!, eleven = builtinModels.find(m => m.id === 'opendesign:elevenlabs-v3')!;
  const [voice] = generationOptions(byteplus)!.fields;
  assert.deepEqual([voice.key, voice.kind, voice.default, voice.required, voice.allowCustom], ['voice', 'choice', 'zh_female_vv_uranus_bigtts', undefined, true]);
  assert.equal(generationOptions(eleven)!.fields[0].choices!.length, 6);
  // The list is a checked subset: an unlisted voice ID still reaches the provider, but a blank or non-string one does not.
  assert.doesNotThrow(() => validateGenerationOptions(byteplus, { voice: 'zh_female_xiaohe_uranus_bigtts' }));
  assert.throws(() => validateGenerationOptions(byteplus, { voice: ' ' }), /Invalid Speech voice/);
  assert.throws(() => validateGenerationOptions(eleven, { voice: 1 }), /Invalid Speech voice/);
  assert.deepEqual(modelDefaults({ ...eleven, id: 'account:elevenlabs-v3', provider: 'account' }), { voice: '21m00Tcm4TlvDq8ikWAM' });
  // A saved override still wins over the built-in default.
  assert.deepEqual(modelDefaults({ ...eleven, defaults: { voice: 'JBFqnCBsd6RMkjVDRZzb' } }), { voice: 'JBFqnCBsd6RMkjVDRZzb' });
  const other = { ...byteplus, id: 'opendesign:other-tts', modelId: 'other-tts' };
  assert.deepEqual(modelDefaults(other), {});
  assert.throws(() => validateGenerationOptions(other, {}), /Voice ID is required/);
  const prototypeName = { ...byteplus, id: 'opendesign:constructor', modelId: 'constructor' };
  assert.deepEqual(modelDefaults(prototypeName), {});
  assert.throws(() => validateGenerationOptions(prototypeName, {}), /Voice ID is required/);
  assert.deepEqual(modelDefaults({ ...byteplus, mode: 'text-to-audio' }), {});
  // Discovery shows the default through the schema; the model's saved defaults stay empty for Settings.
  const gateway = gatewayFor(store);
  await gateway.configureProvider('opendesign', { apiKey: 'fixture-only' });
  const { models } = await gateway.listModels({ provider: 'opendesign', modality: 'audio' });
  const listed = models.find(m => m.id === byteplus.id)!;
  assert.equal(listed.generationOptions!.fields[0].default, 'zh_female_vv_uranus_bigtts');
  assert.equal(listed.defaults?.voice, undefined);
  await gateway.close();
}));

test('OpenDesign Cloud and account video models derive options from published capabilities and native audio policy', async () => {
  // Unsorted AMR-style arrays where default `5` comes first.
  const seedanceDurations = [5, 4, ...Array.from({ length: 25 }, (_, i) => i + 6)];
  const wanDurations = [5, 2, 3, 4, ...Array.from({ length: 10 }, (_, i) => i + 6)];
  for (const provider of ['opendesign', 'account']) {
    const seedance: Model = {
      id: `${provider}:doubao-seedance-2-5-260628`, provider, modelId: 'doubao-seedance-2-5-260628', label: 'doubao-seedance-2-5-260628',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: {
        durations: { values: seedanceDurations, default: 5 },
        ratios: { values: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], default: '16:9' },
        resolutions: { values: ['720p', '480p', '1080p'], default: '720p' },
      },
    };
    const seedanceFlash: Model = {
      ...seedance, id: `${provider}:doubao-seedance-2-5-flash-261115`, modelId: 'doubao-seedance-2-5-flash-261115', label: 'doubao-seedance-2-5-flash-261115',
    };
    const wan: Model = {
      id: `${provider}:wan-2.7`, provider, modelId: 'wan-2.7', label: 'wan-2.7',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: {
        durations: { values: wanDurations, default: 5 },
        ratios: { values: ['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'], default: '16:9' },
        resolutions: { values: ['720p', '1080p'], default: '720p' },
      },
    };
    const seedance20: Model = {
      id: `${provider}:doubao-seedance-2-0-260128`, provider, modelId: 'doubao-seedance-2-0-260128', label: 'doubao-seedance-2-0-260128',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: { durations: { values: [5, 10], default: 5 } },
    };

    const seedanceFields = generationOptions(seedance)!.fields;
    assert.deepEqual(seedanceFields.map(f => f.key), ['ratio', 'resolution', 'duration', 'generate_audio']);
    assert.equal(seedanceFields.find(f => f.key === 'ratio')!.presentation, 'ratio');
    assert.deepEqual(seedanceFields.find(f => f.key === 'resolution')!.choices!.map(c => c.value), ['480p', '720p', '1080p']);
    assert.equal(seedanceFields.find(f => f.key === 'resolution')!.default, '720p');
    const seedanceDuration = seedanceFields.find(f => f.key === 'duration')!;
    assert.deepEqual([seedanceDuration.kind, seedanceDuration.min, seedanceDuration.max, seedanceDuration.step, seedanceDuration.default], ['number', 4, 30, 1, 5]);
    const seedanceAudio = seedanceFields.find(f => f.key === 'generate_audio')!;
    assert.deepEqual([seedanceAudio.kind, seedanceAudio.default], ['boolean', true]);

    const flashFields = generationOptions(seedanceFlash)!.fields;
    assert.equal(flashFields.find(f => f.key === 'generate_audio')!.default, true);
    assert.equal(usesInputImageRatio(seedanceFlash, true), true);

    const wanFields = generationOptions(wan)!.fields;
    assert.deepEqual(wanFields.map(f => f.key), ['ratio', 'resolution', 'duration']);
    const wanDuration = wanFields.find(f => f.key === 'duration')!;
    assert.deepEqual([wanDuration.kind, wanDuration.min, wanDuration.max, wanDuration.step, wanDuration.default], ['number', 2, 15, 1, 5]);
    assert.equal(wanFields.some(f => f.key === 'generate_audio'), false);

    const [seedance20Duration] = generationOptions(seedance20)!.fields;
    assert.equal(seedance20Duration.kind, 'choice');
    assert.deepEqual(seedance20Duration.choices!.map(c => c.value), [5, 10]);

    validateGenerationOptions(seedance, { duration: 15, generate_audio: false });
    validateGenerationOptions(seedance, { duration: 30, resolution: '1080p', ratio: '16:9' });
    assert.throws(() => validateGenerationOptions(seedance, { duration: 31 }), /Invalid Duration/);
    assert.throws(() => validateGenerationOptions(seedance, { duration: 15.5 }), /Invalid Duration/);
    assert.throws(() => validateGenerationOptions(seedance, { duration: '15' }), /Invalid Duration/);
    validateGenerationOptions(wan, { duration: 2 });
    validateGenerationOptions(wan, { duration: 15 });
    assert.throws(() => validateGenerationOptions(wan, { duration: 16 }), /Invalid Duration/);
    assert.equal(generationOptions({ ...wan, nativeOptions: {} }), undefined);
    assert.equal(generationOptions({ ...wan, nativeOptions: { durations: { values: [] } } }), undefined);
  }
});

test('account catalogue preserves capabilities and forwards explicit duration and native audio policy', () => fixture(async store => {
  const calls: string[][] = [];
  const account = new OpenDesignAccount(store.directory, {
    run: async args => {
      calls.push(args);
      if (args[0] === 'model') return JSON.stringify({ source: 'remote', data: [] });
      if (args[0] === 'media') {
        return JSON.stringify({
          models: [
            {
              model: 'doubao-seedance-2-5-260628', kind: 'video',
              capabilities: {
                durations: { values: [5, 4, ...Array.from({ length: 25 }, (_, i) => i + 6)], default: 5 },
                ratios: { values: ['16:9', '9:16', 'adaptive'], default: '16:9' },
                resolutions: { values: ['720p', '480p', '1080p'], default: '720p' },
              },
            },
            {
              model: 'wan-2.7', kind: 'video',
              capabilities: {
                durations: { values: [5, 2, 3, 4, ...Array.from({ length: 10 }, (_, i) => i + 6)], default: 5 },
                ratios: { values: ['16:9', '9:16', 'adaptive'], default: '16:9' },
                resolutions: { values: ['720p', '1080p'], default: '720p' },
              },
            },
          ],
        });
      }
      if (args[0] === 'video' && args[1] === 'gen') return JSON.stringify({ task_id: `vt_${calls.length}` });
      if (args[0] === 'video' && args[1] === 'get') {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(args[args.indexOf('--output') + 1], Buffer.from('mp4'));
        return JSON.stringify({ task_id: args[2], status: 'succeeded' });
      }
      throw new Error(`unexpected call: ${args.join(' ')}`);
    },
    pollMs: 0,
  });
  account.profile = async () => ({ runtimeKey: 'fixture-key' });
  account.identity = async () => 'fixture-session';
  account.summary = async () => ({ state: 'signed-in' } as AccountSummary);
  try {
    await account.models(true);
    const media = await account.mediaModels();
    const seedance = media.find(m => m.modelId === 'doubao-seedance-2-5-260628')!;
    const wan = media.find(m => m.modelId === 'wan-2.7')!;
    assert.equal(generationOptions(seedance)!.fields.find(f => f.key === 'duration')!.max, 30);
    assert.equal(generationOptions(wan)!.fields.find(f => f.key === 'duration')!.min, 2);

    // 1. Seedance 2.5 with omitted generate_audio defaults to `--generate-audio`.
    await account.generate(
      { id: 'job-15s-audio-default', model: seedance, modality: 'video', prompt: 'Drive along the boulevard', providerOrigin: 'fixture-session', parameters: { duration: 15 } } as GenerationJob,
      store.directory, new AbortController().signal, async () => {},
    );
    const defaultAudioArgs = calls.filter(args => args[0] === 'video' && args[1] === 'gen').at(-1)!;
    assert.equal(defaultAudioArgs[defaultAudioArgs.indexOf('--duration') + 1], '15');
    assert.ok(defaultAudioArgs.includes('--generate-audio'));
    assert.ok(!defaultAudioArgs.includes('--generate-audio=false'));

    // 2. Seedance 2.5 with explicit generate_audio: false passes `--generate-audio=false`.
    await account.generate(
      { id: 'job-15s-audio-off', model: seedance, modality: 'video', prompt: 'Silent boulevard', providerOrigin: 'fixture-session', parameters: { duration: 15, generate_audio: false } } as GenerationJob,
      store.directory, new AbortController().signal, async () => {},
    );
    const silentArgs = calls.filter(args => args[0] === 'video' && args[1] === 'gen').at(-1)!;
    assert.equal(silentArgs[silentArgs.indexOf('--duration') + 1], '15');
    assert.ok(silentArgs.includes('--generate-audio=false'));

    // 3. wan-2.7 omits --generate-audio flags so AMR keeps native audio enabled without 400.
    await account.generate(
      { id: 'job-wan-10s', model: wan, modality: 'video', prompt: 'Ocean cliff', providerOrigin: 'fixture-session', parameters: { duration: 10 } } as GenerationJob,
      store.directory, new AbortController().signal, async () => {},
    );
    const wanArgs = calls.filter(args => args[0] === 'video' && args[1] === 'gen').at(-1)!;
    assert.equal(wanArgs[wanArgs.indexOf('--duration') + 1], '10');
    assert.ok(!wanArgs.includes('--generate-audio') && !wanArgs.includes('--generate-audio=false'));
  } finally { account.close(); }
}));
