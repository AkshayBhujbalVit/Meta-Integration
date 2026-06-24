"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getClient, updateClient,
  getClientCallingConfig, updateClientCallingConfig,
  getClientSmsConfig, updateClientSmsConfig,
  getClientWhatsappConfig, updateClientWhatsappConfig,
  connectMetaPage,
} from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Save, Building2, Phone, MessageSquare,
  Smartphone, Share2, Megaphone, CheckCircle2, Eye, EyeOff,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

type Tab = "info" | "calling" | "sms" | "whatsapp" | "meta";

const MASKED = "••••••••••••";

function MaskedInput({
  value, onChange, placeholder, className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`pr-10 ${className ?? ""}`}
      />
      <button type="button" onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelCls = "block text-xs font-medium text-gray-600 mb-1.5";

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = Number(params.id);
  const [tab, setTab] = useState<Tab>("info");

  const { data, isLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => getClient(clientId),
    enabled: !isNaN(clientId),
  });

  const client = (data as any)?.data ?? {};

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  );

  const tabs: [Tab, typeof Building2, string][] = [
    ["info",     Building2,     "Company Info"],
    ["calling",  Phone,         "Calling"],
    ["sms",      MessageSquare, "SMS"],
    ["whatsapp", Smartphone,    "WhatsApp"],
    ["meta",     Share2,        "Meta Ads"],
  ];

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{client.name || "Client"}</h1>
          <p className="text-sm text-gray-500">{client.business_type ?? "Business"} · {client.city ?? ""}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/campaigns?client_id=${clientId}`}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition">
            <Megaphone className="w-4 h-4" /> View Campaigns
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(([key, Icon, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              tab === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "info"     && <InfoTab clientId={clientId} client={client} />}
      {tab === "calling"  && <CallingTab clientId={clientId} />}
      {tab === "sms"      && <SMSTab clientId={clientId} />}
      {tab === "whatsapp" && <WhatsAppTab clientId={clientId} />}
      {tab === "meta"     && <MetaTab clientId={clientId} client={client} />}
    </div>
  );
}

// ── Info Tab ──────────────────────────────────────────────────────────────────

function InfoTab({ clientId, client }: { clientId: number; client: Record<string, unknown> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string) => (form[k] ?? (client[k] as string) ?? "");

  const mut = useMutation({
    mutationFn: () => updateClient(clientId, form as Parameters<typeof updateClient>[1]),
    onSuccess: () => {
      toast.success("Client info saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: () => toast.error("Failed to save"),
  });

  const fields: [string, string][] = [
    ["name", "Company Name"],
    ["business_type", "Business Type"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["city", "City"],
    ["website", "Website"],
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {fields.map(([k, label]) => (
          <div key={k}>
            <label className={labelCls}>{label}</label>
            <input value={val(k)} onChange={(e) => set(k, e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>
      <div>
        <label className={labelCls}>Address</label>
        <textarea value={val("address")} onChange={(e) => set("address", e.target.value)} rows={2}
          className={`${inputCls} resize-none`} />
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea value={val("notes")} onChange={(e) => set("notes", e.target.value)} rows={3}
          className={`${inputCls} resize-none`} />
      </div>
      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
      </button>
    </div>
  );
}

// ── Calling Tab ───────────────────────────────────────────────────────────────

const CALLING_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "vobiz", label: "VoBiz" },
  { value: "livekit_sip", label: "LiveKit SIP" },
  { value: "custom", label: "Custom" },
];

function CallingTab({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["client-calling", clientId],
    queryFn: () => getClientCallingConfig(clientId),
  });
  const cfg = (data as any)?.data ?? {};
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string) => form[k] ?? (k === "auth_token" ? "" : (cfg[k] ?? ""));
  const provider = val("provider") || cfg.provider || "twilio";

  const mut = useMutation({
    mutationFn: () => updateClientCallingConfig(clientId, form as Parameters<typeof updateClientCallingConfig>[1]),
    onSuccess: () => {
      toast.success("Calling config saved");
      setDirty(false);
      setForm({});
      qc.invalidateQueries({ queryKey: ["client-calling", clientId] });
    },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Calling Provider</h3>
        <p className="text-xs text-gray-500 mb-4">Configure the outbound calling channel for this client.</p>

        <div className="grid grid-cols-4 gap-2 mb-5">
          {CALLING_PROVIDERS.map((p) => (
            <button key={p.value} onClick={() => set("provider", p.value)}
              className={`py-2 px-3 rounded-lg text-sm font-medium border transition ${
                (form.provider ?? cfg.provider ?? "twilio") === p.value
                  ? "bg-blue-50 border-blue-400 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              {provider === "twilio" ? "Account SID" : provider === "vobiz" ? "Auth ID" : "API Key"}
            </label>
            <input value={val("account_sid")} onChange={(e) => set("account_sid", e.target.value)}
              placeholder="Enter credential ID"
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              Auth Token {cfg.auth_token_set && <span className="text-green-600 font-normal">(saved)</span>}
            </label>
            <MaskedInput
              value={val("auth_token")}
              onChange={(v) => set("auth_token", v)}
              placeholder={cfg.auth_token_set ? MASKED : "Enter auth token"}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Caller Phone Number (E.164)</label>
            <input value={val("from_number")} onChange={(e) => set("from_number", e.target.value)}
              placeholder="+91XXXXXXXXXX"
              className={inputCls} />
          </div>
          {provider === "livekit_sip" && (
            <div>
              <label className={labelCls}>LiveKit SIP Trunk ID</label>
              <input value={val("sip_trunk_id")} onChange={(e) => set("sip_trunk_id", e.target.value)}
                placeholder="ST_xxxx"
                className={inputCls} />
            </div>
          )}
        </div>
      </div>

      {cfg.from_number && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Caller number configured: <span className="font-mono font-semibold">{cfg.from_number}</span>
        </div>
      )}

      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Calling Config
      </button>
    </div>
  );
}

