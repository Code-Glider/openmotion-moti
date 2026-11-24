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
