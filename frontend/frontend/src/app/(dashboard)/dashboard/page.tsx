"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLeads, getAppointments, updateAppointmentStatus } from "@/lib/api";
import { Users, Phone, CalendarCheck, TrendingUp, PhoneCall, MapPin, ChevronLeft, ChevronRight, BarChart2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtRelative } from "@/lib/utils";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import Link from "next/link";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO,
} from "date-fns";

const PIE_COLORS: Record<string, string> = {
  new: "#8b5cf6",
  interested: "#7c3aed",
  appointment_booked: "#ec4899",
  not_interested: "#ef4444",
  no_answer: "#94a3b8",
  callback_requested: "#f97316",
  calling: "#a855f7",
  duplicate: "#cbd5e1",
};
const FALLBACK_COLORS = ["#8b5cf6","#ec4899","#a855f7","#c084fc"];

export default function DashboardPage() {
  const qc = useQueryClient();
  const { data: leadsData } = useQuery({
    queryKey: ["leads", "dashboard"],
    queryFn: () => getLeads({ limit: 200, offset: 0 }),
  });
  const { data: apptData } = useQuery({
    queryKey: ["appointments", "dashboard"],
    queryFn: () => getAppointments(),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      updateAppointmentStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  const leads: Lead[] = leadsData?.data?.leads ?? [];
  const appointments: Appointment[] = apptData?.data ?? [];

  const total = leadsData?.data?.total ?? 0;
  const booked = leads.filter((l) => l.status === "appointment_booked").length;
  const interested = leads.filter((l) => l.status === "interested").length;
  const called = leads.filter((l) => l.call_count > 0).length;
  const successRate = called > 0 ? Math.round(((booked + interested) / called) * 100) : 0;
  const online = leads.filter((l) => l.consultation_type === "online").length;
  const inClinic = leads.filter((l) => l.consultation_type === "in_clinic").length;

  const statusMap: Record<string, number> = {};
  leads.forEach((l) => { statusMap[l.status] = (statusMap[l.status] || 0) + 1; });
  const pieData = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

  const recent = [...leads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gradient-to-br from-violet-50/40 via-white to-pink-50/20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Good Morning 👋</h1>
          <p className="text-sm text-gray-400 mt-0.5">{today}</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: "Total Leads", value: total, icon: Users,
            gradient: "from-violet-500 to-indigo-600",
            bg: "from-violet-50 to-indigo-50",
            iconBg: "bg-violet-500",
            sub: `${online} online · ${inClinic} in-clinic`,
          },
          {
            label: "Calls Made", value: called, icon: PhoneCall,
            gradient: "from-purple-500 to-violet-600",
            bg: "from-purple-50 to-violet-50",
            iconBg: "bg-purple-500",
            sub: `${total - called} not yet called`,
          },
          {
            label: "Appointments", value: booked, icon: CalendarCheck,
            gradient: "from-pink-500 to-rose-500",
            bg: "from-pink-50 to-rose-50",
            iconBg: "bg-pink-500",
            sub: `${interested} interested, pending`,
          },
          {
            label: "Success Rate", value: `${successRate}%`, icon: TrendingUp,
            gradient: "from-fuchsia-500 to-pink-600",
            bg: "from-fuchsia-50 to-pink-50",
            iconBg: "bg-fuchsia-500",
            sub: called > 0 ? `From ${called} calls` : "No calls yet",
          },
        ].map(({ label, value, icon: Icon, gradient, bg, iconBg, sub }) => (
          <div key={label} className={`relative bg-gradient-to-br ${bg} rounded-2xl border border-white shadow-sm overflow-hidden p-5`}>
            <div className="flex items-start justify-between mb-4">
              <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shadow-sm`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <span className={`text-xs font-semibold bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
                {label}
              </span>
            </div>
            <p className="text-3xl font-extrabold text-gray-900 tracking-tight">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
            {/* decorative circle */}
            <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full bg-gradient-to-br ${gradient} opacity-10`} />
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { href: "/leads", label: "View All Leads", desc: `${total} total`, color: "bg-violet-600 hover:bg-violet-700", icon: Users },
          { href: "/calls", label: "Call Logs", desc: `${called} calls made`, color: "bg-purple-600 hover:bg-purple-700", icon: Phone },
          { href: "/appointments", label: "Appointments", desc: `${booked} booked`, color: "bg-pink-500 hover:bg-pink-600", icon: CalendarCheck },
          { href: "/analytics", label: "Analytics", desc: "Funnel · Heatmap · Export", color: "bg-fuchsia-600 hover:bg-fuchsia-700", icon: BarChart2 },
        ].map(({ href, label, desc, color, icon: Icon }) => (
          <Link key={href} href={href}
            className={`${color} text-white rounded-xl p-4 flex items-center gap-3 transition group`}>
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center group-hover:bg-white/30 transition">
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs opacity-75">{desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-5">
        {/* Pie */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Lead Status Breakdown</h2>
            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">{leads.length} leads</span>
          </div>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={82} dataKey="value" paddingAngle={3}>
                    {pieData.map((d, i) => (
                      <Cell key={i} fill={PIE_COLORS[d.name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, String(n).replace(/_/g, " ")]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
                {pieData.map((d, i) => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: PIE_COLORS[d.name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
                    <span className="capitalize">{d.name.replace(/_/g, " ")}</span>
                    <span className="font-semibold text-gray-800">({d.value})</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-300 text-sm">No data yet</div>
          )}
        </div>

        {/* Mini Calendar */}
        <MiniCalendar
          appointments={appointments}
          onStatusUpdate={(id, status) => statusMut.mutate({ id, status })}
        />
      </div>

      {/* Recent leads */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900">Recent Leads</h2>
          <Link href="/leads" className="text-xs text-teal-600 hover:underline font-medium">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                {["Patient Name", "Phone", "City", "Inquiry", "Type", "Status", "Added"].map((h) => (
                  <th key={h} className="pb-2.5 font-medium pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((lead, i) => (
                <tr key={lead.id}
                  className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/80 transition ${i % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                  <td className="py-3 pr-4 font-semibold text-gray-900">{lead.full_name || "—"}</td>
                  <td className="py-3 pr-4 text-gray-500 font-mono text-xs">{lead.phone}</td>
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-1 text-gray-500 text-xs">
                      <MapPin className="w-3 h-3 text-gray-300" />{lead.city || "—"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-500 max-w-[160px] truncate text-xs">{lead.inquiry_type || "—"}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lead.consultation_type === "in_clinic" ? "bg-orange-50 text-orange-500" : "bg-blue-50 text-blue-500"}`}>
                      {lead.consultation_type === "in_clinic" ? "In-Clinic" : "Online"}
                    </span>
                  </td>
                  <td className="py-3 pr-4"><StatusBadge status={lead.status} /></td>
                  <td className="py-3 text-gray-400 text-xs">{fmtRelative(lead.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Mini Calendar widget ──────────────────────────────────────────────────────

const APPT_STATUS_CHIP: Record<string, string> = {
  booked:    "bg-green-100 text-green-700",
  confirmed: "bg-violet-100 text-violet-700",
  completed: "bg-gray-100 text-gray-500",
  no_show:   "bg-amber-100 text-amber-700",
  cancelled: "bg-red-100 text-red-500",
};

function MiniCalendar({ appointments, onStatusUpdate }: {
  appointments: Appointment[];
  onStatusUpdate: (id: number, status: string) => void;
}) {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState<Date>(new Date());

  const today = new Date();
  const monthStart = startOfMonth(month);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  const apptsByDate = (d: Date) =>
    appointments.filter((a) => {
      try { return isSameDay(parseISO(a.appointment_date), d) && a.status !== "cancelled"; }
      catch { return false; }
    });

  const selectedAppts = apptsByDate(selected);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Appointments Calendar</h2>
        <Link href="/appointments" className="text-xs text-teal-600 hover:underline font-medium">View all</Link>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(subMonths(month, 1))}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-gray-700">{format(month, "MMMM yyyy")}</span>
        <button onClick={() => setMonth(addMonths(month, 1))}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 text-center">
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <div key={i} className="text-[10px] font-medium text-gray-300 pb-1">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const dayAppts = apptsByDate(day);
          const isToday = isSameDay(day, today);
          const isSel = isSameDay(day, selected);
          const inMonth = isSameMonth(day, month);
          const hasOnline = dayAppts.some((a) => a.appointment_type !== "in_clinic");
          const hasClinic = dayAppts.some((a) => a.appointment_type === "in_clinic");

          return (
            <button key={day.toISOString()} onClick={() => setSelected(day)}
              className={`flex flex-col items-center py-1 rounded-lg transition
                ${isSel ? "bg-teal-600" : isToday ? "bg-teal-50 ring-1 ring-teal-400" : "hover:bg-gray-50"}
                ${!inMonth ? "opacity-25" : ""}`}>
              <span className={`text-[11px] font-semibold leading-none
                ${isSel ? "text-white" : isToday ? "text-teal-700" : "text-gray-700"}`}>
                {format(day, "d")}
              </span>
              {/* Appointment dots */}
              {dayAppts.length > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {hasOnline && <span className={`w-1 h-1 rounded-full ${isSel ? "bg-blue-200" : "bg-blue-400"}`} />}
                  {hasClinic && <span className={`w-1 h-1 rounded-full ${isSel ? "bg-orange-200" : "bg-orange-400"}`} />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Online</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> In-Clinic</span>
      </div>

      {/* Selected date appointments */}
      <div className="border-t border-gray-50 pt-3 space-y-2 min-h-[80px]">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          {format(selected, "EEE, d MMM")}
          {selectedAppts.length > 0 && <span className="ml-1.5 text-teal-600">· {selectedAppts.length} appointment{selectedAppts.length > 1 ? "s" : ""}</span>}
        </p>

        {selectedAppts.length === 0 ? (
          <p className="text-xs text-gray-300">No appointments on this day</p>
        ) : (
          selectedAppts.map((a) => {
            const apptDate = parseISO(a.appointment_date);
            const isPast = apptDate < today;
            const canMark = isPast && (a.status === "booked" || a.status === "confirmed");
            const statusLabel = a.status === "no_show" ? "No-show"
              : a.status.charAt(0).toUpperCase() + a.status.slice(1);
            return (
              <div key={a.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-50/80">
                {/* Time badge */}
                <div className="flex flex-col items-center justify-center bg-white rounded-lg border border-gray-100 px-2 py-1.5 shrink-0 min-w-[44px]">
                  <span className="text-[11px] font-bold text-gray-700 leading-none">
                    {format(apptDate, "h:mm")}
                  </span>
                  <span className="text-[9px] text-gray-400 leading-none mt-0.5">
                    {format(apptDate, "a")}
                  </span>
                </div>
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">{a.patient_name || a.phone}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium
                      ${a.appointment_type === "in_clinic" ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"}`}>
                      {a.appointment_type === "in_clinic" ? "In-Clinic" : "Online"}
                    </span>
                    {a.inquiry_type && (
                      <span className="text-[10px] text-gray-400 truncate max-w-[100px]">{a.inquiry_type}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${APPT_STATUS_CHIP[a.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {statusLabel}
                    </span>
                  </div>
                  {canMark && (
                    <div className="flex gap-1 mt-1.5">
                      <button
                        onClick={() => onStatusUpdate(a.id, "completed")}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600 hover:bg-green-100 font-medium transition"
                      >
                        ✓ Done
                      </button>
                      <button
                        onClick={() => onStatusUpdate(a.id, "no_show")}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium transition"
                      >
                        No-show
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


// ── Types ─────────────────────────────────────────────────────────────────────

interface Lead {
  id: number; full_name: string; phone: string; city: string;
  inquiry_type: string; status: string; consultation_type: string;
  call_count: number; created_at: string;
}
interface Appointment {
  id: number; patient_name: string; phone: string; appointment_date: string;
  appointment_type: string; inquiry_type: string; status: string;
}
