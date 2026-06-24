"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Phone,
  CalendarDays,
  Settings,
  LogOut,
  BarChart2,
  Zap,
  Building2,
  Megaphone,
  PhoneCall,
  Puzzle,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/api";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard, section: null },
  { href: "/setup",        label: "Setup Guide",  icon: BookOpen,        section: "Setup" },
  { href: "/integrations", label: "Integrations", icon: Puzzle,          section: null },
  { href: "/clients",      label: "Clients",      icon: Building2,       section: null },
  { href: "/campaigns",    label: "Campaigns",    icon: Megaphone,       section: null },
  { href: "/leads",        label: "Leads",        icon: Users,           section: "Workspace" },
  { href: "/calls",        label: "Calls",        icon: Phone,           section: null },
  { href: "/appointments", label: "Appointments", icon: CalendarDays,    section: null },
  { href: "/analytics",    label: "Analytics",    icon: BarChart2,       section: "Insights" },
  { href: "/usage",        label: "Usage",        icon: Zap,             section: null },
  { href: "/settings",     label: "Settings",     icon: Settings,        section: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try { await logout(); } catch {}
    localStorage.removeItem("token");
    router.push("/login");
  };

  let lastSection: string | null = "___init___";

  return (
    <aside className="w-60 min-h-screen bg-[#0f172a] flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/40">
            <PhoneCall className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">Vidushi Infotech</p>
            <p className="text-[10px] text-slate-400 font-medium leading-tight">AI Calling Platform</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon, section }) => {
          const active = href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(href);

          const showSection = section && section !== lastSection;
          if (section !== lastSection) lastSection = section;

          return (
            <div key={href}>
              {showSection && (
                <p className="px-3 pt-4 pb-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  {section}
                </p>
              )}
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                  active
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0 transition-colors", active ? "text-white" : "text-slate-500")} />
                {label}
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/60" />
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* User / Logout */}
      <div className="px-3 py-4 border-t border-white/5">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all group"
        >
          <LogOut className="w-4 h-4 group-hover:text-red-400 transition-colors" />
          Logout
        </button>
      </div>
    </aside>
  );
}
