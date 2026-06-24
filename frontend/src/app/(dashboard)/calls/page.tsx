"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCallLogs, getAppointments, cancelAppointment, api } from "@/lib/api";
import { fmtRelative } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, ChevronDown, ChevronUp, Play, MessageSquare,
  Mic, Phone, CalendarCheck, RefreshCw, XCircle, Clock, X,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  meta_lead_ads:    "Meta Ads",
  hubspot_webhook:  "HubSpot CRM",
  google_webhook:   "Google Ads",
  klaviyo_webhook:  "Klaviyo",
  meta_whatsapp:    "WhatsApp",
  manual:           "Manual",
  csv:              "CSV Import",
};

function platformLabel(p: string | null) {
  if (!p) return "—";
  return PLATFORM_LABELS[p] ?? p.replace(/_/g, " ");
}

const OUTCOME_COLORS: Record<string, string> = {
  appointment_booked: "bg-green-50 text-green-700 border-green-200",
  interested:         "bg-blue-50 text-blue-700 border-blue-200",
  not_interested:     "bg-red-50 text-red-500 border-red-200",
  callback_requested: "bg-yellow-50 text-yellow-700 border-yellow-200",
  no_answer:          "bg-gray-100 text-gray-500 border-gray-200",
  completed:          "bg-blue-50 text-blue-600 border-blue-100",
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
  const [expanded, setExpanded]     = useState<number | null>(null);
  const [expandedCall, setExpandedCall] = useState<number | null>(null);
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null);
  const [cancelAppt, setCancelAppt] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelAppointment(id, reason),
    onSuccess: () => {
      toast.success("Appointment cancelled");
      setCancelAppt(null);
      setCancelReason("");
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

  const apptByLead = appointments.reduce<Record<number, Appointment>>((acc, a) => {
    if (a.status !== "cancelled" && (!acc[a.lead_id] || a.id > acc[a.lead_id].id))
      acc[a.lead_id] = a;
    return acc;
  }, {});

  // Group by lead_id
  const groupMap = new Map<number, {
    lead_id: number; name: string; phone: string;
    source_platform: string | null; campaign_name: string | null;
    calls: CallLog[];
  }>();

  logs.forEach((log) => {
    const key = log.lead_id;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        lead_id: key,
        name: log.lead_name || "Unknown",
        phone: log.phone,
        source_platform: log.source_platform ?? null,
        campaign_name: log.campaign_name ?? null,
        calls: [],
      });
    }
    groupMap.get(key)!.calls.push(log);
  });

  const groups = Array.from(groupMap.values()).map((g) => ({
    ...g,
    calls: [...g.calls].sort((a, b) => (a.attempt_number ?? 0) - (b.attempt_number ?? 0)),
  }));

  groups.sort((a, b) => {
    const aLatest = Math.max(...a.calls.map((c) => new Date(c.started_at || 0).getTime()));
    const bLatest = Math.max(...b.calls.map((c) => new Date(c.started_at || 0).getTime()));
    return bLatest - aLatest;
  });

  const toggle     = (id: number) => setExpanded((p) => (p === id ? null : id));
  const toggleCall = (id: number) => setExpandedCall((p) => (p === id ? null : id));

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Calls</h1>
          <p className="text-sm text-gray-400">{groups.length} leads · {logs.length} total calls</p>
        </div>
        <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none bg-white">
          <option value="">All Outcomes</option>
          {["appointment_booked","interested","not_interested","callback_requested","no_answer","completed"].map((o) => (
            <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Phone className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No calls yet</p>
          </div>
        ) : (
          <div>
            {/* Header row */}
            <div className="grid grid-cols-[2fr_1.3fr_1.2fr_0.7fr_1.3fr_1.2fr_0.5fr] px-5 py-3 bg-gray-50/60 border-b border-gray-100 text-xs font-medium text-gray-400">
              <span>Lead / Contact</span>
              <span>Phone</span>
              <span>Source Platform</span>
              <span>Calls</span>
              <span>Latest Outcome</span>
              <span>Last Called</span>
              <span></span>
            </div>

            {groups.map((group) => {
              const appt       = apptByLead[group.lead_id];
              const latestCall = group.calls[group.calls.length - 1];
              const isOpen     = expanded === group.lead_id;

              return (
                <div key={group.lead_id} className="border-b border-gray-50 last:border-0">

                  {/* Parent row */}
                  <div onClick={() => toggle(group.lead_id)}
                    className={`grid grid-cols-[2fr_1.3fr_1.2fr_0.7fr_1.3fr_1.2fr_0.5fr] px-5 py-4 cursor-pointer transition-colors items-center
                      ${isOpen ? "bg-blue-50/40" : "hover:bg-gray-50/60"}`}>

                    {/* Lead name */}
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-blue-600">
                          {(group.name || "?")[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                        <p className="text-[10px] text-gray-400">
                          {group.calls.length} call{group.calls.length > 1 ? "s" : ""}
                          {group.campaign_name ? ` · ${group.campaign_name}` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Phone */}
                    <span className="text-xs text-gray-500 font-mono">{group.phone}</span>

                    {/* Source platform */}
                    <div>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                        {platformLabel(group.source_platform)}
                      </span>
                    </div>

                    {/* Call count */}
                    <span className="text-sm font-bold text-gray-700">{group.calls.length}</span>

                    {/* Latest outcome */}
                    <div>
                      {latestCall?.outcome ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border whitespace-nowrap ${OUTCOME_COLORS[latestCall.outcome] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                          {latestCall.outcome.replace(/_/g, " ")}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>

                    {/* Last called */}
                    <span className="text-xs text-gray-400">{fmtRelative(latestCall?.started_at)}</span>

                    {/* Expand chevron */}
                    <div className="flex justify-end">
                      {isOpen
                        ? <ChevronUp className="w-4 h-4 text-blue-500" />
                        : <ChevronDown className="w-4 h-4 text-gray-300" />}
                    </div>
                  </div>

                  {/* Expanded: individual call attempts */}
                  {isOpen && (
                    <div className="bg-gray-50/60 border-t border-blue-100/60">

                      {/* Appointment block (if booked) */}
                      {appt && appt.status !== "cancelled" && appt.status !== "completed" && (
                        <div className="mx-5 mt-3 mb-1 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <CalendarCheck className="w-4 h-4 text-emerald-600" />
                            <div>
                              <p className="text-xs font-bold text-emerald-800">Appointment booked</p>
                              <p className="text-xs text-emerald-700">
                                {fmtApptDate(appt.appointment_date)} ·{" "}
                                <span className={`font-medium ${appt.appointment_type === "in_person" ? "text-orange-600" : "text-blue-600"}`}>
                                  {appt.appointment_type === "in_person" ? "In-Person" : "Online"}
                                </span>
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setRescheduleAppt(appt); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 font-medium">
                              <RefreshCw className="w-3 h-3" /> Reschedule
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setCancelAppt(appt); setCancelReason(""); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 font-medium">
                              <XCircle className="w-3 h-3" /> Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Child header */}
                      <div className="grid grid-cols-[0.3fr_1fr_0.8fr_1.2fr_0.8fr_0.5fr_0.4fr] px-8 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50 mt-2">
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
                        const colors = ["bg-blue-600","bg-amber-500","bg-rose-500","bg-gray-500"];
                        const color  = colors[idx] ?? "bg-gray-400";

                        return (
                          <div key={call.id} className="border-b border-gray-100 last:border-0">
                            <div onClick={() => toggleCall(call.id)}
                              className={`grid grid-cols-[0.3fr_1fr_0.8fr_1.2fr_0.8fr_0.5fr_0.4fr] px-8 py-3 cursor-pointer transition-colors items-center
                                ${isCallOpen ? "bg-white" : "hover:bg-white/60"}`}>
                              <div>
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-white ${color}`}>
                                  {call.attempt_number ?? idx + 1}
                                </span>
                              </div>
                              <span className="text-xs text-gray-600">{fmtCallDate(call.started_at)}</span>
                              <span className="flex items-center gap-1 text-xs text-gray-500">
                                <Clock className="w-3 h-3 text-gray-300" />
                                {fmtDuration(call.duration_seconds)}
                              </span>
                              <div>
                                {call.outcome ? (
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${OUTCOME_COLORS[call.outcome] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                    {call.outcome.replace(/_/g, " ")}
                                  </span>
                                ) : <span className="text-xs text-gray-300">—</span>}
                              </div>
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
                              <div>
                                {call.transcript
                                  ? <span className="flex items-center gap-1 text-[10px] text-blue-500 font-medium"><Play className="w-3 h-3" /> View</span>
                                  : <span className="text-[10px] text-gray-300">None</span>}
                              </div>
                              <div className="flex justify-end">
                                {isCallOpen ? <ChevronUp className="w-3.5 h-3.5 text-blue-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-300" />}
                              </div>
                            </div>

                            {/* Expanded call detail */}
                            {isCallOpen && (
                              <div className="px-8 pb-5 pt-2 bg-white space-y-4 border-t border-gray-50">
                                {call.recording_url ? (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-2">
                                      <Mic className="w-3.5 h-3.5 text-blue-500" /> Recording
                                    </p>
                                    <audio controls src={call.recording_url} className="w-full max-w-lg h-9 rounded-lg" />
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-300 flex items-center gap-1.5">
                                    <Mic className="w-3.5 h-3.5" /> Recording not available
                                  </p>
                                )}
                                {call.summary && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-1.5">
                                      <MessageSquare className="w-3.5 h-3.5 text-blue-500" /> Summary
                                    </p>
                                    <p className="text-xs text-gray-600 italic bg-gray-50 rounded-lg px-3 py-2">{call.summary}</p>
                                  </div>
                                )}
                                {call.transcript ? (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-2">
                                      <Play className="w-3.5 h-3.5 text-blue-500" /> Full Transcript
                                    </p>
                                    <div className="bg-gray-50 rounded-xl px-4 py-3 max-h-72 overflow-y-auto space-y-2 border border-gray-100">
                                      {call.transcript.split("\n").filter(Boolean).map((line, i) => {
                                        const isAI   = line.startsWith("assistant:");
                                        const isUser = line.startsWith("user:");
                                        const text   = line.replace(/^(assistant|user):\s*/, "");
                                        return (
                                          <div key={i} className={`flex gap-2 ${isAI ? "justify-start" : "justify-end"}`}>
                                            {isAI && <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">AI</span>}
                                            <p className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] leading-relaxed
                                              ${isAI ? "bg-blue-50 text-blue-900 rounded-tl-none" : isUser ? "bg-white border border-gray-200 text-gray-800 rounded-tr-none" : "bg-gray-100 text-gray-500"}`}>
                                              {text}
                                            </p>
                                            {isUser && <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">L</span>}
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

      {/* Cancel confirmation modal */}
      {cancelAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">Cancel Appointment</h3>
                <p className="text-xs text-gray-400 mt-0.5">{cancelAppt.patient_name || cancelAppt.phone}</p>
              </div>
              <button onClick={() => setCancelAppt(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <label className="text-xs font-medium text-gray-600">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="e.g. Lead requested cancellation"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => { setCancelAppt(null); setCancelReason(""); }}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Keep it
              </button>
              <button
                onClick={() => cancelMut.mutate({ id: cancelAppt.id, reason: cancelReason })}
                disabled={cancelMut.isPending}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                {cancelMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Cancel Appointment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reschedule Modal ──────────────────────────────────────────────────────────

function RescheduleModal({ appt, onClose, onSaved }: {
  appt: Appointment; onClose: () => void; onSaved: () => void;
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">New Date & Time</label>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Consultation Type</label>
            <div className="grid grid-cols-2 gap-2">
              {[["online","Online"],["in_person","In-Person"]].map(([val, label]) => (
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
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
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
  source_platform: string | null;
  campaign_name: string | null;
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
