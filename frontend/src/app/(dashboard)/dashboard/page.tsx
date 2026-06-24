"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getDashboardOverview } from "@/lib/api";
import {
  Users, PhoneCall, CheckCircle2, TrendingUp, Share2, ArrowRight,
  Loader2, Megaphone, Circle, Zap, BarChart3, Plus,
} from "lucide-react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlatformStat {
  platform: string;
  total: number;
  called: number;
  booked: number;
  conv_pct: number;
}

interface CampaignStat {
  id: number;
  name: string;
  client_name: string;
  caller_phone: string | null;
  total_leads: number;
  called: number;
  booked: number;
  conv_pct: number;
}

interface RecentLead {
  id: number;
  full_name: string;
  phone: string;
  status: string;
  source_platform: string;
  client_name: string;
  campaign_name: string;
  created_at: string;
}

interface Overview {
  total_clients: number;
  active_campaigns: number;
  total_leads: number;
  new_leads_today: number;
  calls_today: number;
  booked_today: number;
  total_booked: number;
  total_called: number;
  by_platform: PlatformStat[];
  active_campaigns_list: CampaignStat[];
  clients: { id: number; name: string; business_type: string; total_leads: number; booked: number; active_campaigns: number }[];
  recent_leads: RecentLead[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; ring: string }> = {
  meta:     { label: "Meta Ads",    color: "#1877F2", bg: "bg-[#1877F2]", ring: "ring-[#1877F2]/20" },
  facebook: { label: "Meta Ads",    color: "#1877F2", bg: "bg-[#1877F2]", ring: "ring-[#1877F2]/20" },
  google:   { label: "Google Ads",  color: "#EA4335", bg: "bg-[#EA4335]", ring: "ring-[#EA4335]/20" },
  google_ads: { label: "Google Ads",color: "#EA4335", bg: "bg-[#EA4335]", ring: "ring-[#EA4335]/20" },
  linkedin: { label: "LinkedIn",    color: "#0A66C2", bg: "bg-[#0A66C2]", ring: "ring-[#0A66C2]/20" },
  mailchimp:{ label: "Mailchimp",   color: "#FFE01B", bg: "bg-[#FFE01B]", ring: "ring-yellow-300/20" },
  manual:   { label: "Manual",      color: "#6B7280", bg: "bg-gray-400",  ring: "ring-gray-400/20" },
  csv:      { label: "CSV Import",  color: "#6B7280", bg: "bg-gray-400",  ring: "ring-gray-400/20" },
};

function getPlatformMeta(key: string) {
  return PLATFORM_META[key?.toLowerCase()] ?? { label: key, color: "#6B7280", bg: "bg-gray-400", ring: "ring-gray-400/20" };
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  new:                { label: "New",        dot: "bg-blue-500",    badge: "bg-blue-50 text-blue-700 ring-blue-100" },
  call_scheduled:     { label: "Scheduled",  dot: "bg-amber-500",   badge: "bg-amber-50 text-amber-700 ring-amber-100" },
  called:             { label: "Called",     dot: "bg-indigo-500",  badge: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  interested:         { label: "Interested", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  appointment_booked: { label: "Booked",     dot: "bg-green-500",   badge: "bg-green-50 text-green-700 ring-green-100" },
  not_interested:     { label: "Not Int.",   dot: "bg-gray-400",    badge: "bg-gray-50 text-gray-500 ring-gray-100" },
  no_answer:          { label: "No Answer",  dot: "bg-orange-400",  badge: "bg-orange-50 text-orange-700 ring-orange-100" },
};

function getStatus(key: string) {
  return STATUS_CONFIG[key] ?? { label: key, dot: "bg-gray-400", badge: "bg-gray-50 text-gray-600 ring-gray-100" };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  gradient: string;
  textAccent: string;
  trend?: string;
}

function StatCard({ label, value, sub, icon: Icon, gradient, textAccent, trend }: StatCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl ${gradient} p-5 shadow-sm`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-white/70 uppercase tracking-widest">{label}</p>
        <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <p className={`text-3xl font-black ${textAccent} leading-none mb-1`}>{value}</p>
      {sub && <p className="text-xs text-white/60 mt-1.5">{sub}</p>}
      {trend && (
        <div className="absolute bottom-0 right-0 w-20 h-12 opacity-10">
          <TrendingUp className="w-full h-full" />
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: () => getDashboardOverview() as unknown as Promise<{ data: Overview }>,
    refetchInterval: 30_000,
  });

  const d = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
          <p className="text-sm text-gray-400 font-medium">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  const convRate = d && d.total_called > 0
    ? `${((d.total_booked / d.total_called) * 100).toFixed(1)}%`
    : "—";

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Overview</h1>
            <p className="text-sm text-gray-400 mt-0.5">{today}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {d?.active_campaigns ?? 0} campaigns live
            </div>
            <Link href="/campaigns"
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-full transition-colors shadow-sm">
              <Plus className="w-3 h-3" /> New Campaign
            </Link>
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Leads"
            value={d?.total_leads?.toLocaleString() ?? "0"}
            sub={d?.new_leads_today ? `+${d.new_leads_today} today` : "No new leads today"}
            icon={Users}
            gradient="bg-gradient-to-br from-blue-600 to-blue-700"
            textAccent="text-white"
            trend="up"
          />
          <StatCard
            label="Calls Today"
            value={d?.calls_today ?? 0}
            sub={`${d?.total_called ?? 0} total calls made`}
            icon={PhoneCall}
            gradient="bg-gradient-to-br from-violet-600 to-purple-700"
            textAccent="text-white"
          />
          <StatCard
            label="Appointments"
            value={d?.total_booked ?? 0}
            sub={d?.booked_today ? `+${d.booked_today} booked today` : "Total booked"}
            icon={CheckCircle2}
            gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
            textAccent="text-white"
          />
          <StatCard
            label="Conv. Rate"
            value={convRate}
            sub={`${d?.total_clients ?? 0} clients · ${d?.active_campaigns ?? 0} campaigns`}
            icon={TrendingUp}
            gradient="bg-gradient-to-br from-orange-500 to-rose-500"
            textAccent="text-white"
          />
        </div>

        {/* ── Platform breakdown ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Leads by Platform</h2>
                <p className="text-xs text-gray-400">All marketing channels in your pipeline</p>
              </div>
            </div>
            <Link href="/integrations"
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 transition-colors">
              Manage <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {!d?.by_platform?.length ? (
            <div className="py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                <Share2 className="w-8 h-8 text-gray-200" />
              </div>
              <p className="text-sm font-bold text-gray-400">No leads yet</p>
              <p className="text-xs text-gray-300 mt-1 mb-5">Connect a marketing platform to start receiving leads</p>
              <Link href="/integrations"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
                Connect Platforms <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div>
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-3 px-6 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/70">
                <div className="col-span-4">Platform</div>
                <div className="col-span-4">Distribution</div>
                <div className="col-span-1 text-right">Leads</div>
                <div className="col-span-1 text-right">Called</div>
                <div className="col-span-2 text-right">Booked / Conv%</div>
              </div>
              {d.by_platform.map((p, i) => {
                const meta = getPlatformMeta(p.platform);
                const barPct = d.total_leads > 0 ? (p.total / d.total_leads) * 100 : 0;
                return (
                  <div key={p.platform}
                    className={`grid grid-cols-12 gap-3 px-6 py-4 items-center transition-colors hover:bg-blue-50/30
                      ${i < d.by_platform.length - 1 ? "border-b border-gray-50" : ""}`}>
                    {/* Platform name */}
                    <div className="col-span-4 flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl ${meta.bg} ring-4 ${meta.ring} flex items-center justify-center shrink-0`}>
                        <span className="text-[10px] font-black text-white">
                          {meta.label.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{meta.label}</p>
                        <p className="text-[10px] text-gray-400">{barPct.toFixed(0)}% of total pipeline</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="col-span-4 flex items-center gap-2">
                      <div className="h-2 bg-gray-100 rounded-full flex-1 overflow-hidden">
                        <div className="h-2 rounded-full transition-all duration-700"
                          style={{ width: `${barPct}%`, backgroundColor: meta.color }} />
                      </div>
                    </div>
                    {/* Leads */}
                    <div className="col-span-1 text-right">
                      <span className="text-base font-black text-gray-900">{p.total}</span>
                    </div>
                    {/* Called */}
                    <div className="col-span-1 text-right">
                      <span className="text-sm font-semibold text-gray-700">{p.called}</span>
                      {p.total > 0 && (
                        <div className="text-[10px] text-gray-400">{Math.round((p.called / p.total) * 100)}%</div>
                      )}
                    </div>
                    {/* Booked */}
                    <div className="col-span-2 text-right">
                      <span className={`text-sm font-black ${p.booked > 0 ? "text-emerald-600" : "text-gray-200"}`}>
                        {p.booked}
                      </span>
                      {p.conv_pct > 0 && (
                        <span className="ml-1.5 text-[10px] font-bold text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                          {p.conv_pct}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Active campaigns + Recent leads ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Active campaigns — 2 cols */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Megaphone className="w-3.5 h-3.5 text-violet-600" />
                </div>
                <h2 className="text-sm font-bold text-gray-900">Active Campaigns</h2>
              </div>
              <Link href="/campaigns"
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {!d?.active_campaigns_list?.length ? (
              <div className="py-14 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                  <Megaphone className="w-6 h-6 text-gray-200" />
                </div>
                <p className="text-sm font-semibold text-gray-400">No active campaigns</p>
                <Link href="/campaigns"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <Plus className="w-3 h-3" /> Create campaign
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {d.active_campaigns_list.map((camp) => (
                  <Link key={camp.id} href="/campaigns"
                    className="flex items-start gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors group">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Zap className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">{camp.name}</p>
                        <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full shrink-0">
                          <Circle className="w-1.5 h-1.5 fill-emerald-500" /> LIVE
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mb-2">{camp.client_name}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500"><span className="font-bold text-gray-900">{camp.total_leads}</span> leads</span>
                        <span className="text-gray-500"><span className="font-bold text-gray-900">{camp.called}</span> called</span>
                        {camp.booked > 0 && (
                          <span className="font-bold text-emerald-600">{camp.booked} booked</span>
                        )}
                      </div>
                      {/* Mini progress bar */}
                      {camp.total_leads > 0 && (
                        <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-1 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                            style={{ width: `${Math.round((camp.called / camp.total_leads) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent leads — 3 cols */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <h2 className="text-sm font-bold text-gray-900">Recent Leads</h2>
              </div>
              <Link href="/leads"
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {!d?.recent_leads?.length ? (
              <div className="py-14 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-gray-200" />
                </div>
                <p className="text-sm font-semibold text-gray-400">No leads yet</p>
                <Link href="/integrations"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <Plus className="w-3 h-3" /> Connect a platform
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {d.recent_leads.slice(0, 8).map((lead) => {
                  const st = getStatus(lead.status);
                  const pm = getPlatformMeta(lead.source_platform);
                  return (
                    <Link key={lead.id} href="/leads"
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/50 transition-colors group">
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-white">
                          {(lead.full_name || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                            {lead.full_name || "Unknown"}
                          </p>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${pm.bg}`} />
                        </div>
                        <p className="text-[11px] text-gray-400 truncate">
                          {lead.campaign_name || lead.client_name || pm.label}
                        </p>
                      </div>
                      {/* Status + time */}
                      <div className="text-right shrink-0">
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ${st.badge}`}>
                          {st.label}
                        </span>
                        <p className="text-[10px] text-gray-300 mt-1">{timeAgo(lead.created_at)}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* ── Clients overview (only if multiple clients) ── */}
        {d?.clients && d.clients.length > 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
              <h2 className="text-sm font-bold text-gray-900">Clients Overview</h2>
              <Link href="/clients"
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                Manage <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {d.clients.slice(0, 6).map((c) => (
                <Link key={c.id} href={`/clients/${c.id}`}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                    <span className="text-sm font-black text-white">{c.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">{c.name}</p>
                    <p className="text-[11px] text-gray-400">{c.total_leads} leads · {c.booked} booked</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
