import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseHTMLContent } from "@hyperframes/core/compiler";
import { parseAudioElements } from "@hyperframes/engine";
import { canonical } from "@odsuite/protocol";
import { assembleProject } from "@open-motion/motion/project";
import { capture, gsap, runtime } from "@open-motion/motion/runtime";
import type { ProjectSnapshot, Workspace } from "@open-motion/workspace";
import { fps, type Specification, specification } from "../jobs/contract.js";
import { persist } from "./file.js";

export interface Snapshot {
  project: ProjectSnapshot;
  assets: { path: string; chunks(): Iterable<Uint8Array> | AsyncIterable<Uint8Array> }[];
  spec: Specification;
}
/** Copy immutable metadata and retain the already pinned byte producers. */
export function cloneSnapshot(input: Snapshot): Snapshot {
  return {
    project: structuredClone(input.project),
    spec: structuredClone(input.spec),
    assets: input.assets.map((asset) => ({ path: asset.path, chunks: asset.chunks.bind(asset) })),
  };
}
function fromSource(html: string, frameRate: { num: number; den: number }) {
  const rate = fps.parse(frameRate),
    root = parseHTMLContent(html).querySelector("[data-composition-id]");
  const numeric = (key: string) => {
    const value = root?.getAttribute(key) ?? "";
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw Error(`export requires static ${key}`);
    return Number(value);
  };
  const duration = numeric("data-duration"),
    frames = Math.ceil((duration * rate.num) / rate.den),
    spec = specification.parse({
      width: numeric("data-width"),
      height: numeric("data-height"),
      fps: rate,
      duration,
      frames,
      audio: parseAudioElements(html).length ? "required" : "silent",
    });
  return spec;
}
/** Capture the confirmed source and immutable resource bytes once, before execution. */
export function freeze(
  workspace: Workspace,
  input: {
    sessionId: string;
    artifactId: string;
    revision: string;
    fps: { num: number; den: number };
  },
): Snapshot {
  const project = workspace.execute("project_snapshot", {
    sessionId: input.sessionId,
    artifactId: input.artifactId,
    revision: input.revision,
  });
  const spec = fromSource(assembleProject(project.files, project.resources).html, input.fps);
  const assets = project.resources.map((resource) => {
    const reader = workspace.readResource({
      sessionId: project.sessionId,
      artifactId: project.artifactId,
      revision: project.revision,
      path: resource.path,
    });
    return { path: resource.path, chunks: reader.chunks.bind(reader) };
  });
  return { project: structuredClone(project), assets, spec };
}
/** An execution projection under a granted staging root, never an editable project authority. */
export async function materialize(snapshot: Snapshot, root: string, signal?: AbortSignal) {
  const { project } = snapshot,
    html = assembleProject(project.files, project.resources).html,
    reserved = new Set(["__runtime.js", "__gsap.js"]);
  if (canonical(fromSource(html, snapshot.spec.fps)) !== canonical(snapshot.spec))
    throw Error("render specification differs from fixed source");
  await mkdir(root, { mode: 0o700 });
  const paths = new Set<string>();
  const write = async (path: string, bytes: string | Buffer) => {
    signal?.throwIfAborted();
    if (paths.has(path) || /[\\:%?#]/.test(path) || path.split("/").some((p) => !p || p === "." || p === ".."))
      throw Error("invalid export materialization path");
    paths.add(path);
    await mkdir(dirname(join(root, path)), { mode: 0o700, recursive: true });
    await writeFile(join(root, path), bytes, { flag: "wx", mode: 0o600, flush: true });
  };
  for (const file of project.files) {
    if (reserved.has(file.path)) throw Error("reserved export engine path");
    if (file.path !== "index.html") await write(file.path, file.content);
  }
  for (const resource of project.resources) {
    signal?.throwIfAborted();
    const asset = snapshot.assets.find((a) => a.path === resource.path);
    if (
      !asset ||
      paths.has(resource.path) ||
      /[\\:%?#]/.test(resource.path) ||
      resource.path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("invalid export materialization path");
    paths.add(resource.path);
    await mkdir(dirname(join(root, resource.path)), { mode: 0o700, recursive: true });
    await persist(join(root, resource.path), asset.chunks(), signal, resource);
  }
  const document = parseHTMLContent(capture(html, "./", snapshot.spec.fps)),
    policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute(
    "content",
    "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
  );
  document.head.prepend(policy);
  await write("index.html", document.toString());
  await write("__gsap.js", gsap);
  await write("__runtime.js", runtime);
  signal?.throwIfAborted();
  return html;
}
