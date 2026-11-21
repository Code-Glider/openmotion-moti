import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as htmlParser from '@hyperframes/parsers/html-attribute-spans';
import { exportSubtitleSegments, parseTranscriptSubtitles, type TranscriptSegment } from '../shared/transcript.ts';
import { createCaptionSourceOperations } from '../shared/transcript-captions.ts';
import { exportCaptionSource } from '../shared/caption-export.ts';

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
