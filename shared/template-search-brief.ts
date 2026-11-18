export type SearchBrief = { mode: 'reference' | 'describe'; source: 'link' | 'local'; query: string; reference: string; description: string };
/** Plain reference data stays separate from the host's instructions and is never sent automatically. */
export function templateSearchBrief(input: SearchBrief, t: (message: string) => string) {
  const lines = [t('Use OpenMotion to create an editable video for this request.'), t('Follow the OpenMotion production workflow. Use openmotion_create_project for a new project, openmotion_edit_project with current revision protection, and openmotion_open_preview for the editable preview.')];
  if (input.query.trim()) lines.push(`${t('Search context')}: ${JSON.stringify(input.query.trim())}`);
  if (input.mode === 'reference') {
    lines.push(input.source === 'local' ? t('Read the video I attach in this conversation before recreating it.')
      : `${t('Reference video')}: ${JSON.stringify(input.reference.trim())}`);
  }
  if (input.description.trim()) lines.push(`${t('Creative brief')}: ${JSON.stringify(input.description.trim())}`);
  lines.push(t('If required material is missing or inaccessible, ask me for it. Keep my existing projects safe.'));
  return lines.join('\n');
}
