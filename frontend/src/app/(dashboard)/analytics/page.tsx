"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAnalyticsOverview, getAnalyticsFunnel, getAnalyticsHeatmap,
  getAnalyticsTrends, exportLeads, getDashboardOverview,
} from "@/lib/api";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import {
  Users, Phone, CalendarCheck, TrendingUp, Download,
  PhoneIncoming, MessageSquare, Clock, Share2, Search,
  Briefcase, Mail, Building2, ArrowRight,
} from "lucide-react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FunnelStep { label: string; count: number; pct_of_prev: number; }
interface HeatmapBucket { hour: number; label: string; total_calls: number; answered: number; answer_rate: number; }
interface TrendPoint { date: string; leads: number; calls: number; appointments: number; }
interface PlatformStat { platform: string; total: number; called: number; booked: number; conv_pct: number; }
interface ClientStat { id: number; name: string; business_type: string; total_leads: number; booked: number; active_campaigns: number; }

// ── Platform metadata ─────────────────────────────────────────────────────────
const PLATFORM_META: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  meta:       { label: "Meta Ads",   color: "#1877F2", bg: "bg-[#1877F2]", icon: Share2    },
  facebook:   { label: "Meta Ads",   color: "#1877F2", bg: "bg-[#1877F2]", icon: Share2    },
  google:     { label: "Google Ads", color: "#EA4335", bg: "bg-[#EA4335]", icon: Search    },
  google_ads: { label: "Google Ads", color: "#EA4335", bg: "bg-[#EA4335]", icon: Search    },
  linkedin:   { label: "LinkedIn",   color: "#0A66C2", bg: "bg-[#0A66C2]", icon: Briefcase },
  mailchimp:  { label: "Mailchimp",  color: "#FFE01B", bg: "bg-yellow-400", icon: Mail      },
  manual:     { label: "Manual",     color: "#6B7280", bg: "bg-gray-400",   icon: Users     },
  csv:        { label: "CSV Import", color: "#6B7280", bg: "bg-gray-400",   icon: Users     },
};
function getPM(key: string) {
  return PLATFORM_META[key?.toLowerCase()] ?? { label: key, color: "#6B7280", bg: "bg-gray-400", icon: Share2 };
}

const FUNNEL_COLORS = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#dbeafe"];

function heatColor(rate: number): string {
  if (rate === 0) return "#f3f4f6";
  const intensity = Math.min(rate / 100, 1);
  const r = Math.round(96  + (37  - 96 ) * intensity);
  const g = Math.round(165 + (99  - 165) * intensity);
  const b = Math.round(250 + (235 - 250) * intensity);
  return `rgb(${r},${g},${b})`;
}

