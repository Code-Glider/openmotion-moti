import { StudioToast } from './StudioToast';
import { StudioToastLayer } from './StudioToastLayer';

/** A single live connection state, not a new notification on every failed poll. */
export function StudioConnectionToast({ reconnecting }: { reconnecting: boolean }) {
  if (!reconnecting) return null;
  return <StudioToastLayer><div data-testid="motion-connection-toast">
    <StudioToast message="Connection lost. Reconnecting…" tone="info" />
  </div></StudioToastLayer>;
}
