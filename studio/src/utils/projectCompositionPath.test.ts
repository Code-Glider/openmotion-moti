import { describe, expect, it } from "vitest";
import { projectCompositionPath } from "./projectCompositionPath";

const origin = "http://localhost:4173";
const resolve = (source: string) => projectCompositionPath(source, "p", origin);

describe("projectCompositionPath", () => {
  it.each([
    ["./compositions/clip.html", "compositions/clip.html"],
    ["compositions/../clip.html", "clip.html"],
    ["/api/projects/p/preview/compositions/clip.html", "compositions/clip.html"],
    [`${origin}/api/projects/p/preview/comp/compositions/clip.html?t=1#label`, "compositions/clip.html"],
    [`${origin}/api/projects/p/preview/compositions/%E5%AD%97%20%23%25.html`, "compositions/字 #%.html"],
  ])("normalizes %s", (source, expected) => {
    expect(resolve(source)).toBe(expected);
    expect(resolve(expected)).toBe(expected);
  });

  it.each([
    `${origin}/api/projects/q/preview/clip.html`,
    `${origin}/api/projects/p-other/preview/clip.html`,
    "https://foreign.invalid/api/projects/p/preview/clip.html",
    "//foreign.invalid/api/projects/p/preview/clip.html",
    `${origin}/api/projects/p/preview/../clip.html`,
    `${origin}/api/projects/p/preview/%2e%2e%2fclip.html`,
    `${origin}/api/projects/p/preview/%5c..%5cclip.html`,
    `${origin}/api/projects/p/preview/%00.html`,
    `${origin}/api/projects/p/preview/%broken.html`,
    "../clip.html", "C:\\project\\clip.html", "./C:/clip.html", "folder/../C:/clip.html", "/etc/passwd", "", ".",
  ])("refuses non-project paths: %s", source => {
    expect(resolve(source)).toBeNull();
  });
});
