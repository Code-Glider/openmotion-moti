import type { ReactNode } from 'react';
import { HorizontalRail } from './HorizontalRail';

export function CategoryStrip({ label, selection, neutral, children }: {
  label: string; selection?: string | null; neutral?: boolean; children: ReactNode;
}) {
  return <HorizontalRail label={label} className="om-category-strip" viewportClassName="om-category-strip-viewport" selection={selection}>
    <div className={neutral ? 'om-category-strip-track om-gallery-categories' : 'om-category-strip-track'}
      data-neutral={neutral || undefined}>{children}</div>
  </HorizontalRail>;
}
