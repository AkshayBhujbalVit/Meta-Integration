"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAppointments, cancelAppointment, sendReminder } from "@/lib/api";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2, Bell, XCircle, ChevronLeft, ChevronRight,
  CalendarDays, CheckCircle2, Clock, RefreshCw, List, X,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO,
} from "date-fns";

interface Appt {
  id: number;
  lead_id: number;
  patient_name: string;  // stored as lead name at booking time
  phone: string;
  appointment_date: string;
  appointment_type: string;
  inquiry_type: string;
  status: string;
  notes: string;
  calendar_event_id: string | null;
}

const STATUS_CHIP: Record<string, string> = {
  booked:    "bg-green-50 text-green-700 border-green-200",
  confirmed: "bg-blue-50 text-blue-700 border-blue-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
  completed: "bg-gray-50 text-gray-500 border-gray-200",
  no_show:   "bg-amber-50 text-amber-700 border-amber-200",
};

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const [view, setView]                   = useState<"calendar" | "all">("calendar");
  const [month, setMonth]                 = useState(new Date());
  const [selectedDate, setSelectedDate]   = useState<Date | null>(new Date());
  const [rescheduleAppt, setRescheduleAppt] = useState<Appt | null>(null);
  const [cancelTarget, setCancelTarget]   = useState<Appt | null>(null);
  const [cancelReason, setCancelReason]   = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => getAppointments(),
  });
  const appointments: Appt[] = data?.data ?? [];

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      cancelAppointment(id, reason),
    onSuccess: () => {
      toast.success("Appointment cancelled");
      setCancelTarget(null);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: () => toast.error("Failed to cancel"),
  });

  const reminderMut = useMutation({
    mutationFn: (id: number) => sendReminder(id),
    onSuccess: () => toast.success("Reminder sent via WhatsApp"),
    onError: () => toast.error("Failed to send reminder"),
  });

  const handleCancel = (appt: Appt) => {
    setCancelTarget(appt);
    setCancelReason("");
  };

  // ── calendar helpers ──────────────────────────────────────────────────────
  const today = new Date();
  const monthStart = startOfMonth(month);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end:   endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  const apptsByDate = (d: Date) =>
    appointments.filter((a) => {
      try { return isSameDay(parseISO(a.appointment_date), d) && a.status !== "cancelled"; }
      catch { return false; }
    });

  const selectedAppts = selectedDate ? apptsByDate(selectedDate) : [];
  const allSorted = [...appointments]
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime());

  const active     = appointments.filter((a) => a.status !== "cancelled").length;
  const todayCount = apptsByDate(today).length;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500">
            {active} active
            {todayCount > 0 && <> · <span className="text-blue-600 font-medium">{todayCount} today</span></>}
          </p>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
          <button onClick={() => setView("calendar")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition
              ${view === "calendar" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            <CalendarDays className="w-4 h-4" /> Calendar
          </button>
          <button onClick={() => setView("all")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition
              ${view === "all" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            <List className="w-4 h-4" /> All
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : view === "calendar" ? (
        <CalendarSection
          days={days} month={month} today={today}
          selectedDate={selectedDate}
          apptsByDate={apptsByDate}
          selectedAppts={selectedAppts}
          onMonthPrev={() => setMonth(subMonths(month, 1))}
          onMonthNext={() => setMonth(addMonths(month, 1))}
          onDateSelect={(d) => setSelectedDate(isSameDay(d, selectedDate ?? new Date("")) ? null : d)}
          onCancel={handleCancel}
          onReminder={(id) => reminderMut.mutate(id)}
          onReschedule={(a) => setRescheduleAppt(a)}
        />
      ) : (
        <AllView
          appointments={allSorted}
          onCancel={handleCancel}
          onReminder={(id) => reminderMut.mutate(id)}
          onReschedule={(a) => setRescheduleAppt(a)}
        />
      )}

      {/* Reschedule modal */}
      {rescheduleAppt && (
        <RescheduleModal
          appt={rescheduleAppt}
          onClose={() => setRescheduleAppt(null)}
          onSaved={() => { setRescheduleAppt(null); qc.invalidateQueries({ queryKey: ["appointments"] }); }}
        />
      )}

      {/* Cancel confirmation modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">Cancel Appointment</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {cancelTarget.patient_name || cancelTarget.phone}
                </p>
              </div>
              <button onClick={() => setCancelTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Reason <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="e.g. Lead requested cancellation"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                  onKeyDown={e => e.key === "Enter" && cancelMut.mutate({ id: cancelTarget.id, reason: cancelReason })}
                />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => { setCancelTarget(null); setCancelReason(""); }}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50"
              >
                Keep it
              </button>
              <button
                onClick={() => cancelMut.mutate({ id: cancelTarget.id, reason: cancelReason })}
                disabled={cancelMut.isPending}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                {cancelMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <XCircle className="w-4 h-4" />}
                Cancel Appointment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Calendar section ──────────────────────────────────────────────────────────

function CalendarSection({
  days, month, today, selectedDate, apptsByDate, selectedAppts,
  onMonthPrev, onMonthNext, onDateSelect, onCancel, onReminder, onReschedule,
}: {
  days: Date[]; month: Date; today: Date;
  selectedDate: Date | null;
  apptsByDate: (d: Date) => Appt[];
  selectedAppts: Appt[];
  onMonthPrev: () => void; onMonthNext: () => void;
  onDateSelect: (d: Date) => void;
  onCancel: (a: Appt) => void;
  onReminder: (id: number) => void;
  onReschedule: (a: Appt) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {/* Month nav */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button onClick={onMonthPrev} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900">{format(month, "MMMM yyyy")}</h2>
          <button onClick={onMonthNext} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-gray-400">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const dayAppts  = apptsByDate(day);
            const isToday   = isSameDay(day, today);
            const isSel     = selectedDate ? isSameDay(day, selectedDate) : false;
            const inMonth   = isSameMonth(day, month);
            const hasOnline = dayAppts.some((a) => a.appointment_type !== "in_person");
            const hasClinic = dayAppts.some((a) => a.appointment_type === "in_person");

            return (
              <div key={day.toISOString()} onClick={() => onDateSelect(day)}
                className={`min-h-[72px] p-2 border-b border-r border-gray-50 cursor-pointer transition-colors
                  ${!inMonth ? "bg-gray-50/40 opacity-40" : "hover:bg-blue-50/30"}
                  ${isSel ? "bg-blue-50 ring-2 ring-inset ring-blue-400" : ""}`}>
                <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1
                  ${isToday ? "bg-blue-600 text-white" : "text-gray-700"}`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {dayAppts.slice(0, 2).map((a) => (
                    <div key={a.id}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium truncate
                        ${a.appointment_type === "in_person" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                      {a.patient_name?.split(" ")[0] || "Lead"}
                    </div>
                  ))}
                  {dayAppts.length > 2 && (
                    <div className="text-[10px] text-gray-400 px-1">+{dayAppts.length - 2} more</div>
                  )}
                </div>
                {dayAppts.length > 0 && (
                  <div className="flex gap-0.5 mt-1">
                    {hasOnline && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    {hasClinic && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-blue-100 border border-blue-200" /> Online / Video</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-orange-100 border border-orange-200" /> In-Person</span>
        </div>
      </div>

      {/* Selected day */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-semibold text-gray-800">
              {selectedDate ? format(selectedDate, "EEEE, d MMMM yyyy") : "Select a date to see appointments"}
            </span>
          </div>
          {selectedAppts.length > 0 && (
            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
              {selectedAppts.length} appointment{selectedAppts.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {!selectedDate ? (
          <div className="flex items-center justify-center h-24 text-gray-300 text-sm">
            Click any date on the calendar above
          </div>
        ) : selectedAppts.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-gray-300 text-sm gap-2">
            <CheckCircle2 className="w-4 h-4" /> No appointments on this day
          </div>
        ) : (
          <div className="overflow-x-auto">
            <ApptTable appts={selectedAppts} onCancel={onCancel} onReminder={onReminder} onReschedule={onReschedule} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── All appointments view ─────────────────────────────────────────────────────

function AllView({ appointments, onCancel, onReminder, onReschedule }: {
  appointments: Appt[];
  onCancel: (a: Appt) => void;
  onReminder: (id: number) => void;
  onReschedule: (a: Appt) => void;
}) {
  const groups: { date: string; appts: Appt[] }[] = [];
  appointments.forEach((a) => {
    try {
      const key = format(parseISO(a.appointment_date), "EEEE, d MMMM yyyy");
      const g = groups.find((g) => g.date === key);
      if (g) g.appts.push(a);
      else groups.push({ date: key, appts: [a] });
    } catch { /* skip */ }
  });

  if (appointments.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 flex flex-col items-center justify-center h-48 gap-2 text-gray-300">
        <CalendarDays className="w-8 h-8" />
        <span className="text-sm">No active appointments</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(({ date, appts }) => (
        <div key={date} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-semibold text-gray-700">{date}</span>
            <span className="text-xs text-gray-400 ml-1">· {appts.length} appointment{appts.length > 1 ? "s" : ""}</span>
          </div>
          <ApptTable appts={appts} onCancel={onCancel} onReminder={onReminder} onReschedule={onReschedule} />
        </div>
      ))}
    </div>
  );
}

// ── Shared table ──────────────────────────────────────────────────────────────

function ApptTable({ appts, onCancel, onReminder, onReschedule }: {
  appts: Appt[];
  onCancel: (a: Appt) => void;
  onReminder: (id: number) => void;
  onReschedule: (a: Appt) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 bg-gray-50/50 border-b border-gray-100">
          <th className="px-5 py-3 font-medium">Lead / Contact</th>
          <th className="px-5 py-3 font-medium">Phone</th>
          <th className="px-5 py-3 font-medium">Date</th>
          <th className="px-5 py-3 font-medium">Time</th>
          <th className="px-5 py-3 font-medium">Type</th>
          <th className="px-5 py-3 font-medium">Topic</th>
          <th className="px-5 py-3 font-medium">Status</th>
          <th className="px-5 py-3 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {appts.map((a) => (
          <ApptRow key={a.id} a={a} onCancel={onCancel} onReminder={onReminder} onReschedule={onReschedule} />
        ))}
      </tbody>
    </table>
  );
}

// ── Appointment row ───────────────────────────────────────────────────────────

function ApptRow({ a, onCancel, onReminder, onReschedule }: {
  a: Appt;
  onCancel: (a: Appt) => void;
  onReminder: (id: number) => void;
  onReschedule: (a: Appt) => void;
}) {
  let dateStr = "—";
  let timeStr = "—";
  try {
    const parsed = parseISO(a.appointment_date);
    dateStr = format(parsed, "d MMM yyyy");
    timeStr = format(parsed, "h:mm a");
  } catch { /* */ }

  const isOnline = a.appointment_type !== "in_person";
  const canAct   = a.status !== "cancelled" && a.status !== "completed" && a.status !== "no_show";

  return (
    <tr className="hover:bg-gray-50/40 transition border-b border-gray-50 last:border-0">
      <td className="px-5 py-3.5 font-semibold text-gray-900">{a.patient_name || "—"}</td>
      <td className="px-5 py-3.5 text-gray-400 font-mono text-xs">{a.phone}</td>
      <td className="px-5 py-3.5 text-gray-600 text-sm font-medium">{dateStr}</td>
      <td className="px-5 py-3.5">
        <span className="flex items-center gap-1.5 text-gray-700 text-sm font-semibold">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          {timeStr}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold
          ${isOnline ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-blue-500" : "bg-orange-500"}`} />
          {isOnline ? "Online" : "In-Person"}
        </span>
      </td>
      <td className="px-5 py-3.5 text-gray-500 text-xs max-w-[140px] truncate">{a.inquiry_type || "—"}</td>
      <td className="px-5 py-3.5">
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${STATUS_CHIP[a.status] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
          {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
        </span>
      </td>
      <td className="px-5 py-3.5">
        {canAct ? (
          <div className="flex items-center gap-1.5">
            <button onClick={() => onReschedule(a)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition">
              <RefreshCw className="w-3 h-3" /> Reschedule
            </button>
            <button onClick={() => onReminder(a.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
              <Bell className="w-3 h-3" /> Remind
            </button>
            <button onClick={() => onCancel(a)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition">
              <XCircle className="w-3 h-3" /> Cancel
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-300 capitalize">{a.status}</span>
        )}
      </td>
    </tr>
  );
}

// ── Reschedule modal ──────────────────────────────────────────────────────────

function RescheduleModal({ appt, onClose, onSaved }: {
  appt: Appt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate]   = useState(() => {
    try { return format(parseISO(appt.appointment_date), "yyyy-MM-dd'T'HH:mm"); }
    catch { return ""; }
  });
  const [type, setType]   = useState(appt.appointment_type || "online");
  const [notes, setNotes] = useState(appt.notes || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/appointments/${appt.id}`, {
        appointment_date: date ? new Date(date).toISOString() : undefined,
        appointment_type: type,
        notes: notes || undefined,
      });
      toast.success("Appointment updated");
      onSaved();
    } catch {
      toast.error("Failed to update appointment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">Reschedule / Update</h3>
            <p className="text-xs text-gray-400 mt-0.5">{appt.patient_name || appt.phone}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">New Date & Time</label>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Appointment Type</label>
            <div className="grid grid-cols-2 gap-2">
              {[["online","Online / Video"],["in_person","In-Person"]].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setType(val)}
                  className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition
                    ${type === val
                      ? val === "online" ? "border-blue-400 bg-blue-50 text-blue-700" : "border-orange-400 bg-orange-50 text-orange-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Any special instructions..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
