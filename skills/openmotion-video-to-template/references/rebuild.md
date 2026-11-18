# Native source and useful editing boundaries

Use the pinned HyperFrames authoring guide for its actual runtime contract. Choose composition and component boundaries with the shared [editable representation](../../openmotion-production/references/reference-video.md#choose-an-editable-representation) rules. This page adds what a reusable template must record and keep working; it is not a replacement engine or mandatory project architecture.

## Group by behavior

A composition can own a coordinated scene; independent captions or graphics can remain peers. One object can contain SVG subpaths, nested geometry or code-defined children. Preserve useful identity through names, IDs, source functions or asset references. Studio selects existing native elements; code-defined subobjects remain editable in source even when they lack separate Studio controls. Explain that distinction in `TEMPLATE.md`.

In HyperFrames 0.9.7 a Canvas/WebGL host without a GSAP timeline uses `data-no-timeline`; time-driven rendering listens to the documented seek mechanism. Wall-clock playback must not make exported frames change unpredictably.

## Use assets and text appropriately

Photos, screenshots, textures, logos and extracted independent figures can remain local assets. Record their source and useful crop/mask relationship in `TEMPLATE.md`.

Text and fonts follow the shared [text and fonts](../../openmotion-production/references/reference-video.md#text-and-fonts) rules. Bundle a stable font in a portable project when the project uses it. Fonts use the existing phase-one batch asset Tool, with parsed metadata and optional license retention; arbitrary binary imports remain unsupported. Preserve its version guards. When a logo or calligraphic artwork stays an image or vector asset, document its replacement location and limitation in `TEMPLATE.md`.

## Rebuild mixed-media shots

- Identify the shots where media carries the product, subject, materials, environment or performance. For those shots, note the visible subject, framing, start and end states, action, cut, usable duration and areas reserved for graphics. Link repeated subjects and lighting across cuts. Make the shot list from the source; do not use the model to redesign the sequence.
- Prefer approved clean assets that preserve the reference. If a media role is still missing, delegate that asset to [openmotion-media](../../openmotion-media/SKILL.md) following the shared [generation boundary](../../openmotion-production/references/materials.md#generation-boundary). The internal template workflow assumes an existing team OpenDesign Cloud configuration. Discover the relevant Cloud model and capability when needed; do not open signup, subscription or purchase flows for this template task. If the required capability is unavailable, keep working on supported layers and record the affected shot and the supplied asset or approximation needed. A configured key does not establish model access or authorize a paid retry.
- Choose the least complex input that preserves the shot's function. For a static product or background, use an approved image and add controllable native animation if it reproduces the movement. For camera/subject motion, changing reflections, parallax or occlusion that a still cannot reproduce, evaluate a video model with compatible reference input, duration and framing. Prefer the clean product or first frame where supported. Keep the same approved starting appearance for repeated product shots and inspect it at the start, through the action and at the cut. For a difficult shot, validate a representative short segment before spending the approved batch on the remaining shots. When comparing authorized model candidates, hold the starting asset, shot brief and output target constant. Choose by identity and motion through the cut in the composition; keep model scores and observations in test evidence, not Skill defaults.
- Keep the selected media as project-relative, replaceable clips or stills. Keep captions, prices, UI, logos and added graphic elements in native layers when they are meant to be changed. Use a clean plate or alternate asset if the available material bakes those elements in. When exact product identity is essential, use real approved product material or record any approximation; a generated look-alike does not establish product fidelity. A clean individual shot can supply its footage layer, but neither the reference film nor generated footage with the final overlays baked in may stand in for the editable composition.
- Preserve approved source sound when it serves the reference. Keep music, speech and sound effects independently replaceable when clean stems are available. If only a mixed track is available, identify what a future edit would affect; do not claim it has been separated. For missing eligible sound, use the media Skill within its actual capabilities, then align real audio duration and events to the reference. Silence or a stock replacement is not proof that the original sound was faithfully reconstructed.

In `TEMPLATE.md`, note the source role, relative path, crop/timing constraints and how to replace each meaningful asset. Label supplied, extracted, generated and approximated content; for generated assets keep enough provenance to identify the selected version without requiring its provider, URL, workspace or credentials to render the template.

## Make common edits discoverable

Use root variables for common content when useful, with labels the user understands. Do not require every object or decorative property to be a variable. Source edits can also change structure, layout, media and timing. The shared [edit dependencies](../../openmotion-production/references/reference-video.md#check-fidelity-and-edit-dependencies) say what each common change affects.

`TEMPLATE.md` connects observed reference objects/behaviors to their reconstruction and differences, and identifies source/asset entry points, common edits and related effects on layout/timing. Record meaningful systems, not every decorative subpath. Keep existing variable shortcuts functional or remove stale declarations; direct source editing remains available.

## Inspect actual results

Choose static frames for layout, consecutive frames for entrances or shape changes, and playback for rhythm. Native lint/timeline/info and optional diff diagnostics help locate problems. Use the native CLI in the supplied project directory for lint/timeline/info; managed preview/export perform their own lint/technical checks, with export status read through openmotion_get_project. There is no standalone public inspection Tool. CLI/shell access is a host capability, not a guarantee of MCP-only access.

If results lose texture, depth, blur or a hard cut, inspect how the reference produces that observable effect before choosing a correction. Do not prescribe fixed glow/blur values. Human review decides whether the overall result is acceptable; report technical problems and concrete remaining differences separately.
