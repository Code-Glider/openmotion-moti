import { resourceLimit } from "@open-motion/workspace/contract";
import type { Entry, ZipFile } from "yauzl";
import { invalid, limits, manifestPath, names } from "../contract.js";
import { at, type Input } from "./input.js";
export function envelope(bytes: Buffer, total: number) {
  if (bytes.length < 22) invalid("truncated portable ZIP");
  const end = 0;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 20)
  )
    invalid("unsupported ZIP envelope");
  const count = bytes.readUInt16LE(end + 10),
    directory = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12);
  if (!count || count > limits.entries || bytes.readUInt16LE(end + 8) !== count || directory + size !== total - 22)
    invalid("invalid ZIP directory bounds");
  return { count, directory, size };
}
export async function entries(zip: ZipFile, input: Input, directory: number) {
  const found: Entry[] = [];
  let offset = 0,
    expanded = 0,
    central = 0;
  for (;;) {
    const entry = await new Promise<Entry | undefined>((resolve, reject) => {
      const cleanup = () => {
        zip.off("entry", got);
        zip.off("end", end);
        zip.off("error", error);
        zip.off("close", close);
      };
      const got = (value: Entry) => {
          cleanup();
          resolve(value);
        },
        end = () => {
          cleanup();
          resolve(undefined);
        },
        error = (value: Error) => {
          cleanup();
          reject(value);
        },
        close = () => error(Error("ZIP closed during scan"));
      zip.once("entry", got);
      zip.once("end", end);
      zip.once("error", error);
      zip.once("close", close);
      zip.readEntry();
    });
    if (!entry) break;
    const centralHeader = await at(input, directory + central, 46);
    if (
      found.length >= limits.entries ||
      ![0, 0x800].includes(entry.generalPurposeBitFlag) ||
      ![0, 8].includes(entry.compressionMethod) ||
      entry.extraFieldLength ||
      entry.fileCommentLength ||
      entry.extraFields.length ||
      centralHeader.readUInt16LE(34) ||
      entry.externalFileAttributes >>> 16 !== 0o100644 ||
      entry.relativeOffsetOfLocalHeader !== offset
    )
      invalid("unsupported portable ZIP entry");
    const name = Buffer.from(entry.fileName),
      bound = entry.fileName === manifestPath ? limits.manifestBytes : resourceLimit;
    expanded += entry.uncompressedSize;
    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize > bound ||
      expanded > limits.expandedBytes ||
      offset + 30 + name.length + entry.compressedSize > directory
    )
      invalid("ZIP expansion exceeds declared bounds");
    const bytes = await at(input, offset, 30 + name.length);
    if (
      bytes.readUInt32LE(0) !== 0x04034b50 ||
      bytes.readUInt16LE(6) !== entry.generalPurposeBitFlag ||
      bytes.readUInt16LE(8) !== entry.compressionMethod ||
      bytes.readUInt32LE(14) !== entry.crc32 ||
      bytes.readUInt32LE(18) !== entry.compressedSize ||
      bytes.readUInt32LE(22) !== entry.uncompressedSize ||
      bytes.readUInt16LE(26) !== name.length ||
      bytes.readUInt16LE(28) ||
      !bytes.subarray(30, 30 + name.length).equals(name)
    )
      invalid("ZIP local/central identity mismatch");
    offset += 30 + name.length + entry.compressedSize;
    central += 46 + name.length;
    found.push(entry);
  }
  if (offset !== directory) invalid("unclaimed ZIP local bytes");
  names(found.map((entry) => entry.fileName));
  return { found, central };
}
