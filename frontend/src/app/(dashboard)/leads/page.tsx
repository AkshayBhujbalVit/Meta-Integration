"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getLeads, getLead, getLeadFilters, triggerCall, getCallHistory,
  getLeadAppointments, getSMSHistory, sendFollowup, bookAppointment,
  createLead, resetStuckCalls, updateLead, deleteLead,
} from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDateTime, fmtRelative } from "@/lib/utils";
import { toast } from "sonner";
import {
  Phone, CalendarPlus, MessageSquare, Search, Loader2, X,
  UserPlus, RotateCcw, Pencil, Trash2, AlertTriangle, Filter,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// ── Local types ───────────────────────────────────────────────────────────────

interface Lead {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  city: string;
  client_id: number | null;
  client_name: string | null;
  campaign_id: number | null;
  campaign_name: string | null;
  source_platform: string | null;
  platform: string | null;
  inquiry_type: string;
  second_inquiry_type: string;
  problem_description: string;
  tests_done: string;
  is_working_professional: string;
  ad_name: string;
  status: string;
  consultation_type: string;
  call_count: number;
  last_called_at: string;
  assigned_to_human: boolean;
  created_at: string;
  call_outcome: string;
  fb_lead_id: string;
}

interface ClientOption { id: number; name: string; }
interface CampaignOption { id: number; client_id: number; name: string; }
interface FilterOptions {
  clients: ClientOption[];
  campaigns: CampaignOption[];
  source_platforms: string[];
  statuses: string[];
  cities: string[];
  inquiry_types: string[];
}
interface CallLog {
  id: number;
  attempt_number: number;
  status: string;
  outcome: string;
  language_used: string;
  duration_seconds: number;
  started_at: string;
  summary: string;
  transcript: string;
}
interface Appt {
  id: number;
  appointment_date: string;
  appointment_type: string;
  inquiry_type: string;
  status: string;
  notes: string;
}
interface SMS {
  id: number;
  sms_type: string;
  language: string;
  status: string;
  message: string;
  sent_at: string;
}

type NewLeadState = {
  full_name: string;
  phone: string;
  city: string;
  email: string;
  client_id: string;
  campaign_id: string;
  source_platform: string;
};

type EditLeadState = {
  full_name: string;
  phone: string;
  email: string;
  city: string;
};

// ── Platform badge ────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  meta_lead_ads:   { label: "Meta Ads",    color: "bg-blue-50 text-blue-600" },
  meta_whatsapp:   { label: "WhatsApp",    color: "bg-green-50 text-green-600" },
  hubspot:         { label: "HubSpot CRM", color: "bg-orange-50 text-orange-600" },
  hubspot_webhook: { label: "HubSpot CRM", color: "bg-orange-50 text-orange-600" },
  google_webhook:  { label: "Google Ads",  color: "bg-red-50 text-red-600" },
  klaviyo_webhook: { label: "Klaviyo",     color: "bg-purple-50 text-purple-600" },
  manual:          { label: "Manual",      color: "bg-gray-100 text-gray-600" },
  csv:             { label: "CSV Import",  color: "bg-sky-50 text-sky-600" },
};

