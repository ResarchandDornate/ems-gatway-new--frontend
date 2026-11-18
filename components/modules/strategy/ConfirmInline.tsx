"use client";

/**
 * In-row Yes / No prompt for destructive actions. window.confirm is not used:
 * embedded browsers (including the desktop app's preview pane) can suppress it,
 * which made Delete silently do nothing.
 */
export function ConfirmInline({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={message} className="flex items-center gap-3 flex-wrap">
      <span className="text-[11.5px] text-ink2">{message}</span>
      <button onClick={onConfirm} autoFocus
        className="text-[12px] font-semibold text-[var(--red)] underline underline-offset-2 hover:opacity-80">
        Yes, Delete
      </button>
      <button onClick={onCancel} className="text-[12px] font-medium text-ink2 underline underline-offset-2 hover:opacity-80">
        No
      </button>
    </div>
  );
}
