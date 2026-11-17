import { createHash, randomBytes } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Download, Job } from "@open-motion/render/contract";
import { Fault } from "@open-motion/workspace/contract";
import { byteRange } from "../transport/range.js";

const fingerprint = (info: BigIntStats) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;

/** Temporary read-only business grants; these never allocate an OS path or another listener. */
export class Downloads {
  private tickets = new Map<string, { job: Job; expiresAt: number; verified?: string }>();
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
      const info = await file.stat({ bigint: true }),
        identity = fingerprint(info),
        size = Number(info.size);
      if (!info.isFile() || info.size !== BigInt(result.verification.bytes))
        throw new Fault("integrity", "export film size/type changed");
      if (entry.verified !== identity) {
        entry.verified = undefined;
        const hash = createHash("sha256");
        for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
        if (`sha256:${hash.digest("hex")}` !== result.verification.digest)
          throw new Fault("integrity", "export film integrity mismatch");
        if (fingerprint(await file.stat({ bigint: true })) !== identity)
          throw new Fault("integrity", "export film changed during verification");
        entry.verified = identity;
      }
      const etag = `"${result.verification.digest}"`;
      let start = 0,
        end = size - 1,
        partial = false;
      if (range && !head && (ifRange === undefined || ifRange === etag)) {
        const interval = byteRange(range, size);
        if (!interval) {
          response.writeHead(416, {
            "content-range": `bytes */${size}`,
            "content-length": 0,
            "cache-control": "no-store",
          });
          response.end();
          return;
        }
        ({ start, end } = interval);
        partial = true;
      }
      response.writeHead(partial ? 206 : 200, {
        "content-type": "video/mp4",
        "content-length": end - start + 1,
        "accept-ranges": "bytes",
        ...(partial ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
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
