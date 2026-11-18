import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  title       = "No Data",
  description = "Nothing to show here yet.",
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4">
      <div className="w-14 h-14 rounded-2xl bg-surface2 grid place-items-center border border-line">
        <Inbox size={24} className="text-muted" />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-semibold text-ink2">{title}</p>
        {description && <p className="text-[11.5px] text-muted mt-1">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
