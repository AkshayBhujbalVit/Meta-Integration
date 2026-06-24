"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUsageOverview } from "@/lib/api";
import {
  Loader2, Phone, MessageSquare, MessagesSquare,
  Zap, DollarSign, Users, TrendingUp,
} from "lucide-react";

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { label: string; value: Period }[] = [
  { label: "7 days",   value: "7d"  },
  { label: "30 days",  value: "30d" },
  { label: "90 days",  value: "90d" },
  { label: "All time", value: "all" },
];

const OUTCOME_COLORS: Record<string, string> = {
  appointment_booked: "bg-green-100 text-green-700",
  interested:         "bg-blue-100 text-blue-700",
  not_interested:     "bg-red-100 text-red-500",
  callback_requested: "bg-yellow-100 text-yellow-700",
  no_answer:          "bg-gray-100 text-gray-500",
  completed:          "bg-blue-100 text-blue-600",
  unknown:            "bg-gray-100 text-gray-400",
};

const STATUS_COLORS: Record<string, string> = {
  new:                "bg-blue-100 text-blue-700",
  calling:            "bg-purple-100 text-purple-700",
  interested:         "bg-sky-100 text-sky-700",
  appointment_booked: "bg-green-100 text-green-700",
  not_interested:     "bg-red-100 text-red-500",
  no_answer:          "bg-gray-100 text-gray-500",
  callback_requested: "bg-yellow-100 text-yellow-700",
  failed:             "bg-red-100 text-red-400",
  duplicate:          "bg-gray-100 text-gray-400",
};

const SOURCE_LABELS: Record<string, string> = {
  meta_lead_ads:     "Meta Lead Ads",
  hubspot_webhook:   "HubSpot",
  google_webhook:    "Google Ads",
  klaviyo_webhook:   "Klaviyo",
  meta_whatsapp:     "Meta WhatsApp",
  manual:            "Manual",
  csv:               "CSV Upload",
};

const SMS_TYPE_COLORS: Record<string, string> = {
  confirmation: "bg-green-100 text-green-700",
  reminder:     "bg-blue-100 text-blue-600",
  cancellation: "bg-red-100 text-red-500",
  followup:     "bg-blue-100 text-blue-700",
  custom:       "bg-gray-100 text-gray-500",
  other:        "bg-gray-100 text-gray-400",
};

function StatCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, total, colorClass }: {
  label: string; value: number; total: number; colorClass: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const displayLabel = SOURCE_LABELS[label] || label.replace(/_/g, " ");
  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${colorClass}`}>
        {displayLabel}
      </span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-2 rounded-full bg-blue-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-6 text-right">{value}</span>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function UsagePage() {
  const [period, setPeriod] = useState<Period>("30d");

  const { data, isLoading } = useQuery({
    queryKey: ["usage", period],
    queryFn: () => getUsageOverview(period),
  });

  const d = data?.data;

  const leads    = d?.leads        ?? {};
  const calls    = d?.calls        ?? {};
  const sms      = d?.sms          ?? {};
  const wa       = d?.whatsapp     ?? {};
  const cost     = d?.cost_summary ?? {};
  const rates    = d?.rates        ?? {};

  const callRate = period === "all"
    ? null
    : leads.total > 0 ? Math.round((leads.called / leads.total) * 100) : 0;

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Usage</h1>
          <p className="text-sm text-gray-400 mt-0.5">Activity and cost across all services</p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                period === p.value
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users}         label="Leads Received"  value={leads.total ?? 0}   sub={`${leads.called ?? 0} called`}                     color="bg-indigo-500" />
            <StatCard icon={Phone}         label="Voice Calls"     value={calls.total ?? 0}   sub={`${calls.total_minutes ?? 0} min`}                  color="bg-blue-500"   />
            <StatCard icon={MessageSquare} label="SMS Sent"        value={sms.total ?? 0}     sub={`~$${sms.est_cost_usd ?? 0} est.`}                  color="bg-blue-400"   />
            <StatCard icon={DollarSign}    label="Est. Total Cost" value={`$${cost.total_usd ?? 0}`} sub="Combined all services"                       color="bg-amber-500"  />
          </div>

          {/* Main content grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* ── Leads Intake ── */}
            <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <h2 className="text-sm font-bold text-gray-800">Leads Intake</h2>
                {callRate !== null && (
                  <span className="ml-auto text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium border border-indigo-100">
                    {callRate}% call rate
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Total Leads</p>
                  <p className="text-xl font-bold text-gray-800">{leads.total ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Called</p>
                  <p className="text-xl font-bold text-gray-800">{leads.called ?? 0}</p>
                </div>
              </div>

              {Object.keys(leads.by_source ?? {}).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">By Source</p>
                  <div className="space-y-2">
                    {Object.entries(leads.by_source ?? {}).map(([k, v]) => (
                      <BreakdownRow
                        key={k} label={k} value={v as number}
                        total={leads.total ?? 0}
                        colorClass="bg-indigo-100 text-indigo-700"
                      />
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(leads.by_status ?? {}).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">By Status</p>
                  <div className="space-y-2">
                    {Object.entries(leads.by_status ?? {}).map(([k, v]) => (
                      <BreakdownRow
                        key={k} label={k} value={v as number}
                        total={leads.total ?? 0}
                        colorClass={STATUS_COLORS[k] ?? "bg-gray-100 text-gray-500"}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Calls ── */}
            <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Phone className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  <h2 className="text-sm font-bold text-gray-800">Voice Calls</h2>
                </div>
                <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium border border-blue-100">
                  LiveKit + Gemini Live
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Total Calls</p>
                  <p className="text-xl font-bold text-gray-800">{calls.total ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Minutes Used</p>
                  <p className="text-xl font-bold text-gray-800">{calls.total_minutes ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Est. Cost</p>
                  <p className="text-xl font-bold text-amber-600">${calls.est_cost_usd ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Rate</p>
                  <p className="text-sm font-bold text-gray-600">${rates.call_per_min_usd}/min</p>
                </div>
              </div>

              {Object.keys(calls.by_direction ?? {}).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Direction</p>
                  <div className="space-y-2">
                    {Object.entries(calls.by_direction ?? {}).map(([k, v]) => (
                      <BreakdownRow
                        key={k} label={k} value={v as number}
                        total={calls.total ?? 0}
                        colorClass={k === "outbound" ? "bg-blue-100 text-blue-700" : "bg-sky-100 text-sky-700"}
                      />
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(calls.by_outcome ?? {}).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">By Outcome</p>
                  <div className="space-y-2">
                    {Object.entries(calls.by_outcome ?? {}).map(([k, v]) => (
                      <BreakdownRow
                        key={k} label={k} value={v as number}
                        total={calls.total ?? 0}
                        colorClass={OUTCOME_COLORS[k] ?? "bg-gray-100 text-gray-500"}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── WhatsApp ── */}
            <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center">
                    <MessagesSquare className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  <h2 className="text-sm font-bold text-gray-800">WhatsApp</h2>
                </div>
                <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium border border-green-100">
                  Meta Cloud / Twilio
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Total Messages</p>
                  <p className="text-xl font-bold text-gray-800">{wa.total ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Unique Leads</p>
                  <p className="text-xl font-bold text-gray-800">{wa.unique_leads ?? wa.unique_patients ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Est. Cost</p>
                  <p className="text-xl font-bold text-amber-600">${wa.est_cost_usd ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Rate</p>
                  <p className="text-sm font-bold text-gray-600">${rates.whatsapp_per_msg_usd}/msg</p>
                </div>
              </div>

              {(wa.total ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Direction</p>
                  <div className="space-y-2">
                    <BreakdownRow label="inbound"  value={wa.inbound  ?? 0} total={wa.total ?? 0} colorClass="bg-green-100 text-green-700" />
                    <BreakdownRow label="outbound" value={wa.outbound ?? 0} total={wa.total ?? 0} colorClass="bg-teal-100 text-teal-700"   />
                  </div>
                </div>
              )}

              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <div className="flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 leading-relaxed">
                    Outbound messages include AI-generated follow-ups and appointment reminders. Each message incurs one WhatsApp conversation charge.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* SMS — full width below */}
          {(sms.total ?? 0) > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  <h2 className="text-sm font-bold text-gray-800">SMS</h2>
                </div>
                <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium border border-blue-100">
                  Twilio SMS
                </span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Total Sent</p>
                  <p className="text-xl font-bold text-gray-800">{sms.total ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Est. Cost</p>
                  <p className="text-xl font-bold text-amber-600">${sms.est_cost_usd ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium">Rate</p>
                  <p className="text-sm font-bold text-gray-600">${rates.sms_per_msg_usd}/message</p>
                </div>
              </div>

              {Object.keys(sms.by_type ?? {}).length > 0 && (
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">By Type</p>
                    <div className="space-y-2">
                      {Object.entries(sms.by_type ?? {}).map(([k, v]) => (
                        <BreakdownRow
                          key={k} label={k} value={v as number}
                          total={sms.total ?? 0}
                          colorClass={SMS_TYPE_COLORS[k] ?? "bg-gray-100 text-gray-500"}
                        />
                      ))}
                    </div>
                  </div>
                  {Object.keys(sms.by_status ?? {}).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2">Delivery Status</p>
                      <div className="space-y-2">
                        {Object.entries(sms.by_status ?? {}).map(([k, v]) => (
                          <BreakdownRow
                            key={k} label={k} value={v as number}
                            total={sms.total ?? 0}
                            colorClass={
                              k === "delivered" ? "bg-green-100 text-green-700"
                              : k === "failed"  ? "bg-red-100 text-red-500"
                              : "bg-gray-100 text-gray-500"
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cost Summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                <DollarSign className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <h2 className="text-sm font-bold text-gray-800">Estimated Cost Breakdown</h2>
              <span className="text-[10px] text-gray-400 ml-1">— based on standard API rates</span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Voice Calls", value: cost.calls_usd ?? 0,    note: `${calls.total_minutes ?? 0} min × $${rates.call_per_min_usd}/min`,     color: "border-blue-200 bg-blue-50" },
                { label: "SMS",         value: cost.sms_usd   ?? 0,    note: `${sms.total ?? 0} msgs × $${rates.sms_per_msg_usd}/msg`,               color: "border-blue-200 bg-blue-50"   },
                { label: "WhatsApp",    value: cost.whatsapp_usd ?? 0, note: `${wa.total ?? 0} msgs × $${rates.whatsapp_per_msg_usd}/msg`,            color: "border-green-200 bg-green-50" },
                { label: "Total",       value: cost.total_usd ?? 0,    note: "Combined all services",                                                  color: "border-amber-200 bg-amber-50" },
              ].map(({ label, value, note, color }) => (
                <div key={label} className={`rounded-xl border p-4 ${color}`}>
                  <p className="text-xs font-medium text-gray-500">{label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">${value}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{note}</p>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-gray-400 mt-4">
              * Estimates only. Actual billing depends on your provider plan. LiveKit SIP ~$0.013/min · Gemini 2.5 Flash Live audio ~$0.06/min combined · Twilio SMS ~$0.0075/msg · WhatsApp ~$0.005/conversation.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
