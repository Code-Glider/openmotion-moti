/**
 * Opt-in versioned native caption sources.
 *
 * A live drag currently updates the model/sidecar, but native MP4 and offline
 * project export read the authored HTML. Only compositions created with this
 * exact managed marker may be regenerated. Unknown legacy/custom scripts are
 * never flattened. Both script and its exact model input are embedded so a
 * reopened Studio can reconstruct authored positioning/group styles without
 * inferring them from animated/computed DOM geometry.
 */
import type { CaptionModel } from "./types";
import { extractTranscript } from "./parser";
import { generateCaptionHtml } from "./generator";

const MARKER = 'data-openmotion-caption-source="v1"';
const SCRIPT_RE =
  /<script data-openmotion-caption-source="v1" data-sha256="([a-f0-9]{64})" data-model-hex="([a-f0-9]+)">([\s\S]*?)<\/script>/g;

export type ManagedCaptionSourceResult =
  | { status: "unsupported"; content: string }
  | { status: "unchanged" | "updated"; content: string };

async function digest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generatedScript(model: CaptionModel): string {
  const source = generateCaptionHtml(model);
  const match = /<script>([\s\S]*?)<\/script>/.exec(source);
  if (!match || source.match(/<script>/g)?.length !== 1) {
    throw new Error("MANAGED_CAPTION_GENERATOR_SCRIPT_INVALID");
  }
  return match[1];
}

function authoredWords(model: CaptionModel) {
  const words: Array<{ id: string; text: string; start: number; end: number }> = [];
  const ids = new Set<string>();
  for (const groupId of model.groupOrder) {
    const group = model.groups.get(groupId);
    if (!group || group.segmentIds.length === 0) {
      throw new Error("MANAGED_CAPTION_GROUP_IDENTITY_INVALID");
    }
    for (const segmentId of group.segmentIds) {
      const segment = model.segments.get(segmentId);
      if (!segment || !segment.wordId || ids.has(segment.wordId) ||
          !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
          segment.end <= segment.start) {
        throw new Error("MANAGED_CAPTION_WORD_IDENTITY_INVALID");
      }
      ids.add(segment.wordId);
      words.push({ id: segment.wordId, text: segment.text, start: segment.start, end: segment.end });
    }
  }
  if (words.length !== model.segments.size) {
    throw new Error("MANAGED_CAPTION_WORD_IDENTITY_INVALID");
  }
  return words;
}