import React from "react";

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [exporting, setExporting] = useState(false);

  const { data: overviewData } = useQuery({ queryKey: ["analytics", "overview"], queryFn: getAnalyticsOverview });
  const { data: funnelData }   = useQuery({ queryKey: ["analytics", "funnel"],   queryFn: getAnalyticsFunnel });
  const { data: heatmapData }  = useQuery({ queryKey: ["analytics", "heatmap"],  queryFn: getAnalyticsHeatmap });
  const { data: trendsData }   = useQuery({ queryKey: ["analytics", "trends", period], queryFn: () => getAnalyticsTrends(period) });
  const { data: dashData }     = useQuery({ queryKey: ["dashboard-overview"],    queryFn: () => getDashboardOverview() as unknown as Promise<{ data: { by_platform: PlatformStat[]; clients: ClientStat[] } }> });

  const ov      = overviewData?.data ?? {};
  const funnel: FunnelStep[]     = funnelData?.data?.steps ?? [];
  const heatmap: HeatmapBucket[] = heatmapData?.data?.heatmap ?? [];
  const trends: TrendPoint[]     = trendsData?.data?.series ?? [];
  const byPlatform: PlatformStat[] = dashData?.data?.by_platform ?? [];
  const clients: ClientStat[]    = dashData?.data?.clients ?? [];

  const handleExport = async (fmt: "excel" | "csv") => {
    setExporting(true);
    try {
      const res = await exportLeads(fmt);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = fmt === "excel" ? "leads_export.xlsx" : "leads_export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error("Export failed", e); }
    finally { setExporting(false); }
  };

  return (
    <div className="min-h-full bg-gray-50/60">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Analytics</h1>
            <p className="text-sm text-gray-400 mt-0.5">Overall performance, by platform, and by client</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleExport("excel")} disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50 shadow-sm">
              <Download className="w-4 h-4" />
              {exporting ? "Exporting…" : "Export Excel"}
            </button>
            <button onClick={() => handleExport("csv")} disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl transition disabled:opacity-50">
              <Download className="w-4 h-4" /> CSV
            </button>
          </div>
        </div>

        {/* ── Section 1: Overall KPIs ── */}
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Overall Performance</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Leads",       value: ov.total_leads,        icon: Users,          g: "from-blue-500 to-blue-700" },
              { label: "Total Calls Made",  value: ov.total_calls,        icon: Phone,          g: "from-violet-500 to-violet-700" },
              { label: "Appointments",      value: ov.total_appointments, icon: CalendarCheck,  g: "from-emerald-500 to-teal-600" },
              { label: "Booking Rate",      value: `${ov.booking_rate_pct ?? 0}%`, icon: TrendingUp, g: "from-orange-500 to-rose-500" },
            ].map(({ label, value, icon: Icon, g }) => (
              <div key={label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${g} p-5 shadow-sm`}>
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest">{label}</p>
                  <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                </div>
                <p className="text-3xl font-black text-white leading-none">{value ?? "—"}</p>
              </div>
            ))}
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            {[
              { label: "Inbound Calls",     value: ov.inbound_calls,     icon: PhoneIncoming },
              { label: "Answer Rate",        value: `${ov.answer_rate_pct ?? 0}%`, icon: TrendingUp },
              { label: "Avg Call Duration",  value: ov.avg_call_duration_seconds ? `${Math.round(ov.avg_call_duration_seconds)}s` : "—", icon: Clock },
              { label: "WhatsApp Messages",  value: (ov.whatsapp_inbound ?? 0) + (ov.whatsapp_outbound ?? 0), icon: MessageSquare },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xl font-black text-gray-900 leading-none">{value ?? "—"}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 2: By Platform ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">By Platform</p>
            <Link href="/integrations" className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-700">
              Manage integrations <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {byPlatform.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
              <Share2 className="w-10 h-10 text-gray-100 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-400">No platform data yet</p>
              <p className="text-xs text-gray-300 mt-1">Connect a marketing platform in Integrations to see breakdowns here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {byPlatform.map((p) => {
                const meta = getPM(p.platform);
                const Icon = meta.icon;
                const callPct = p.total > 0 ? Math.round((p.called / p.total) * 100) : 0;
                return (
                  <div key={p.platform} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {/* Card header */}
                    <div className="flex items-center gap-3 p-4 border-b border-gray-50">
                      <div className={`w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center shrink-0 shadow-sm`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900">{meta.label}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="h-1.5 bg-gray-100 rounded-full flex-1 overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all duration-700"
                              style={{ width: `${callPct}%`, backgroundColor: meta.color }} />
                          </div>
                          <span className="text-[10px] text-gray-400 shrink-0">{callPct}% called</span>
                        </div>
                      </div>
                    </div>
                    {/* Stats */}
                    <div className="grid grid-cols-3 divide-x divide-gray-50">
                      {[
                        { label: "Leads",  value: p.total,  bold: false },
                        { label: "Called", value: p.called, bold: false },
                        { label: "Booked", value: p.booked, bold: true  },
                      ].map(({ label, value, bold }) => (
                        <div key={label} className="p-3 text-center">
                          <p className={`text-xl font-black leading-none ${bold && value > 0 ? "text-emerald-600" : "text-gray-900"}`}>
                            {value}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    {/* Conv rate */}
                    {p.conv_pct > 0 && (
                      <div className="px-4 pb-3">
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {p.conv_pct}% conversion rate
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Section 3: By Client ── */}
        {clients.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">By Client</p>
              <Link href="/clients" className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-700">
                Manage clients <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-12 gap-3 px-6 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/70">
                <div className="col-span-4">Client</div>
                <div className="col-span-2 text-right">Leads</div>
                <div className="col-span-2 text-right">Campaigns</div>
                <div className="col-span-2 text-right">Booked</div>
                <div className="col-span-2 text-right">Conv %</div>
              </div>
              {clients.map((c, i) => {
                const convPct = c.total_leads > 0 ? ((c.booked / c.total_leads) * 100).toFixed(1) : "0";
                return (
                  <Link key={c.id} href={`/clients/${c.id}`}
                    className={`grid grid-cols-12 gap-3 px-6 py-4 items-center hover:bg-blue-50/30 transition-colors group
                      ${i < clients.length - 1 ? "border-b border-gray-50" : ""}`}>
                    <div className="col-span-4 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                        <span className="text-xs font-black text-white">{c.name.charAt(0)}</span>
                      </div>
                      <p className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{c.name}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-base font-black text-gray-900">{c.total_leads}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-sm text-gray-700">{c.active_campaigns}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className={`text-sm font-bold ${c.booked > 0 ? "text-emerald-600" : "text-gray-300"}`}>{c.booked}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      {Number(convPct) > 0 ? (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{convPct}%</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 4: Conversion Funnel + Heatmap ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Funnel */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Conversion Funnel</h2>
            {funnel.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-gray-300">No data yet</div>
            ) : (
              <div className="space-y-3">
                {funnel.map((step, i) => (
                  <div key={step.label}>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span className="font-semibold text-gray-700">{step.label}</span>
                      <span className="font-bold text-gray-900">{step.count.toLocaleString()}
                        <span className="font-normal text-gray-400 ml-1">({step.pct_of_prev}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div className="h-2.5 rounded-full transition-all duration-700"
                        style={{ width: `${step.pct_of_prev}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Heatmap */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-1">Best Time to Call</h2>
            <p className="text-xs text-gray-400 mb-4">Answer rate by hour · IST</p>
            <div className="grid grid-cols-12 gap-1">
              {heatmap.map((b) => (
                <div key={b.hour} className="flex flex-col items-center gap-0.5">
                  <div title={`${b.label} — ${b.answer_rate}% (${b.answered}/${b.total_calls})`}
                    className="w-full rounded"
                    style={{ height: 32, backgroundColor: heatColor(b.answer_rate), border: "1px solid #e5e7eb" }} />
                  <span className="text-[9px] text-gray-400">{b.hour}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-300 mt-2">
              <span>Low answer rate</span>
              <span>High answer rate</span>
            </div>
          </div>
        </div>

        {/* ── Section 5: Daily Trends ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Daily Trends</h2>
            <div className="flex gap-1">
              {(["7d", "30d", "90d"] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    period === p ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trends} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickFormatter={(v) => v.slice(5)} interval={Math.max(0, Math.floor(trends.length / 6))} />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
              <Line type="monotone" dataKey="leads"        stroke="#2563eb" strokeWidth={2} dot={false} name="Leads" />
              <Line type="monotone" dataKey="calls"        stroke="#7c3aed" strokeWidth={2} dot={false} name="Calls" />
              <Line type="monotone" dataKey="appointments" stroke="#10b981" strokeWidth={2} dot={false} name="Appointments" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-5 mt-2 text-xs justify-center">
            {[{ label: "Leads", color: "#2563eb" }, { label: "Calls", color: "#7c3aed" }, { label: "Appointments", color: "#10b981" }]
              .map(({ label, color }) => (
                <span key={label} className="flex items-center gap-1.5 text-gray-500">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: color }} />
                  {label}
                </span>
              ))}
          </div>
        </div>

        {/* ── Section 6: Outcome summary ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Call Outcome Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Appointment Booked", value: ov.booked,            gradient: "from-emerald-500 to-teal-600" },
              { label: "Interested",          value: ov.interested,        gradient: "from-blue-500 to-blue-700" },
              { label: "Callback Requested",  value: ov.callback_requested, gradient: "from-amber-400 to-orange-500" },
              { label: "Not Interested",      value: ov.not_interested,    gradient: "from-red-400 to-rose-600" },
              { label: "No Answer",           value: ov.no_answer,         gradient: "from-gray-400 to-gray-500" },
            ].map(({ label, value, gradient }) => (
              <div key={label} className={`rounded-xl bg-gradient-to-br ${gradient} p-4`}>
                <p className="text-2xl font-black text-white leading-none">{value ?? "—"}</p>
                <p className="text-[10px] font-semibold text-white/70 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
