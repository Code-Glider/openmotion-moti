import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { POPUP_LAYER, popupSurface } from '../components/ui/Menu';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';

/** A transient project preview never changes the pinned navigation width. */
export function WorkspaceHomeButton({ active, expanded, previewEnabled, onToggle, children }: {
  active: boolean;
  expanded: boolean;
  previewEnabled: boolean;
  onToggle: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const [previewOpen, setPreviewOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const open = previewEnabled && previewOpen;
  useEffect(() => { if (!previewEnabled) setPreviewOpen(false); }, [previewEnabled]);
  return <Popover.Root open={open} modal={false} onOpenChange={(next, details) => {
    // A press pins/unpins the full sidebar; only hover owns this floating view.
    if (details.reason === 'trigger-press') { details.cancel(); return; }
    // Moving the pointer away must not dismiss a search the user is typing in.
    if (!next && details.reason === 'trigger-hover' && popup.current !== document.activeElement && popup.current?.contains(document.activeElement)) {
      details.cancel(); return;
    }
    setPreviewOpen(previewEnabled && next);
  }}>
    <Popover.Trigger ref={trigger} openOnHover={previewEnabled} delay={180} closeDelay={160}
      className="om-nav-item om-rail-button" aria-label={t('Home')} aria-pressed={active}
      aria-expanded={expanded || open} {...(expanded ? { 'aria-controls': 'om-project-navigation' } : {})}
      title={previewEnabled ? undefined : t('Home')}
      onClick={() => { setPreviewOpen(false); onToggle(); }}>
      <RemixIcon name="home-line" size={18} />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="right" align="start" sideOffset={8} collisionPadding={8}
        collisionAvoidance={{ side: 'none', align: 'shift', fallbackAxisSide: 'none' }} className={POPUP_LAYER}>
        <Popover.Popup ref={popup} aria-label={t('Project list')} initialFocus={false}
          finalFocus={() => popup.current?.contains(document.activeElement) ? trigger.current : false}
          className={`${popupSurface} om-selection-panel om-project-flyout`}>
          {children(() => setPreviewOpen(false))}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
