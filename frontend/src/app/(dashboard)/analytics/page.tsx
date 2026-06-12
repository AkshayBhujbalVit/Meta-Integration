"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAnalyticsOverview,
  getAnalyticsFunnel,
  getAnalyticsHeatmap,
  getAnalyticsTrends,
  getInquiryBreakdown,
  getCityBreakdown,
  exportLeads,
} from "@/lib/api";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import {
  Users, Phone, CalendarCheck, TrendingUp, Download,
  PhoneIncoming, MessageSquare, Clock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FunnelStep { label: string; count: number; pct_of_prev: number; }
interface HeatmapBucket { hour: number; label: string; total_calls: number; answered: number; answer_rate: number; }
interface TrendPoint { date: string; leads: number; calls: number; appointments: number; }
interface InquiryRow { inquiry_type: string; count: number; }
interface CityRow { city: string; count: number; }

// ── Colours ───────────────────────────────────────────────────────────────────
const FUNNEL_COLORS = ["#7c3aed","#8b5cf6","#a78bfa","#c4b5fd","#ddd6fe","#ede9fe"];
const HEATMAP_BASE = "#8b5cf6";

function heatColor(rate: number): string {
  // 0% → light grey, 100% → deep violet
  if (rate === 0) return "#f3f4f6";
  const intensity = Math.min(rate / 100, 1);
  const r = Math.round(139 + (55 - 139) * intensity);   // 139 → 55
  const g = Math.round(92  + (52  - 92 ) * intensity);  // 92  → 52
  const b = Math.round(246 + (237 - 246) * intensity);  // 246 → 237
  return `rgb(${r},${g},${b})`;
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [exporting, setExporting] = useState(false);

  const { data: overviewData } = useQuery({ queryKey: ["analytics", "overview"], queryFn: getAnalyticsOverview });
  const { data: funnelData }   = useQuery({ queryKey: ["analytics", "funnel"],   queryFn: getAnalyticsFunnel });
  const { data: heatmapData }  = useQuery({ queryKey: ["analytics", "heatmap"],  queryFn: getAnalyticsHeatmap });
  const { data: trendsData }   = useQuery({ queryKey: ["analytics", "trends", period], queryFn: () => getAnalyticsTrends(period) });
  const { data: inquiryData }  = useQuery({ queryKey: ["analytics", "inquiry"],  queryFn: getInquiryBreakdown });
  const { data: cityData }     = useQuery({ queryKey: ["analytics", "city"],     queryFn: getCityBreakdown });

  const ov    = overviewData?.data ?? {};
  const funnel: FunnelStep[] = funnelData?.data?.steps ?? [];
  const heatmap: HeatmapBucket[] = heatmapData?.data?.heatmap ?? [];
  const trends: TrendPoint[] = trendsData?.data?.series ?? [];
  const inquiries: InquiryRow[] = inquiryData?.data ?? [];
  const cities: CityRow[] = cityData?.data ?? [];

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
    } catch (e) {
      console.error("Export failed", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gradient-to-br from-violet-50/40 via-white to-pink-50/20">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-400 mt-0.5">Campaign performance & conversion insights</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("excel")}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-xl transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      {/* KPI cards — 4 per row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Leads",      value: ov.total_leads,           icon: Users,          color: "violet" },
          { label: "Total Calls",      value: ov.total_calls,           icon: Phone,          color: "purple" },
          { label: "Inbound Calls",    value: ov.inbound_calls,         icon: PhoneIncoming,  color: "indigo" },
          { label: "Appointments",     value: ov.total_appointments,    icon: CalendarCheck,  color: "pink"   },
          { label: "Answer Rate",      value: `${ov.answer_rate_pct}%`, icon: TrendingUp,     color: "fuchsia"},
          { label: "Booking Rate",     value: `${ov.booking_rate_pct}%`,icon: TrendingUp,     color: "rose"   },
          { label: "Avg Call Duration",value: ov.avg_call_duration_seconds ? `${Math.round(ov.avg_call_duration_seconds)}s` : "—", icon: Clock, color: "amber"},
          { label: "WA Messages",      value: (ov.whatsapp_inbound ?? 0) + (ov.whatsapp_outbound ?? 0), icon: MessageSquare, color: "green"},
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 relative overflow-hidden">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 bg-${color}-100`}>
              <Icon className={`w-4 h-4 text-${color}-600`} />
            </div>
            <p className="text-2xl font-extrabold text-gray-900">{value ?? "—"}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Row 2: Funnel + Heatmap */}
      <div className="grid grid-cols-2 gap-5">

        {/* Conversion funnel */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Conversion Funnel</h2>
          {funnel.length === 0 ? (
            <p className="text-xs text-gray-300 h-40 flex items-center justify-center">No data yet</p>
          ) : (
            <div className="space-y-2">
              {funnel.map((step, i) => (
                <div key={step.label}>
                  <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                    <span className="font-medium text-gray-700">{step.label}</span>
                    <span className="font-semibold">{step.count.toLocaleString()}&nbsp;
                      <span className="text-gray-400 font-normal">({step.pct_of_prev}%)</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-2.5 rounded-full transition-all duration-500"
                      style={{
                        width: `${step.pct_of_prev}%`,
                        backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Heatmap — 24 hour buckets */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Best Time to Call (Answer Rate by Hour)</h2>
          <p className="text-xs text-gray-400 mb-4">Darker = higher answer rate · IST</p>
          <div className="grid grid-cols-12 gap-1">
            {heatmap.map((b) => (
              <div key={b.hour} className="flex flex-col items-center gap-0.5">
                <div
                  title={`${b.label} — ${b.answer_rate}% answered (${b.answered}/${b.total_calls})`}
                  className="w-full rounded"
                  style={{
                    height: 32,
                    backgroundColor: heatColor(b.answer_rate),
                    border: "1px solid #e5e7eb",
                  }}
                />
                <span className="text-[9px] text-gray-400">{b.hour}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-gray-300 mt-2 px-0.5">
            <span>0% (no answer)</span>
            <span>100% (all answered)</span>
          </div>
        </div>
      </div>

      {/* Row 3: Trends */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900">Daily Trends</h2>
          <div className="flex gap-1">
            {(["7d", "30d", "90d"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  period === p
                    ? "bg-violet-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trends} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v) => v.slice(5)} // show MM-DD
              interval={Math.floor(trends.length / 6)}
            />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
            <Line type="monotone" dataKey="leads"        stroke="#7c3aed" strokeWidth={2} dot={false} name="Leads" />
            <Line type="monotone" dataKey="calls"        stroke="#a855f7" strokeWidth={2} dot={false} name="Calls" />
            <Line type="monotone" dataKey="appointments" stroke="#ec4899" strokeWidth={2} dot={false} name="Appointments" />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-5 mt-2 text-xs justify-center">
          {[
            { label: "Leads",        color: "#7c3aed" },
            { label: "Calls",        color: "#a855f7" },
            { label: "Appointments", color: "#ec4899" },
          ].map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1.5 text-gray-500">
              <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Row 4: Inquiry breakdown + City breakdown */}
      <div className="grid grid-cols-2 gap-5">

        {/* Inquiry breakdown — horizontal bar chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Leads by Inquiry Type</h2>
          {inquiries.length === 0 ? (
            <p className="text-xs text-gray-300 h-40 flex items-center justify-center">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, inquiries.length * 36)}>
              <BarChart data={inquiries} layout="vertical" margin={{ left: 10, right: 10 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: "#9ca3af" }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="inquiry_type"
                  width={130}
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  tickFormatter={(v) => v.length > 20 ? v.slice(0, 19) + "…" : v}
                />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" name="Leads" radius={[0, 4, 4, 0]}>
                  {inquiries.map((_, i) => (
                    <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* City table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Leads by City (Top 15)</h2>
          {cities.length === 0 ? (
            <p className="text-xs text-gray-300 h-40 flex items-center justify-center">No data yet</p>
          ) : (
            <div className="overflow-y-auto max-h-[300px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                    <th className="pb-2 font-medium">City</th>
                    <th className="pb-2 font-medium text-right">Leads</th>
                    <th className="pb-2 font-medium text-right w-28">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {cities.map((row, i) => {
                    const maxCount = cities[0]?.count || 1;
                    return (
                      <tr key={row.city} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 font-medium text-gray-800 text-xs">{row.city}</td>
                        <td className="py-2 text-right text-xs text-gray-600 font-mono">{row.count}</td>
                        <td className="py-2 pl-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${(row.count / maxCount) * 100}%`,
                                  backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 w-8 text-right">
                              {Math.round((row.count / (cities.reduce((s, c) => s + c.count, 0))) * 100)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Outcome summary table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-4">Outcome Summary</h2>
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: "Appointment Booked", value: ov.booked,           color: "bg-pink-100 text-pink-700"   },
            { label: "Interested",         value: ov.interested,        color: "bg-violet-100 text-violet-700"},
            { label: "Callback Requested", value: ov.callback_requested,color: "bg-orange-100 text-orange-700"},
            { label: "Not Interested",     value: ov.not_interested,    color: "bg-red-100 text-red-600"     },
            { label: "No Answer",          value: ov.no_answer,         color: "bg-gray-100 text-gray-500"   },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl p-4 ${color}`}>
              <p className="text-2xl font-extrabold">{value ?? "—"}</p>
              <p className="text-xs font-medium mt-0.5 opacity-80">{label}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