// ── SMS Tab ───────────────────────────────────────────────────────────────────

const SMS_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "msg91", label: "MSG91" },
  { value: "textlocal", label: "Textlocal" },
  { value: "custom", label: "Custom" },
];

function SMSTab({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["client-sms", clientId],
    queryFn: () => getClientSmsConfig(clientId),
  });
  const cfg = (data as any)?.data ?? {};
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string) => form[k] ?? (k === "api_key" ? "" : (cfg[k] ?? ""));

  const mut = useMutation({
    mutationFn: () => updateClientSmsConfig(clientId, form as Parameters<typeof updateClientSmsConfig>[1]),
    onSuccess: () => {
      toast.success("SMS config saved");
      setDirty(false);
      setForm({});
      qc.invalidateQueries({ queryKey: ["client-sms", clientId] });
    },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">SMS Provider</h3>
        <p className="text-xs text-gray-500 mb-4">Used to send SMS follow-ups and OTPs to leads.</p>

        <div className="grid grid-cols-4 gap-2 mb-5">
          {SMS_PROVIDERS.map((p) => (
            <button key={p.value} onClick={() => set("provider", p.value)}
              className={`py-2 px-3 rounded-lg text-sm font-medium border transition ${
                (form.provider ?? cfg.provider ?? "twilio") === p.value
                  ? "bg-blue-50 border-blue-400 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              API Key {cfg.api_key_set && <span className="text-green-600 font-normal">(saved)</span>}
            </label>
            <MaskedInput
              value={val("api_key")}
              onChange={(v) => set("api_key", v)}
              placeholder={cfg.api_key_set ? MASKED : "Enter API key"}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>From Number / Sender ID</label>
            <input value={val("from_number") || val("sender_id")}
              onChange={(e) => {
                set("from_number", e.target.value);
                set("sender_id", e.target.value);
              }}
              placeholder="+91XXXXXXXXXX or VIINFO"
              className={inputCls} />
          </div>
        </div>
      </div>

      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save SMS Config
      </button>
    </div>
  );
}

// ── WhatsApp Tab ──────────────────────────────────────────────────────────────

const WA_PROVIDERS = [
  { value: "meta_cloud", label: "Meta Cloud API" },
  { value: "twilio", label: "Twilio" },
];

function WhatsAppTab({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["client-whatsapp", clientId],
    queryFn: () => getClientWhatsappConfig(clientId),
  });
  const cfg = (data as any)?.data ?? {};
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string) => form[k] ?? (k === "access_token" ? "" : (cfg[k] ?? ""));

  const mut = useMutation({
    mutationFn: () => updateClientWhatsappConfig(clientId, form as Parameters<typeof updateClientWhatsappConfig>[1]),
    onSuccess: () => {
      toast.success("WhatsApp config saved");
      setDirty(false);
      setForm({});
      qc.invalidateQueries({ queryKey: ["client-whatsapp", clientId] });
    },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">WhatsApp Business</h3>
        <p className="text-xs text-gray-500 mb-4">Send WhatsApp messages to leads via Meta Cloud API or Twilio.</p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          {WA_PROVIDERS.map((p) => (
            <button key={p.value} onClick={() => set("provider", p.value)}
              className={`py-2 px-3 rounded-lg text-sm font-medium border transition ${
                (form.provider ?? cfg.provider ?? "meta_cloud") === p.value
                  ? "bg-blue-50 border-blue-400 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Phone Number ID</label>
            <input value={val("phone_number_id")} onChange={(e) => set("phone_number_id", e.target.value)}
              placeholder="Meta Phone Number ID"
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              Access Token {cfg.access_token_set && <span className="text-green-600 font-normal">(saved)</span>}
            </label>
            <MaskedInput
              value={val("access_token")}
              onChange={(v) => set("access_token", v)}
              placeholder={cfg.access_token_set ? MASKED : "Enter access token"}
              className={inputCls}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Business Account ID (WABA ID)</label>
            <input value={val("business_account_id")} onChange={(e) => set("business_account_id", e.target.value)}
              placeholder="Meta Business Account ID"
              className={inputCls} />
          </div>
        </div>
      </div>

      {cfg.phone_number_id && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          WhatsApp configured: Phone ID <span className="font-mono font-semibold">{cfg.phone_number_id}</span>
        </div>
      )}

      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save WhatsApp Config
      </button>
    </div>
  );
}

// ── Meta Ads Tab ──────────────────────────────────────────────────────────────

function MetaTab({ clientId, client }: { clientId: number; client: Record<string, unknown> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ meta_page_id: "", meta_page_name: "", meta_access_token: "" });
  const [dirty, setDirty] = useState(false);

  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  const mut = useMutation({
    mutationFn: () => connectMetaPage(clientId, form),
    onSuccess: () => {
      toast.success("Meta page connected");
      setDirty(false);
      setForm((f) => ({ ...f, meta_access_token: "" }));
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: () => toast.error("Failed to connect Meta page"),
  });

  const connected = !!client.meta_page_id;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Meta Lead Ads</h3>
        <p className="text-xs text-gray-500 mb-4">
          Connect a Facebook Page so that leads from Meta Lead Ads forms are automatically routed to this client.
        </p>
      </div>

      {connected && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
          <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">{String(client.meta_page_name || client.meta_page_id)}</p>
            <p className="text-xs text-gray-500 font-mono">Page ID: {String(client.meta_page_id)}</p>
          </div>
          <a href={`https://facebook.com/${client.meta_page_id}`} target="_blank" rel="noopener"
            className="p-1.5 text-gray-400 hover:text-blue-600 transition">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      )}

      <div className="space-y-4">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          {connected ? "Update Connection" : "Connect Facebook Page"}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Facebook Page ID</label>
            <input value={form.meta_page_id || String(client.meta_page_id ?? "")}
              onChange={(e) => set("meta_page_id", e.target.value)}
              placeholder="e.g. 123456789012345"
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Page Name (optional)</label>
            <input value={form.meta_page_name || String(client.meta_page_name ?? "")}
              onChange={(e) => set("meta_page_name", e.target.value)}
              placeholder="My Business Page"
              className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>
              Page Access Token {connected && <span className="text-gray-400 font-normal">(leave blank to keep existing)</span>}
            </label>
            <MaskedInput
              value={form.meta_access_token}
              onChange={(v) => set("meta_access_token", v)}
              placeholder={connected ? "Enter new token to replace" : "EAAxxxxxxxxxxxxxxx"}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <button onClick={() => mut.mutate()}
        disabled={(!dirty && !form.meta_page_id) || mut.isPending}
        className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
        {connected ? "Update Meta Connection" : "Connect Meta Page"}
      </button>
    </div>
  );
}