function encodeModel(model: CaptionModel): string {
  const dto = {
    width: model.width, height: model.height, duration: model.duration,
    segments: [...model.segments], groups: [...model.groups],
    groupOrder: model.groupOrder, defaultAnimation: model.defaultAnimation,
  };
  return Array.from(new TextEncoder().encode(JSON.stringify(dto)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeModel(hex: string): CaptionModel {
  if (hex.length % 2 || hex.length > 2_000_000) {
    throw new Error("MANAGED_CAPTION_MODEL_INVALID");
  }
  try {
    const pairs = hex.match(/../g);
    if (!pairs) throw new Error("missing encoded model");
    const dto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(pairs, (pair) => parseInt(pair, 16)),
    ));
    if (!dto || !Array.isArray(dto.segments) || !Array.isArray(dto.groups) ||
        !Array.isArray(dto.groupOrder) || !dto.defaultAnimation ||
        !Number.isFinite(dto.width) || !Number.isFinite(dto.height) ||
        !Number.isFinite(dto.duration) || dto.width <= 0 || dto.height <= 0 ||
        dto.duration <= 0) throw new Error("malformed");
    const segments = new Map(dto.segments) as CaptionModel["segments"];
    const groups = new Map(dto.groups) as CaptionModel["groups"];
    if (segments.size !== dto.segments.length || groups.size !== dto.groups.length) {
      throw new Error("duplicate entries");
    }
    return {
      width: dto.width, height: dto.height, duration: dto.duration,
      segments, groups, groupOrder: dto.groupOrder,
      defaultAnimation: dto.defaultAnimation,
    };
  } catch {
    throw new Error("MANAGED_CAPTION_MODEL_INVALID");
  }
}

function sameIdentity(a: CaptionModel, b: CaptionModel): void {
  if (a.width !== b.width || a.height !== b.height || a.duration !== b.duration ||
      JSON.stringify(a.groupOrder) !== JSON.stringify(b.groupOrder)) {
    throw new Error("MANAGED_CAPTION_COMPOSITION_IDENTITY_CHANGED");
  }
  const left = authoredWords(a), right = authoredWords(b);
  if (left.length !== right.length || left.some((word, index) =>
    word.id !== right[index].id ||
    word.text !== right[index].text ||
    word.start !== right[index].start ||
    word.end !== right[index].end)) {
    throw new Error("MANAGED_CAPTION_WORD_IDENTITY_CHANGED");
  }
}

async function readManaged(source: string): Promise<
  { tag: string; script: string; model: CaptionModel; index: number } | null
> {
  if (!source.includes(MARKER)) return null;
  const matches = [...source.matchAll(SCRIPT_RE)];
  if (matches.length !== 1 || source.split(MARKER).length !== 2) {
    throw new Error("MANAGED_CAPTION_SOURCE_MARKER_INVALID");
  }
  const match = matches[0];
  const [tag, checksum, modelHex, script] = match;
  if (await digest(script) !== checksum) {
    throw new Error("MANAGED_CAPTION_SOURCE_CHANGED_EXTERNALLY");
  }
  const model = decodeModel(modelHex);
  authoredWords(model); // Reject missing, duplicate, non-finite IDs/timings.
  if (generatedScript(model) !== script) {
    throw new Error("MANAGED_CAPTION_SCRIPT_UNRECOGNIZED");
  }
  const transcript = extractTranscript(script);
  const expected = authoredWords(model);
  if (transcript.length !== expected.length || transcript.some((word, index) =>
    word.id !== expected[index].id || word.text !== expected[index].text ||
    word.start !== expected[index].start || word.end !== expected[index].end)) {
    throw new Error("MANAGED_CAPTION_WORD_IDENTITY_CHANGED");
  }
  // A managed script belongs to one composition. Never update a user project
  // whose container ID/size/duration disagree with its embedded model.
  if (!source.includes('data-composition-id="captions"') ||
      !source.includes('data-width="' + model.width + '"') ||
      !source.includes('data-height="' + model.height + '"') ||
      !source.includes('data-duration="' + model.duration + '"')) {
    throw new Error("MANAGED_CAPTION_COMPOSITION_IDENTITY_CHANGED");
  }
  return { tag, script, model, index: match.index };
}

/** Produce an explicit managed marker; never add one to legacy source. */
export async function managedCaptionScriptTag(model: CaptionModel): Promise<string> {
  authoredWords(model);
  const script = generatedScript(model);
  return '<script ' + MARKER + ' data-sha256="' + await digest(script) +
    '" data-model-hex="' + encodeModel(model) + '">' + script + '</script>';
}

/**
 * Persist a model edit into the versioned native HTML for the render/export
 * pipeline. Preserve everything outside the identified script tag verbatim.
 */
export async function rewriteManagedCaptionSource(
  source: string,
  model: CaptionModel,
): Promise<ManagedCaptionSourceResult> {
  const prior = await readManaged(source);
  if (!prior) return { status: "unsupported", content: source };
  sameIdentity(prior.model, model);
  const tag = await managedCaptionScriptTag(model);
  if (prior.tag === tag) return { status: "unchanged", content: source };
  return {
    status: "updated",
    content: source.slice(0, prior.index) + tag + source.slice(prior.index + prior.tag.length),
  };
}

/** Reopen exact saved authored geometry, independent of live GSAP animation. */
export async function hydrateManagedCaptionSource(
  source: string,
  observed: CaptionModel,
): Promise<{ managed: boolean; model: CaptionModel }> {
  const prior = await readManaged(source);
  if (!prior) return { managed: false, model: observed };
  sameIdentity(prior.model, observed);
  // Persisted model is the source of truth, including group-specific fonts,
  // positions, animation parameters and stable word IDs. The observed DOM
  // model can otherwise lose authored values when it samples computed styles.
  return { managed: true, model: prior.model };
}
