import { trackMotion } from '../studio/src/motion/tracking.ts';
import { beginStudioIo } from '../studio/src/telemetry/ioRecovery.ts';

// Compile-only calls: this function must never execute or emit events.
function studioContract() {
  const finishIo = beginStudioIo('import_files', { requested_count: 2 });
  finishIo({ outcome: 'partial', added_count: 1, failed_count: 1, listing_status: 'failed' });
  void trackMotion('studio_io_action', { action: 'recheck_render', attempt_id: '' });
  void trackMotion('studio_io_result', { action: 'download_render', attempt_id: '', outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' });
  // @ts-expect-error Each result needs an explicit observed outcome.
  finishIo({ added_count: 2 });
  // @ts-expect-error Automatic reads are not manual I/O actions.
  beginStudioIo('automatic_refresh');
  // @ts-expect-error Private file data is not part of the helper contract.
  beginStudioIo('import_files', { file_name: 'PRIVATE_FILE' });
  // @ts-expect-error Download handoff cannot claim an observed file save.
  finishIo({ outcome: 'success', delivery_status: 'saved' });
  // @ts-expect-error Each result retains its attempt correlation.
  void trackMotion('studio_io_result', { action: 'recheck_file', outcome: 'unknown' });
  void trackMotion('webmcp_tool_finished', { tool_name: 'openmotion_assets_use', transport: 'webmcp', call_id: '', action: 'read', outcome: 'success', duration_ms: 10 });
  // @ts-expect-error Tool actions are closed categories, never arbitrary input.
  void trackMotion('webmcp_tool_started', { tool_name: 'openmotion_assets_use', transport: 'webmcp', call_id: '', action: 'PRIVATE_ACTION' });
  void trackMotion('ui_click', { page_name: 'home', area: 'workspace', element: 'new_creation' });
  void trackMotion('playback', { action: 'speed_change', rate: 1.25 });
  void trackMotion('audio_fx_param_committed', { effect: 'compressor', param: 'threshold', value: -18.5, surface: 'details' });
  // @ts-expect-error Migrated event actions remain closed.
  void trackMotion('playback', { action: 'PRIVATE_ACTION' });
  // @ts-expect-error Measurements are numbers, not arbitrary strings.
  void trackMotion('audio_fx_param_committed', { effect: 'compressor', param: 'threshold', value: 'PRIVATE', surface: 'details' });
  // @ts-expect-error Node-only events are not part of the Studio API.
  void trackMotion('mcp_tool_started', { tool_name: 'motion_get_project', call_id: '', accepted: true });
  // @ts-expect-error Required semantic fields remain required.
  void trackMotion('ui_click', { page_name: 'home' });
  // @ts-expect-error Enums remain closed.
  void trackMotion('ui_click', { page_name: 'private', area: 'workspace', element: 'new_creation' });
}
void studioContract;
