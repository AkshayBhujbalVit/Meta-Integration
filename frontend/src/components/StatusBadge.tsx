import { cn, STATUS_COLORS, STATUS_LABELS } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
