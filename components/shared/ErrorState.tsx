import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = "Failed To Load Data", onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="w-12 h-12 rounded-full bg-bad/10 grid place-items-center">
        <AlertTriangle size={22} className="text-bad" />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-semibold text-ink">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-surface2 hover:bg-surface3 border border-line rounded-lg text-[12.5px] font-medium text-ink2 transition-colors"
        >
          <RefreshCw size={13} />
          Retry
        </button>
      )}
    </div>
  );
}
