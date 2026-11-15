# Timeline interaction regression matrix

Use a disposable local project with two images, a video with audio, an audio file,
two overlapping clips that share an authored track, and a nested composition.
Keep fixtures and screenshots outside the checkout. Use the Node version in
the CI workflow and the normal Studio build. Do not test against production projects.

## Acceptance rules

- Splitting preserves the visible lane and exact adjacent boundaries.
- A drop uses the pointer's time and the row actually drawn, including scroll,
  centered row padding, track controls and zoom. Creating a row does not reset time.
- A known-duration collision resolves to the nearest free time on the intended row.
  Unknown media duration is provisional; metadata can change collision placement.
- Uploads show one placeholder per file before upload or probing completes.
  The placeholder survives saving until discovery supplies the real clip.
- Newly reserved loading rows are not editable drop targets until discovery gives
  them an authored identity. Their temporary layout keys must never enter source.
- Intentional edits preserve existing visible spill rows in the same source file
  and media zone. Locked peers cannot be silently renumbered. Canvas stacking is
  independent of horizontal timing edits.
- Drag cancellation and failed saves leave no partial source edit. Undo and redo
  restore the complete gesture. Switching projects cancels stale pending work.
- Trim grips align with the clip's outer borders. Their hit areas stay distinct
  on short clips and do not cover the effect badge.

## Scenario coverage

Automated tests are under `studio/src/`. Browser results below describe the
2026-11-15 computer-use run, not release acceptance or universal performance claims.
“Pending” requires another real browser run; an automated pass does not replace it.

| Scenario and variations | Automated coverage | Computer-use result |
| --- | --- | --- |
| Split once, repeated cuts, floating-point seams; retain one lane | `player/components/timelineSplitLanes.test.ts`, `TimelineRazorInteraction.test.tsx`; `utils/timelineElementSplit.test.ts`, `razorSplitTransaction.test.ts` | Passed: image split into two adjacent clips on one row |
| Move horizontally into free time, clamp at zero, preserve relative selection offsets | `player/components/timelineClipDragCommit.test.ts`, `timelineClipDragPreview.test.ts` | Passed: selected clip moved on its row |
| Collision, snapping enabled/disabled, nearest free start | `player/components/timelineCollision.test.ts`, `timelineSnapping.test.ts` | Automated; browser variants pending |
| Move to an existing lane, insert above/between/below lanes | `player/components/timelineClipDragCommit.test.ts` | Passed: bottom insertion created a second row |
| Legacy spill row: horizontal move, save, actual adapter, rediscovery | `player/components/timelineLanePersistence.test.ts`, `timelineClipDragCommit.test.ts`; `hooks/timelineMoveAdapter.test.ts` | Passed after fixing the adapter operation: row 2 survived reload |
| Sparse authored indices, foreign source selection, audio/visual isolation | `player/components/timelineLanePersistence.test.ts`, `timelineClipDragCommit.test.ts` | Automated; browser variants pending |
| Locks reject dragging and required peer renumbering | `player/components/timelineLanePersistence.test.ts`, `timelineClipDragCommit.test.ts` | Passed: locked row did not move |
| Undo/redo lane insertion and timing; save rollback | `player/components/timelineClipDragCommit.test.ts`; `hooks/useRazorSplit.history.test.tsx` | Passed: undo returned to one row; redo restored row 2 |
| Trim start/end, minimum duration, linked/group constraints | `player/components/useTimelineClipDrag.resize.test.tsx` | Passed: right trim extended the clip without moving its row |
| Selected grip alignment, very short clip, FX hit area, zoom | `player/components/TimelineClip.test.tsx`; resize interaction tests | Passed: border centers measured, FX separated, pointer trim/undo and 10% zoom checked in light/dark |
| Keyboard pickup, lane choice, commit and cancellation | `player/components/useTimelineClipDrag.keyboard.test.tsx`, `timelineKeyboardNavigation.test.ts` | Automated; browser variants pending |
| Empty timeline drop, nonzero time, sidebar/control-column offsets | `player/components/timelineLayout.test.ts`, `timelineDragDrop.test.tsx` | Native drag transport pending; file-picker upload passed |
| Populated centered rows, horizontal/vertical scroll, variable row heights | `player/components/timelineLayout.test.ts`, `timelineDragDrop.test.tsx` | Native drag transport pending |
| New-row external drop retains pointer time and reserves row geometry | `player/components/timelineDragDrop.test.tsx`, `timelinePendingRows.test.ts`; `hooks/useTimelineAssetDropFeedback.test.tsx` | Native drag transport pending |
| Immediate feedback, delayed metadata and save, identity-based replacement | `hooks/useTimelineAssetDropFeedback.test.tsx` | File-picker upload passed; deliberately delayed browser run pending |
| Batch upload: sequential placement, first file rejected/failed, one final refresh | `hooks/useTimelineAssetDropFeedback.test.tsx`, `useTimelineAssetDropOps.test.tsx` | Automated; native multi-file run pending |
| Media probe, upload, save and preview failure; dismiss and retry | `hooks/useTimelineAssetDropFeedback.test.tsx` | Automated; browser failure injection pending |
| Project/composition switch while work is pending | `hooks/useTimelineAssetDropFeedback.test.tsx`; `player/components/timelineDragDrop.test.tsx` | Automated |
| Blocks/compositions keep their own insertion contracts | `hooks/useTimelineBlockDropFeedback.test.tsx`, `useTimelineCompositionDropFeedback.test.tsx` | Automated |
| Pending reserved row rejects a second edit without saving a fractional index | `player/components/timelineDragDrop.test.tsx`, `timelinePendingRows.test.ts` | Automated |
| 200 dragover events coalesce; release before RAF; edge autoscroll updates preview | `player/components/timelineDragDrop.test.tsx` | Automated; no measured FPS claim |
| Virtualized rows/clips, zoom, reduced-motion loading | `player/components/Timeline.virtualization.test.tsx`, `useTimelineGeometry.test.tsx`; shared design checks | Desktop light/dark inspected; narrow viewport pending |

