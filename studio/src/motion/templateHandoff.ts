import { motionApi, type ProjectCatalog, type WorkspaceStatus } from './useWorkspace';
import { isEditableTemplate, type GalleryTemplate } from '../../../shared/catalog';

const enabledKey = 'motion.template-handoff.preview';
const resultKey = 'motion.template-handoff.results';
export function templateHandoffEnabled() {
  try {
    const override = new URLSearchParams(location.search).get('templateHandoffPreview');
    if (override === '0' || override === '1') sessionStorage.setItem(enabledKey, override);
    return sessionStorage.getItem(enabledKey) !== '0';
  } catch { return new URLSearchParams(location.search).get('templateHandoffPreview') !== '0'; }
}

export type PreparedTemplateProject = {
  projectId: string; sessionId: string; title: string; templateId: string;
  originalProjectId?: string; requestId: string;
};
export function preparedTemplateProjects(): PreparedTemplateProject[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(resultKey) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PreparedTemplateProject => item && typeof item === 'object'
      && ['projectId', 'sessionId', 'templateId', 'requestId', 'title'].every(key => typeof item[key] === 'string')
      && (item.originalProjectId === undefined || typeof item.originalProjectId === 'string')).slice(-20);
  } catch { return []; }
}
function remember(result: PreparedTemplateProject) {
  try {
    const records = preparedTemplateProjects().filter(item => item.requestId !== result.requestId);
    sessionStorage.setItem(resultKey, JSON.stringify([...records, result].slice(-20)));
  } catch { /* The current view still retains the exact result. */ }
  return result;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Reconcile only the explicitly requested session, never the newest project. */
export async function findPreparedTemplate(template: GalleryTemplate, originalProjectId: string | undefined, requestId: string) {
  const catalog = await motionApi<ProjectCatalog>('/projects');
  const session = catalog.sessions?.find(item => item.id === requestId && item.templateId === template.id);
  const artifact = session?.artifacts.find(item => item.id === session.activeArtifactId) ?? session?.artifacts[0];
  if (!session || !artifact) return null;
  const project = catalog.projects.find(item => item.id === artifact.projectId && !item.trashedAt);
  if (!project) return null;
  return remember({ projectId: project.id, sessionId: session.id, title: project.title, templateId: template.id, originalProjectId, requestId });
}

/** Compose existing guarded session/artifact operations into an independent editable project. */
export async function prepareTemplateProject(template: GalleryTemplate, originalProjectId: string | undefined, requestId: string) {
  if (!isEditableTemplate(template)) throw new Error('此资源只有参考说明，没有可直接打开的工程。');
  const existing = await findPreparedTemplate(template, originalProjectId, requestId);
  if (existing) return existing;
  const created = await motionApi<{ sessionId: string }>('/sessions', json({ id: requestId, templateId: template.id, mode: 'motion', title: template.title }));
  const current = await motionApi<WorkspaceStatus>('/project/status', undefined, originalProjectId);
  const result = await motionApi<WorkspaceStatus>(`/sessions/${created.sessionId}/artifacts`, json({
    templateId: template.id, expectedRevision: current.revision, expectedProjectId: current.projectId,
  }), originalProjectId);
  return remember({ projectId: result.projectId, sessionId: created.sessionId, title: result.projectTitle,
    templateId: template.id, originalProjectId, requestId });
}

export function templateHandoffPrompt(template: GalleryTemplate, locale: string) {
  const editable = isEditableTemplate(template);
  return locale === 'zh-CN' ? `使用说明：请使用已连接的 OpenMotion 插件；未安装时先按 https://github.com/nexu-io/openmotion 安装并验证连接。
指定模板：${template.title}（${template.id}）；资源类型：${editable ? '可编辑工程' : '参考创作，仅有参考视频与动效说明，没有原片工程'}。
创作要求：先读取这条准确资源，${editable ? '基于完整模板创建独立工程，再按我的要求修改' : '根据参考和我的内容创建独立作品，不承诺精确复刻'}；保留已有工程。先核对产品名、功能文案；需要界面展示时核对截图或录屏，缺必要材料先说明。Logo可用文字品牌，未提供音频时静音。交付时返回准确工程链接，打开并检查自己的内容，后续在同一工程接着改。
我的要求：
` : `Instructions: Use the connected OpenMotion plugin. If needed, install it from https://github.com/nexu-io/openmotion and verify the connection.
Selected template: ${template.title} (${template.id}). Resource: ${editable ? 'editable project' : 'reference video and motion guidance; no original editable project'}.
Creation requirements: Read this exact resource. ${editable ? 'Create an independent project from the complete template, then adapt it to my request.' : 'Create an independent work from the reference and my content; do not promise an exact reconstruction.'} Preserve existing projects. Check product name, copy and any required screenshots or recordings; ask for missing essential inputs. A text brand may replace a logo. Use silence if no audio is supplied. Return the exact project link, open it to check my content, and continue in that same project.
My request:
`;
}
