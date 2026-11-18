import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TemplateRecommendationCard } from "../src/TemplateRecommendationCard";
import { configureStudio } from "../src/studio";
import type { RecommendationDetails } from "../src/templateRecommendationAction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); document.body.removeAttribute("data-ds-dark-theme"); });
const details: RecommendationDetails = {
  onboarding: true, language: "zh", libraryOpened: true,
  templates: ["one", "two", "three"].map(id => ({ id, title: id, description: "简介", previewUrl: "/" + id + ".mp4", posterUrl: "/" + id + ".jpg" })),
};
function mount(value: RecommendationDetails, actCard = vi.fn().mockResolvedValue({ status: "settled" })) {
  configureStudio("http://localhost:4173");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(<TemplateRecommendationCard proposal={{ details: value }} act={actCard} />));
  return actCard;
}
it("shows the shared Chinese onboarding above the same three playable cards", async () => {
  const actCard = mount(details);
  expect(document.body.textContent).toContain("我是你的开源视频创作搭档");
  expect(document.body.textContent).toContain("先看看我挑的这 3 个");
  expect([...document.querySelectorAll("[data-template-id]")].map(el => el.getAttribute("data-template-id"))).toEqual(["one", "two", "three"]);
  expect(document.querySelectorAll("video[controls]")).toHaveLength(3);
  expect(document.querySelector("video")?.getAttribute("src")).toBe("http://localhost:4173/one.mp4");
  expect(document.querySelector("video")?.hasAttribute("autoplay")).toBe(false);
  const buttons = document.querySelectorAll("button");
  await act(async () => (buttons[2] as HTMLButtonElement).click());
  expect(actCard).toHaveBeenCalledWith("preview", { templateId: "two" });
  await act(async () => (buttons[5] as HTMLButtonElement).click());
  expect(actCard).toHaveBeenLastCalledWith("use", { templateId: "three" });
});
it("does not claim a right-hand library opened when opening was not confirmed", () => {
  mount({ ...details, libraryOpened: false, language: "en" });
  expect(document.body.textContent).toContain("open-source video creation partner");
  expect(document.body.textContent).not.toContain("right");
});
it("keeps selection available after an action fails", async () => {
  mount(details, vi.fn().mockResolvedValue({ status: "refused" }));
  await act(async () => (document.querySelector("button") as HTMLButtonElement).click());
  expect(document.querySelector("[role=status]")?.textContent).toContain("未能填入");
  expect((document.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
});

it("tracks the host theme without resetting cards or their template identities", async () => {
  mount(details);
  expect(document.querySelector(".omd-recommendation-card")?.getAttribute("data-theme")).toBe("light");
  await act(async () => { document.body.setAttribute("data-ds-dark-theme", ""); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.querySelector(".omd-recommendation-card")?.getAttribute("data-theme")).toBe("dark");
  expect(document.querySelectorAll("[data-template-id]")).toHaveLength(3);
});
