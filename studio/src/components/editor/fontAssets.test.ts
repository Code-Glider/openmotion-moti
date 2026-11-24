// @vitest-environment jsdom
import { expect, it } from "vitest";
import { importedFontFaceCssFor, injectPreviewImportedFont } from "../../utils/studioFontHelpers";
import { fontFamilyFromAssetPath, importedFontFaceCss, resolveInspectorProjectFont, type ImportedFontAsset } from "./fontAssets";

it("derives labels from both encoded paths and literal percent filenames", () => {
  expect(fontFamilyFromAssetPath("assets/My%20Font-Regular.ttf")).toBe("My Font");
  expect(fontFamilyFromAssetPath("assets/50% off.ttf")).toBe("50% off");
  expect(fontFamilyFromAssetPath("assets/Font%E0%A4.ttf")).toBe("Font%E0%A4");
});

const face = (file: string, extra: Partial<ImportedFontAsset> = {}): ImportedFontAsset => ({
  family: "Poppins",
  path: `assets/fonts/Poppins/${file}`,
  url: `/preview/assets/fonts/Poppins/${file}`,
  ...extra,
});

it("a face with no weight or style is written as before", () => {
  expect(importedFontFaceCss(face("Poppins-Bold.ttf"))).toBe(
    '@font-face { font-family: "Poppins"; src: url("/preview/assets/fonts/Poppins/Poppins-Bold.ttf"); font-display: swap; }',
  );
});

it("a face says which weight and style it draws, a variable file its weight range", () => {
  expect(
    importedFontFaceCss(face("Poppins-BoldItalic.ttf", { weight: "700", style: "italic" })),
  ).toBe(
    '@font-face { font-family: "Poppins"; src: url("/preview/assets/fonts/Poppins/Poppins-BoldItalic.ttf"); font-weight: 700; font-style: italic; font-display: swap; }',
  );
  expect(
    importedFontFaceCss(face("Roboto-Variable.ttf", { weight: "100 900", style: "normal" })),
  ).toContain("font-weight: 100 900; font-style: normal;");
  expect(importedFontFaceCss(face("x.ttf", { weight: "700; color: red" }))).not.toContain(
    "font-weight",
  );
});

it("two weights of one family are both drawn in the preview", () => {
  const bold = face("Poppins-Bold.ttf", { weight: "700", style: "normal" });
  const regular = face("Poppins-Regular.ttf", { weight: "400", style: "normal" });
  injectPreviewImportedFont(document, bold);
  injectPreviewImportedFont(document, regular);
  injectPreviewImportedFont(document, bold);
  expect(document.head.querySelectorAll("style")).toHaveLength(2);
});

it("the saved rule points at the font from the file that uses it", () => {
  const bold = face("Poppins-Bold.ttf");
  expect(importedFontFaceCssFor(bold, "index.html")).toContain(
    'url("assets/fonts/Poppins/Poppins-Bold.ttf")',
  );
  expect(importedFontFaceCssFor(bold, "compositions/intro.html")).toContain(
    'url("../assets/fonts/Poppins/Poppins-Bold.ttf")',
  );
});

it("a weight the browser would drop is left out, and a family cannot close the style block", () => {
  for (const weight of ["0", "5000", "bold", "700;}"])
    expect(importedFontFaceCss(face("x.ttf", { weight }))).not.toContain("font-weight");
  expect(importedFontFaceCss(face("x.ttf", { weight: "1000" }))).toContain("font-weight: 1000;");
  expect(importedFontFaceCss({ ...face("x.ttf"), family: "</style><b>x" })).not.toContain(
    "</style>",
  );
});


const studioBase = "https://studio.example/";
const projectBase = studioBase + "api/projects/current/preview/";
const inspectorAsset = face("NotoSansSyriac.woff2", {
  family: "Noto Sans Syriac", path: "assets/fonts/syr.woff2",
  url: "/api/projects/current/preview/assets/fonts/syr.woff2",
});

function fontSheet(src: string, family = '"Authored alias"', href: string | null = null) {
  return { href, cssRules: [{ type: 5, style: {
    getPropertyValue: (property: string) => property === "font-family" ? family : src,
  } }] };
}
function previewWith(...styleSheets: unknown[]): Document {
  return { baseURI: projectBase + "index.html", styleSheets } as unknown as Document;
}

it("resolves an authored alias against the actual current-project font inventory, not metadata names", () => {
  const preview = previewWith(fontSheet('url("assets/fonts/syr.woff2") format("woff2")'));
  expect(resolveInspectorProjectFont(preview, '"Authored alias", serif', [inspectorAsset], studioBase))
    .toBe(projectBase + "assets/fonts/syr.woff2");
  expect(resolveInspectorProjectFont(preview, "Different alias", [inspectorAsset], studioBase)).toBeNull();
  expect(resolveInspectorProjectFont(preview, '"Authored alias"', [], studioBase)).toBeNull();
});

it("refuses remote, cross-project, unlisted, and multiple-source font CSS", () => {
  for (const src of [
    'url("https://other.example/assets/fonts/syr.woff2")',
    'url("/api/projects/other/preview/assets/fonts/syr.woff2")',
    'url("assets/fonts/unlisted.woff2")',
    'local("Noto Sans Syriac"), url("assets/fonts/syr.woff2")',
    'url("assets/fonts/syr.woff2"), url("https://other.example/x.woff2")',
  ]) {
    expect(resolveInspectorProjectFont(previewWith(fontSheet(src)), '"Authored alias"', [inspectorAsset], studioBase)).toBeNull();
  }
  const remote = { ...inspectorAsset, url: "https://other.example/assets/fonts/syr.woff2" };
  expect(resolveInspectorProjectFont(previewWith(fontSheet('url("https://other.example/assets/fonts/syr.woff2")')),
    '"Authored alias"', [remote], studioBase)).toBeNull();
});

it("uses a readable stylesheet's own base, skips inaccessible sheets, and rejects ambiguous inventory matches", () => {
  const denied = { get cssRules() { throw new Error("cross-origin"); } };
  const linked = fontSheet('url("../fonts/syr.woff2")', '"Authored alias"', projectBase + "assets/css/main.css");
  expect(resolveInspectorProjectFont(previewWith(denied, linked), '"Authored alias"', [inspectorAsset], studioBase))
    .toBe(projectBase + "assets/fonts/syr.woff2");
  const second = { ...inspectorAsset, path: "assets/fonts/other.woff2",
    url: "/api/projects/current/preview/assets/fonts/other.woff2" };
  expect(resolveInspectorProjectFont(previewWith(linked, fontSheet('url("assets/fonts/other.woff2")')),
    '"Authored alias"', [inspectorAsset, second], studioBase)).toBeNull();
});
