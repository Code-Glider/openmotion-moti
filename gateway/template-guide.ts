import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { authoredTemplateGuide, jsonForHtml, parseTemplateGuideDraft, type TemplateGuideDraft } from '../shared/template-guide.ts';
import type { TemplateCatalog } from '../prism-templates.ts';
import { createBlankProject } from '../workspace.ts';

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
/** Convert the selected guide's actual canvas example, never a different built-in film. */
export async function materializeTemplateGuide(catalog: TemplateCatalog, templateId: string, directory: string, runtimeRoot: string, input: TemplateGuideDraft) {
  const draft = parseTemplateGuideDraft(input);
  const guide = authoredTemplateGuide((await catalog.sourceFile(templateId, 'preview.html')).toString());
  if (!guide) throw new Error('GUIDE_NOT_EDITABLE: this guide has no supported authored example');
  const sequence = (await catalog.sourceFile(templateId, guide.src)).toString();
  const canvas = sequence.match(/<canvas\s+width="(\d+)"\s+height="(\d+)"/);
  if (!canvas || Number(canvas[1]) > 4096 || Number(canvas[2]) > 4096) throw new Error('GUIDE_CANVAS_UNAVAILABLE');
  const [width, height] = canvas.slice(1).map(Number);
  const files = await Promise.all(['data.js', 'common.js', 'scene.js'].map(async name => [name, await catalog.sourceFile(templateId, 'demos/' + name)] as const));
  const motion = await catalog.sourceFile(templateId, 'motion.md');
  await createBlankProject(directory, runtimeRoot, draft.title);
  await mkdir(path.join(directory, 'demos'), { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(directory, 'demos', name), bytes);
  await writeFile(path.join(directory, 'motion.md'), motion);
  await writeFile(path.join(directory, 'guide-draft.json'), jsonForHtml({ templateId, ...draft }));
  const variables = [{ id: 'title', label: 'Title', type: 'string', default: draft.title }, { id: 'accent', label: 'Accent color', type: 'color', default: draft.accent }];
  const html = `<!doctype html><html data-composition-variables='${attribute(jsonForHtml(variables))}'><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%;object-fit:contain}
</style></head><body data-mode="sequence"><div id="main" data-composition-id="main" data-start="0" data-duration="${guide.duration}" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px;position:relative"><div id="guide-example" class="clip" data-composition-id="guide-example" data-start="0" data-duration="${guide.duration}" data-track-index="0" data-track-kind="graphics" data-width="${width}" data-height="${height}"><canvas width="${width}" height="${height}"></canvas></div></div>
<script src="assets/gsap.min.js"></script><script src="demos/data.js"></script><script src="demos/common.js"></script><script src="demos/scene.js"></script><script>
(() => { const defaults=${jsonForHtml(draft)}, clock={time:0};
const draw=()=>{const values=window.__hyperframes?.getVariables?.()||defaults;window.motionDemo.setParams({...defaults,...values});window.motionDemo.renderAt(clock.time)};
const timeline=gsap.timeline({paused:true});timeline.to(clock,{time:${guide.duration},duration:${guide.duration},ease:'none',onUpdate:draw},0);
window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});window.__timelines['guide-example']=timeline;draw();
})();</script></body></html>`;
  await writeFile(path.join(directory, 'index.html'), html);
  return { draft, source: { id: templateId, provenance: 'authored-motion-guide-example', durationSeconds: guide.duration, width, height,
    editing: 'Canvas example. Title and accent are declared as native variables for Agent editing; change demos/*.js for deeper edits; the reference film is not reconstructed.' } };
}
