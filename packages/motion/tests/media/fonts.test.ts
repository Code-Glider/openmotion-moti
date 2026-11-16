import { resourceFontFamily } from "@open-motion/workspace/contract";
import { expect, it, vi } from "vitest";
import { Motion } from "@";
import { assembleProject, type MediaFact } from "@/project/assemble.js";

const digest = `sha256:${"a".repeat(64)}`,
  family = resourceFontFamily(digest),
  html =
    '<html><head></head><body><main data-composition-id="main" data-width="320" data-height="180" data-duration="1"><p data-hf-id="title" data-start="0" data-duration="1">Title</p></main></body></html>',
  face: MediaFact = { path: "assets/face.woff2", digest, type: "font/woff2", weight: [100, 900], slant: "normal" };
it("writes only explicit font-family through SDK source edits and preserves inheritance on clear", async () => {
  const model = await Motion.open(html);
  try {
    const changed = model.patch("title", { fontFamily: family });
    expect(model.clips.find((c) => c.id === "title")?.fontFamily).toBe(family);
    expect(changed).not.toContain("@font-face");
    expect(changed).not.toContain("font-size");
    const compiled = assembleProject([{ path: "index.html", content: changed }], [face]);
    expect(compiled.html).toContain("@font-face");
    expect(compiled.html).toContain(face.path);
    expect(() => assembleProject([{ path: "index.html", content: changed }])).toThrow("missing project font");
    const cleared = model.patch("title", { fontFamily: null });
    expect(model.clips.find((c) => c.id === "title")?.fontFamily).toBeNull();
    expect(() => assembleProject([{ path: "index.html", content: cleared }])).not.toThrow();
  } finally {
    model.dispose();
  }
});
it("derives one face per byte identity and rejects missing stylesheet/custom-property bindings", () => {
  const compiled = assembleProject(
    [{ path: "index.html", content: html }],
    [face, { ...face, path: "assets/copy.woff2" }],
  );
  expect(compiled.html.match(/@font-face/g)).toHaveLength(1);
  for (const css of [`p{font-family:"${family}"}`, `:root{--font:"${family}"}p{font-family:var(--font)}`]) {
    expect(() =>
      assembleProject([{ path: "index.html", content: html.replace("</head>", `<style>${css}</style></head>`) }]),
    ).toThrow("missing project font");
    expect(() =>
      assembleProject([
        { path: "index.html", content: html },
        { path: "text.css", content: css },
      ]),
    ).toThrow("missing project font");
  }
  expect(() =>
    assembleProject([
      { path: "index.html", content: html.replace("</head>", `<style>/* ${family} */</style></head>`) },
    ]),
  ).not.toThrow();
});

it("reads literal quoted font families from authored Agent source without changing other styles", async () => {
  const source = html.replace(
      'data-hf-id="title"',
      `data-hf-id="title" style="font-size:36px;font-family:'${family}'"`,
    ),
    model = await Motion.open(source);
  try {
    expect(model.clips.find((clip) => clip.id === "title")?.fontFamily).toBe(family);
    const changed = model.patch("title", { fontSize: 37 });
    expect(changed).toMatch(new RegExp(`font-family:\\s*'${family}'`));
    expect(model.clips.find((clip) => clip.id === "title")?.fontFamily).toBe(family);
    const compiled = assembleProject([{ path: "index.html", content: changed }], [face]);
    expect(compiled.html).toContain(family);
  } finally {
    model.dispose();
  }
});

it("waits for every template font face and actual font readiness, and reports failed or excessive faces", async () => {
  const { fontBridge } = await import("@/project/fonts.js");
  const messages: { ready: boolean }[] = [],
    ready = Promise.withResolvers<void>(),
    load = vi.fn(async () => {});
  const configure = (faces: { load(): Promise<void> }[], fontsReady = Promise.resolve()) => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("parent", { postMessage: (value: { ready: boolean }) => messages.push(value) });
    vi.stubGlobal("document", {
      documentElement: { getAttribute: () => "[]" },
      fonts: Object.assign(new Set(faces), { ready: fontsReady, load: async () => [] }),
    });
  };
  try {
    configure([{ load }], ready.promise);
    fontBridge(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
    ready.resolve();
    await Reflect.get(window, "__openMotionFonts");
    expect(messages.at(-1)?.ready).toBe(true);
    configure([
      {
        load: async () => {
          throw Error("bad font bytes");
        },
      },
    ]);
    fontBridge(true);
    await expect(Reflect.get(window, "__openMotionFonts")).rejects.toThrow("bad font bytes");
    expect(messages.at(-1)?.ready).toBe(false);
    load.mockClear();
    configure(Array.from({ length: 65 }, () => ({ load })));
    fontBridge(true);
    await expect(Reflect.get(window, "__openMotionFonts")).rejects.toThrow("font face limit");
    expect(load).not.toHaveBeenCalled();
    expect(messages.at(-1)?.ready).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
