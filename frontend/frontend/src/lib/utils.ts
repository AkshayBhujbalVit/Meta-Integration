import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(date: string | null | undefined) {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy");
}

export function fmtDateTime(date: string | null | undefined) {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy, h:mm a");
}

export function fmtRelative(date: string | null | undefined) {
  if (!date) return "—";
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  call_scheduled: "bg-purple-100 text-purple-700",
  calling: "bg-yellow-100 text-yellow-700",
  interested: "bg-violet-100 text-violet-700",
  appointment_booked: "bg-green-100 text-green-700",
  not_interested: "bg-red-100 text-red-700",
  no_answer: "bg-gray-100 text-gray-600",
  callback_requested: "bg-orange-100 text-orange-700",
  duplicate: "bg-slate-100 text-slate-500",
  failed: "bg-red-100 text-red-600",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  call_scheduled: "Scheduled",
  calling: "Calling",
  interested: "Interested",
  appointment_booked: "Booked",
  not_interested: "Not Interested",
  no_answer: "No Answer",
  callback_requested: "Callback",
  duplicate: "Duplicate",
  failed: "Failed",
};
