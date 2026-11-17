import { Fault, type Input, type Project } from "@open-motion/workspace/contract";
import type { Client } from "../api.js";
import type { Editor } from "./editor.js";

/** Freeze one restore after the existing save barrier; unknown outcomes replay that exact command. */
export class VersionRestore {
  private intent?: Omit<Input<"project_restore">, "requestId">;
  get pending() {
    return this.intent?.versionId;
  }
  constructor(
    private editor: Editor,
    private client: Client,
    private execute: (input: Omit<Input<"project_restore">, "requestId">) => Promise<Project>,
    private apply: (project: Project) => void,
  ) {}
  async restore(versionId: string) {
    if (this.intent && this.intent.versionId !== versionId) throw Error("先重试尚未确认的恢复");
    if (!this.intent) {
      await this.editor.save();
      const project = this.editor.project;
      if (!project) throw Error("先打开工程");
      const owner = { sessionId: project.sessionId, artifactId: project.artifactId },
        page = await this.client.execute("project_versions", owner);
      if (
        this.editor.project !== project ||
        page.current.revision !== project.revision ||
        page.historyVersion !== project.history.version
      )
        throw Error("工程已有外部修改，请先刷新并核对版本");
      this.intent = {
        ...owner,
        versionId,
        expectedRevision: project.revision,
        expectedHistory: project.history.version,
        expectedVersionId: page.current.id,
      };
    }
    try {
      const project = await this.execute(this.intent);
      this.intent = undefined;
      this.apply(project);
    } catch (error) {
      if (error instanceof Fault && error.code !== "integrity") this.intent = undefined;
      throw error;
    }
  }
}
