import type { ResourceReader, SourceFile } from "@open-motion/workspace";
import { resource, resourceBytesLimit, resourceCountLimit } from "@open-motion/workspace/contract";
import { content } from "./content.js";
import { type Inventory, invalid, limits, manifestPath, names } from "./contract.js";
import { buffered, type StreamEntry, zip } from "./write.js";

/** Workspace owns format facts and complete byte verification. This encoder accepts its repeatable readers,
 * not untrusted raw media or a project authority. Caller drains all iterations before Workspace closes. */
export function prepareSnapshot(files: SourceFile[], readers: ResourceReader[]) {
  if (!Array.isArray(readers) || readers.length > resourceCountLimit) invalid("portable resource count exceeds limit");
  const base = content({ files, resources: [] }),
    resources = readers
      .map((reader) => ({
        resource: resource.parse(reader.resource),
        chunks: reader.chunks.bind(reader),
      }))
      .sort((a, b) => (a.resource.path < b.resource.path ? -1 : a.resource.path > b.resource.path ? 1 : 0));
  if (resources.reduce((sum, entry) => sum + entry.resource.bytes, 0) > resourceBytesLimit)
    invalid("portable media exceeds 64 MiB");
  names([
    manifestPath,
    ...base.inventory.files.map((file) => file.path),
    ...resources.map((entry) => entry.resource.path),
  ]);
  const inventory: Inventory = { ...base.inventory, resources: resources.map((entry) => entry.resource) },
    metadata = Buffer.from(JSON.stringify(inventory));
  if (metadata.length > limits.manifestBytes) invalid("portable inventory exceeds limit");
  const entries: StreamEntry[] = base.entries.filter((entry) => entry.path !== manifestPath).map(buffered);
  entries.push(
    ...resources.map((entry) => ({
      path: entry.resource.path,
      bytes: entry.resource.bytes,
      digest: entry.resource.digest,
      chunks: entry.chunks,
    })),
    buffered({ path: manifestPath, bytes: metadata }),
  );
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return zip(entries);
}
