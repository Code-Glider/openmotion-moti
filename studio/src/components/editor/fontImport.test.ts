// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { prepareFontImport } from "./fontImport";

afterEach(() => vi.unstubAllGlobals());

it("rejects invalid files before upload and retains the decoded font metadata", async () => {
  const load = vi.fn(async () => ({}));
  vi.stubGlobal("FontFace", class { load = load; });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("bad font", { status: 400 })));
  await expect(prepareFontImport(new File(["text"], "bad.ttf"))).rejects.toThrow("invalid font");
  expect(load).not.toHaveBeenCalled();

  const metadata = { family: "Arial Black", weight: "900", style: "normal" };
  vi.mocked(fetch).mockResolvedValue(new Response("font bytes", { headers: {
    "Content-Type": "font/ttf", "X-Font-Metadata": encodeURIComponent(JSON.stringify(metadata)),
  } }));
  const prepared = await prepareFontImport(new File(["collection bytes"], "original.ttc"));
  expect(load).toHaveBeenCalledOnce();
  expect(prepared.metadata).toEqual(metadata);
  expect(prepared.file.name).toBe("original.ttf");
  expect(await prepared.file.text()).toBe("font bytes");
});

it("rejects a server-accepted font when browser decoding fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("bad bytes", { headers: {
    "Content-Type": "font/ttf",
    "X-Font-Metadata": encodeURIComponent(JSON.stringify({ family: "Broken" })),
  } })));
  vi.stubGlobal("FontFace", class { async load() { throw new Error("Browser cannot decode"); } });
  await expect(prepareFontImport(new File(["bad"], "bad.ttf"))).rejects.toThrow("cannot decode");
});

it.each(["font/otf", "font/woff", "font/woff2"])(
  "preserves accepted %s bytes, metadata and canonical extension",
  async (contentType) => {
    const load = vi.fn(async () => ({}));
    vi.stubGlobal("FontFace", class { load = load; });
    const metadata = { family: "Mixed Script Face", weight: "400", style: "normal" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("normalized font bytes", { headers: {
      "Content-Type": contentType + "; charset=binary",
      "X-Font-Metadata": encodeURIComponent(JSON.stringify(metadata)),
    } })));
    const prepared = await prepareFontImport(new File(["original"], "ArabicAndHebrew.ttc"));
    const extension = contentType.split("/")[1];
    expect(prepared.file.name).toBe("ArabicAndHebrew." + extension);
    expect(prepared.file.type).toBe(contentType);
    expect(await prepared.file.text()).toBe("normalized font bytes");
    expect(prepared.metadata).toEqual(metadata);
    expect(load).toHaveBeenCalledOnce();
  },
);

it.each([null, "text/html", "font/woff2-not-a-font", "constructor", "toString", "__proto__"])(
  "rejects an unrecognized prepared font type %s before browser validation",
  async (contentType) => {
    const load = vi.fn(async () => ({}));
    vi.stubGlobal("FontFace", class { load = load; });
    const headers: Record<string, string> = {
      "X-Font-Metadata": encodeURIComponent(JSON.stringify({ family: "Valid family" })),
    };
    if (contentType) headers["Content-Type"] = contentType;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bytes", { headers })));
    await expect(prepareFontImport(new File(["bytes"], "Hebrew.woff2")))
      .rejects.toThrow("Unsupported prepared font format");
    expect(load).not.toHaveBeenCalled();
  },
);
