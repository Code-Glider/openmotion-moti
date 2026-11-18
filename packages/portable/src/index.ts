import type { SourcePayload } from "@open-motion/workspace/contract";
import { content } from "./content.js";
import { buffered, zip } from "./write.js";

export { type Archive, limits } from "./contract.js";
export { read } from "./read.js";
export { prepareSnapshot } from "./snapshot.js";
/** Owns bounded immutable memory only; transport/staging/reader drain belongs to its caller. */
export function prepare(payload: SourcePayload) {
  return zip(content(payload).entries.map(buffered));
}
