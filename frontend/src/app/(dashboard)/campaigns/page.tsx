"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getClients, getCampaigns, createCampaign, updateCampaign, deleteCampaign, startCampaignCalls } from "@/lib/api";
import { toast } from "sonner";
import {
  Megaphone, Plus, Pencil, Trash2, X, Loader2, AlertTriangle,
  Play, Pause, CheckCircle2, Phone, ChevronDown, ChevronUp,
  Share2, Search, Globe, Mail, Bot, Zap, Users,
} from "lucide-react";
import { fmtDateTime } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client { id: number; name: string; }

interface Campaign {
  id: number;
  client_id: number;
  name: string;
  description: string | null;
  status: string;
  agent_name: string | null;
  agent_prompt: string | null;
  language_default: string;
  agent_voice: string;
  call_start_time: string;
  call_end_time: string;
  max_retries: number;
  retry_gap_hours: number;
  caller_phone_number: string | null;
  lead_sources: string | null;
  meta_form_id: string | null;
  meta_form_name: string | null;
  hubspot_list_id: string | null;
  google_form_id: string | null;
  google_campaign_id: string | null;
  klaviyo_list_id: string | null;
  website_form_id: string | null;
  total_leads: number;
  calls_made: number;
  booked: number;
  is_active: boolean;
  created_at: string;
}

type LeadSourceType = "meta" | "hubspot" | "google" | "klaviyo" | "website" | "manual";

type CampaignForm = {
  client_id: string;
  name: string;
  description: string;
  agent_name: string;
  agent_prompt: string;
  language_default: string;
  agent_voice: string;
  call_start_time: string;
  call_end_time: string;
  max_retries: string;
  retry_gap_hours: string;
  caller_phone_number: string;
  // Lead source selection
  lead_source_type: LeadSourceType;
  // Meta
  meta_form_id: string;
  meta_form_name: string;
  // HubSpot
  hubspot_list_id: string;
  // Google
  google_form_id: string;
  google_campaign_id: string;
  // Klaviyo
  klaviyo_list_id: string;
  // Website Form
  website_form_id: string;
};

const EMPTY_FORM: CampaignForm = {
  client_id: "", name: "", description: "",
  agent_name: "AI Calling Assistant",
  agent_prompt: "",
  language_default: "hindi",
  agent_voice: "alloy",
  call_start_time: "09:00",
  call_end_time: "20:00",
  max_retries: "3",
  retry_gap_hours: "24",
  caller_phone_number: "",
  lead_source_type: "manual",
  meta_form_id: "",
  meta_form_name: "",
  hubspot_list_id: "",
  google_form_id: "",
  google_campaign_id: "",
  klaviyo_list_id: "",
  website_form_id: "",
};

const DEFAULT_PROMPT = `Aap {business_name} ki AI calling assistant hain.
Goal: Natural baat karke lead ki appointment book karna.

STYLE: Real conversation — script nahi. 1-2 sentences, phir RUKO aur suno.
Jo bole uspe react karo. Warm aur helpful.

LANGUAGE: Hindi mein shuru. 2+ sentences doosri bhasha mein aaye tab switch.

FLOW:
1. OPENING: "Namaste! Main {business_name} se call kar rahi hoon — kya main aapse baat kar sakti hoon?" → wait
2. Slot: check_specific_slot ya check_available_slots
3. book_appointment tool se confirm karo
4. Close: WhatsApp + SMS confirmation mention karo`;

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "bg-gray-100 text-gray-600" },
  active:    { label: "Active",    color: "bg-green-50 text-green-600" },
  paused:    { label: "Paused",    color: "bg-amber-50 text-amber-600" },
  completed: { label: "Completed", color: "bg-blue-50 text-blue-600" },
};