function PlatformBadge({ platform }: { platform?: string | null }) {
  if (!platform) return <span className="text-gray-300 text-xs">—</span>;
  const p = PLATFORM_LABELS[platform] ?? { label: platform, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.color}`}>
      {p.label}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const qc = useQueryClient();

  // Filters
  const [search, setSearch]               = useState<string>("");
  const [clientFilter, setClientFilter]   = useState<string>("");
  const [campaignFilter, setCampaignFilter] = useState<string>("");
  const [platformFilter, setPlatformFilter] = useState<string>("");
  const [statusFilter, setStatusFilter]   = useState<string>("");
  const [dateFrom, setDateFrom]           = useState<string>("");
  const [dateTo, setDateTo]               = useState<string>("");
  const [page, setPage]                   = useState<number>(0);

  // Drawer
  const [selectedLead, setSelectedLead]   = useState<Lead | null>(null);
  const [drawerTab, setDrawerTab]         = useState<"info" | "calls" | "appointments" | "messages">("info");
  const [bookingDate, setBookingDate]     = useState<string>("");
  const [bookingType, setBookingType]     = useState<string>("online");

  // Add modal
  const [addOpen, setAddOpen]             = useState<boolean>(false);
  const [newLead, setNewLead]             = useState<NewLeadState>({
    full_name: "", phone: "", city: "", email: "",
    client_id: "", campaign_id: "", source_platform: "manual",
  });

  // Edit modal
  const [editLead, setEditLead]           = useState<Lead | null>(null);
  const [editForm, setEditForm]           = useState<EditLeadState>({
    full_name: "", phone: "", email: "", city: "",
  });

  // Delete modal
  const [deleteTarget, setDeleteTarget]   = useState<Lead | null>(null);

  const LIMIT = 25;

  // Filter options
  const { data: filtersData } = useQuery<{ data: FilterOptions }>({
    queryKey: ["lead-filters"],
    queryFn: getLeadFilters,
    staleTime: 60_000,
  });
  const filters = filtersData?.data;

  // Campaigns filtered by selected client
  const availableCampaigns = useMemo<CampaignOption[]>(() => {
    if (!filters?.campaigns) return [];
    if (!clientFilter) return filters.campaigns;
    return filters.campaigns.filter((c: CampaignOption) => c.client_id === Number(clientFilter));
  }, [filters?.campaigns, clientFilter]);

  // Main leads query
  const { data, isLoading } = useQuery({
    queryKey: ["leads", search, clientFilter, campaignFilter, platformFilter, statusFilter, dateFrom, dateTo, page],
    queryFn: () => getLeads({
      limit: LIMIT,
      offset: page * LIMIT,
      ...(search         && { search }),
      ...(clientFilter   && { client_id: Number(clientFilter) }),
      ...(campaignFilter && { campaign_id: Number(campaignFilter) }),
      ...(platformFilter && { source_platform: platformFilter }),
      ...(statusFilter   && { status: statusFilter }),
      ...(dateFrom       && { date_from: dateFrom }),
      ...(dateTo         && { date_to: dateTo }),
    }),
  });

  // Live polling for selected lead during calls
  const { data: liveLeadData } = useQuery({
    queryKey: ["lead-live", selectedLead?.id],
    queryFn: () => getLead(selectedLead!.id),
    enabled: !!selectedLead,
    refetchInterval: (query: { state: { data?: { data?: { status?: string } } } }) =>
      query.state.data?.data?.status === "calling" ? 5000 : false,
  });
  const activeLead: Lead | null = (liveLeadData?.data as Lead) ?? selectedLead;
  const isCallInProgress = activeLead?.status === "calling";

  const { data: callsData } = useQuery({
    queryKey: ["calls", selectedLead?.id],
    queryFn: () => getCallHistory(selectedLead!.id),
    enabled: !!selectedLead && drawerTab === "calls",
  });
  const { data: apptsData } = useQuery({
    queryKey: ["lead-appts", selectedLead?.id],
    queryFn: () => getLeadAppointments(selectedLead!.id),
    enabled: !!selectedLead && drawerTab === "appointments",
  });
  const { data: smsData } = useQuery({
    queryKey: ["sms", selectedLead?.id],
    queryFn: () => getSMSHistory(selectedLead!.id),
    enabled: !!selectedLead && drawerTab === "messages",
  });

  // Mutations
  const resetStuckMutation = useMutation({
    mutationFn: resetStuckCalls,
    onSuccess: (res: { data: { message?: string } }) => {
      toast.success(res.data.message || "Stuck calls reset");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: () => toast.error("Failed to reset"),
  });

  const addLeadMutation = useMutation({
    mutationFn: () => createLead({
      full_name: newLead.full_name,
      phone: newLead.phone,
      city: newLead.city,
      email: newLead.email,
      client_id: newLead.client_id ? Number(newLead.client_id) : undefined,
      campaign_id: newLead.campaign_id ? Number(newLead.campaign_id) : undefined,
      source_platform: newLead.source_platform || "manual",
    }),
    onSuccess: () => {
      toast.success("Lead added");
      setAddOpen(false);
      setNewLead({ full_name: "", phone: "", city: "", email: "", client_id: "", campaign_id: "", source_platform: "manual" });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-filters"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to add lead"),
  });

  const editMutation = useMutation({
    mutationFn: () => updateLead(editLead!.id, editForm),
    onSuccess: () => {
      toast.success("Lead updated");
      setEditLead(null);
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-live", editLead?.id] });
    },
    onError: () => toast.error("Failed to update lead"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLead(deleteTarget!.id),
    onSuccess: () => {
      toast.success("Lead deleted");
      setDeleteTarget(null);
      if (selectedLead?.id === deleteTarget?.id) setSelectedLead(null);
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: () => toast.error("Failed to delete lead"),
  });

  const callMutation = useMutation({
    mutationFn: (leadId: number) => triggerCall(leadId),
    onSuccess: (_: unknown, leadId: number) => {
      toast.success("Call triggered");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-live", leadId] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to trigger call"),
  });

  const followupMutation = useMutation({
    mutationFn: (leadId: number) => sendFollowup(leadId),
    onSuccess: () => { toast.success("Follow-up sent"); qc.invalidateQueries({ queryKey: ["sms"] }); },
    onError: () => toast.error("Failed to send message"),
  });

  const bookMutation = useMutation({
    mutationFn: () => bookAppointment({
      lead_id: selectedLead!.id,
      appointment_date: new Date(bookingDate).toISOString(),
      appointment_type: bookingType,
      language: "hindi",
    }),
    onSuccess: () => {
      toast.success("Appointment booked");
      setBookingDate("");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-appts", selectedLead?.id] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to book"),
  });

  const leads: Lead[] = (data?.data?.leads as Lead[]) ?? [];
  const total: number = (data?.data?.total as number) ?? 0;
  const hasFilter = !!(search || clientFilter || campaignFilter || platformFilter || statusFilter || dateFrom || dateTo);

  const clearFilters = () => {
    setSearch(""); setClientFilter(""); setCampaignFilter("");
    setPlatformFilter(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); setPage(0);
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500">{total} leads{hasFilter ? " (filtered)" : " total"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => resetStuckMutation.mutate()}
            disabled={resetStuckMutation.isPending}
            title="Reset stuck calling leads"
            className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 text-gray-500 hover:text-amber-600 hover:border-amber-300 rounded-lg transition disabled:opacity-50"
          >
            {resetStuckMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Reset Stuck
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
          >
            <UserPlus className="w-4 h-4" /> Add Lead
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <Filter className="w-3.5 h-3.5" /> Filters
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search name, phone…"
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
          </div>

          <select
            value={clientFilter}
            onChange={e => { setClientFilter(e.target.value); setCampaignFilter(""); setPage(0); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Clients</option>
            {filters?.clients?.map((c: ClientOption) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={campaignFilter}
            onChange={e => { setCampaignFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Campaigns</option>
            {availableCampaigns.map((c: CampaignOption) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={platformFilter}
            onChange={e => { setPlatformFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Platforms</option>
            <option value="meta_lead_ads">Meta Ads</option>
            <option value="meta_whatsapp">WhatsApp</option>
            <option value="hubspot_webhook">HubSpot CRM</option>
            <option value="google_webhook">Google Ads</option>
            <option value="klaviyo_webhook">Klaviyo</option>
            <option value="manual">Manual</option>
            <option value="csv">CSV Import</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Statuses</option>
            {filters?.statuses?.map((s: string) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {hasFilter && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/50">
                {["Name", "Phone", "Client", "Campaign", "Platform", "Status", "Date"].map(h => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leads.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No leads found</td></tr>
              ) : leads.map((lead: Lead) => (
                <tr
                  key={lead.id}
                  className="group hover:bg-gray-50/80 cursor-pointer transition-colors"
                  onClick={() => { setSelectedLead(lead); setDrawerTab("info"); }}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{lead.full_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{lead.phone}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{lead.client_name ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-[140px] truncate">{lead.campaign_name ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3"><PlatformBadge platform={lead.source_platform} /></td>
                  <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDateTime(lead.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setEditForm({ full_name: lead.full_name || "", phone: lead.phone || "", email: lead.email || "", city: lead.city || "" });
                          setEditLead(lead);
                        }}
                        className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget(lead); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}</p>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage((p: number) => p - 1)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button disabled={(page + 1) * LIMIT >= total} onClick={() => setPage((p: number) => p + 1)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Add Lead Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Add New Lead</h2>
              <button onClick={() => setAddOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {([
                { label: "Full Name *", key: "full_name", placeholder: "e.g. Rahul Sharma" },
                { label: "Phone *", key: "phone", placeholder: "+919876543210" },
                { label: "Email", key: "email", placeholder: "user@example.com" },
                { label: "City", key: "city", placeholder: "e.g. Mumbai" },
              ] as { label: string; key: keyof NewLeadState; placeholder: string }[]).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-600">{label}</label>
                  <input
                    value={newLead[key]}
                    onChange={e => setNewLead((p: NewLeadState) => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-600">Client</label>
                <select
                  value={newLead.client_id}
                  onChange={e => setNewLead((p: NewLeadState) => ({ ...p, client_id: e.target.value, campaign_id: "" }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">No client</option>
                  {filters?.clients?.map((c: ClientOption) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Campaign</label>
                <select
                  value={newLead.campaign_id}
                  onChange={e => setNewLead((p: NewLeadState) => ({ ...p, campaign_id: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">No campaign</option>
                  {(filters?.campaigns ?? [])
                    .filter((c: CampaignOption) => !newLead.client_id || c.client_id === Number(newLead.client_id))
                    .map((c: CampaignOption) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Source</label>
                <select
                  value={newLead.source_platform}
                  onChange={e => setNewLead((p: NewLeadState) => ({ ...p, source_platform: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="manual">Manual</option>
                  <option value="csv">CSV Upload</option>
                  <option value="meta_lead_ads">Meta Ads</option>
                  <option value="hubspot">HubSpot</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setAddOpen(false)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => addLeadMutation.mutate()}
                disabled={!newLead.full_name || !newLead.phone || addLeadMutation.isPending}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                {addLeadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Add Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lead Modal */}
      {editLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Edit Lead</h2>
              <button onClick={() => setEditLead(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-3">
              {([
                { label: "Full Name", key: "full_name", placeholder: "e.g. Rahul Sharma" },
                { label: "Phone", key: "phone", placeholder: "+919876543210" },
                { label: "Email", key: "email", placeholder: "user@example.com" },
                { label: "City", key: "city", placeholder: "e.g. Mumbai" },
              ] as { label: string; key: keyof EditLeadState; placeholder: string }[]).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-600">{label}</label>
                  <input
                    value={editForm[key]}
                    onChange={e => setEditForm((p: EditLeadState) => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setEditLead(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-white">Cancel</button>
              <button
                onClick={() => editMutation.mutate()}
                disabled={!editForm.full_name || !editForm.phone || editMutation.isPending}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1">Delete Lead</h3>
              <p className="text-sm text-gray-500 mb-1">
                Delete <span className="font-semibold text-gray-800">{deleteTarget.full_name || deleteTarget.phone}</span>?
              </p>
              <p className="text-xs text-red-400">This permanently removes the lead and all associated data.</p>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lead Detail Drawer */}
      <Sheet open={!!selectedLead} onOpenChange={(o: boolean) => !o && setSelectedLead(null)}>
        <SheetContent className="w-[750px] sm:max-w-[750px] overflow-y-auto">
          {selectedLead && activeLead && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-base">{activeLead.full_name || "Lead Detail"}</SheetTitle>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <StatusBadge status={activeLead.status} />
                  <PlatformBadge platform={activeLead.source_platform} />
                  {activeLead.client_name && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                      {activeLead.client_name}
                    </span>
                  )}
                  {isCallInProgress && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" /> Live call
                    </span>
                  )}
                </div>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-2 mb-5">
                <button
                  onClick={() => callMutation.mutate(selectedLead.id)}
                  disabled={callMutation.isPending || isCallInProgress}
                  className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition
                    ${isCallInProgress ? "bg-amber-50 text-amber-600 border border-amber-200 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                >
                  {callMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Triggering…</>
                    : isCallInProgress
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Call In Progress</>
                    : <><Phone className="w-4 h-4" /> Trigger Call</>}
                </button>
                <button
                  onClick={() => { setDrawerTab("messages"); followupMutation.mutate(selectedLead.id); }}
                  disabled={followupMutation.isPending}
                  className="flex items-center justify-center gap-2 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg"
                >
                  {followupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                  Send WhatsApp
                </button>
              </div>

              <div className="flex border-b border-gray-100 mb-4">
                {(["info", "calls", "appointments", "messages"] as const).map(tab => (
                  <button key={tab} onClick={() => setDrawerTab(tab)}
                    className={`px-4 py-2 text-xs font-medium border-b-2 transition capitalize ${drawerTab === tab ? "border-blue-500 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                    {tab}
                  </button>
                ))}
              </div>

              {drawerTab === "info" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    {([
                      ["Phone", activeLead.phone],
                      ["City", activeLead.city],
                      ["Email", activeLead.email],
                      ["Platform", activeLead.source_platform],
                      ["Client", activeLead.client_name],
                      ["Campaign", activeLead.campaign_name],
                      ["Inquiry", activeLead.inquiry_type],
                      ["Ad Name", activeLead.ad_name],
                      ["Created", fmtDateTime(activeLead.created_at)],
                    ] as [string, string | null | undefined][]).map(([k, v]) => v ? (
                      <div key={k} className="bg-gray-50/80 rounded-xl px-3 py-2.5 border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">{k}</p>
                        <p className="text-sm text-gray-800 font-medium truncate">{v}</p>
                      </div>
                    ) : null)}
                  </div>
                  {activeLead.problem_description && (
                    <div className="bg-blue-50/60 rounded-xl px-4 py-3 border border-blue-100">
                      <p className="text-[10px] text-blue-500 font-semibold uppercase tracking-wide mb-1">Problem Description</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{activeLead.problem_description}</p>
                    </div>
                  )}
                  <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
                      <CalendarPlus className="w-4 h-4 text-blue-500" /> Book Appointment
                    </h4>
                    <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                      <input type="datetime-local" value={bookingDate} onChange={e => setBookingDate(e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <select value={bookingType} onChange={e => setBookingType(e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="online">Online</option>
                        <option value="in_person">In-Person</option>
                      </select>
                    </div>
                    <button onClick={() => bookMutation.mutate()} disabled={!bookingDate || bookMutation.isPending}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2">
                      {bookMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Confirm & Send Confirmation
                    </button>
                  </div>
                </div>
              )}

              {drawerTab === "calls" && (
                <div className="space-y-4">
                  {((callsData?.data ?? []) as CallLog[]).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No calls yet</p>
                  ) : ((callsData?.data ?? []) as CallLog[]).map((c: CallLog) => (
                    <div key={c.id} className="rounded-xl border border-gray-100 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-gray-500">Attempt #{c.attempt_number}</span>
                          <span className="text-xs text-gray-400">{fmtDateTime(c.started_at)}</span>
                          {c.duration_seconds ? (
                            <span className="text-xs text-gray-400">
                              · {Math.floor(c.duration_seconds / 60)}:{String(c.duration_seconds % 60).padStart(2, "0")}
                            </span>
                          ) : null}
                        </div>
                        {c.outcome && <StatusBadge status={c.outcome} />}
                      </div>
                      {c.summary && (
                        <div className="px-4 py-2.5 bg-white border-b border-gray-50">
                          <p className="text-xs text-gray-500 italic">{c.summary}</p>
                        </div>
                      )}
                      {c.transcript && (
                        <div className="px-4 py-3 bg-white space-y-2 max-h-64 overflow-y-auto">
                          {c.transcript.split("\n").filter(Boolean).map((line: string, i: number) => {
                            const isAI = line.startsWith("assistant:");
                            const text = line.replace(/^(assistant|user):\s*/, "");
                            return (
                              <div key={i} className={`flex gap-2 ${isAI ? "justify-start" : "justify-end"}`}>
                                {isAI && <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">AI</span>}
                                <p className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] leading-relaxed ${isAI ? "bg-blue-50 text-blue-900 rounded-tl-none" : "bg-gray-100 text-gray-800 rounded-tr-none"}`}>
                                  {text}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {drawerTab === "appointments" && (
                <div className="space-y-3">
                  {((apptsData?.data ?? []) as Appt[]).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No appointments</p>
                  ) : ((apptsData?.data ?? []) as Appt[]).map((a: Appt) => (
                    <div key={a.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-800">{fmtDateTime(a.appointment_date)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.status === "booked" ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-600"}`}>{a.status}</span>
                      </div>
                      <p className="text-xs text-gray-500">{a.appointment_type}</p>
                    </div>
                  ))}
                </div>
              )}

              {drawerTab === "messages" && (
                <div className="space-y-3">
                  {((smsData?.data ?? []) as SMS[]).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No messages sent</p>
                  ) : ((smsData?.data ?? []) as SMS[]).map((s: SMS) => (
                    <div key={s.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-600 capitalize">{s.sms_type?.replace("_", " ")}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${s.status === "sent" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>{s.status}</span>
                      </div>
                      <p className="text-xs text-gray-500 whitespace-pre-line">{s.message}</p>
                      <p className="text-xs text-gray-300 mt-1">{fmtRelative(s.sent_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
