import { randomUUID } from "node:crypto";
import {
  type Artifact,
  type ContentVersion,
  Fault,
  type Input,
  type Project,
  type ProjectHead,
  type ProjectSnapshot,
  type Resource,
  type SourceFile,
  type VersionPage,
} from "./contract.js";
import type { Database } from "./database.js";
import { digest, manifest, sources } from "./native.js";
import type { Sessions } from "./sessions.js";
export class Projects {
  constructor(
    private db: Database,
    private sessions: Sessions,
  ) {
    db.sql.function("project_search", { deterministic: true }, (title, query) =>
      Number(String(title).toLowerCase().includes(String(query).toLowerCase())),
    );
  }
  list(input: Input<"project_list">) {
    const query = input.query ?? "",
      cursor = input.cursor;
    if (cursor && cursor.query !== query) throw new Fault("invalid", "project cursor belongs to another query");
    const rows = this.db.all(
      `SELECT id,session_id AS sessionId,project_id AS projectId,'motion-project' AS kind,title,created_at AS createdAt
       FROM artifacts WHERE project_search(title,?) AND (? IS NULL OR created_at<? OR (created_at=? AND id<?))
       ORDER BY created_at DESC,id DESC LIMIT 6`,
      query,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? 0,
      cursor?.createdAt ?? 0,
      cursor?.id ?? "",
    ) as unknown as Artifact[];
    const projects = rows.slice(0, 5),
      last = projects.at(-1);
    return { projects, nextCursor: rows.length > 5 && last ? { createdAt: last.createdAt, id: last.id, query } : null };
  }
  owner(sessionId: string, artifactId: string): Artifact {
    this.sessions.require(sessionId);
    const artifact = this.db.one(
      "SELECT id,session_id AS sessionId,project_id AS projectId,'motion-project' AS kind,title,created_at AS createdAt FROM artifacts WHERE id=?",
      artifactId,
    );
    if (!artifact || artifact.sessionId !== sessionId)
      throw new Fault("ownership", "artifact does not belong to session");
    return artifact as unknown as Artifact;
  }
  create(input: Input<"artifact_create">, assets: Resource[]): Artifact {
    this.sessions.get(input.sessionId);
    const files = sources(input.files),
      resources = manifest(assets),
      revision = digest(files, resources),
      projectId = randomUUID(),
      id = randomUUID();
    this.db.run("INSERT INTO projects VALUES(?,?,0,0)", projectId, revision);
    this.db.run(
      "INSERT INTO revisions VALUES(?,?,?,?)",
      projectId,
      revision,
      JSON.stringify(files),
      JSON.stringify(resources),
    );
    this.db.run("INSERT INTO history VALUES(?,0,?)", projectId, revision);
    const artifact: Artifact = {
      id,
      projectId,
      sessionId: input.sessionId,
      title: input.title,
      kind: "motion-project",
      createdAt: Date.now(),
    };
    this.db.run(
      "INSERT INTO artifacts VALUES(?,?,?,?,?)",
      id,
      input.sessionId,
      projectId,
      input.title,
      artifact.createdAt,
    );
    this.record(projectId, revision, "create");
    return artifact;
  }
  head(input: Input<"project_read">): ProjectHead {
    const owner = this.owner(input.sessionId, input.artifactId);
    const entry = this.db.one("SELECT current_revision,history_version FROM projects WHERE id=?", owner.projectId);
    if (!entry) throw new Fault("integrity", "project head is missing");
    return {
      sessionId: owner.sessionId,
      artifactId: owner.id,
      revision: String(entry.current_revision),
      historyVersion: Number(entry.history_version),
    };
  }
  read(input: Input<"project_read">): Project {
    const owner = this.owner(input.sessionId, input.artifactId);
    const entry = this.db.one(
      "SELECT r.revision,r.files,r.resources,p.cursor,p.history_version FROM projects p JOIN revisions r ON r.project_id=p.id AND r.revision=p.current_revision WHERE p.id=?",
      owner.projectId,
    );
    if (!entry) throw new Fault("integrity", "project revision is missing");
    const files = JSON.parse(String(entry.files)) as SourceFile[],
      resources = manifest(JSON.parse(String(entry.resources)) as Resource[]);
    if (digest(files, resources) !== entry.revision) throw new Fault("integrity", "native revision content mismatch");
    return {
      id: owner.projectId,
      artifactId: owner.id,
      sessionId: owner.sessionId,
      revision: String(entry.revision),
      files,
      resources,
      history: {
        version: Number(entry.history_version),
        canUndo: Number(entry.cursor) > 0,
        canRedo: !!this.db.one(
          "SELECT 1 FROM history WHERE project_id=? AND position>?",
          owner.projectId,
          Number(entry.cursor),
        ),
      },
    };
  }
  move(input: Input<"project_undo">, direction: -1 | 1): Project {
    const current = this.read(input);
    if (current.revision !== input.expectedRevision || current.history.version !== input.expectedHistory)
      throw new Fault("conflict", "project history changed; read before moving history");
    const cursor = Number(this.db.one("SELECT cursor FROM projects WHERE id=?", current.id)?.cursor) + direction;
    const target = this.db.one("SELECT revision FROM history WHERE project_id=? AND position=?", current.id, cursor);
    if (!target) throw new Fault("invalid", direction < 0 ? "nothing to undo" : "nothing to redo");
    this.db.run(
      "UPDATE projects SET current_revision=?,cursor=?,history_version=history_version+1 WHERE id=?",
      String(target.revision),
      cursor,
      current.id,
    );
    this.record(current.id, String(target.revision), direction < 0 ? "undo" : "redo");
    return this.read(input);
  }
  save(input: Input<"project_save">): Project {
    const current = this.read(input);
    if (current.revision !== input.expectedRevision)
      throw new Fault("conflict", "project revision changed; read before saving");
    return this.commit(current, input.files, current.resources);
  }
  snapshot(input: Input<"project_snapshot">) {
    const owner = this.owner(input.sessionId, input.artifactId),
      entry = this.db.one(
        "SELECT files,resources FROM revisions WHERE project_id=? AND revision=?",
        owner.projectId,
        input.revision,
      );
    if (!entry) throw new Fault("missing", "owned project revision is missing");
    const files = sources(JSON.parse(String(entry.files)) as SourceFile[]),
      resources = manifest(JSON.parse(String(entry.resources)) as Resource[]);
    if (digest(files, resources) !== input.revision) throw new Fault("integrity", "project revision content mismatch");
    return {
      id: owner.projectId,
      artifactId: owner.id,
      sessionId: owner.sessionId,
      revision: input.revision,
      files,
      resources,
    };
  }
  commit(current: Project, input: SourceFile[], assets: Resource[], restoredFrom?: string): Project {
    const files = sources(input),
      resources = manifest(assets),
      revision = digest(files, resources);
    if (revision === current.revision && !restoredFrom) return current;
    const cursor = Number(this.db.one("SELECT cursor FROM projects WHERE id=?", current.id)?.cursor);
    this.db.run(
      "INSERT OR IGNORE INTO revisions VALUES(?,?,?,?)",
      current.id,
      revision,
      JSON.stringify(files),
      JSON.stringify(resources),
    );
    this.db.run("DELETE FROM history WHERE project_id=? AND position>?", current.id, cursor);
    this.db.run("INSERT INTO history VALUES(?,?,?)", current.id, cursor + 1, revision);
    this.db.run(
      "UPDATE projects SET current_revision=?,cursor=?,history_version=history_version+1 WHERE id=?",
      revision,
      cursor + 1,
      current.id,
    );
    this.record(current.id, revision, restoredFrom ? "restore" : "edit", restoredFrom);
    return this.read({ sessionId: current.sessionId, artifactId: current.artifactId });
  }
  private record(projectId: string, revision: string, kind: ContentVersion["kind"], restoredFrom?: string) {
    const number = Number(
      this.db.one("SELECT COALESCE(MAX(number),0)+1 AS number FROM versions WHERE project_id=?", projectId)?.number,
    );
    this.db.run(
      "INSERT INTO versions VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      projectId,
      number,
      revision,
      kind,
      Date.now(),
      restoredFrom ?? null,
    );
  }
  private versionHead(projectId: string): ContentVersion {
    const version = this.db.one(
      "SELECT id,number,revision,kind,created_at AS createdAt,restored_from AS restoredFromVersionId FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1",
      projectId,
    );
    if (!version) throw new Fault("integrity", "project version head is missing");
    return version as unknown as ContentVersion;
  }
  versions(input: Input<"project_versions">, verify: (snapshot: ProjectSnapshot) => string[]): VersionPage {
    const owner = this.owner(input.sessionId, input.artifactId),
      head = this.head(input),
      current = this.versionHead(owner.projectId),
      cursor = input.cursor;
    if (current.revision !== head.revision)
      throw new Fault("integrity", "project version head differs from current revision");
    if (
      cursor &&
      (cursor.projectId !== owner.projectId || cursor.ceiling > current.number || cursor.before > cursor.ceiling + 1)
    )
      throw new Fault("invalid", "version cursor is outside its owned inventory");
    const ceiling = cursor?.ceiling ?? current.number,
      rows = this.db.all(
        "SELECT id,number,revision,kind,created_at AS createdAt,restored_from AS restoredFromVersionId FROM versions WHERE project_id=? AND number<=? AND number<? ORDER BY number DESC LIMIT 6",
        owner.projectId,
        ceiling,
        cursor?.before ?? ceiling + 1,
      ) as unknown as ContentVersion[];
    const versions = rows.slice(0, 5).map((version) => {
        let unavailableFiles: string[];
        try {
          unavailableFiles = verify(this.snapshot({ ...input, revision: version.revision }));
        } catch {
          unavailableFiles = ["native source snapshot"];
        }
        return { ...version, restorable: unavailableFiles.length === 0, unavailableFiles };
      }),
      last = versions.at(-1);
    return {
      current,
      historyVersion: head.historyVersion,
      versions,
      newerAvailable: current.number > ceiling,
      nextCursor: rows.length > 5 && last ? { projectId: owner.projectId, ceiling, before: last.number } : null,
    };
  }
  restore(input: Input<"project_restore">, verify: (snapshot: ProjectSnapshot) => string[]): Project {
    const current = this.read(input),
      head = this.versionHead(current.id);
    if (
      current.revision !== input.expectedRevision ||
      current.history.version !== input.expectedHistory ||
      head.id !== input.expectedVersionId
    )
      throw new Fault("conflict", "project version changed; read current source and versions before restoring", {
        revision: current.revision,
        historyVersion: current.history.version,
        versionId: head.id,
      });
    const target = this.db.one(
      "SELECT revision FROM versions WHERE project_id=? AND id=?",
      current.id,
      input.versionId,
    );
    if (!target) throw new Fault("ownership", "version does not belong to this project");
    if (input.versionId === head.id) throw new Fault("invalid", "selected version is already current");
    let snapshot: ProjectSnapshot;
    try {
      snapshot = this.snapshot({ ...input, revision: String(target.revision) });
    } catch {
      throw new Fault("invalid", "historical source is unavailable; current project is unchanged");
    }
    if (verify(snapshot).length)
      throw new Fault("invalid", "historical resource bytes are missing or corrupt; current project is unchanged");
    return this.commit(current, snapshot.files, snapshot.resources, input.versionId);
  }
}
