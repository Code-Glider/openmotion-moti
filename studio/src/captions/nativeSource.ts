/**
 * Managed native caption composition source.
 *
 * The legacy caption editor persists overrides in a sidecar. Native MP4 and
 * offline ZIP exports read the authored HTML, not browser-only wrapper state.
 * Only a source that explicitly opts into this managed script format may be
 * rewritten. Unknown/legacy scripts must NEVER be regenerated or flattened.
 */
import type { CaptionModel } from "./types";
import { extractTranscript } from "./parser";
import { generateCaptionHtml } from "./generator";

const SCRIPT_RE =
  /<script data-openmotion-caption-source="v1" data-sha256="([a-f0-9]{64})">([\s\S]*?)<\/script>/g;
const MANAGED_MARKER = 'data-openmotion-caption-source="v1"';

export type ManagedCaptionSourceResult =
  | { status: "unsupported"; content: string }
  | { status: "unchanged" | "updated"; content: string };

async function digest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

function generatedScript(model: CaptionModel): string {
  const source = generateCaptionHtml(model);
  const match = /<script>([\s\S]*?)<\/script>/.exec(source);
  if (!match || source.match(/<script>/g)?.length !== 1) {
    throw new Error("MANAGED_CAPTION_GENERATOR_SCRIPT_INVALID");
  }
  return match[1];
}

/** Produce the opt-in tag used by a generated, versioned native composition. */
export async function managedCaptionScriptTag(model: CaptionModel): Promise<string> {
  const script = generatedScript(model);
  return '<script ' + MANAGED_MARKER + ' data-sha256="' + await digest(script) + '">' +
    script + '</script>';
}

function authoredWords(model: CaptionModel) {
  const words: Array<{ id: string; text: string; start: number; end: number }> = [];
  const wordIds = new Set<string>();
  for (const groupId of model.groupOrder) {
    const group = model.groups.get(groupId);
    if (!group || group.segmentIds.length === 0) {
      throw new Error("MANAGED_CAPTION_GROUP_IDENTITY_INVALID");
    }
    for (const segmentId of group.segmentIds) {
      const segment = model.segments.get(segmentId);
      if (!segment || !segment.wordId || wordIds.has(segment.wordId) ||
          !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
          segment.end <= segment.start) {
        throw new Error("MANAGED_CAPTION_WORD_IDENTITY_INVALID");
      }
      wordIds.add(segment.wordId);
      words.push({ id: segment.wordId, text: segment.text, start: segment.start, end: segment.end });
    }
  }
  if (words.length !== model.segments.size) {
    throw new Error("MANAGED_CAPTION_WORD_IDENTITY_INVALID");
  }
  return words;
}

function authoredGroupIds(script: string): string[] {
  const ids: string[] = [];
  for (const match of script.matchAll(/\.dataset\.captionGroupId = ([^\r\n;]+);/g)) {
    try {
      const id: unknown = JSON.parse(match[1]);
      if (typeof id !== "string") throw new Error("invalid");
      ids.push(id);
    } catch {
      throw new Error("MANAGED_CAPTION_GROUP_IDENTITY_INVALID");
    }
  }
  return ids;
}

/**
 * Read persisted transforms back from the *managed authored source*, rather
 * than trusting a browser-mutated iframe or a possibly stale sidecar.
 * Rebuilding the canonical script from the recovered transform values is a
 * fail-closed safeguard against overwriting customized animation JavaScript.
 */
