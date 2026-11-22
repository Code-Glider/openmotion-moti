import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import * as htmlParser from '@hyperframes/parsers/html-attribute-spans';
import { exportSubtitleSegments, parseTranscriptSubtitles, type TranscriptSegment } from '../shared/transcript.ts';
import { createCaptionSourceOperations } from '../shared/transcript-captions.ts';
import { exportCaptionSource } from '../shared/caption-export.ts';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';

const nativeBase = '<html><body><div data-composition-id="main" data-duration="8" data-width="640" data-height="360"></div></body></html>';
const { manualCaptionSource, captionTracks, updateCaptionTrackSource } = createCaptionSourceOperations(htmlParser);

const semiticCues: TranscriptSegment[] = [
  { id: 'he', text: 'שָׁלוֹם, 2026 ABC!', start: 0.1, end: 0.82 },
  { id: 'ar', text: 'السَّلَامُ عَلَيْكُمْ؟', start: 0.95, end: 1.65 },
  { id: 'fa', text: 'سلام، فارسی ۱۲۳', start: 1.75, end: 2.45 },
  { id: 'ur', text: 'سَلام، اردو؟', start: 2.6, end: 3.35 },
  { id: 'syr', text: 'ܫܠܡܐ ܥܠܘܟܘܢ 2026', start: 3.5, end: 4.25 },
  { id: 'controls', text: 'እንዴት ነህ? English & <bdi> \u200fאב\u200e\u00a0A', start: 4.4, end: 5.75 },
];
const values = (cues: TranscriptSegment[]) => cues.map(({ text, start, end }) => ({ text, start, end }));

test('WebVTT decodes baseline BiDi and no-break references once; SRT stays literal', () => {
  const payload = 'שָׁלוֹם &rlm;ABC&lrm; &nbsp;ܫܠܡܐ &amp;rlm; &lt;2026&gt; &unsupported;';
  const suffix = '1\n00:00:00.100 --> 00:00:01.200\n' + payload + '\n';
  const expected = 'שָׁלוֹם \u200fABC\u200e \u00a0ܫܠܡܐ &rlm; <2026> &unsupported;';
  assert.equal(parseTranscriptSubtitles('WEBVTT\n\n' + suffix)[0].text, expected);
  assert.equal(parseTranscriptSubtitles('\uFEFFWEBVTT Demo\n\n' + suffix)[0].text, expected);
  assert.equal(parseTranscriptSubtitles(suffix.replace(/\./g, ','))[0].text, payload);
});

test('native SRT/VTT authoring reimport and export preserve six-script logical strings and clock', () => {
  for (const format of ['srt', 'vtt'] as const) {
    const sidecar = exportSubtitleSegments(semiticCues, format);
    assert.deepEqual(values(parseTranscriptSubtitles(sidecar.content)), values(semiticCues));
    const authored = manualCaptionSource(nativeBase, 'bidi-track', {
      subtitles: sidecar.content,
      captionSettings: { language: 'he', direction: 'rtl' },
    });
    assert.equal(authored.count, semiticCues.length);
    assert.equal(captionTracks(authored.content)[0].id, 'bidi-track');
    assert.equal(captionTracks(authored.content)[0].settings.language, 'he');
    assert.equal(captionTracks(authored.content)[0].settings.direction, 'rtl');

    const output = exportCaptionSource(authored.content, format, parseHTML, 'bidi-track');
    assert.equal(output.cueCount, semiticCues.length);
    assert.deepEqual(values(parseTranscriptSubtitles(output.content)), values(semiticCues));

    // Direction is clip metadata, not a Unicode rewrite or a media-time reversal.
    const opposite = updateCaptionTrackSource(authored.content, 'bidi-track', { direction: 'ltr' }).content;
    assert.equal(captionTracks(opposite)[0].settings.direction, 'ltr');
    assert.deepEqual(
      values(parseTranscriptSubtitles(exportCaptionSource(opposite, format, parseHTML, 'bidi-track').content)),
      values(semiticCues),
    );
    const restored = manualCaptionSource(nativeBase, 'reimported-bidi', { subtitles: output.content });
    assert.deepEqual(
      values(parseTranscriptSubtitles(exportCaptionSource(restored.content, format, parseHTML, 'reimported-bidi').content)),
      values(semiticCues),
    );
  }
});


