import { readInto } from "@open-motion/portable";
import { Fault, type SourceReaders } from "@open-motion/workspace";
import { Upload } from "../../transport/upload.js";

/** Exact temporary files inside one caller-injected grant; no allocation, journal or GC authority. */
export class Staging {
  private files: Upload[] = [];
  private active = false;
  private fenced = false;
  private payload?: SourceReaders;
  constructor(
    private root: string,
    private expected: { bytes: number; digest: string },
  ) {}
  async write(source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<SourceReaders> {
    if (this.active || this.fenced) throw new Fault("conflict", "archive staging is active or awaiting cleanup");
    this.active = true;
    const raw = new Upload(this.root, this.expected, "integrity"),
      prior = this.payload;
    this.files.push(raw);
    let result = prior;
    try {
      await raw.write(source, signal);
      // An identical repeated POST confirms the same ready input, preserving the existing retry contract.
      if (!prior)
        result = await readInto(
          { bytes: this.expected.bytes, read: (offset, length) => raw.range(offset, length, signal) },
          this.expected.digest,
          async (resource, bytes) => {
            signal.throwIfAborted();
            const file = new Upload(this.root, resource);
            this.files.push(file);
            const chunks = async function* () {
              yield bytes;
            };
            await file.write(chunks(), signal).catch((error) => {
              if (error instanceof Fault || signal.aborted) throw error;
              throw new Fault("integrity", "archive media staging failed");
            });
            return {
              path: resource.path,
              name: resource.name,
              bytes: resource.bytes,
              digest: resource.digest,
              read: () => file.read(),
            };
          },
        );
      signal.throwIfAborted();
    } finally {
      try {
        await raw.drain();
        raw.close();
        this.files = this.files.filter((file) => file !== raw);
        if (!result) this.clear();
      } catch (error) {
        this.fenced = true;
        throw error;
      } finally {
        this.active = false;
      }
    }
    if (signal.aborted) {
      if (!prior) this.close();
      signal.throwIfAborted();
    }
    if (!result) throw new Fault("integrity", "archive staging result is missing");
    this.payload = result;
    return result;
  }
  close() {
    if (this.active) throw new Fault("integrity", "archive staging has not drained");
    this.clear();
  }
  private clear() {
    for (const file of this.files) file.close();
    this.files = [];
    this.payload = undefined;
    this.fenced = false;
  }
}