const VOICES = ["alloy", "echo", "onyx", "nova", "shimmer", "ash", "coral", "sage", "verse"];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const qc = useQueryClient();

  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [clientFilter, setClientFilter]     = useState<string>("");
  const [addOpen, setAddOpen]               = useState<boolean>(false);
  const [editTarget, setEditTarget]     = useState<Campaign | null>(null);
  const [editForm, setEditForm]         = useState<CampaignForm>(EMPTY_FORM);
  const [newForm, setNewForm]           = useState<CampaignForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [expandedId, setExpandedId]     = useState<number | null>(null);

  const { data: clientsData } = useQuery<{ data: Client[] }>({
    queryKey: ["clients"],
    queryFn: () => getClients() as unknown as Promise<{ data: Client[] }>,
  });
  const clients: Client[] = clientsData?.data ?? [];

  const { data, isLoading } = useQuery<{ data: Campaign[] }>({
    queryKey: ["campaigns", clientFilter],
    queryFn: () => getCampaigns(clientFilter ? { client_id: Number(clientFilter) } : undefined),
  });
  const campaigns: Campaign[] = data?.data ?? [];

  const clientMap = useMemo<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    clients.forEach((c: Client) => { m[c.id] = c.name; });
    return m;
  }, [clients]);

  // Detect campaign platform from specific IDs or lead_sources
  function campPlatform(c: Campaign): string {
    if (c.meta_form_id) return "meta";
    if (c.hubspot_list_id) return "hubspot";
    if (c.google_form_id || c.google_campaign_id) return "google";
    if (c.klaviyo_list_id) return "klaviyo";
    if (c.website_form_id) return "website";
    return "manual";
  }

  const PLATFORM_TABS = [
    { key: "all",     label: "All",        Icon: Megaphone },
    { key: "meta",    label: "Meta Ads",   Icon: Share2    },
    { key: "hubspot", label: "HubSpot",    Icon: Globe     },
    { key: "google",  label: "Google Ads", Icon: Search    },
    { key: "klaviyo", label: "Klaviyo",    Icon: Mail      },
    { key: "website", label: "Website",    Icon: Globe     },
    { key: "manual",  label: "Manual",     Icon: Zap       },
  ];

  const PLATFORM_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
    meta:    { bg: "bg-blue-50",   text: "text-[#1877F2]",  dot: "bg-[#1877F2]" },
    hubspot: { bg: "bg-orange-50", text: "text-orange-600", dot: "bg-orange-500" },
    google:  { bg: "bg-red-50",    text: "text-red-600",    dot: "bg-red-500"    },
    klaviyo: { bg: "bg-purple-50", text: "text-purple-600", dot: "bg-purple-500" },
    website: { bg: "bg-teal-50",   text: "text-teal-600",   dot: "bg-teal-500"   },
    manual:  { bg: "bg-gray-50",   text: "text-gray-500",   dot: "bg-gray-400"   },
  };

  const PLATFORM_ICON: Record<string, React.ElementType> = {
    meta: Share2, hubspot: Globe, google: Search, klaviyo: Mail, website: Globe, manual: Bot,
  };

  const filteredCampaigns = useMemo(() => {
    let list = campaigns;
    if (platformFilter !== "all") list = list.filter(c => campPlatform(c) === platformFilter);
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, platformFilter]);

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: () => createCampaign({
      client_id: Number(newForm.client_id),
      name: newForm.name,
      description: newForm.description || undefined,
      agent_name: newForm.agent_name,
      agent_prompt: newForm.agent_prompt,
      language_default: newForm.language_default,
      call_start_time: newForm.call_start_time,
      call_end_time: newForm.call_end_time,
      caller_phone_number: newForm.caller_phone_number || undefined,
      lead_sources: newForm.lead_source_type !== "manual" ? `${newForm.lead_source_type}_webhook` : undefined,
      meta_form_id: newForm.meta_form_id || undefined,
      meta_form_name: newForm.meta_form_name || undefined,
      hubspot_list_id: newForm.hubspot_list_id || undefined,
      google_form_id: newForm.google_form_id || undefined,
      google_campaign_id: newForm.google_campaign_id || undefined,
      klaviyo_list_id: newForm.klaviyo_list_id || undefined,
      website_form_id: newForm.website_form_id || undefined,
    }),
    onSuccess: () => {
      toast.success("Campaign created");
      setAddOpen(false);
      setNewForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["lead-filters"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to create campaign"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateCampaign(editTarget!.id, {
      name: editForm.name,
      description: editForm.description,
      agent_name: editForm.agent_name,
      agent_prompt: editForm.agent_prompt,
      language_default: editForm.language_default,
      agent_voice: editForm.agent_voice,
      call_start_time: editForm.call_start_time,
      call_end_time: editForm.call_end_time,
      max_retries: Number(editForm.max_retries),
      retry_gap_hours: Number(editForm.retry_gap_hours),
      caller_phone_number: editForm.caller_phone_number,
      lead_sources: editForm.lead_source_type !== "manual" ? `${editForm.lead_source_type}_webhook` : null,
      meta_form_id: editForm.meta_form_id || null,
      meta_form_name: editForm.meta_form_name || null,
      hubspot_list_id: editForm.hubspot_list_id || null,
      google_form_id: editForm.google_form_id || null,
      google_campaign_id: editForm.google_campaign_id || null,
      klaviyo_list_id: editForm.klaviyo_list_id || null,
      website_form_id: editForm.website_form_id || null,
    }),
    onSuccess: () => {
      toast.success("Campaign updated");
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: () => toast.error("Failed to update campaign"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      updateCampaign(id, { status }),
    onSuccess: () => {
      toast.success("Campaign status updated");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: () => toast.error("Failed to update status"),
  });

  const startCallsMutation = useMutation({
    mutationFn: (id: number) => startCampaignCalls(id),
    onSuccess: (res) => {
      const d = (res as { data?: { triggered?: number; queued?: number } }).data;
      toast.success(`Calls started — ${d?.triggered ?? 0} triggered, ${d?.queued ?? 0} queued`);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to start calls"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCampaign(deleteTarget!.id),
    onSuccess: () => {
      toast.success("Campaign deleted");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: () => toast.error("Failed to delete campaign"),
  });

  const openEdit = (c: Campaign) => {
    setEditForm({
      client_id: String(c.client_id),
      name: c.name || "",
      description: c.description || "",
      agent_name: c.agent_name || "AI Calling Assistant",
      agent_prompt: c.agent_prompt || "",
      language_default: c.language_default || "hindi",
      agent_voice: c.agent_voice || "alloy",
      call_start_time: c.call_start_time || "09:00",
      call_end_time: c.call_end_time || "20:00",
      max_retries: String(c.max_retries ?? 3),
      retry_gap_hours: String(c.retry_gap_hours ?? 24),
      caller_phone_number: c.caller_phone_number || "",
      lead_source_type: campPlatform(c) as LeadSourceType,
      meta_form_id: c.meta_form_id || "",
      meta_form_name: c.meta_form_name || "",
      hubspot_list_id: c.hubspot_list_id || "",
      google_form_id: c.google_form_id || "",
      google_campaign_id: c.google_campaign_id || "",
      klaviyo_list_id: c.klaviyo_list_id || "",
      website_form_id: c.website_form_id || "",
    });
    setEditTarget(c);
  };

  return (
    <div className="min-h-full bg-gray-50/60">
      <div className="max-w-6xl mx-auto p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Campaigns</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {filteredCampaigns.length} of {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
            {platformFilter !== "all" && ` · filtered by ${platformFilter}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">All Clients</option>
            {clients.map((c: Client) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition shadow-sm">
            <Plus className="w-4 h-4" /> New Campaign
          </button>
        </div>
      </div>

      {/* Platform filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {PLATFORM_TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setPlatformFilter(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              platformFilter === key
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-white border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600"
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
            {key !== "all" && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${platformFilter === key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-400"}`}>
                {campaigns.filter(c => campPlatform(c) === key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* AI agent info banner */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-700 rounded-2xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">AI Agent lives inside each Campaign</p>
          <p className="text-xs text-purple-200 mt-0.5">
            Click <strong>Edit</strong> on any campaign → <strong>Agent tab</strong> to set the prompt, voice, and language.
            Click <strong>▶ Launch</strong> to start AI calling all leads in that campaign.
          </p>
        </div>
        <a href="/calls" className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg transition">
          View Call Activity →
        </a>
      </div>

      {/* Campaign Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
          <Megaphone className="w-10 h-10 mx-auto mb-3 text-gray-100" />
          <p className="text-sm font-semibold text-gray-400">No campaigns {platformFilter !== "all" ? `for ${platformFilter}` : "yet"}</p>
          {platformFilter !== "all" && (
            <button onClick={() => setPlatformFilter("all")} className="mt-2 text-xs text-blue-600 hover:underline">Show all campaigns</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCampaigns.map((campaign: Campaign) => {
            const sc = STATUS_CONFIG[campaign.status] ?? { label: campaign.status, color: "bg-gray-100 text-gray-600" };
            const isExpanded = expandedId === campaign.id;
            const convRate = campaign.total_leads > 0 ? Math.round((campaign.booked / campaign.total_leads) * 100) : 0;
            const plat = campPlatform(campaign);
            const ps = PLATFORM_STYLE[plat] ?? PLATFORM_STYLE.manual;
            const PlatIcon = PLATFORM_ICON[plat] ?? Megaphone;
            const hasAgent = !!campaign.agent_prompt;

            return (
              <div key={campaign.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:border-blue-100 transition-colors">
                {/* Campaign row */}
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Platform badge */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${ps.bg} shrink-0`}>
                    <PlatIcon className={`w-3.5 h-3.5 ${ps.text}`} />
                    <span className={`text-[10px] font-bold capitalize ${ps.text}`}>{plat === "meta" ? "Meta" : plat === "google" ? "Google" : plat}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-gray-900 text-sm">{campaign.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sc.color}`}>{sc.label}</span>
                      {hasAgent && (
                        <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-violet-50 text-violet-600">
                          <Bot className="w-2.5 h-2.5" /> Agent set
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {clientMap[campaign.client_id] || `Client #${campaign.client_id}`}
                      {campaign.meta_form_id && (
                        <span className="ml-2 text-blue-400">· {campaign.meta_form_name || campaign.meta_form_id}</span>
                      )}
                      {campaign.caller_phone_number && (
                        <span className="ml-2 inline-flex items-center gap-0.5">
                          <Phone className="w-2.5 h-2.5" /> {campaign.caller_phone_number}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="hidden md:flex items-center gap-5 text-center shrink-0">
                    {[
                      { label: "Leads",  value: campaign.total_leads },
                      { label: "Called", value: campaign.calls_made  },
                      { label: "Booked", value: campaign.booked      },
                      { label: "Conv",   value: `${convRate}%`       },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className={`text-sm font-black ${label === "Booked" && campaign.booked > 0 ? "text-emerald-600" : "text-gray-800"}`}>{value}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(campaign.status === "draft" || campaign.status === "paused") && (
                      <button onClick={() => startCallsMutation.mutate(campaign.id)}
                        disabled={startCallsMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white rounded-xl transition shadow-sm disabled:opacity-50">
                        {startCallsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Launch AI Calls
                      </button>
                    )}
                    {campaign.status === "active" && (
                      <button onClick={() => statusMutation.mutate({ id: campaign.id, status: "paused" })}
                        disabled={statusMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition disabled:opacity-50">
                        <Pause className="w-3 h-3" /> Pause
                      </button>
                    )}
                    {campaign.status === "active" && (
                      <button onClick={() => statusMutation.mutate({ id: campaign.id, status: "completed" })}
                        disabled={statusMutation.isPending}
                        className="p-1.5 rounded-xl hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors" title="Mark done">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => openEdit(campaign)}
                      className="p-1.5 rounded-xl hover:bg-violet-50 text-gray-400 hover:text-violet-600 transition-colors" title="Edit agent & settings">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteTarget(campaign)}
                      className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setExpandedId(isExpanded ? null : campaign.id)}
                      className="p-1.5 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                {campaign.total_leads > 0 && (
                  <div className="h-0.5 bg-gray-50 mx-5 mb-0">
                    <div className="h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                      style={{ width: `${Math.round((campaign.calls_made / campaign.total_leads) * 100)}%` }} />
                  </div>
                )}

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-gray-50 bg-gray-50/40 p-5">
                    {/* AI Agent section */}
                    <div className="bg-white rounded-xl border border-violet-100 p-4 mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Bot className="w-4 h-4 text-violet-600" />
                        <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">AI Agent Configuration</p>
                        <button onClick={() => openEdit(campaign)}
                          className="ml-auto text-[10px] font-semibold text-violet-600 hover:text-violet-700 border border-violet-200 px-2 py-0.5 rounded-lg hover:bg-violet-50 transition-colors">
                          Edit Agent →
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                        <div>
                          <p className="text-gray-400 mb-0.5">Agent Name</p>
                          <p className="font-semibold text-gray-800">{campaign.agent_name || "Not set"}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 mb-0.5">Language</p>
                          <p className="font-semibold text-gray-800 capitalize">{campaign.language_default}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 mb-0.5">Call Window</p>
                          <p className="font-semibold text-gray-800">{campaign.call_start_time} – {campaign.call_end_time}</p>
                        </div>
                      </div>
                      {campaign.agent_prompt ? (
                        <pre className="text-[11px] text-gray-600 whitespace-pre-wrap font-sans leading-relaxed line-clamp-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                          {campaign.agent_prompt.slice(0, 300)}{campaign.agent_prompt.length > 300 ? "…" : ""}
                        </pre>
                      ) : (
                        <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700 flex items-center gap-2">
                          <span className="text-amber-500">⚠</span>
                          No agent prompt set — click <strong>Edit Agent →</strong> above to configure the AI script.
                        </div>
                      )}
                    </div>

                    {/* Meta + other details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-gray-400 mb-0.5">Max Retries</p>
                        <p className="font-semibold text-gray-800">{campaign.max_retries}× every {campaign.retry_gap_hours}h</p>
                      </div>
                      {campaign.meta_form_id && (
                        <div className="col-span-2">
                          <p className="text-gray-400 mb-0.5">Meta Form Linked</p>
                          <p className="font-semibold text-blue-700">{campaign.meta_form_name || campaign.meta_form_id}</p>
                        </div>
                      )}
                      {campaign.description && (
                        <div className="col-span-2 md:col-span-4">
                          <p className="text-gray-400 mb-0.5">Description</p>
                          <p className="text-gray-700 leading-relaxed">{campaign.description}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-gray-400 mb-0.5">Created</p>
                        <p className="font-semibold text-gray-800">{fmtDateTime(campaign.created_at)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Campaign Modal */}
      {addOpen && (
        <CampaignFormModal
          title="New Campaign"
          form={newForm}
          setForm={setNewForm}
          clients={clients}
          onSubmit={() => createMutation.mutate()}
          onClose={() => { setAddOpen(false); setNewForm(EMPTY_FORM); }}
          isPending={createMutation.isPending}
          submitLabel="Create Campaign"
        />
      )}

      {/* Edit Campaign Modal */}
      {editTarget && (
        <CampaignFormModal
          title={`Edit — ${editTarget.name}`}
          form={editForm}
          setForm={setEditForm}
          clients={clients}
          onSubmit={() => updateMutation.mutate()}
          onClose={() => setEditTarget(null)}
          isPending={updateMutation.isPending}
          submitLabel="Save Changes"
          lockClient
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1">Delete Campaign</h3>
            <p className="text-sm text-gray-500 mb-1">Delete <span className="font-semibold">{deleteTarget.name}</span>?</p>
            <p className="text-xs text-red-400 mb-6">Leads assigned to this campaign will be unassigned.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ── Campaign form modal ───────────────────────────────────────────────────────

function CampaignFormModal({
  title, form, setForm, clients, onSubmit, onClose, isPending, submitLabel, lockClient,
}: {
  title: string;
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  clients: Client[];
  onSubmit: () => void;
  onClose: () => void;
  isPending: boolean;
  submitLabel: string;
  lockClient?: boolean;
}) {
  const [tab, setTab] = useState<"basic" | "source" | "agent" | "schedule">("basic");

  // Auto-fill campaign name when client is selected (only if name is empty)
  useEffect(() => {
    if (!form.client_id || form.name) return;
    const client = clients.find(c => String(c.id) === form.client_id);
    if (client) {
      const month = new Date().toLocaleString("en-US", { month: "short" });
      setForm(p => ({ ...p, name: `${client.name} — ${month} Campaign` }));
    }
  }, [form.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const TABS = [
    { key: "basic",    label: "1. Basics"      },
    { key: "source",   label: "2. Lead Source" },
    { key: "agent",    label: "3. AI Agent"    },
    { key: "schedule", label: "4. Schedule"    },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure step by step — click each tab</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-gray-100 bg-gray-50/50">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 px-3 py-3 text-xs font-semibold transition-all border-b-2 ${
                tab === t.key
                  ? "border-blue-600 text-blue-600 bg-white"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* ── Tab 1: Basics ── */}
          {tab === "basic" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Client *</label>
                <select value={form.client_id}
                  onChange={e => setForm(p => ({ ...p, client_id: e.target.value, name: "" }))}
                  disabled={lockClient}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60">
                  <option value="">Select client…</option>
                  {clients.map((c: Client) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Campaign Name *
                  <span className="text-gray-400 font-normal ml-1">(auto-filled from client, you can edit)</span>
                </label>
                <input value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Vidushi — June Campaign"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What leads is this campaign targeting?"
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Caller Phone Number
                  <span className="text-gray-400 font-normal ml-1">(the number leads see on their screen)</span>
                </label>
                <input value={form.caller_phone_number}
                  onChange={e => setForm(p => ({ ...p, caller_phone_number: e.target.value }))}
                  placeholder="+91XXXXXXXXXX"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 leading-relaxed">
                <strong>Next:</strong> Go to <strong>Lead Source</strong> tab to connect where leads come from (Meta, Google, or manual).
              </div>
            </>
          )}

          {/* ── Tab 2: Lead Source ── */}
          {tab === "source" && (
            <>
              <p className="text-sm font-bold text-gray-900 mb-1">Where do leads come from?</p>
              <p className="text-xs text-gray-400 mb-4">
                Pick the platform. Leads matching the ID you enter below will automatically flow into this campaign and the AI will call them.
              </p>

              <div className="grid grid-cols-1 gap-3">

                {/* ── Meta Ads ── */}
                <SourceCard
                  active={form.lead_source_type === "meta"}
                  color="bg-[#1877F2]"
                  icon={<Share2 className="w-4 h-4 text-white" />}
                  title="Meta Ads (Facebook & Instagram)"
                  subtitle="Leads who fill your Lead Ad form → arrive here instantly"
                  onClick={() => setForm(p => ({ ...p, lead_source_type: "meta" }))}
                  activeColor="border-blue-500 bg-blue-50"
                >
                  <div className="mt-3 pt-3 border-t border-blue-100 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Meta Lead Form ID <span className="text-gray-400 font-normal">— links this campaign to ONE specific form</span>
                      </label>
                      <input value={form.meta_form_id} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, meta_form_id: e.target.value }))}
                        placeholder="e.g. 1234567890123456"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono bg-white" />
                      <p className="text-[10px] text-gray-400 mt-1">Meta Ads Manager → Instant Forms → your form → Form ID</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Form Label <span className="text-gray-400 font-normal">(optional)</span></label>
                      <input value={form.meta_form_name} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, meta_form_name: e.target.value }))}
                        placeholder='e.g. "June Consultation Form"'
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                    </div>
                  </div>
                </SourceCard>

                {/* ── HubSpot ── */}
                <SourceCard
                  active={form.lead_source_type === "hubspot"}
                  color="bg-orange-500"
                  icon={<Globe className="w-4 h-4 text-white" />}
                  title="HubSpot CRM"
                  subtitle="New contacts from a HubSpot list/workflow → auto-called"
                  onClick={() => setForm(p => ({ ...p, lead_source_type: "hubspot" }))}
                  activeColor="border-orange-400 bg-orange-50"
                >
                  <div className="mt-3 pt-3 border-t border-orange-100 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        HubSpot List ID <span className="text-gray-400 font-normal">— routes leads from a specific list</span>
                      </label>
                      <input value={form.hubspot_list_id} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, hubspot_list_id: e.target.value }))}
                        placeholder="e.g. 123 (from HubSpot list URL)"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono bg-white" />
                      <p className="text-[10px] text-gray-400 mt-1">HubSpot → Contacts → Lists → open list → ID in URL</p>
                    </div>
                  </div>
                </SourceCard>

                {/* ── Google Ads ── */}
                <SourceCard
                  active={form.lead_source_type === "google"}
                  color="bg-[#EA4335]"
                  icon={<Search className="w-4 h-4 text-white" />}
                  title="Google Ads"
                  subtitle="Lead Form Asset submissions → arrive here via webhook"
                  onClick={() => setForm(p => ({ ...p, lead_source_type: "google" }))}
                  activeColor="border-red-400 bg-red-50"
                >
                  <div className="mt-3 pt-3 border-t border-red-100 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Google Form ID <span className="text-gray-400 font-normal">— from your Lead Form Asset</span>
                      </label>
                      <input value={form.google_form_id} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, google_form_id: e.target.value }))}
                        placeholder="e.g. 12345678"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 font-mono bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Google Campaign ID <span className="text-gray-400 font-normal">(optional fallback)</span>
                      </label>
                      <input value={form.google_campaign_id} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, google_campaign_id: e.target.value }))}
                        placeholder="e.g. 987654321"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 font-mono bg-white" />
                      <p className="text-[10px] text-gray-400 mt-1">Google Ads → Campaigns → click campaign → ID in URL</p>
                    </div>
                  </div>
                </SourceCard>

                {/* ── Klaviyo ── */}
                <SourceCard
                  active={form.lead_source_type === "klaviyo"}
                  color="bg-purple-600"
                  icon={<Mail className="w-4 h-4 text-white" />}
                  title="Klaviyo"
                  subtitle="New list subscribers or form fills → auto-called"
                  onClick={() => setForm(p => ({ ...p, lead_source_type: "klaviyo" }))}
                  activeColor="border-purple-500 bg-purple-50"
                >
                  <div className="mt-3 pt-3 border-t border-purple-100 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Klaviyo List ID or Name <span className="text-gray-400 font-normal">— matches incoming webhook event</span>
                      </label>
                      <input value={form.klaviyo_list_id} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, klaviyo_list_id: e.target.value }))}
                        placeholder='e.g. "June Leads List" or XYZ123'
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono bg-white" />
                      <p className="text-[10px] text-gray-400 mt-1">Klaviyo → Lists → your list → name shown in webhook payload</p>
                    </div>
                  </div>
                </SourceCard>

                {/* ── Website Form ── */}
                <SourceCard
                  active={form.lead_source_type === "website"}
                  color="bg-teal-600"
                  icon={<Globe className="w-4 h-4 text-white" />}
                  title="Website Form"
                  subtitle="For ads that link to your own website instead of a native lead form"
                  onClick={() => setForm(p => ({ ...p, lead_source_type: "website" }))}
                  activeColor="border-teal-500 bg-teal-50"
                >
                  <div className="mt-3 pt-3 border-t border-teal-100 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Website Form ID <span className="text-gray-400 font-normal">— matches the data-form-id in the embed snippet</span>
                      </label>
                      <input value={form.website_form_id} onClick={e => e.stopPropagation()}
                        onChange={e => setForm(p => ({ ...p, website_form_id: e.target.value }))}
                        placeholder='e.g. "contact-us" — any unique label you choose'
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono bg-white" />
                      <p className="text-[10px] text-gray-400 mt-1">
                        Integrations → Website Forms → copy the embed snippet, paste this same ID into its data-form-id attribute
                      </p>
                    </div>
                  </div>
                </SourceCard>

                {/* ── Manual ── */}
                <SourceCard
                  active={form.lead_source_type === "manual"}
                  color="bg-gray-500"
                  icon={<Users className="w-4 h-4 text-white" />}
                  title="Manual / CSV Import"
                  subtitle="Add leads manually or upload a CSV — no platform linking"
                  onClick={() => setForm(p => ({ ...p, lead_source_type: "manual", meta_form_id: "", hubspot_list_id: "", google_form_id: "", google_campaign_id: "", klaviyo_list_id: "", website_form_id: "" }))}
                  activeColor="border-gray-400 bg-gray-50"
                />
              </div>
            </>
          )}

          {/* ── Tab 3: AI Agent ── */}
          {tab === "agent" && (
            <>
              <div className="bg-violet-50 rounded-xl p-3 text-xs text-violet-700 leading-relaxed mb-2">
                <strong>This is your AI calling script.</strong> The agent will follow this prompt when calling leads.
                Use <code className="bg-violet-100 px-1 rounded">{"{business_name}"}</code> and <code className="bg-violet-100 px-1 rounded">{"{first_name}"}</code> as placeholders.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Agent Name</label>
                  <input value={form.agent_name}
                    onChange={e => setForm(p => ({ ...p, agent_name: e.target.value }))}
                    placeholder="AI Calling Assistant"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Language</label>
                  <select value={form.language_default}
                    onChange={e => setForm(p => ({ ...p, language_default: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    {["hindi","english","marathi","gujarati","tamil","telugu","kannada","bengali"].map(l => (
                      <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Voice</label>
                  <select value={form.agent_voice}
                    onChange={e => setForm(p => ({ ...p, agent_voice: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-700">AI Script / System Prompt</label>
                  <button type="button"
                    onClick={() => setForm(p => ({ ...p, agent_prompt: DEFAULT_PROMPT }))}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    Load default template
                  </button>
                </div>
                <textarea value={form.agent_prompt}
                  onChange={e => setForm(p => ({ ...p, agent_prompt: e.target.value }))}
                  placeholder={`Write what the AI should say and do when calling leads.\n\nExample:\n"Aap {business_name} ki AI calling assistant hain. {first_name} ji ko call karke unki inquiry ke baare mein poochho aur appointment book karo."`}
                  rows={12}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-xs leading-relaxed"
                />
              </div>
            </>
          )}

          {/* ── Tab 4: Schedule ── */}
          {tab === "schedule" && (
            <>
              <p className="text-xs text-gray-400 mb-1">The AI agent only calls during these hours, and retries if there is no answer.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Call Start Time</label>
                  <input type="time" value={form.call_start_time}
                    onChange={e => setForm(p => ({ ...p, call_start_time: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Call End Time</label>
                  <input type="time" value={form.call_end_time}
                    onChange={e => setForm(p => ({ ...p, call_end_time: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Max Retries <span className="text-gray-400 font-normal">(if no answer)</span></label>
                  <input type="number" min={1} max={10} value={form.max_retries}
                    onChange={e => setForm(p => ({ ...p, max_retries: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Wait Between Retries <span className="text-gray-400 font-normal">(hours)</span></label>
                  <input type="number" min={1} value={form.retry_gap_hours}
                    onChange={e => setForm(p => ({ ...p, retry_gap_hours: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="p-4 bg-blue-50 rounded-xl text-xs text-blue-700 leading-relaxed">
                AI calls between <strong>{form.call_start_time}</strong> – <strong>{form.call_end_time}</strong>.
                If no answer, retries up to <strong>{form.max_retries} times</strong>, waiting <strong>{form.retry_gap_hours} hours</strong> each time.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-white transition">
            Cancel
          </button>
          <button onClick={onSubmit}
            disabled={!form.client_id || !form.name || isPending}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition shadow-sm">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SourceCard ────────────────────────────────────────────────────────────────

function SourceCard({
  active, color, icon, title, subtitle, onClick, activeColor, children,
}: {
  active: boolean;
  color: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  activeColor: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${
        active ? activeColor : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl ${color} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        {active && <CheckCircle2 className="w-5 h-5 text-gray-600 shrink-0" />}
      </div>
      {active && children}
    </div>
  );
}
