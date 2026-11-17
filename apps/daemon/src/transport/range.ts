/** One closed, open-ended or suffix byte range; callers own HTTP status and representation headers. */
export function byteRange(range: string, length: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range),
    first = match?.[1],
    last = match?.[2],
    start = first ? Number(first) : last ? Math.max(0, length - Number(last)) : Number.NaN,
    end = first && last ? Math.min(Number(last), length - 1) : length - 1;
  if (
    !match ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    (first !== "" && !Number.isSafeInteger(Number(first))) ||
    (last !== "" && !Number.isSafeInteger(Number(last))) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= length ||
    end < start ||
    (!first && Number(last) <= 0)
  )
    return null;
  return { start, end };
}