export async function hydrateManagedCaptionSource(
  source: string,
  model: CaptionModel,
): Promise<{ managed: boolean; model: CaptionModel }> {
  if (!source.includes(MANAGED_MARKER)) return { managed: false, model };
  const matches = [...source.matchAll(SCRIPT_RE)];
  if (matches.length !== 1 || source.split(MANAGED_MARKER).length !== 2) {
    throw new Error("MANAGED_CAPTION_SOURCE_MARKER_INVALID");
  }
  const script = matches[0][3 - 1];
  if (await digest(script) !== matches[0][1]) {
    throw new Error("MANAGED_CAPTION_SOURCE_CHANGED_EXTERNALLY");
  }
  const originalWords = extractTranscript(script);
  const expectedWords = authoredWords(model);
  if (originalWords.length !== expectedWords.length ||
      originalWords.some((word, index) =>
        word.id !== expectedWords[index].id ||
        word.text !== expectedWords[index].text ||
        word.start !== expectedWords[index].start ||
        word.end !== expectedWords[index].end)) {
    throw new Error("MANAGED_CAPTION_WORD_IDENTITY_CHANGED");
  }
  const groupIds = authoredGroupIds(script);
  if (groupIds.length !== model.groupOrder.length ||
      groupIds.some((id, index) => id !== model.groupOrder[index])) {
    throw new Error("MANAGED_CAPTION_GROUP_IDENTITY_CHANGED");
  }
  if (!source.includes('data-composition-id="captions"') ||
      !source.includes('data-width="' + model.width + '"') ||
      !source.includes('data-height="' + model.height + '"') ||
      !source.includes('data-duration="' + model.duration + '"')) {
    throw new Error("MANAGED_CAPTION_COMPOSITION_IDENTITY_CHANGED");
  }

  const varToId = new Map<string, string>();
  for (const match of script.matchAll(/^\s*(w_[a-zA-Z0-9_]+)\.id = ("(?:[^"\\]|\\.)*");\s*$/gm)) {
    const id: unknown = JSON.parse(match[2]);
    if (typeof id !== "string" || varToId.has(match[1])) {
      throw new Error("MANAGED_CAPTION_WORD_IDENTITY_INVALID");
    }
    varToId.set(match[1], id);
  }
  const wrappers = new Map<string, string>();
  for (const match of script.matchAll(/^\s*(wrap_[a-zA-Z0-9_]+)\.appendChild\((w_[a-zA-Z0-9_]+)\);\s*$/gm)) {
    if (wrappers.has(match[1]) || !varToId.has(match[2])) {
      throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
    }
    wrappers.set(match[1], varToId.get(match[2])!);
  }
  const recovered = new Map<string, {
    x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  }>();
  let styledWrappers = 0;
  for (const match of script.matchAll(/^\s*(wrap_[a-zA-Z0-9_]+)\.style\.transform = ("(?:[^"\\]|\\.)*");\s*$/gm)) {
    const id = wrappers.get(match[1]);
    if (!id || recovered.has(id)) {
      throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
    }
    const transform: unknown = JSON.parse(match[2]);
    if (typeof transform !== "string") throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
    const literal = /^translate\(([^,]+)px,\s*([^)]+)px\) rotate\(([^)]+)deg\) scale\(([^,]+),\s*([^)]+)\)$/.exec(transform);
    if (!literal) throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
    const values = literal.slice(1).map(Number);
    if (!values.every(Number.isFinite)) throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
    recovered.set(id, {
      x: values[0], y: values[1], rotation: values[2],
      scaleX: values[3], scaleY: values[4],
    });
    styledWrappers++;
  }
  if (styledWrappers !== wrappers.size) {
    throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
  }
  const segments = new Map(model.segments);
  for (const [segmentId, segment] of segments) {
    const style = { ...segment.style };
    // The current editor model may contain a newer, unsaved gesture. Derive
    // the original native transform strictly from the source, not that edit.
    delete style.x; delete style.y; delete style.rotation;
    delete style.scaleX; delete style.scaleY;
    const old = recovered.get(segment.wordId ?? "");
    segments.set(segmentId, {
      ...segment, style: old ? { ...style, ...old } : style,
    });
  }
  const hydrated = { ...model, segments };
  if (generatedScript(hydrated) !== script) {
    throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
  }
  return { managed: true, model: hydrated };
}

/**
 * Replace exactly one SHA-verified generated caption script. The surrounding
 * project HTML, user CSS, fonts, audio, other scripts and timing are unchanged.
 * The marker is deliberately not added to existing legacy projects: those
 * require an explicit, separately verified source conversion.
 */
export async function rewriteManagedCaptionSource(
  source: string,
  model: CaptionModel,
): Promise<ManagedCaptionSourceResult> {
  if (!source.includes(MANAGED_MARKER)) {
    return { status: "unsupported", content: source };
  }
  const occurrences = [...source.matchAll(SCRIPT_RE)];
  if (occurrences.length !== 1 || source.split(MANAGED_MARKER).length !== 2) {
    throw new Error("MANAGED_CAPTION_SOURCE_MARKER_INVALID");
  }
  // Establish that the prior authored program is byte-for-byte a recognized
  // generator output before replacing its script, even if its SHA marker was
  // edited manually. User-authored animation code must not be flattened.
  await hydrateManagedCaptionSource(source, model);
  const [originalTag, hash, originalScript] = occurrences[0];
  if (await digest(originalScript) !== hash) {
    throw new Error("MANAGED_CAPTION_SOURCE_CHANGED_EXTERNALLY");
  }
  const originalWords = extractTranscript(originalScript);
  const expectedWords = authoredWords(model);
  if (originalWords.length !== expectedWords.length ||
      originalWords.some((word, index) =>
        word.id !== expectedWords[index].id ||
        word.text !== expectedWords[index].text ||
        word.start !== expectedWords[index].start ||
        word.end !== expectedWords[index].end)) {
    throw new Error("MANAGED_CAPTION_WORD_IDENTITY_CHANGED");
  }
  const groups = authoredGroupIds(originalScript);
  if (groups.length !== model.groupOrder.length ||
      groups.some((id, index) => id !== model.groupOrder[index])) {
    throw new Error("MANAGED_CAPTION_GROUP_IDENTITY_CHANGED");
  }
  // A script from a different composition or dimension cannot silently
  // replace the current author's file, even if some word IDs happen to match.
  if (!source.includes('data-composition-id="captions"') ||
      !source.includes('data-width="' + model.width + '"') ||
      !source.includes('data-height="' + model.height + '"') ||
      !source.includes('data-duration="' + model.duration + '"')) {
    throw new Error("MANAGED_CAPTION_COMPOSITION_IDENTITY_CHANGED");
  }
  const updatedTag = await managedCaptionScriptTag(model);
  if (originalTag === updatedTag) return { status: "unchanged", content: source };
  const start = occurrences[0].index;
  const updated = source.slice(0, start) + updatedTag + source.slice(start + originalTag.length);
  return { status: "updated", content: updated };
}
