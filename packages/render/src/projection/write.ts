import { createHash } from "node:crypto";
import { canonical } from "@odsuite/protocol";
import { chunkSize, persist } from "./file.js";
import { cloneSnapshot, type Snapshot } from "./index.js";

function* text(value: string) {
  const bytes = Buffer.from(value);
  for (let at = 0; at < bytes.length; at += chunkSize) yield bytes.subarray(at, at + chunkSize);
}
/** Exact existing canonical JSON/base64 representation, emitted with bounded binary copies. */
async function* serialize(snapshot: Snapshot, signal?: AbortSignal) {
  const { project, spec, assets } = snapshot;
  if (assets.length !== project.resources.length || new Set(assets.map((a) => a.path)).size !== assets.length)
    throw Error("export resource membership mismatch");
  yield* text('{"assets":[');
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index]!,
      resource = project.resources.find((r) => r.path === asset.path);
    if (!resource) throw Error("export resource membership mismatch");
    yield* text(`${index ? "," : ""}{"data":"`);
    let tail = Buffer.alloc(0),
      total = 0;
    const complete = createHash("sha256");
    for await (const value of asset.chunks()) {
      signal?.throwIfAborted();
      if (!(value instanceof Uint8Array) || value.length > chunkSize || total + value.length > resource.bytes)
        throw Error("export resource exceeds fixed bytes");
      total += value.length;
      complete.update(value);
      const bytes = Buffer.concat([tail, value]),
        count = bytes.length - (bytes.length % 3);
      yield* text(bytes.subarray(0, count).toString("base64"));
      tail = Buffer.from(bytes.subarray(count));
    }
    if (total !== resource.bytes || `sha256:${complete.digest("hex")}` !== resource.digest)
      throw Error("export resource integrity mismatch");
    yield* text(tail.toString("base64"));
    yield* text(`","path":${canonical(asset.path)}}`);
  }
  yield* text(`],"project":${canonical(project)},"spec":${canonical(spec)}}`);
}
export function projection(snapshot: Snapshot, signal?: AbortSignal) {
  return serialize(cloneSnapshot(snapshot), signal);
}
export function writeProjection(snapshot: Snapshot, path: string, signal?: AbortSignal) {
  return persist(path, projection(snapshot, signal), signal);
}