test('native project versions restore and reapply six-script SRT/VTT captions without rewriting text or timing', async () => {
  for (const format of ['srt', 'vtt'] as const) {
    await fixture(async store => {
      const service = new Phase1Service(store, pluginRoot, {
        origin: () => 'http://127.0.0.1:4173',
        nativeUrl: () => undefined,
        openProject: async () => {},
        mutation: async task => task(),
        cancel: async () => {},
      });
      const projectId = store.projectId;
      const htmlPath = path.join(store.projectDirectory, 'index.html');
      const call = (transcript: Record<string, unknown>) =>
        service.call('openmotion_assets_use', { action: 'transcript', transcript });
      const detail = () => service.call('openmotion_get_project', { projectId });
      const source = () => readFile(htmlPath, 'utf8');
      const restore = async (versionId: string, requestId: string) => {
        const current = await detail();
        await service.call('openmotion_restore_version', {
          projectId, versionId, requestId,
          expectedRevision: current.revision,
          expectedVersionId: current.currentVersionId,
        });
      };
      const expected = values(semiticCues).map(cue => ({
        text: cue.text,
        start: Math.round((cue.start + 0.25) * 1000) / 1000,
        end: Math.round((cue.end + 0.25) * 1000) / 1000,
      }));
      const original = await detail();
      const originalHtml = await source();
      const request = {
        command: 'caption_add', projectId, compositionPath: 'index.html',
        subtitles: exportSubtitleSegments(semiticCues, format).content,
        timelineStart: 0.25, requestId: 'native-version-import',
        expectedRevision: original.revision,
        expectedVersionId: original.currentVersionId,
      };
      const added = await call(request);
      assert.equal(added.captionCount, semiticCues.length);
      assert.equal((await call(request)).replayed, true);
      const addedVersion = await detail();
      const addedHtml = await source();
      const exported = await call({
        command: 'caption_export', projectId, compositionPath: 'index.html',
        transcriptId: added.trackId, format,
      });
      assert.deepEqual(values(parseTranscriptSubtitles(exported.content)), expected);
      assert.notEqual(addedHtml, originalHtml);

      // Edit only caption presentation; it must not rewrite logical Unicode
      // or the timeline clock. A native version restore represents actual
      // on-disk undo/reapply, not an in-memory string-copy simulation.
      await call({
        command: 'caption_update', projectId, compositionPath: 'index.html',
        transcriptId: added.trackId, captionSettings: { direction: 'ltr', language: 'ar' },
        requestId: 'native-version-direction-edit',
        expectedRevision: addedVersion.revision,
        expectedVersionId: addedVersion.currentVersionId,
      });
      const editedVersion = await detail();
      const editedHtml = await source();
      assert.notEqual(editedHtml, addedHtml);
      assert.equal((await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' }))
        .tracks.find((track: { id: string }) => track.id === added.trackId)?.settings.direction, 'ltr');
      assert.deepEqual(values(parseTranscriptSubtitles((await call({
        command: 'caption_export', projectId, compositionPath: 'index.html',
        transcriptId: added.trackId, format,
      })).content)), expected);

      await restore(addedVersion.currentVersionId, 'native-version-undo-direction');
      assert.equal(await source(), addedHtml);
      await restore(editedVersion.currentVersionId, 'native-version-redo-direction');
      assert.equal(await source(), editedHtml);
      await restore(original.currentVersionId, 'native-version-undo-import');
      assert.equal(await source(), originalHtml);
      await restore(addedVersion.currentVersionId, 'native-version-redo-import');
      assert.equal(await source(), addedHtml);
      assert.deepEqual(values(parseTranscriptSubtitles((await call({
        command: 'caption_export', projectId, compositionPath: 'index.html',
        transcriptId: added.trackId, format,
      })).content)), expected);
      await assert.rejects(call({ ...request, requestId: 'stale-import' }), /VERSION_CONFLICT/);

      // A second native import of the exported sidecar must coexist with the
      // original captions. Revert the second import and confirm byte-for-byte
      // recovery of the first authored native project file.
      const current = await detail();
      const second = await call({
        command: 'caption_add', projectId, compositionPath: 'index.html',
        subtitles: exported.content, requestId: 'native-version-reimport',
        expectedRevision: current.revision,
        expectedVersionId: current.currentVersionId,
      });
      assert.notEqual(second.trackId, added.trackId);
      const tracks = (await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks;
      assert.equal(tracks.filter((track: { id: string }) =>
        track.id === added.trackId || track.id === second.trackId).length, 2);
      assert.deepEqual(values(parseTranscriptSubtitles((await call({
        command: 'caption_export', projectId, compositionPath: 'index.html',
        transcriptId: second.trackId, format,
      })).content)), expected);
      await restore(current.currentVersionId, 'native-version-undo-reimport');
      assert.equal(await source(), addedHtml);
    });
  }
});
