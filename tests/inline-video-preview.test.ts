import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { inlinePlaybackBytes } from '../inline-video.ts';

test('large final videos play a cached, smaller preview while small ones embed the verified bytes', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inline-preview-'));
  try {
    const { ffmpeg, ffprobe } = verificationBinaries(), source = path.join(directory, 'film.mp4');
    const made = await execute(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], directory, 60_000);
    assert.equal(made.code, 0, made.stderr);
    const bytes = await readFile(source), cache = path.join(directory, 'cache', 'preview.mp4');
    assert.equal(await inlinePlaybackBytes(source, bytes, cache, directory, bytes.length), bytes);
    const limit = Math.floor(bytes.length / 4);
    const preview = await inlinePlaybackBytes(source, bytes, cache, directory, limit);
    assert.ok(preview.length > 0 && preview.length <= limit, `${preview.length} > ${limit}`);
    assert.deepEqual(await inlinePlaybackBytes(source, bytes, cache, directory, limit), preview);
    const probe = await execute(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,height', '-of', 'csv=p=0', cache], directory, 30_000);
    assert.match(probe.stdout, /video/); assert.match(probe.stdout, /audio/);
    await rm(cache);
    await assert.rejects(inlinePlaybackBytes(source, bytes, cache, directory, 100), /INLINE_MEDIA_UNAVAILABLE/);
    assert.equal((await stat(source)).size, bytes.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
