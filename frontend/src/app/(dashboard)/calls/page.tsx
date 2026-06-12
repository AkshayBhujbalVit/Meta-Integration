"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCallLogs, getAppointments, cancelAppointment, api } from "@/lib/api";
import { fmtRelative } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, ChevronDown, ChevronUp, Play, MessageSquare,
  Mic, Phone, CalendarCheck, RefreshCw, XCircle, Clock,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OUTCOME_COLORS: Record<string, string> = {
  appointment_booked: "bg-green-50 text-green-700 border-green-200",
  interested:         "bg-violet-50 text-violet-700 border-violet-200",
  not_interested:     "bg-red-50 text-red-500 border-red-200",
  callback_requested: "bg-yellow-50 text-yellow-700 border-yellow-200",
  no_answer:          "bg-gray-100 text-gray-500 border-gray-200",
  completed:          "bg-blue-50 text-blue-600 border-blue-100",
};

const APPT_STATUS_COLORS: Record<string, string> = {
  booked:    "bg-green-50 text-green-700",
  confirmed: "bg-violet-50 text-violet-700",
  cancelled: "bg-red-50 text-red-500",
  completed: "bg-gray-50 text-gray-500",
};

function fmtDuration(secs: number | null) {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtApptDate(iso: string) {
  try { return format(parseISO(iso), "d MMM, h:mm a"); }
  catch { return "—"; }
}

function fmtCallDate(iso: string) {
  try { return format(parseISO(iso), "d MMM yyyy, h:mm a"); }
  catch { return "—"; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CallsPage() {
  const qc = useQueryClient();
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);       // expanded patient (lead_id)
  const [expandedCall, setExpandedCall] = useState<number | null>(null); // expanded individual call
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null);

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelAppointment(id, reason),
    onSuccess: () => {
      toast.success("Appointment cancelled");
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: () => toast.error("Failed to cancel"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["call-logs", outcomeFilter],
    queryFn: () => getCallLogs(outcomeFilter ? { outcome: outcomeFilter } : undefined),
  });

  const { data: apptData } = useQuery({
    queryKey: ["appointments", "calls-page"],
    queryFn: () => getAppointments(),
  });

  const logs: CallLog[] = data?.data?.logs ?? [];
  const appointments: Appointment[] = apptData?.data ?? [];

  // Map lead_id → latest active appointment
  const apptByLead = appointments.reduce<Record<number, Appointment>>((acc, a) => {
    if (a.status !== "cancelled" && (!acc[a.lead_id] || a.id > acc[a.lead_id].id))
      acc[a.lead_id] = a;
    return acc;
  }, {});

  // ── Group calls by patient (lead_id) ─────────────────────────────────────────
  const groupMap = new Map<number, { lead_id: number; name: string; phone: string; calls: CallLog[] }>();

  logs.forEach((log) => {
    const key = log.lead_id;
    if (!groupMap.has(key)) {
      groupMap.set(key, { lead_id: key, name: log.lead_name || "Unknown", phone: log.phone, calls: [] });
    }
    groupMap.get(key)!.calls.push(log);
  });

  // Sort calls within each group by attempt_number
  const groups = Array.from(groupMap.values()).map((g) => ({
    ...g,
    calls: [...g.calls].sort((a, b) => (a.attempt_number ?? 0) - (b.attempt_number ?? 0)),
  }));

  // Sort groups: most recent call first
  groups.sort((a, b) => {
    const aLatest = Math.max(...a.calls.map((c) => new Date(c.started_at || 0).getTime()));
    const bLatest = Math.max(...b.calls.map((c) => new Date(c.started_at || 0).getTime()));
    return bLatest - aLatest;
  });

  const toggle = (leadId: number) => setExpanded((prev) => (prev === leadId ? null : leadId));
  const toggleCall = (callId: number) => setExpandedCall((prev) => (prev === callId ? null : callId));

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Calls</h1>
          <p className="text-sm text-gray-400">{groups.length} patients · {logs.length} total calls</p>
        </div>
        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none bg-white"
        >
          <option value="">All Outcomes</option>
          {["appointment_booked","interested","not_interested","callback_requested","no_answer","completed"].map((o) => (
            <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {/* Grouped table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Phone className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No calls yet</p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="grid grid-cols-[1.8fr_1.4fr_0.7fr_1.3fr_1fr_1.2fr_1.1fr_0.5fr] gap-0 px-5 py-3 bg-gray-50/60 border-b border-gray-100 text-xs font-medium text-gray-400">
              <span>Patient</span>
              <span>Phone</span>
              <span>Total Calls</span>
              <span>Latest Outcome</span>
              <span>Appt. Type</span>
              <span>Appt. Date</span>
              <span>Last Called</span>
              <span></span>
            </div>

            {/* Patient groups */}
            {groups.map((group) => {
              const appt = apptByLead[group.lead_id];
              const latestCall = group.calls[group.calls.length - 1];
              const isOpen = expanded === group.lead_id;

              return (
                <div key={group.lead_id} className="border-b border-gray-50 last:border-0">

                  {/* ── PARENT ROW ── */}
                  <div
                    onClick={() => toggle(group.lead_id)}
                    className={`grid grid-cols-[1.8fr_1.4fr_0.7fr_1.3fr_1fr_1.2fr_1.1fr_0.5fr] gap-0 px-5 py-4 cursor-pointer transition-colors items-center
                      ${isOpen ? "bg-violet-50/40" : "hover:bg-gray-50/60"}`}
                  >
                    {/* Patient name + call count badge */}
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-violet-600">
                          {(group.name || "?")[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                        <p className="text-[10px] text-gray-400">{group.calls.length} call{group.calls.length > 1 ? "s" : ""}</p>
                      </div>
                    </div>

                    {/* Phone */}
                    <span className="text-xs text-gray-500 font-mono">{group.phone}</span>

                    {/* Total calls */}
                    <span className="text-sm font-bold text-gray-700">{group.calls.length}</span>

                    {/* Latest outcome */}
                    <div>
                      {latestCall?.outcome ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border whitespace-nowrap ${OUTCOME_COLORS[latestCall.outcome] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                          {latestCall.outcome.replace(/_/g, " ")}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>

                    {/* Appt. Type */}
                    <div>
                      {appt ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${appt.appointment_type === "in_clinic" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                          {appt.appointment_type === "in_clinic" ? "In-Clinic" : "Online"}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>

                    {/* Appt. Date */}
                    <div>
                      {appt ? (
                        <div>
                          <p className="text-xs text-gray-700 font-medium">
                            {(() => { try { return format(parseISO(appt.appointment_date), "d MMM yyyy"); } catch { return "—"; } })()}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {(() => { try { return format(parseISO(appt.appointment_date), "h:mm a"); } catch { return ""; } })()}
                          </p>
                        </div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>

                    {/* Last called */}
                    <span className="text-xs text-gray-400">{fmtRelative(latestCall?.started_at)}</span>

                    {/* Expand chevron */}
                    <div className="flex justify-end">
                      {isOpen
                        ? <ChevronUp className="w-4 h-4 text-violet-500" />
                        : <ChevronDown className="w-4 h-4 text-gray-300" />}
                    </div>
                  </div>

                  {/* ── CHILD ROWS (individual call attempts) ── */}
                  {isOpen && (
                    <div className="bg-gray-50/60 border-t border-violet-100/60">

                      {/* Child header */}
                      <div className="grid grid-cols-[0.3fr_1fr_0.8fr_1.2fr_0.8fr_0.5fr_0.4fr] px-8 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                        <span>Attempt</span>
                        <span>Date & Time</span>
                        <span>Duration</span>
                        <span>Outcome</span>
                        <span>Language</span>
                        <span>Transcript</span>
                        <span></span>
                      </div>

                      {group.calls.map((call, idx) => {
                        const isCallOpen = expandedCall === call.id;
                        const attemptColors = [
                          "bg-violet-600",
                          "bg-amber-500",
                          "bg-rose-500",
                          "bg-gray-500",
                        ];
                        const color = attemptColors[idx] ?? "bg-gray-400";

                        return (
                          <div key={call.id} className="border-b border-gray-100 last:border-0">
                            {/* Call row */}
                            <div
                              onClick={() => toggleCall(call.id)}
                              className={`grid grid-cols-[0.3fr_1fr_0.8fr_1.2fr_0.8fr_0.5fr_0.4fr] px-8 py-3 cursor-pointer transition-colors items-center
                                ${isCallOpen ? "bg-white" : "hover:bg-white/60"}`}
                            >
                              {/* Attempt badge */}
                              <div>
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-white ${color}`}>
                                  {call.attempt_number ?? idx + 1}
                                </span>
                              </div>

                              {/* Date & Time */}
                              <span className="text-xs text-gray-600">{fmtCallDate(call.started_at)}</span>

                              {/* Duration */}
                              <span className="flex items-center gap-1 text-xs text-gray-500">
                                <Clock className="w-3 h-3 text-gray-300" />
                                {fmtDuration(call.duration_seconds)}
                              </span>

                              {/* Outcome */}
                              <div>
                                {call.outcome ? (
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${OUTCOME_COLORS[call.outcome] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                    {call.outcome.replace(/_/g, " ")}
                                  </span>
                                ) : <span className="text-xs text-gray-300">—</span>}
                              </div>

                              {/* Language */}
                              <span className="text-xs text-gray-400 capitalize">
                                {(() => {
                                  const lang = (call.language_used || "").toLowerCase();
                                  if (!lang) return "—";
                                  if (lang === "hi" || lang === "hindi") return "Hindi";
                                  if (lang === "mr" || lang === "marathi") return "Marathi";
                                  if (lang === "en" || lang === "english") return "English";
                                  return call.language_used;
                                })()}
                              </span>

                              {/* Transcript indicator */}
                              <div>
                                {call.transcript ? (
                                  <span className="flex items-center gap-1 text-[10px] text-violet-500 font-medium">
                                    <Play className="w-3 h-3" /> View
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-gray-300">None</span>
                                )}
                              </div>

                              {/* Expand call */}
                              <div className="flex justify-end">
                                {isCallOpen
                                  ? <ChevronUp className="w-3.5 h-3.5 text-violet-400" />
                                  : <ChevronDown className="w-3.5 h-3.5 text-gray-300" />}
                              </div>
                            </div>

                            {/* ── Expanded call detail ── */}
                            {isCallOpen && (
                              <div className="px-8 pb-5 pt-2 bg-white space-y-4 border-t border-gray-50">

                                {/* Recording */}
                                {call.recording_url ? (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-2">
                                      <Mic className="w-3.5 h-3.5 text-violet-500" /> Recording
                                    </p>
                                    <audio controls src={call.recording_url} className="w-full max-w-lg h-9 rounded-lg" />
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-300 flex items-center gap-1.5">
                                    <Mic className="w-3.5 h-3.5" /> Recording not available
                                  </p>
                                )}

                                {/* Summary */}
                                {call.summary && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-1.5">
                                      <MessageSquare className="w-3.5 h-3.5 text-violet-500" /> Summary
                                    </p>
                                    <p className="text-xs text-gray-600 italic bg-gray-50 rounded-lg px-3 py-2">
                                      {call.summary}
                                    </p>
                                  </div>
                                )}

                                {/* Full transcript as chat bubbles */}
                                {call.transcript ? (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-2">
                                      <Play className="w-3.5 h-3.5 text-violet-500" /> Full Transcript
                                    </p>
                                    <div className="bg-gray-50 rounded-xl px-4 py-3 max-h-72 overflow-y-auto space-y-2 border border-gray-100">
                                      {call.transcript.split("\n").filter(Boolean).map((line, i) => {
                                        const isAI      = line.startsWith("assistant:");
                                        const isPatient = line.startsWith("user:");
                                        const text      = line.replace(/^(assistant|user):\s*/, "");
                                        return (
                                          <div key={i} className={`flex gap-2 ${isAI ? "justify-start" : "justify-end"}`}>
                                            {isAI && (
                                              <span className="text-[9px] font-bold text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">AI</span>
                                            )}
                                            <p className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] leading-relaxed
                                              ${isAI ? "bg-violet-50 text-violet-900 rounded-tl-none" : isPatient ? "bg-white border border-gray-200 text-gray-800 rounded-tr-none" : "bg-gray-100 text-gray-500"}`}>
                                              {text}
                                            </p>
                                            {isPatient && (
                                              <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">P</span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-300 flex items-center gap-1.5">
                                    <Play className="w-3.5 h-3.5" /> No transcript saved
                                  </p>
                                )}

                                {/* Appointment actions */}
                                {appt && appt.status !== "cancelled" && appt.status !== "completed" && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-2">
                                      <CalendarCheck className="w-3.5 h-3.5 text-violet-500" /> Appointment
                                    </p>
                                    <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-semibold text-gray-800">{fmtApptDate(appt.appointment_date)}</p>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${appt.appointment_type === "in_clinic" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                                          {appt.appointment_type === "in_clinic" ? "In-Clinic" : "Online"}
                                        </span>
                                      </div>
                                      <div className="flex gap-2">
                                        <button onClick={() => setRescheduleAppt(appt)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 font-medium transition">
                                          <RefreshCw className="w-3 h-3" /> Reschedule
                                        </button>
                                        <button onClick={() => {
                                            const r = window.prompt("Reason (optional):") ?? "";
                                            if (r !== null) cancelMut.mutate({ id: appt.id, reason: r });
                                          }}
                                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 font-medium transition">
                                          <XCircle className="w-3 h-3" /> Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}

                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reschedule modal */}
      {rescheduleAppt && (
        <RescheduleModal
          appt={rescheduleAppt}
          onClose={() => setRescheduleAppt(null)}
          onSaved={() => { setRescheduleAppt(null); qc.invalidateQueries({ queryKey: ["appointments"] }); }}
        />
      )}
    </div>
  );
}

// ── Reschedule Modal ──────────────────────────────────────────────────────────

function RescheduleModal({ appt, onClose, onSaved }: {
  appt: Appointment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(() => {
    try { return format(parseISO(appt.appointment_date), "yyyy-MM-dd'T'HH:mm"); }
    catch { return ""; }
  });
  const [type, setType] = useState(appt.appointment_type || "online");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/appointments/${appt.id}`, {
        appointment_date: date ? new Date(date).toISOString() : undefined,
        appointment_type: type,
      });
      toast.success("Appointment rescheduled");
      onSaved();
    } catch {
      toast.error("Failed to reschedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">Reschedule</h3>
            <p className="text-xs text-gray-400 mt-0.5">{appt.patient_name || appt.phone}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">New Date & Time</label>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Consultation Type</label>
            <div className="grid grid-cols-2 gap-2">
              {[["online","Online"],["in_clinic","In-Clinic"]].map(([val, label]) => (
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
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallLog {
  id: number;
  lead_id: number;
  lead_name: string;
  phone: string;
  attempt_number: number;
  status: string;
  outcome: string;
  language_used: string;
  duration_seconds: number;
  summary: string;
  transcript: string;
  recording_url: string | null;
  started_at: string;
  ended_at: string;
}

interface Appointment {
  id: number;
  lead_id: number;
  patient_name: string;
  phone: string;
  appointment_date: string;
  appointment_type: string;
  inquiry_type: string;
  status: string;
}
