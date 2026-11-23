import type { ReactNode } from 'react';

// Client Hub page title block: 26px/600 title, optional count, 14px dim description.
export function PageHeader({
  title,
  count,
  description,
  actions,
  tabs,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-3 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {title}
            {count !== undefined && <span className="font-normal text-faint">{count}</span>}
          </h1>
          {description && <p className="max-w-[620px] text-sm leading-relaxed text-dim">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}
