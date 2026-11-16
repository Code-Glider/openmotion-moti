const id = { type: 'string', pattern: '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const reference = object({ assetId: id, versionId: id }, ['assetId', 'versionId']);
export const assetLibraryTool = {
  name: 'openmotion_assets', title: 'OpenMotion · Asset Library',
  description: 'Manage reusable workspace assets independently of film projects. list/get read images, video and audio, immutable versions and generation provenance. import copies a real local file (max 500 MB); generate uses the configured Model Gateway and returns a job, not finished media. First inspect providers/models through openmotion_media_use. Use stable requestId for import/generate/import_to_project, poll the original job with status, and never automatically resubmit a paid request. assetId + parentVersionId creates another version; references pin exact versions (image models with supportsImageReference, such as local Codex and OpenDesign account models that support editing, accept one image reference). update can rename, move to trash, restore from trash or select a current version; older bytes remain. import_to_project copies a pinned version into an explicit project using its normal import/history protections; it never places it on the timeline. Generated assets, imported project media and composition edits remain separate.',
  inputSchema: object({
    action: { enum: ['list', 'get', 'import', 'update', 'generate', 'jobs', 'status', 'cancel', 'import_to_project'] },
    requestId: { type: 'string', pattern: '^[\\w-]{1,100}$' }, assetId: id, versionId: id, parentVersionId: id, jobId: id,
    projectId: { type: 'string', pattern: '^(project|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$' },
    name: { type: 'string', minLength: 1, maxLength: 200 }, sourcePath: { type: 'string', minLength: 1, maxLength: 4096 },
    modality: { enum: ['image', 'video', 'audio'] }, source: { enum: ['upload', 'generated'] }, query: { type: 'string', maxLength: 200 },
    trash: { type: 'boolean' }, sort: { enum: ['newest', 'oldest', 'name'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    model: { type: 'string', minLength: 1, maxLength: 300 }, prompt: { type: 'string', minLength: 1, maxLength: 20000 },
    mode: { enum: ['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'] }, parameters: { type: 'object', additionalProperties: true },
    references: { type: 'array', maxItems: 8, items: reference }, conversationId: id,
    changes: object({ name: { type: 'string', minLength: 1, maxLength: 200 }, trashed: { type: 'boolean' }, currentVersionId: id }),
  }, ['action']),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};
