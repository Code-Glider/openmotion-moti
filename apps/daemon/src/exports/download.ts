import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Download, Job } from "@open-motion/render/contract";
import { Fault } from "@open-motion/workspace/contract";

/** Temporary read-only business grants; these never allocate an OS path or another listener. */
export class Downloads {
  private tickets = new Map<string, { job: Job; expiresAt: number }>();
  constructor(
    private root?: string,
    private endpoint?: string,
  ) {}
  issue(job: Job): Download {
    if (job.state !== "succeeded" || !job.result || !this.root || !this.endpoint)
      throw new Fault("invalid", "export has no verified film");
    for (const [key, entry] of this.tickets) if (entry.expiresAt <= Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 128) throw new Fault("invalid", "download grant capacity reached");
    const token = randomBytes(32).toString("hex"),
      expiresAt = Date.now() + 600000;
    this.tickets.set(token, { job: structuredClone(job), expiresAt });
    return {
      url: `${this.endpoint}/exports/files/${token}`,
      playbackUrl: `${this.endpoint}/exports/files/${token}?inline=1`,
      digest: job.result.verification.digest,
      bytes: job.result.verification.bytes,
      filename: `open-motion-${job.id}.mp4`,
      expiresAt,
      film: { ...structuredClone(job.result), jobId: job.id, attempt: job.attempt },
    };
  }
  async serve(url: string, response: ServerResponse, head = false, range?: string, ifRange?: string | string[]) {
    const matchUrl = /^\/exports\/files\/([a-f0-9]{64})(\?inline=1)?$/.exec(url),
      token = matchUrl?.[1],
      entry = token && this.tickets.get(token);
    if (!entry || entry.expiresAt <= Date.now() || !this.root || !entry.job.result) {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }
    const result = entry.job.result,
      file = await open(join(this.root, "exports", `${result.id}.mp4`), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat(),
        hash = createHash("sha256");
      if (!info.isFile() || info.size !== result.verification.bytes)
        throw new Fault("integrity", "export film size/type changed");
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
      if (`sha256:${hash.digest("hex")}` !== result.verification.digest)
        throw new Fault("integrity", "export film integrity mismatch");
      const etag = `"${result.verification.digest}"`;
      let start = 0,
        end = info.size - 1,
        partial = false;
      if (range && !head && (ifRange === undefined || ifRange === etag)) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range),
          first = match?.[1],
          last = match?.[2];
        start = first ? Number(first) : last ? Math.max(0, info.size - Number(last)) : Number.NaN;
        end = first && last ? Math.min(Number(last), info.size - 1) : info.size - 1;
        if (
          !match ||
          (first !== "" && !Number.isSafeInteger(Number(first))) ||
          (last !== "" && !Number.isSafeInteger(Number(last))) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start >= info.size ||
          end < start ||
          (!first && Number(last) <= 0)
        ) {
          response.writeHead(416, {
            "content-range": `bytes */${info.size}`,
            "content-length": 0,
            "cache-control": "no-store",
          });
          response.end();
          return;
        }
        partial = true;
      }
      response.writeHead(partial ? 206 : 200, {
        "content-type": "video/mp4",
        "content-length": end - start + 1,
        "accept-ranges": "bytes",
        ...(partial ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}),
        etag,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-disposition": `${matchUrl?.[2] ? "inline" : "attachment"}; filename="open-motion-${entry.job.id}.mp4"`,
      });
      if (head) response.end();
      else await pipeline(file.createReadStream({ start, end, autoClose: false }), response);
    } finally {
      await file.close();
    }
  }
  close() {
    this.tickets.clear();
  }
}