## Repeatable browser sequence

1. Create a blank project. Upload image A through the native file chooser. Check
   immediate loading feedback, then the clip and preview. Repeat with multiple
   files and verify order and one final preview refresh.
2. Split A halfway. Confirm both halves share one row. Move the right half right,
   trim it, and move it below the occupied row. Reload, then undo and redo.
3. Lock the destination row and attempt another move. Unlock it. Repeat with
   audio, linked video/audio, a multi-selection and a nested composition.
4. Prepare overlapping same-authored-track clips. Move the second displayed row
   horizontally until it no longer overlaps. Reload and verify the row is retained.
5. Drag image/video/audio assets and OS files at nonzero times into empty space,
   existing rows and row gutters. Repeat after horizontal/vertical scrolling and
   changing zoom or track-control width. Record both release and loaded positions.
6. Hold a drag at each viewport edge, release before the next rendered frame,
   cancel outside the timeline, and change project during a delayed upload.
7. Select long and short clips at several zoom levels. Check both trim grips,
   FX menu, resize cursor and actual trims. Repeat in light/dark and narrow layouts.

## Verification limits

The computer-use browser transport emitted `dragstart` for asset-card drags but
did not deliver native `dragover` or `drop` to the timeline. Internal pointer
dragging and native file-picker upload worked. Native external drag/drop remains
unverified in this run; synthetic event tests establish handler behavior only.
The requested viewport override did not resize the observed browser, so narrow
layout is also not claimed as a computer-use pass. Reset temporary viewport and
theme settings after testing.

Run `npm run check`, `npm run typecheck:studio`, `npm run build:studio`,
`npm run design:check` and `npm run test:studio` before publication. Check actual
CI separately. Installation, export fidelity and human visual acceptance are
outside this interaction matrix.
