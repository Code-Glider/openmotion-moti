/*!
MIT License

Copyright (c) 2024-2026 Augustus Otu and Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Adapted from OpenReel calculateSnap; Motion retains its saved timing precision and beat targets.
// https://github.com/Augani/openreel-video/blob/367d7e90b61b5181f9861b852bb8b9d7a7d2954a/apps/web/src/components/editor/timeline/utils.ts
import { TIMELINE_SNAP_PX, type TimelineSnapTarget } from "./timelineSnapping";

const OPENREEL_DRAG_SNAP_PX = 40;

export function snapOpenReelMove(
  rawTime: number,
  duration: number,
  targets: readonly TimelineSnapTarget[],
  pixelsPerSecond: number,
  gridStep = 0,
): { start: number; snapTime: number | null; snapType: TimelineSnapTarget["type"] | null; snapEdge?: "start" | "end" } {
  const points = targets.filter(point => point.type !== "playhead");
  if (gridStep > 0) {
    points.push({ time: Math.round(rawTime / gridStep) * gridStep, type: "grid" });
    points.push({ time: Math.round((rawTime + duration) / gridStep) * gridStep, type: "grid" });
  }
  const priority = { "clip-edge": 0, beat: 1, grid: 2, playhead: 3 };
  let closest: TimelineSnapTarget | null = null;
  let closestDistance = Infinity;
  let closestPriority = Infinity;
  let edge: "start" | "end" = "start";
  for (const point of points) {
    // Keep dense music beat targets at Motion's existing radius.
    const threshold = (point.type === "beat" ? TIMELINE_SNAP_PX : OPENREEL_DRAG_SNAP_PX) / Math.max(pixelsPerSecond, 1);
    const pointPriority = priority[point.type];
    for (const candidateEdge of ["start", "end"] as const) {
      const distance = Math.abs(point.time - rawTime - (candidateEdge === "end" ? duration : 0));
      if (distance < threshold && (pointPriority < closestPriority ||
          (pointPriority === closestPriority && distance < closestDistance))) {
        closest = point;
        closestDistance = distance;
        closestPriority = pointPriority;
        edge = candidateEdge;
      }
    }
  }
  const start = Math.max(0, Math.round((closest ? closest.time - (edge === "end" ? duration : 0) : rawTime) * 1000) / 1000);
  return { start, snapTime: closest?.time ?? null, snapType: closest?.type ?? null,
    ...(closest && { snapEdge: edge }) };
}
