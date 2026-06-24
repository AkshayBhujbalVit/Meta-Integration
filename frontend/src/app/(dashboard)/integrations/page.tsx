"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Share2, Search, Globe, Mail, ArrowRight,
  Zap, BarChart3, X, Copy, Check, Loader2,
  ExternalLink, ChevronRight, RefreshCw,
  CheckCircle2, XCircle, Users, Link2,
  Megaphone, Layers, PlusCircle,
} from "lucide-react";
import {
  getPlatformIntegrations,
  disconnectPlatformMeta,
  connectPlatformHubSpot,
  disconnectPlatformHubSpot,
  connectPlatformGoogle,
  disconnectPlatformGoogle,
  connectPlatformKlaviyo,
  disconnectPlatformKlaviyo,
  regeneratePlatformToken,
  setIntegrationPaused,
  syncMetaCampaigns,
  getMetaSyncedCampaigns,
  getMetaLeadForms,
  toggleMetaLeadForm,
  getClients,
  getCampaigns,
  startMetaOAuth,
  startHubSpotOAuth,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlatformStatus {
  source: string;
  connected: boolean;
  is_paused?: boolean;
  webhook_url: string | null;
  webhook_token: string | null;
  meta_page_id?: string;
  meta_page_name?: string;
  meta_ad_account_id?: string | null;
  meta_callback_url?: string;
  hubspot_portal_id?: string;
  google_customer_id?: string;
  klaviyo_account_id?: string;
}

interface MetaSyncedAdSet {
  id: string;
  name: string | null;
  status: string | null;
  synced_at: string | null;
}

interface MetaSyncedCampaignTree {
  id: string;
  name: string | null;
  status: string | null;
  objective: string | null;
  synced_at: string | null;
  adsets: MetaSyncedAdSet[];
}

interface MetaLeadFormRow {
  id: number;
  external_id: string;
  name: string | null;
  status: string | null;
  leads_count: number | null;
  ai_enabled: boolean;
  linked_campaign_id: number | null;
  synced_at: string | null;
}

interface IntegrationsMap {
  meta?: PlatformStatus;
  hubspot?: PlatformStatus;
  google?: PlatformStatus;
  klaviyo?: PlatformStatus;
  website?: PlatformStatus;
}

type PanelId = "meta_ads" | "hubspot" | "google_ads" | "klaviyo" | "website" | "linkedin_ads";

// ── Integration catalogue ─────────────────────────────────────────────────────

const INTEGRATIONS = [
  {
    id: "meta_ads" as PanelId, source: "meta",
    name: "Meta Ads", tagline: "Facebook & Instagram Lead Ads",
    description: "One-click connect via Facebook login. When a user fills your Lead Ad form, they land in your system instantly.",
    icon: Share2, gradient: "from-blue-500 to-blue-700",
    badge: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    configurable: true,
  },
  {
    id: "hubspot" as PanelId, source: "hubspot",
    name: "HubSpot CRM", tagline: "crm.contact.creation webhook",
    description: "Connect HubSpot with one click. Every new CRM contact fires a webhook — AI dials instantly.",
    icon: Globe, gradient: "from-orange-400 to-orange-600",
    badge: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    configurable: true,
  },
  {
    id: "google_ads" as PanelId, source: "google",
    name: "Google Ads", tagline: "Lead Form Asset webhook",
    description: "Paste your webhook URL into Google Ads → Lead Form Asset → Lead Delivery. No auth needed.",
    icon: Search, gradient: "from-red-400 to-red-600",
    badge: { label: "Ready", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
    configurable: true,
  },
  {
    id: "klaviyo" as PanelId, source: "klaviyo",
    name: "Klaviyo", tagline: "Subscribed to List · Filled Out Form",
    description: "Paste your Klaviyo Private API Key. Every new subscriber triggers an AI call.",
    icon: Mail, gradient: "from-purple-500 to-purple-700",
    badge: { label: "Ready", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
    configurable: true,
  },
  {
    id: "website" as PanelId, source: "website",
    name: "Website Forms", tagline: "Any contact form, any website",
    description: "For ads that click through to your own website instead of a native lead form. One webhook URL + a copy-paste snippet — works on any site.",
    icon: Globe, gradient: "from-teal-500 to-teal-700",
    badge: { label: "Ready", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
    configurable: true,
  },
  {
    id: "linkedin_ads" as PanelId, source: "linkedin",
    name: "LinkedIn Ads", tagline: "B2B Lead Gen Forms",
    description: "Import leads from LinkedIn Lead Gen Forms for high-intent B2B campaigns.",
    icon: Globe, gradient: "from-blue-600 to-blue-800",
    badge: { label: "Coming Soon", cls: "bg-gray-100 text-gray-500 ring-gray-200" },
    configurable: false,
  },
];

const FLOW = [
  { icon: Share2,    label: "Connect platforms",  desc: "Meta, HubSpot, Google, Klaviyo" },
  { icon: Users,     label: "Leads flow in",      desc: "Unified lead inbox" },
  { icon: Zap,       label: "AI calls instantly", desc: "Campaign agent dials" },
  { icon: BarChart3, label: "Track results",      desc: "Calls, bookings, conversion" },
];

// ── OAuth popup helper ────────────────────────────────────────────────────────

function useOAuthPopup(onSuccess: (data: Record<string, string>) => void) {
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const openPopup = useCallback((url: string) => {
    const w = 600, h = 700;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top  = Math.max(0, (window.screen.height - h) / 2);
    const popup = window.open(url, "oauth-popup", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      toast.error("Popup blocked — please allow popups for this site and try again.");
      return;
    }

    if (listenerRef.current) window.removeEventListener("message", listenerRef.current);
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "oauth-success") {
        window.removeEventListener("message", handler);
        onSuccess(e.data);
      }
      if (e.data?.type === "oauth-error") {
        window.removeEventListener("message", handler);
        toast.error(e.data.error || "OAuth failed");
      }
    };
    listenerRef.current = handler;
    window.addEventListener("message", handler);
  }, [onSuccess]);

  return openPopup;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  const { data, refetch } = useQuery<{ data: IntegrationsMap }>({
    queryKey: ["platform-integrations"],
    queryFn: () => getPlatformIntegrations() as unknown as Promise<{ data: IntegrationsMap }>,
  });
  const statuses: IntegrationsMap = data?.data ?? {};
  const active = INTEGRATIONS.find(i => i.id === activePanel);

  return (
    <div className="min-h-full bg-gray-50/60">
      <div className="max-w-6xl mx-auto p-6 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Integrations</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-xl">
            Connect your marketing platforms. Leads from Meta, HubSpot, Google Ads, and Klaviyo
            flow into one inbox — your AI agent calls them the moment they arrive.
          </p>
        </div>

        {/* How it works */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">How it works</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {FLOW.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-md shadow-blue-200">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="pt-1 flex-1">
                    <p className="text-sm font-bold text-gray-900">{step.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{step.desc}</p>
                  </div>
                  {i < FLOW.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-gray-200 shrink-0 mt-3 hidden lg:block" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((integration) => {
            const Icon = integration.icon;
            const status = statuses[integration.source as keyof IntegrationsMap];
            const connected = status?.connected ?? false;

            return (
              <div key={integration.id}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all
                  ${integration.configurable
                    ? "border-blue-100 hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5"
                    : "border-gray-100 opacity-70"}`}>
                <div className={`bg-gradient-to-br ${integration.gradient} p-5`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ring-1 ${integration.badge.cls}`}>
                        {integration.badge.label}
                      </span>
                      {connected && (
                        status?.is_paused ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/30 text-white">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
                            Paused
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-400/20 text-white">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                            Connected
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  <p className="text-base font-black text-white">{integration.name}</p>
                  <p className="text-xs text-white/60 mt-0.5">{integration.tagline}</p>
                </div>

                <div className="p-5">
                  <p className="text-xs text-gray-500 leading-relaxed mb-4">{integration.description}</p>
                  {integration.configurable ? (
                    <button
                      onClick={() => setActivePanel(integration.id)}
                      className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-2
                        ${connected
                          ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                          : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                    >
                      {connected
                        ? <><CheckCircle2 className="w-3.5 h-3.5" /> Manage</>
                        : <>Connect <ChevronRight className="w-3.5 h-3.5" /></>}
                    </button>
                  ) : (
                    <button disabled
                      className="w-full py-2.5 rounded-xl text-sm font-medium bg-gray-50 text-gray-400 border border-gray-100 cursor-not-allowed">
                      Coming Soon
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-400 text-center">
          More integrations on the way — contact{" "}
          <a href="mailto:dev@vidushiinfotech.com" className="text-blue-500 hover:underline font-medium">
            dev@vidushiinfotech.com
          </a>
        </p>
      </div>

      {/* Slide-over drawer */}
      {activePanel && active && (
        <ConfigDrawer
          integration={active}
          status={statuses[active.source as keyof IntegrationsMap] ?? null}
          onClose={() => setActivePanel(null)}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}

// ── Config drawer ─────────────────────────────────────────────────────────────

function ConfigDrawer({
  integration, status, onClose, onSaved,
}: {
  integration: typeof INTEGRATIONS[number];
  status: PlatformStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className={`bg-gradient-to-br ${integration.gradient} px-6 py-5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <integration.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-black text-white">{integration.name}</p>
                <p className="text-xs text-white/60">{integration.tagline}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {status?.connected && (
          <PauseToggle source={integration.source} isPaused={status.is_paused ?? false} onSaved={onSaved} />
        )}

        <div className="flex-1 overflow-y-auto">
          {integration.id === "meta_ads"   && <MetaPanel    status={status} onSaved={onSaved} />}
          {integration.id === "hubspot"    && <HubSpotPanel status={status} onSaved={onSaved} />}
          {integration.id === "google_ads" && <GooglePanel  status={status} onSaved={onSaved} />}
          {integration.id === "klaviyo"    && <KlaviyoPanel status={status} onSaved={onSaved} />}
          {integration.id === "website"    && <WebsitePanel status={status} onSaved={onSaved} />}
        </div>
      </div>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function PauseToggle({ source, isPaused, onSaved }: {
  source: string; isPaused: boolean; onSaved: () => void;
}) {
  const toggle = useMutation({
    mutationFn: (paused: boolean) => setIntegrationPaused(source, paused),
    onSuccess: (_res, paused) => {
      toast.success(paused ? "Integration paused — no new AI calls from this source" : "Integration resumed");
      onSaved();
    },
  });

  return (
    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
      <div>
        <p className="text-sm font-bold text-gray-900">{isPaused ? "Paused" : "Active"}</p>
        <p className="text-xs text-gray-400">
          {isPaused ? "Leads are saved, but AI calls are stopped" : "AI calls fire as leads arrive"}
        </p>
      </div>
      <div
        className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${isPaused ? "bg-gray-300" : "bg-emerald-500"} ${toggle.isPending ? "opacity-60" : ""}`}
        onClick={() => !toggle.isPending && toggle.mutate(!isPaused)}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isPaused ? "translate-x-0.5" : "translate-x-5"}`} />
      </div>
    </div>
  );
}

function WebhookURLBox({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
      <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5" /> {label}
      </p>
      <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-lg px-3 py-2">
        <code className="flex-1 text-xs text-gray-700 break-all">{url}</code>
        <button onClick={copy} className="shrink-0 p-1 rounded hover:bg-emerald-50 text-emerald-600">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function SecretInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600">{label}</label>
      <div className="mt-1 flex items-center border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-500 overflow-hidden">
        <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-3 py-2.5 text-sm bg-transparent focus:outline-none font-mono" />
        <button type="button" onClick={() => setShow(s => !s)} className="px-3 text-gray-400 hover:text-gray-600">
          {show ? <span className="text-xs">Hide</span> : <span className="text-xs">Show</span>}
        </button>
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, placeholder, optional }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; optional?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600">
        {label} {optional && <span className="font-normal text-gray-400">(optional)</span>}
      </label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function DisconnectButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="w-full py-2.5 border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
      {loading ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}

// ── Meta panel — one-click OAuth ──────────────────────────────────────────────

function MetaPanel({ status, onSaved }: { status: PlatformStatus | null; onSaved: () => void }) {
  const connected = status?.connected ?? false;
  const [oauthLoading, setOauthLoading] = useState(false);

  const disconnect = useMutation({
    mutationFn: disconnectPlatformMeta,
    onSuccess: () => { toast.success("Meta disconnected"); onSaved(); },
  });

  const openPopup = useOAuthPopup((data) => {
    toast.success(`Connected: ${data.page_name || data.page_id}`);
    onSaved();
  });

  async function handleConnect() {
    setOauthLoading(true);
    try {
      const res = await startMetaOAuth();
      const { url } = res.data as { url: string };
      openPopup(url);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Could not start Meta OAuth — check META_APP_ID in .env");
    } finally {
      setOauthLoading(false);
    }
  }

  const callbackUrl = status?.meta_callback_url
    ?? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8009"}/meta/webhook`;

  return (
    <div className="p-6 space-y-5">

      {/* Connected state */}
      {connected ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-emerald-800">Connected</p>
              <p className="text-xs text-emerald-600">{status?.meta_page_name || status?.meta_page_id}</p>
            </div>
          </div>
          <p className="text-xs text-emerald-700">
            Leads from Meta Lead Ads arrive automatically and trigger AI calls.
          </p>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-blue-900">Connect via Facebook</p>
          <p className="text-xs text-blue-700 leading-relaxed">
            Click the button below. A Facebook login window will open — log in, authorise the app, and select
            the page you run Lead Ads from. That&apos;s it. No token copy-pasting.
          </p>
          <p className="text-[10px] text-blue-500">
            Requires: <code className="bg-blue-100 px-1 rounded">META_APP_ID</code> and <code className="bg-blue-100 px-1 rounded">META_APP_SECRET</code> in your .env file.
          </p>
        </div>
      )}

      {connected && <MetaCampaignsSection />}
      {connected && <MetaLeadFormsSection />}

      {/* Connect / Reconnect button */}
      <button
        onClick={handleConnect}
        disabled={oauthLoading}
        className="w-full py-3 bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-3 transition-colors shadow-md shadow-blue-200"
      >
        {oauthLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Link2 className="w-4 h-4" />
        )}
        {oauthLoading ? "Opening Facebook…" : connected ? "Reconnect with Facebook" : "Connect with Facebook"}
      </button>

      {/* Webhook callback URL (for registering in Meta for Developers) */}
      <div className="pt-1">
        <p className="text-xs font-semibold text-gray-500 mb-2">
          After connecting, register this in Meta for Developers → Webhooks → leadgen:
        </p>
        <WebhookURLBox url={callbackUrl} label="Callback URL — paste into Meta Webhooks" />
      </div>

      {connected && (
        <DisconnectButton onClick={() => disconnect.mutate()} loading={disconnect.isPending} />
      )}

      <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-xs text-blue-600 hover:text-blue-700 font-medium">
        Open Meta Developer Console <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Meta — read-only mirror of Campaigns / Ad Sets ────────────────────────────

const META_STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PAUSED: "bg-gray-100 text-gray-500",
  ARCHIVED: "bg-gray-100 text-gray-400",
};

function MetaStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${META_STATUS_CLS[status] ?? "bg-gray-100 text-gray-500"}`}>
      {status}
    </span>
  );
}

function MetaCampaignsSection() {
  const { data, refetch, isFetching } = useQuery<{ data: { campaigns: MetaSyncedCampaignTree[] } }>({
    queryKey: ["meta-synced-campaigns"],
    queryFn: () => getMetaSyncedCampaigns() as unknown as Promise<{ data: { campaigns: MetaSyncedCampaignTree[] } }>,
  });
  const campaigns = data?.data.campaigns ?? [];

  const sync = useMutation({
    mutationFn: syncMetaCampaigns,
    onSuccess: (res: { data: { campaigns_synced: number; adsets_synced: number; ad_account_selected: boolean } }) => {
      const r = res.data;
      if (!r.ad_account_selected) {
        toast.warning("Lead forms synced — no ad account selected yet, so Campaigns/Ad Sets were skipped.");
      } else {
        toast.success(`Synced ${r.campaigns_synced} campaigns, ${r.adsets_synced} ad sets`);
      }
      refetch();
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Sync failed"),
  });

  return (
    <div className="border border-gray-100 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-gray-400" /> Your Meta Campaigns
        </p>
        <button onClick={() => sync.mutate()} disabled={sync.isPending}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {sync.isPending || isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Sync Campaigns
        </button>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing synced yet — click &quot;Sync Campaigns&quot; to pull from Meta.</p>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-gray-400" /> {c.name || c.id}
                </p>
                <MetaStatusBadge status={c.status} />
              </div>
              {c.adsets.length > 0 && (
                <div className="mt-2 ml-5 space-y-1 border-l border-gray-100 pl-3">
                  {c.adsets.map((a) => (
                    <div key={a.id} className="flex items-center justify-between">
                      <p className="text-xs text-gray-600">{a.name || a.id}</p>
                      <MetaStatusBadge status={a.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-3">
        Read-only — mirrors Meta Ads Manager. To turn AI calling on, use Lead Forms below.
      </p>
    </div>
  );
}

// ── Meta — Lead Forms with AI-enable toggle ───────────────────────────────────

function MetaLeadFormsSection() {
  const { data, refetch } = useQuery<{ data: { lead_forms: MetaLeadFormRow[] } }>({
    queryKey: ["meta-lead-forms"],
    queryFn: () => getMetaLeadForms() as unknown as Promise<{ data: { lead_forms: MetaLeadFormRow[] } }>,
  });
  const forms = data?.data.lead_forms ?? [];
  const [pickerFormId, setPickerFormId] = useState<number | null>(null);

  const toggle = useMutation({
    mutationFn: (vars: { id: number; body: Parameters<typeof toggleMetaLeadForm>[1] }) =>
      toggleMetaLeadForm(vars.id, vars.body),
    onSuccess: () => { refetch(); setPickerFormId(null); },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Could not update this lead form"),
  });

  function handleToggle(form: MetaLeadFormRow) {
    if (form.ai_enabled) {
      toggle.mutate({ id: form.id, body: { ai_enabled: false } });
    } else if (form.linked_campaign_id) {
      toggle.mutate({ id: form.id, body: { ai_enabled: true } });
    } else {
      setPickerFormId(form.id);
    }
  }

  return (
    <div className="border border-gray-100 rounded-2xl p-4">
      <p className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-gray-400" /> Your Lead Forms
      </p>

      {forms.length === 0 ? (
        <p className="text-xs text-gray-400">No lead forms synced yet — click &quot;Sync Campaigns&quot; above (it also pulls your Page&apos;s lead forms).</p>
      ) : (
        <div className="space-y-2">
          {forms.map((f) => (
            <div key={f.id}>
              <div className="flex items-center justify-between border border-gray-100 rounded-xl p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{f.name || f.external_id}</p>
                  <p className="text-[10px] text-gray-400">{f.leads_count ?? 0} leads on Meta</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {f.linked_campaign_id && (
                    <button
                      onClick={() => setPickerFormId(f.id)}
                      className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Change campaign
                    </button>
                  )}
                  <div
                    className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${f.ai_enabled ? "bg-blue-500" : "bg-gray-200"} ${toggle.isPending ? "opacity-60" : ""}`}
                    onClick={() => !toggle.isPending && handleToggle(f)}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${f.ai_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                </div>
              </div>
              {pickerFormId === f.id && (
                <LeadFormCampaignPicker
                  onCancel={() => setPickerFormId(null)}
                  onConfirm={(body) => toggle.mutate({ id: f.id, body: { ai_enabled: true, ...body } })}
                  loading={toggle.isPending}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadFormCampaignPicker({ onCancel, onConfirm, loading }: {
  onCancel: () => void;
  onConfirm: (body: { campaign_id?: number; create_campaign?: { client_id: number; name: string } }) => void;
  loading: boolean;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [clientId, setClientId] = useState<number | "">("");
  const [campaignId, setCampaignId] = useState<number | "">("");
  const [newName, setNewName] = useState("");

  const { data: clientsRes } = useQuery<{ data: Array<{ id: number; name: string }> }>({
    queryKey: ["clients-for-picker"],
    queryFn: () => getClients() as unknown as Promise<{ data: Array<{ id: number; name: string }> }>,
  });
  const clients = clientsRes?.data ?? [];

  const { data: campaignsRes } = useQuery<{ data: Array<{ id: number; name: string }> }>({
    queryKey: ["campaigns-for-picker", clientId],
    queryFn: () => getCampaigns(clientId ? { client_id: clientId } : undefined) as unknown as Promise<{ data: Array<{ id: number; name: string }> }>,
    enabled: mode === "existing",
  });
  const campaigns = campaignsRes?.data ?? [];

  function handleConfirm() {
    if (mode === "existing") {
      if (!campaignId) return toast.error("Pick a campaign");
      onConfirm({ campaign_id: campaignId as number });
    } else {
      if (!clientId || !newName.trim()) return toast.error("Pick a client and enter a campaign name");
      onConfirm({ create_campaign: { client_id: clientId as number, name: newName.trim() } });
    }
  }

  return (
    <div className="mt-2 ml-3 border border-blue-100 bg-blue-50/50 rounded-xl p-3 space-y-3">
      <p className="text-xs font-semibold text-blue-900">Link this form to a campaign to enable AI calling</p>
      <div className="flex gap-2 text-xs">
        <button onClick={() => setMode("existing")}
          className={`flex-1 py-1.5 rounded-lg font-semibold ${mode === "existing" ? "bg-blue-600 text-white" : "bg-white text-gray-500 border border-gray-200"}`}>
          Existing campaign
        </button>
        <button onClick={() => setMode("new")}
          className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 ${mode === "new" ? "bg-blue-600 text-white" : "bg-white text-gray-500 border border-gray-200"}`}>
          <PlusCircle className="w-3 h-3" /> New campaign
        </button>
      </div>

      <div>
        <label className="text-[10px] font-semibold text-gray-500">Client</label>
        <select value={clientId} onChange={(e) => { setClientId(e.target.value ? Number(e.target.value) : ""); setCampaignId(""); }}
          className="mt-1 w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Select a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {mode === "existing" ? (
        <div>
          <label className="text-[10px] font-semibold text-gray-500">Campaign</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}
            className="mt-1 w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Select a campaign…</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="text-[10px] font-semibold text-gray-500">New campaign name</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Summer Promo"
            className="mt-1 w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white" />
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-1.5 text-xs font-semibold text-gray-500 hover:bg-white rounded-lg">
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={loading}
          className="flex-1 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg flex items-center justify-center gap-1.5">
          {loading && <Loader2 className="w-3 h-3 animate-spin" />} Confirm
        </button>
      </div>
    </div>
  );
}

// ── HubSpot panel — one-click OAuth or manual token ───────────────────────────

function HubSpotPanel({ status, onSaved }: { status: PlatformStatus | null; onSaved: () => void }) {
  const connected = status?.connected ?? false;
  const [mode, setMode] = useState<"oauth" | "manual">("oauth");
  const [oauthLoading, setOauthLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [portalId, setPortalId] = useState(status?.hubspot_portal_id ?? "");
  const [secret, setSecret] = useState("");

  const save = useMutation({
    mutationFn: () => connectPlatformHubSpot({ portal_id: portalId || undefined, api_key: apiKey, client_secret: secret || undefined }),
    onSuccess: () => { toast.success("HubSpot connected!"); onSaved(); },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to connect HubSpot"),
  });

  const disconnect = useMutation({
    mutationFn: disconnectPlatformHubSpot,
    onSuccess: () => { toast.success("HubSpot disconnected"); onSaved(); },
  });

  const regen = useMutation({
    mutationFn: () => regeneratePlatformToken("hubspot"),
    onSuccess: () => { toast.success("Webhook URL regenerated"); onSaved(); },
  });

  const openPopup = useOAuthPopup((data) => {
    toast.success(`HubSpot portal ${data.portal_id} connected!`);
    onSaved();
  });

  async function handleOAuth() {
    setOauthLoading(true);
    try {
      const res = await startHubSpotOAuth();
      const { url } = res.data as { url: string };
      openPopup(url);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Could not start HubSpot OAuth — check HUBSPOT_CLIENT_ID in .env");
    } finally {
      setOauthLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-5">

      {connected && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="font-bold text-emerald-800 text-sm">Connected</p>
          </div>
          <p className="text-xs text-emerald-700">
            Portal ID: {status?.hubspot_portal_id || "—"} · New contacts trigger AI calls automatically.
          </p>
        </div>
      )}

      {connected && status?.webhook_url && (
        <WebhookURLBox url={status.webhook_url} label="Paste into HubSpot → Webhooks → contact.creation" />
      )}

      {/* Mode toggle */}
      <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
        <button onClick={() => setMode("oauth")}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors
            ${mode === "oauth" ? "bg-white shadow text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
          One-click OAuth
        </button>
        <button onClick={() => setMode("manual")}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors
            ${mode === "manual" ? "bg-white shadow text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
          Private App Token
        </button>
      </div>

      {mode === "oauth" ? (
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 text-xs text-orange-800 leading-relaxed space-y-1">
            <p className="font-semibold">Connect via HubSpot OAuth</p>
            <p>Click the button — a HubSpot login window opens, you authorise, done. No token copy-pasting.</p>
            <p className="text-orange-500">Requires <code className="bg-orange-100 px-1 rounded">HUBSPOT_CLIENT_ID</code> and <code className="bg-orange-100 px-1 rounded">HUBSPOT_CLIENT_SECRET</code> in .env</p>
          </div>
          <button
            onClick={handleOAuth}
            disabled={oauthLoading}
            className="w-full py-3 bg-[#FF7A59] hover:bg-[#f56b4a] disabled:opacity-60 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-3 transition-colors shadow-md shadow-orange-200"
          >
            {oauthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {oauthLoading ? "Opening HubSpot…" : connected ? "Reconnect with HubSpot" : "Connect with HubSpot"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
            <p className="font-semibold mb-1">HubSpot Private App Token</p>
            <p>Settings → Integrations → Private Apps → Create app → copy the access token.</p>
          </div>
          <FieldInput label="HubSpot Portal ID" value={portalId} onChange={setPortalId}
            placeholder="e.g. 12345678" optional />
          <SecretInput label="Private App Access Token *" value={apiKey} onChange={setApiKey}
            placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <SecretInput label="Client Secret (for webhook verification)" value={secret} onChange={setSecret}
            placeholder="From HubSpot App → Auth → Client secret" />
          <button onClick={() => save.mutate()} disabled={!apiKey || save.isPending}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {save.isPending ? "Connecting…" : connected ? "Update" : "Save & Get Webhook URL"}
          </button>
        </div>
      )}

      {connected && (
        <div className="flex gap-2">
          <button onClick={() => regen.mutate()} disabled={regen.isPending}
            className="flex-1 py-2 border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 rounded-xl flex items-center justify-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate URL
          </button>
          <DisconnectButton onClick={() => disconnect.mutate()} loading={disconnect.isPending} />
        </div>
      )}
    </div>
  );
}

// ── Google Ads panel — webhook URL only (no OAuth needed) ─────────────────────

function GooglePanel({ status, onSaved }: { status: PlatformStatus | null; onSaved: () => void }) {
  const connected = status?.connected ?? false;
  const [customerId, setCustomerId] = useState(status?.google_customer_id ?? "");

  const save = useMutation({
    mutationFn: () => connectPlatformGoogle({ customer_id: customerId || undefined }),
    onSuccess: () => { toast.success("Google Ads webhook URL generated!"); onSaved(); },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to configure Google Ads"),
  });

  const disconnect = useMutation({
    mutationFn: disconnectPlatformGoogle,
    onSuccess: () => { toast.success("Google Ads disconnected"); onSaved(); },
  });

  const regen = useMutation({
    mutationFn: () => regeneratePlatformToken("google"),
    onSuccess: () => { toast.success("Webhook URL regenerated"); onSaved(); },
  });

  return (
    <div className="p-6 space-y-5">

      <div className="bg-red-50 border border-red-100 rounded-2xl p-5 space-y-2">
        <p className="text-sm font-bold text-red-900">How Google Ads works</p>
        <ol className="text-xs text-red-800 space-y-1 list-decimal list-inside">
          <li>Click <strong>Generate Webhook URL</strong> below</li>
          <li>Copy the URL that appears</li>
          <li>In Google Ads: Assets → <strong>Lead Form</strong> → Lead Delivery → Webhook</li>
          <li>Paste the URL there — done</li>
        </ol>
        <p className="text-[10px] text-red-400">Google does not sign requests. Your unique URL token is your security — don&apos;t share it.</p>
      </div>

      {connected && status?.webhook_url && (
        <WebhookURLBox url={status.webhook_url} label="Paste into Google Ads → Lead Form → Webhook URL" />
      )}

      <FieldInput label="Google Ads Customer ID" value={customerId} onChange={setCustomerId}
        placeholder="e.g. 123-456-7890" optional />

      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
        {save.isPending ? "Generating…" : connected ? "Update & Regenerate" : "Generate Webhook URL"}
      </button>

      {connected && (
        <div className="flex gap-2">
          <button onClick={() => regen.mutate()} disabled={regen.isPending}
            className="flex-1 py-2 border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 rounded-xl flex items-center justify-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate URL
          </button>
          <DisconnectButton onClick={() => disconnect.mutate()} loading={disconnect.isPending} />
        </div>
      )}
    </div>
  );
}

// ── Website Forms panel — no auth, JS snippet + raw webhook URL ──────────────

function CodeSnippetBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative bg-gray-900 rounded-xl p-4">
      <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all pr-8">{code}</pre>
      <button onClick={copy} className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors">
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function WebsitePanel({ status, onSaved }: { status: PlatformStatus | null; onSaved: () => void }) {
  const connected = status?.connected ?? false;

  const generate = useMutation({
    mutationFn: () => regeneratePlatformToken("website"),
    onSuccess: () => { toast.success("Webhook URL generated!"); onSaved(); },
  });

  const regen = useMutation({
    mutationFn: () => regeneratePlatformToken("website"),
    onSuccess: () => { toast.success("Webhook URL regenerated"); onSaved(); },
  });

  const snippet = status?.webhook_url
    ? `<script src="${typeof window !== "undefined" ? window.location.origin : ""}/website-lead-embed.js"\n        data-webhook="${status.webhook_url}"\n        data-form-id="REPLACE_WITH_A_FORM_ID"></script>`
    : "";

  return (
    <div className="p-6 space-y-5">
      <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5 space-y-2">
        <p className="text-sm font-bold text-teal-900">For ads that link to your own website</p>
        <p className="text-xs text-teal-800 leading-relaxed">
          If a client&apos;s ad doesn&apos;t use Meta&apos;s or Google&apos;s native lead form and instead sends
          people to their website&apos;s contact form, use this instead. Works on any site — no backend required.
        </p>
      </div>

      {!connected ? (
        <button onClick={() => generate.mutate()} disabled={generate.isPending}
          className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {generate.isPending ? "Generating…" : "Generate Webhook URL"}
        </button>
      ) : (
        <>
          {status?.webhook_url && (
            <WebhookURLBox url={status.webhook_url} label="Webhook URL — for custom backends, Zapier, or Make" />
          )}

          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              Or paste this snippet on the page with the contact form:
            </p>
            <CodeSnippetBox code={snippet} />
            <p className="text-[10px] text-gray-400 mt-2">
              Replace <code className="bg-gray-100 px-1 rounded">REPLACE_WITH_A_FORM_ID</code> with the
              Website Form ID you set on that client&apos;s Campaign (Lead Source tab) — that&apos;s how a
              submission gets routed to the right campaign.
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-[10px] text-amber-700">
              If the website builder doesn&apos;t allow custom code (some no-code site builders don&apos;t),
              connect the form tool to Zapier or Make instead and point its webhook step at the URL above.
            </p>
          </div>

          <button onClick={() => regen.mutate()} disabled={regen.isPending}
            className="w-full py-2 border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 rounded-xl flex items-center justify-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate URL
          </button>
        </>
      )}
    </div>
  );
}

// ── Klaviyo panel ─────────────────────────────────────────────────────────────

function KlaviyoPanel({ status, onSaved }: { status: PlatformStatus | null; onSaved: () => void }) {
  const connected = status?.connected ?? false;
  const [accountId, setAccountId] = useState(status?.klaviyo_account_id ?? "");
  const [apiKey, setApiKey] = useState("");

  const save = useMutation({
    mutationFn: () => connectPlatformKlaviyo({ account_id: accountId || undefined, api_key: apiKey }),
    onSuccess: () => { toast.success("Klaviyo connected!"); onSaved(); },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to connect Klaviyo"),
  });

  const disconnect = useMutation({
    mutationFn: disconnectPlatformKlaviyo,
    onSuccess: () => { toast.success("Klaviyo disconnected"); onSaved(); },
  });

  const regen = useMutation({
    mutationFn: () => regeneratePlatformToken("klaviyo"),
    onSuccess: () => { toast.success("Webhook URL regenerated"); onSaved(); },
  });

  return (
    <div className="p-6 space-y-5">

      {connected && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="font-bold text-emerald-800 text-sm">Connected</p>
          </div>
          <p className="text-xs text-emerald-700">New Klaviyo subscribers trigger AI calls automatically.</p>
        </div>
      )}

      {connected && status?.webhook_url && (
        <WebhookURLBox url={status.webhook_url} label="Paste into Klaviyo → Integrations → Webhooks" />
      )}

      <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 text-xs text-purple-800 space-y-2">
        <p className="font-semibold">Where to find your Klaviyo API key</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Klaviyo → <strong>Account (top right) → Settings → API Keys</strong></li>
          <li>Click <strong>Create Private API Key</strong></li>
          <li>Scopes: <code className="bg-purple-100 px-1 rounded">profiles:read</code>, <code className="bg-purple-100 px-1 rounded">events:read</code></li>
          <li>Copy and paste below</li>
        </ol>
        <a href="https://www.klaviyo.com/account#api-keys-tab" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-purple-600 hover:text-purple-700 font-semibold mt-1">
          Open Klaviyo API Keys <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <FieldInput label="Klaviyo Account ID" value={accountId} onChange={setAccountId}
        placeholder="From Klaviyo → Account dropdown" optional />
      <SecretInput label="Private API Key *" value={apiKey} onChange={setApiKey}
        placeholder="pk_xxxxxxxxxxxxxxxx…" />

      <button onClick={() => save.mutate()} disabled={!apiKey || save.isPending}
        className="w-full py-3 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {save.isPending ? "Connecting…" : connected ? "Update Key" : "Save & Get Webhook URL"}
      </button>

      {connected && (
        <div className="flex gap-2">
          <button onClick={() => regen.mutate()} disabled={regen.isPending}
            className="flex-1 py-2 border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 rounded-xl flex items-center justify-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate URL
          </button>
          <DisconnectButton onClick={() => disconnect.mutate()} loading={disconnect.isPending} />
        </div>
      )}
    </div>
  );
}
