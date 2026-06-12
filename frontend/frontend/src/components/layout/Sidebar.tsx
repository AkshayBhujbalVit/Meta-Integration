"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  LayoutDashboard,
  Bot,
  Users,
  Phone,
  CalendarDays,
  BookOpen,
  Settings,
  LogOut,
  BarChart2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/api";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/agent", label: "AI Agent", icon: Bot },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/usage", label: "Usage", icon: Zap },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try { await logout(); } catch {}
    localStorage.removeItem("token");
    router.push("/login");
  };

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-violet-100/60 flex flex-col shadow-sm">
      {/* Brand header — purple gradient with photo */}
      <div className="relative overflow-hidden px-5 py-5 border-b border-violet-100/60 bg-gradient-to-br from-violet-600 to-purple-700">
        {/* Decorative circles */}
        <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
        <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-pink-400/20 pointer-events-none" />

        <div className="relative flex items-center gap-3">
          <div className="relative w-11 h-11 shrink-0">
            <Image
              src="/vidushi-logo.png"
              alt="Vidushi Infotech"
              fill
              className="rounded-full object-cover object-top ring-2 ring-white/60"
              onError={(e) => {
                const target = e.currentTarget as HTMLImageElement;
                target.style.display = "none";
                const fallback = target.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <div className="hidden w-11 h-11 rounded-full bg-white/20 items-center justify-center absolute inset-0 border-2 border-white/40">
              <span className="text-white text-sm font-bold">SG</span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">Vidushi Infotech</p>
            <p className="text-[10px] text-violet-200 font-medium leading-tight mt-0.5">AI Calling Platform</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                active
                  ? "bg-violet-50 text-violet-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-violet-600" : "text-gray-400")} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-100">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
