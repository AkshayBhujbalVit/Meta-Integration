"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getClinicSettings, updateClinicSettings,
  getCallingConfig, updateCallingConfig,
  getCallingCredentials, updateCallingCredentials, activateProvider,
  getMessagingConfig, updateMessagingConfig,
  getCalendarConfig, updateCalendarConfig, testCalendarConnection, testCalDavConnection,
  getMe, getClient, updateClient, uploadClientLogo,
} from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Save, Building2, Phone, MessageSquare, Smartphone, CalendarDays, CheckCircle2, XCircle, FlaskConical, KeyRound, Database, Trash2, ImagePlus } from "lucide-react";
import { api } from "@/lib/api";

type Tab = "clinic" | "calling" | "sms" | "whatsapp" | "calendar" | "developer";


export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("clinic");

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Configure company info, calling, SMS, WhatsApp, and calendar</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {([
          ["clinic",   Building2,    "Company"],
          ["calling",  Phone,        "Calling"],
          ["sms",      MessageSquare, "SMS"],
          ["whatsapp", Smartphone,   "WhatsApp"],
          ["calendar",   CalendarDays, "Calendar"],
          ["developer",  FlaskConical, "Developer"],
        ] as [Tab, React.ComponentType<{ className?: string }>, string][]).map(([key, Icon, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "clinic"     && <ClinicTab />}
      {tab === "calling"    && <CallingTab />}
      {tab === "sms"        && <SMSTab />}
      {tab === "whatsapp"   && <WhatsAppTab />}
      {tab === "calendar"   && <CalendarTab />}
      {tab === "developer"  && <DeveloperTab />}
    </div>
  );
}

// ── Developer Tab ─────────────────────────────────────────────────────────────

function DeveloperTab() {
  const [seedLoading, setSeedLoading]   = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [result, setResult]             = useState<string | null>(null);

  const runSeed = async () => {
    setSeedLoading(true);
    setResult(null);
    try {
      const res = await api.post("/dev/seed-test-data");
      const d = res.data;
      setResult(`✅ Inserted ${d.leads_created} leads, ${d.call_logs_created} call logs, appointment: ${d.appointment_created}. Skipped: ${d.leads_skipped}.`);
      toast.success(`Demo data loaded — ${d.leads_created} leads inserted`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      const msg = err.response?.data?.detail || "Failed to load demo data";
      setResult(`❌ ${msg}`);
      toast.error(msg);
    } finally {
      setSeedLoading(false);
    }
  };

  const clearSeed = async () => {
    setClearLoading(true);
    setResult(null);
    try {
      const res = await api.delete("/dev/seed-test-data");
      setResult(`🗑️ Removed ${res.data.removed_leads} demo leads and their related data.`);
      toast.success("Demo data cleared");
    } catch {
      toast.error("Failed to clear demo data");
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
        <p className="font-bold mb-1">Developer Tools</p>
        <p className="text-xs">Use these to populate the app with realistic demo data for testing. All demo records are clearly tagged and can be removed at any time.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-500" /> Demo Data
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Inserts 2 test leads per platform (Meta, HubSpot, Google, Klaviyo), sample call logs, and 1 appointment.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={runSeed}
            disabled={seedLoading || clearLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition"
          >
            {seedLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {seedLoading ? "Loading…" : "Load Demo Data"}
          </button>
          <button
            onClick={clearSeed}
            disabled={seedLoading || clearLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 text-sm font-semibold rounded-xl transition"
          >
            {clearLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {clearLoading ? "Clearing…" : "Clear Demo Data"}
          </button>
        </div>

        {result && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Branding Card (per-tenant logo + business name) ────────────────────────────
// Only shown for a doctor's own tenant login (admin.client_id set) — Vidushi
// super-admins manage many clients and have no single business to brand.

function BrandingCard() {
  const qc = useQueryClient();
  const { data: meData } = useQuery({ queryKey: ["auth-me"], queryFn: getMe });
  const clientId = meData?.data?.client_id as number | undefined;

  const { data: clientData, isLoading } = useQuery({
    queryKey: ["settings-client", clientId],
    queryFn: () => getClient(clientId as number),
    enabled: !!clientId,
  });

  const [name, setName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const client = clientData?.data ?? {};

  const nameMut = useMutation({
    mutationFn: (newName: string) => updateClient(clientId as number, { name: newName }),
    onSuccess: () => {
      toast.success("Business name saved");
      setName(null);
      qc.invalidateQueries({ queryKey: ["settings-client", clientId] });
    },
    onError: () => toast.error("Failed to save"),
  });

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !clientId) return;
    setUploading(true);
    try {
      await uploadClientLogo(clientId, file);
      toast.success("Logo uploaded");
      qc.invalidateQueries({ queryKey: ["settings-client", clientId] });
    } catch {
      toast.error("Failed to upload logo");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  if (!clientId) return null;
  if (isLoading) return <div className="flex items-center justify-center h-24"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  const currentName = name ?? client.name ?? "";

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
      <div className="pb-2 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 text-sm">Branding</h3>
        <p className="text-xs text-gray-400 mt-0.5">Your business name and logo, shown on your dashboard and login page</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
          {client.logo_url
            ? <img src={client.logo_url} alt="Logo" className="w-full h-full object-contain" />
            : <ImagePlus className="w-6 h-6 text-gray-300" />}
        </div>
        <div>
          <label className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 hover:border-blue-400 text-sm font-medium text-gray-600 hover:text-blue-600 rounded-lg cursor-pointer transition">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload Logo"}
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
              onChange={handleLogoChange} disabled={uploading} />
          </label>
          <p className="text-xs text-gray-400 mt-1.5">PNG, JPG, SVG or WEBP</p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Business Name</label>
        <div className="flex gap-2">
          <input value={currentName} onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={() => nameMut.mutate(currentName)}
            disabled={!currentName || currentName === client.name || nameMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
            {nameMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Clinic Tab ────────────────────────────────────────────────────────────────

function ClinicTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-clinic"], queryFn: getClinicSettings });
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const cfg = data?.data ?? {};

  const update = (key: string, val: string) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
  };

  const mut = useMutation({
    mutationFn: () => updateClinicSettings(form),
    onSuccess: () => { toast.success("Company settings saved"); setDirty(false); qc.invalidateQueries({ queryKey: ["settings-clinic"] }); },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  const val = (k: string) => form[k] ?? cfg[k] ?? "";

  return (
    <div className="max-w-2xl space-y-6">
      <BrandingCard />

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {[
          ["clinic_name", "Company Name"],
          ["phone", "Company Phone"],
          ["email", "Company Email"],
          ["city", "City"],
          ["website", "Website"],
        ].map(([key, label]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
            <input value={val(key)} onChange={(e) => update(key, e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Address</label>
        <textarea value={val("address")} onChange={(e) => update("address", e.target.value)} rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Business Hours</label>
        <input value={val("timings")} onChange={(e) => update("timings", e.target.value)}
          placeholder="Mon–Sat: 9am–6pm"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
      </button>
      </div>
    </div>
  );
}

// ── Phone Provider Card ───────────────────────────────────────────────────────

// ── LiveKit Project Credentials Card ──────────────────────────────────────────
// Shared by every phone provider — set once here, no .env editing needed.

function LiveKitCredentialsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-calling-credentials"], queryFn: getCallingCredentials });
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const cfg = data?.data ?? {};
  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string, isSet = false) => {
    if (form[k] !== undefined) return form[k] as string;
    return isSet ? MASKED : ((cfg[k] ?? "") as string);
  };
  const clearMask = (k: string) => { if (form[k] === undefined) set(k, ""); };

  const mut = useMutation({
    mutationFn: () => updateCallingCredentials(form),
    onSuccess: () => {
      toast.success("LiveKit credentials saved & encrypted");
      setDirty(false);
      setForm({});
      qc.invalidateQueries({ queryKey: ["settings-calling-credentials"] });
    },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
      <div className="pb-2 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 text-sm">LiveKit Project</h3>
        <p className="text-xs text-gray-400 mt-0.5">Used by every phone provider below — no .env editing needed</p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">From the LiveKit Cloud Dashboard:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
          <li>Settings → General → copy Project URL</li>
          <li>Settings → API Keys → create/copy API Key and Secret</li>
          <li>Settings → Project → copy SIP URI (needed for inbound routing)</li>
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            LiveKit URL {cfg.livekit_url && <span className="text-green-500 ml-1">✓ saved</span>}
          </label>
          <input value={val("livekit_url")} onChange={(e) => set("livekit_url", e.target.value)}
            placeholder="wss://your-project.livekit.cloud"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            SIP URI {cfg.livekit_sip_uri && <span className="text-green-500 ml-1">✓ saved</span>}
          </label>
          <input value={val("livekit_sip_uri")} onChange={(e) => set("livekit_sip_uri", e.target.value)}
            placeholder="your-project.sip.livekit.cloud"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            API Key {cfg.livekit_api_key_set && <span className="text-green-500 ml-1">✓ saved</span>}
          </label>
          <input type="password" value={val("livekit_api_key", cfg.livekit_api_key_set)}
            onFocus={() => clearMask("livekit_api_key")}
            onChange={(e) => set("livekit_api_key", e.target.value)}
            placeholder={cfg.livekit_api_key_set ? "Type new value to replace" : "APIxxxxxxxxxxxx"}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            API Secret {cfg.livekit_api_secret_set && <span className="text-green-500 ml-1">✓ saved</span>}
          </label>
          <input type="password" value={val("livekit_api_secret", cfg.livekit_api_secret_set)}
            onFocus={() => clearMask("livekit_api_secret")}
            onChange={(e) => set("livekit_api_secret", e.target.value)}
            placeholder={cfg.livekit_api_secret_set ? "Type new value to replace" : "Enter API Secret"}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>
      </div>

      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Encrypt
      </button>
    </div>
  );
}


// ── Phone Provider Card ───────────────────────────────────────────────────────

const PHONE_PROVIDERS = ["twilio", "vobiz", "msg91", "plivo", "custom"] as const;
// Shown in password fields when a credential is saved but not yet re-typed
const MASKED = "••••••••••••";

function PhoneProviderCard() {
  const qc = useQueryClient();
  const { data: msgData, isLoading: msgLoading } = useQuery({ queryKey: ["settings-messaging"], queryFn: getMessagingConfig });
  const { data: credData, isLoading: credLoading } = useQuery({ queryKey: ["settings-calling-credentials"], queryFn: getCallingCredentials });
  const { data: callData } = useQuery({ queryKey: ["settings-calling"], queryFn: getCallingConfig });

  const [selected, setSelected] = useState<string | null>(null);
  const [msgForm, setMsgForm] = useState<Record<string, string>>({});
  const [vbForm, setVbForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const msgCfg = msgData?.data ?? {};
  const credCfg = credData?.data ?? {};
  const callCfg = callData?.data ?? {};
  // The provider actually live for calls right now — distinct from `active`
  // below, which just tracks which button/form is selected for editing.
  const activeProvider = credCfg.phone_provider || callCfg.phone_provider || "";
  const isLoading = msgLoading || credLoading;

  const derived = credCfg.vobiz_auth_id_set ? "vobiz" : (msgCfg.provider || "twilio");
  const active = selected ?? derived;
  const isVoBiz  = active === "vobiz";
  const isTwilio = active === "twilio";
  const isPlivo  = active === "plivo";
  const isCustom = active === "custom";
  const hasSecret = isTwilio || isPlivo;
  const sidLabel  = isTwilio ? "Account SID" : isPlivo ? "Auth ID" : "API Key";

  const setMsg = (k: string, v: string) => { setMsgForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const setVb  = (k: string, v: string) => { setVbForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  // isSet=true: show MASKED when field is untouched (so user sees something is stored)
  const msgVal = (k: string, isSet = false) => {
    if (msgForm[k] !== undefined) return msgForm[k] as string;
    return isSet ? MASKED : ((msgCfg[k] ?? "") as string);
  };
  const vbVal  = (k: string, isSet = false) => {
    if (vbForm[k] !== undefined) return vbForm[k] as string;
    return isSet ? MASKED : "";
  };
  // When user focuses a masked field, clear it so they can type a new value
  const clearMsgMask = (k: string) => { if (msgForm[k] === undefined) setMsg(k, ""); };
  const clearVbMask  = (k: string) => { if (vbForm[k] === undefined) setVb(k, ""); };

  const handleSelect = (key: string) => {
    setSelected(key);
    setDirty(false);
    setMsgForm({});
    setVbForm({});
  };

  const msgMut = useMutation({
    mutationFn: () => updateMessagingConfig({ ...msgForm, provider: active }),
    onSuccess: () => {
      toast.success("Credentials saved & encrypted");
      setDirty(false);
      setMsgForm({});
      qc.invalidateQueries({ queryKey: ["settings-messaging"] });
    },
    onError: () => toast.error("Failed to save"),
  });

  const vbMut = useMutation({
    mutationFn: () => updateCallingCredentials(vbForm),
    onSuccess: () => {
      toast.success("VoBiz credentials saved & encrypted");
      setDirty(false);
      setVbForm({});
      qc.invalidateQueries({ queryKey: ["settings-calling-credentials"] });
    },
    onError: () => toast.error("Failed to save"),
  });

  // Switching providers is non-destructive — each provider keeps its own trunk
  // IDs, this just changes which one calls are routed through. "" deactivates.
  const activateMut = useMutation({
    mutationFn: (provider: string) => activateProvider({ provider }),
    onSuccess: (res) => {
      toast.success(res.data.message || "Updated");
      if (res.data.warning) toast.warning(res.data.warning);
      qc.invalidateQueries({ queryKey: ["settings-calling-credentials"] });
      qc.invalidateQueries({ queryKey: ["settings-calling"] });
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err.response?.data?.detail || "Action failed"),
  });

  // Only what's needed for outbound calling — Auth ID/Token/Trunk ID/SIP URI are
  // optional and only enable the extra "auto-route inbound calls" step.
  const vobizFieldsReady = !!(
    credCfg.vobiz_sip_domain && credCfg.vobiz_sip_username_set && credCfg.vobiz_sip_password_set &&
    credCfg.vobiz_phone_number
  );

  const handleToggleProvider = (provider: string, isCurrentlyActive: boolean) => {
    const msg = isCurrentlyActive
      ? `Deactivate ${provider === "twilio" ? "Twilio" : "VoBiz"}? Outbound/inbound calls will stop working until you activate a provider.`
      : `Switch calling to ${provider === "twilio" ? "Twilio" : "VoBiz"}? This only changes which number calls route through — no trunks are deleted.`;
    if (!window.confirm(msg)) return;
    activateMut.mutate(isCurrentlyActive ? "" : provider);
  };

  if (isLoading) return <div className="flex items-center justify-center h-24"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
        <KeyRound className="w-4 h-4 text-blue-600" />
        <h3 className="font-semibold text-gray-800 text-sm">Phone Provider</h3>
        <span className="text-xs text-gray-400">— credentials encrypted in database</span>
      </div>

      {/* Provider buttons */}
      <div className="flex gap-2 flex-wrap">
        {PHONE_PROVIDERS.map((p) => (
          <button key={p} type="button" onClick={() => handleSelect(p)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium border transition
              ${active === p
                ? "bg-blue-600 text-white border-blue-600"
                : "border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"}`}>
            {p === "vobiz" ? "VoBiz" : p === "twilio" ? "Twilio" : p === "msg91" ? "MSG91" : p === "plivo" ? "Plivo" : "Custom"}
            {activeProvider === p && (
              <span className="ml-1.5 text-[10px] font-normal text-green-400">● Active</span>
            )}
          </button>
        ))}
      </div>

      {/* ── VoBiz fields ── */}
      {isVoBiz && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">How to get VoBiz credentials:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
              <li>Create account at <span className="font-mono">console.vobiz.ai</span></li>
              <li>SIP Trunk → create trunk → copy Domain, Username, Password (required for outbound)</li>
              <li>Phone Numbers → buy a number for caller ID</li>
              <li>API Keys → copy Auth ID/Token, plus the trunk&apos;s ID (optional — only needed to auto-route inbound calls to LiveKit below)</li>
            </ol>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {([
              ["vobiz_sip_username", "SIP Username",               "vobiz_sip_username_set"],
              ["vobiz_sip_password", "SIP Password",               "vobiz_sip_password_set"],
            ] as [string, string, string][]).map(([key, label, savedKey]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  {label} {credCfg[savedKey] && <span className="text-green-500 ml-1">✓ saved</span>}
                </label>
                <input type="password" value={vbVal(key, credCfg[savedKey])}
                  onFocus={() => clearVbMask(key)}
                  onChange={(e) => setVb(key, e.target.value)}
                  placeholder={credCfg[savedKey] ? "Type new value to replace" : `Enter ${label}`}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              SIP Domain {credCfg.vobiz_sip_domain && <span className="text-green-500 ml-1">✓ saved</span>}
            </label>
            <input
              value={vbVal("vobiz_sip_domain") || credCfg.vobiz_sip_domain || ""}
              onChange={(e) => setVb("vobiz_sip_domain", e.target.value)}
              placeholder="yourcompany.sip.vobiz.ai"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Phone Number (Caller ID) {credCfg.vobiz_phone_number && <span className="text-green-500 ml-1">✓ saved</span>}
            </label>
            <input
              value={vbVal("vobiz_phone_number") || credCfg.vobiz_phone_number || ""}
              onChange={(e) => setVb("vobiz_phone_number", e.target.value)}
              placeholder="+91XXXXXXXXXX"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
            <p className="text-xs font-semibold text-gray-600">
              Optional — only needed to auto-route inbound calls to LiveKit. Outbound calling works without these.
            </p>
            <div className="grid grid-cols-2 gap-4">
              {([
                ["vobiz_auth_id",    "Auth ID (X-Auth-ID)",      "vobiz_auth_id_set"],
                ["vobiz_auth_token", "Auth Token (X-Auth-Token)", "vobiz_auth_token_set"],
              ] as [string, string, string][]).map(([key, label, savedKey]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    {label} {credCfg[savedKey] && <span className="text-green-500 ml-1">✓ saved</span>}
                  </label>
                  <input type="password" value={vbVal(key, credCfg[savedKey])}
                    onFocus={() => clearVbMask(key)}
                    onChange={(e) => setVb(key, e.target.value)}
                    placeholder={credCfg[savedKey] ? "Type new value to replace" : `Enter ${label}`}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                VoBiz Trunk ID {credCfg.vobiz_trunk_id && <span className="text-green-500 ml-1">✓ saved</span>}
              </label>
              <input
                value={vbVal("vobiz_trunk_id") || credCfg.vobiz_trunk_id || ""}
                onChange={(e) => setVb("vobiz_trunk_id", e.target.value)}
                placeholder="console.vobiz.ai → SIP Trunk → Outbound Trunks"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <p className="text-xs text-gray-400">LiveKit SIP URI is set once in the &quot;LiveKit Project&quot; card above.</p>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => vbMut.mutate()} disabled={!dirty || vbMut.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
              {vbMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Encrypt
            </button>
            {activeProvider === "vobiz" ? (
              <button onClick={() => handleToggleProvider("vobiz", true)} disabled={activateMut.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-50 text-red-600 text-sm font-medium rounded-lg transition">
                {activateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Deactivate VoBiz
              </button>
            ) : (
              <button onClick={() => handleToggleProvider("vobiz", false)} disabled={!vobizFieldsReady || activateMut.isPending}
                title={!vobizFieldsReady ? "Save all VoBiz fields first" : ""}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
                {activateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Activate VoBiz
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Standard provider fields ── */}
      {!isVoBiz && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              {sidLabel} {msgCfg.api_key_set && <span className="text-green-500 font-normal ml-1">✓ saved</span>}
            </label>
            <input type="password" value={msgVal("api_key", msgCfg.api_key_set)}
              onFocus={() => clearMsgMask("api_key")}
              onChange={(e) => setMsg("api_key", e.target.value)}
              placeholder={msgCfg.api_key_set ? "Type new value to replace" : `Enter ${sidLabel}`}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          </div>

          {hasSecret && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Auth Token {msgCfg.api_secret_set && <span className="text-green-500 font-normal ml-1">✓ saved</span>}
              </label>
              <input type="password" value={msgVal("api_secret", msgCfg.api_secret_set)}
                onFocus={() => clearMsgMask("api_secret")}
                onChange={(e) => setMsg("api_secret", e.target.value)}
                placeholder={msgCfg.api_secret_set ? "Type new value to replace" : "Enter Auth Token"}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
          )}

          {isCustom && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Webhook URL</label>
                <input value={msgVal("webhook_url")} onChange={(e) => setMsg("webhook_url", e.target.value)}
                  placeholder="https://your-api.com/send-message"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Extra Headers (JSON)</label>
                <textarea value={msgVal("webhook_headers")} onChange={(e) => setMsg("webhook_headers", e.target.value)}
                  placeholder='{"Authorization": "Bearer your-key"}'
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono" />
              </div>
            </div>
          )}

          <button onClick={() => msgMut.mutate()} disabled={!dirty || msgMut.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
            {msgMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Encrypt
          </button>
        </div>
      )}
    </div>
  );
}


// ── Calling Numbers Card ──────────────────────────────────────────────────────

function CallNumbersCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-calling-credentials"], queryFn: getCallingCredentials });
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const cfg = data?.data ?? {};
  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string) => (form[k] !== undefined ? form[k] : cfg[k] ?? "") as string;

  const mut = useMutation({
    mutationFn: () => updateCallingCredentials(form),
    onSuccess: () => { toast.success("Saved"); setDirty(false); setForm({}); qc.invalidateQueries({ queryKey: ["settings-calling-credentials"] }); },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
      <div className="pb-2 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 text-sm">Calling Numbers</h3>
        <p className="text-xs text-gray-400 mt-0.5">Phone numbers for inbound and outbound calls</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">📞 Outbound Number</label>
          <input value={val("twilio_from_number")} onChange={e => set("twilio_from_number", e.target.value)}
            placeholder="+91XXXXXXXXXX — AI calls patients from this"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">📥 Inbound Number</label>
          <input value={val("inbound_phone_number")} onChange={e => set("inbound_phone_number", e.target.value)}
            placeholder="+91XXXXXXXXXX — patients call this"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>
      </div>
      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Numbers
      </button>
    </div>
  );
}


// ── Calling Tab ───────────────────────────────────────────────────────────────

function CallingTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-calling"], queryFn: getCallingConfig });
  const [form, setForm] = useState<Record<string, string | number>>({});
  const [dirty, setDirty] = useState(false);

  const cfg = data?.data ?? {};
  const update = (key: string, v: string | number) => { setForm((f) => ({ ...f, [key]: v })); setDirty(true); };
  const val = (k: string, def = "") => ((form[k] !== undefined ? form[k] : cfg[k] ?? def) as string);

  const mut = useMutation({
    mutationFn: () => updateCallingConfig(form),
    onSuccess: () => { toast.success("Saved"); setDirty(false); qc.invalidateQueries({ queryKey: ["settings-calling"] }); },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  return (
    <div className="max-w-2xl space-y-6">

      {/* LiveKit Project Credentials — shared by every provider below */}
      <LiveKitCredentialsCard />

      {/* Phone Provider Credentials */}
      <PhoneProviderCard />

      {/* Calling Numbers */}
      <CallNumbersCard />

      {/* Call Schedule */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
          <CalendarDays className="w-4 h-4 text-blue-500" />
          <h3 className="font-semibold text-gray-800 text-sm">Call Schedule</h3>
          <span className="text-xs text-gray-400">— when the AI can make outbound calls</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {([
            ["call_start_time", "Earliest Call Time", "09:00", "time"],
            ["call_end_time",   "Latest Call Time",   "20:00", "time"],
            ["max_retries",     "Max Retries",        "3",     "number"],
            ["retry_gap_hours", "Retry Gap (hours)",  "24",    "number"],
          ] as [string, string, string, string][]).map(([key, label, def, type]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
              <input type={type} value={val(key, def)}
                onChange={(e) => update(key, type === "number" ? parseInt(e.target.value) : e.target.value)}
                {...(type === "number" ? { min: 1 } : {})}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ))}
        </div>
      </div>

      <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Schedule
      </button>
    </div>
  );
}

// ── Calendar Tab ──────────────────────────────────────────────────────────────

const CAL_PROVIDERS = [
  { key: "google",  label: "Google Calendar" },
  { key: "apple",   label: "Apple iCloud" },
  { key: "outlook", label: "Outlook 365" },
  { key: "caldav",  label: "CalDav (Other)" },
  { key: "local",   label: "Local Only" },
] as const;

// Default CalDav URLs per provider — pre-filled for convenience
const CALDAV_DEFAULTS: Record<string, string> = {
  apple:   "https://caldav.icloud.com",
  outlook: "https://outlook.office365.com/caldav/v1/",
};

function CalendarTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-calendar"], queryFn: getCalendarConfig });
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [credsJson, setCredsJson] = useState("");
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);

  const cfg = data?.data ?? {};
  const activeProvider = selectedProvider ?? cfg.calendar_provider ?? "google";
  const isCalDavProvider = ["apple", "outlook", "caldav"].includes(activeProvider);

  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string) => (form[k] !== undefined ? form[k] : cfg[k] ?? "") as string;

  const handleSelectProvider = (key: string) => {
    setSelectedProvider(key);
    setDirty(true);
    // Pre-fill CalDav URL if switching to Apple / Outlook and no URL saved yet
    if (CALDAV_DEFAULTS[key] && !cfg.caldav_url) {
      setForm(f => ({ ...f, caldav_url: CALDAV_DEFAULTS[key] }));
    }
  };

  const toggleMut = useMutation({
    mutationFn: (active: boolean) => updateCalendarConfig({ is_active: active }),
    onSuccess: (_, active) => {
      toast.success(active ? "Calendar sync enabled" : "Calendar sync disabled");
      qc.invalidateQueries({ queryKey: ["settings-calendar"] });
    },
    onError: () => toast.error("Failed to update"),
  });

  const saveMut = useMutation({
    mutationFn: () => updateCalendarConfig({
      calendar_provider: activeProvider,
      calendar_id: val("calendar_id") || "primary",
      ...(credsJson ? { credentials_json: credsJson } : {}),
      ...(isCalDavProvider ? {
        caldav_url: val("caldav_url"),
        caldav_username: val("caldav_username"),
        ...(form.caldav_password ? { caldav_password: form.caldav_password } : {}),
      } : {}),
    }),
    onSuccess: () => {
      toast.success("Calendar settings saved");
      setDirty(false); setCredsJson(""); setForm({});
      qc.invalidateQueries({ queryKey: ["settings-calendar"] });
    },
    onError: () => toast.error("Failed to save"),
  });

  const handleTestGoogle = async () => {
    if (!credsJson) { toast.error("Paste your Service Account JSON first"); return; }
    setTesting(true);
    try {
      const res = await testCalendarConnection(credsJson, val("calendar_id") || "primary");
      toast.success(res.data.message);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Connection failed");
    } finally { setTesting(false); }
  };

  const handleTestCalDav = async () => {
    const url = val("caldav_url");
    if (!url) { toast.error("Enter CalDav server URL first"); return; }
    setTesting(true);
    try {
      const res = await testCalDavConnection(url, val("caldav_username"), form.caldav_password || "");
      toast.success(res.data.message);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Connection failed");
    } finally { setTesting(false); }
  };

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  return (
    <div className="max-w-2xl space-y-6">

      {/* Provider + sync toggle */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
          <CalendarDays className="w-4 h-4 text-blue-600" />
          <h3 className="font-semibold text-gray-800 text-sm">Calendar Provider</h3>
          <span className="text-xs text-gray-400">— appointments auto-sync when booked</span>
        </div>

        {/* Provider buttons */}
        <div className="flex gap-2 flex-wrap">
          {CAL_PROVIDERS.map(p => (
            <button key={p.key} type="button" onClick={() => handleSelectProvider(p.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                activeProvider === p.key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Active / inactive status row */}
        <div className={`flex items-center justify-between px-4 py-3 rounded-lg ${cfg.is_active ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
          <div className="flex items-center gap-2">
            {cfg.is_active
              ? <CheckCircle2 className="w-4 h-4 text-green-600" />
              : <XCircle className="w-4 h-4 text-gray-400" />}
            <span className={`text-sm font-medium ${cfg.is_active ? "text-green-700" : "text-gray-500"}`}>
              {cfg.is_active ? "Calendar sync is active" : "Calendar sync is disabled"}
            </span>
          </div>
          <div className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${cfg.is_active ? "bg-blue-500" : "bg-gray-200"}`}
            onClick={() => !toggleMut.isPending && toggleMut.mutate(!cfg.is_active)}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.is_active ? "translate-x-4" : "translate-x-0.5"}`} />
          </div>
        </div>
      </div>

      {/* Config card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="pb-2 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">
            {CAL_PROVIDERS.find(p => p.key === activeProvider)?.label} Setup
          </h3>
        </div>

        {/* ── Google Calendar ── */}
        {activeProvider === "google" && (
          <>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">How to connect:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                <li>Google Cloud Console → IAM → Service Accounts → create account and download JSON key</li>
                <li>Google Calendar → Settings → share the calendar with the service account email</li>
                <li>Paste the JSON key contents below and save</li>
              </ol>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Calendar ID
                <span className="text-gray-400 font-normal ml-1">(use <code className="bg-gray-100 px-1 rounded">primary</code> for main calendar)</span>
              </label>
              <input value={val("calendar_id")} onChange={e => set("calendar_id", e.target.value)}
                placeholder="primary  or  yourname@gmail.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Service Account JSON {cfg.credentials_set && <span className="text-green-500 ml-1">✓ saved</span>}
              </label>
              <textarea value={credsJson} onChange={e => { setCredsJson(e.target.value); setDirty(true); }}
                placeholder={cfg.credentials_set ? "Leave blank to keep existing credentials" : '{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
                rows={7}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-xs" />
            </div>

            <button onClick={handleTestGoogle} disabled={testing || (!credsJson && !cfg.credentials_set)}
              className="flex items-center gap-2 px-4 py-2.5 border border-blue-500 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Test Connection
            </button>
          </>
        )}

        {/* ── Apple iCloud ── */}
        {activeProvider === "apple" && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Apple iCloud setup:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                <li>Go to <span className="font-medium">appleid.apple.com</span> — Sign-In and Security — App-Specific Passwords</li>
                <li>Generate an app-specific password for this integration</li>
                <li>Use your Apple ID email as username and the app password below</li>
              </ol>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">CalDav Server URL</label>
              <input value={val("caldav_url") || CALDAV_DEFAULTS.apple} onChange={e => set("caldav_url", e.target.value)}
                placeholder="https://caldav.icloud.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Apple ID (Email)</label>
                <input value={val("caldav_username")} onChange={e => set("caldav_username", e.target.value)}
                  placeholder="your@icloud.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  App-Specific Password {cfg.caldav_password_set && <span className="text-green-500 ml-1">✓ saved</span>}
                </label>
                <input type="password"
                    value={form.caldav_password !== undefined ? form.caldav_password : (cfg.caldav_password_set ? MASKED : "")}
                    onFocus={() => { if (form.caldav_password === undefined && cfg.caldav_password_set) { setForm(f => ({ ...f, caldav_password: "" })); setDirty(true); } }}
                    onChange={e => { setForm(f => ({ ...f, caldav_password: e.target.value })); setDirty(true); }}
                    placeholder={cfg.caldav_password_set ? "Type new value to replace" : "xxxx-xxxx-xxxx-xxxx"}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
              </div>
            </div>
            <button onClick={handleTestCalDav} disabled={testing || !val("caldav_url")}
              className="flex items-center gap-2 px-4 py-2.5 border border-blue-500 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Test Connection
            </button>
          </div>
        )}

        {/* ── Outlook 365 ── */}
        {activeProvider === "outlook" && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Outlook 365 setup:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                <li>Your CalDav URL is: <span className="font-mono">https://outlook.office365.com/caldav/v1/YOUR_EMAIL/Calendar/</span></li>
                <li>Replace YOUR_EMAIL with your Outlook/Microsoft email address</li>
                <li>Use your Microsoft email and password (or app password if MFA is on)</li>
              </ol>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">CalDav URL</label>
              <input value={val("caldav_url")} onChange={e => set("caldav_url", e.target.value)}
                placeholder="https://outlook.office365.com/caldav/v1/your@email.com/Calendar/"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Microsoft Email</label>
                <input value={val("caldav_username")} onChange={e => set("caldav_username", e.target.value)}
                  placeholder="your@outlook.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Password {cfg.caldav_password_set && <span className="text-green-500 ml-1">✓ saved</span>}
                </label>
                <input type="password"
                    value={form.caldav_password !== undefined ? form.caldav_password : (cfg.caldav_password_set ? MASKED : "")}
                    onFocus={() => { if (form.caldav_password === undefined && cfg.caldav_password_set) { setForm(f => ({ ...f, caldav_password: "" })); setDirty(true); } }}
                    onChange={e => { setForm(f => ({ ...f, caldav_password: e.target.value })); setDirty(true); }}
                    placeholder={cfg.caldav_password_set ? "Type new value to replace" : "Password or app password"}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <button onClick={handleTestCalDav} disabled={testing || !val("caldav_url")}
              className="flex items-center gap-2 px-4 py-2.5 border border-blue-500 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Test Connection
            </button>
          </div>
        )}

        {/* ── CalDav (Other) ── */}
        {activeProvider === "caldav" && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
              Works with any CalDav-compatible service: Nextcloud, Fastmail, Radicale, Synology, and more.
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">CalDav Server URL</label>
              <input value={val("caldav_url")} onChange={e => set("caldav_url", e.target.value)}
                placeholder="https://your-server.com/remote.php/dav"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Username</label>
                <input value={val("caldav_username")} onChange={e => set("caldav_username", e.target.value)}
                  placeholder="username or email"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Password {cfg.caldav_password_set && <span className="text-green-500 ml-1">✓ saved</span>}
                </label>
                <input type="password"
                    value={form.caldav_password !== undefined ? form.caldav_password : (cfg.caldav_password_set ? MASKED : "")}
                    onFocus={() => { if (form.caldav_password === undefined && cfg.caldav_password_set) { setForm(f => ({ ...f, caldav_password: "" })); setDirty(true); } }}
                    onChange={e => { setForm(f => ({ ...f, caldav_password: e.target.value })); setDirty(true); }}
                    placeholder={cfg.caldav_password_set ? "Type new value to replace" : "Password"}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Calendar Name
                <span className="text-gray-400 font-normal ml-1">(optional — uses first calendar if blank)</span>
              </label>
              <input value={val("calendar_id")} onChange={e => set("calendar_id", e.target.value)}
                placeholder="My Calendar"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={handleTestCalDav} disabled={testing || !val("caldav_url")}
              className="flex items-center gap-2 px-4 py-2.5 border border-blue-500 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Test Connection
            </button>
          </div>
        )}

        {/* ── Local Only ── */}
        {activeProvider === "local" && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-1">
            <p className="text-sm font-medium text-gray-700">No external calendar sync</p>
            <p className="text-xs text-gray-500">
              Appointments are stored in the app only. You can view and manage them from the Appointments page.
            </p>
          </div>
        )}

        <button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Calendar Settings
        </button>
      </div>
    </div>
  );
}


// ── SMS Tab ───────────────────────────────────────────────────────────────────

function SMSTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-messaging"], queryFn: getMessagingConfig });
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [dirty, setDirty] = useState(false);

  const cfg = data?.data ?? {};
  const set = (k: string, v: string | boolean) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string, isSet = false) => {
    if (form[k] !== undefined) return form[k] as string;
    return isSet ? MASKED : ((cfg[k] ?? "") as string);
  };
  const bval = (k: string) => (form[k] !== undefined ? form[k] : cfg[k]) as boolean;
  const clearMask = (k: string) => { if (form[k] === undefined) set(k, ""); };

  const mut = useMutation({
    mutationFn: () => updateMessagingConfig(form),
    onSuccess: () => { toast.success("SMS config saved"); setDirty(false); setForm({}); qc.invalidateQueries({ queryKey: ["settings-messaging"] }); },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  const SMS_PROVIDERS = [
    { key: "twilio",   label: "Twilio",   hasSecret: true,  sidLabel: "Account SID" },
    { key: "msg91",    label: "MSG91",    hasSecret: false, sidLabel: "API Key" },
    { key: "fast2sms", label: "Fast2SMS", hasSecret: false, sidLabel: "API Key" },
    { key: "custom",   label: "Custom",   hasSecret: false, sidLabel: "API Key" },
  ];

  const activeProvider = val("provider") || cfg.provider || "twilio";
  const meta = SMS_PROVIDERS.find(p => p.key === activeProvider) ?? SMS_PROVIDERS[0];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <div className="pb-2 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">SMS Provider</h3>
          <p className="text-xs text-gray-400 mt-0.5">For sending appointment confirmations and reminders via SMS</p>
        </div>

        {/* Provider selector */}
        <div className="flex gap-2 flex-wrap">
          {SMS_PROVIDERS.map(p => (
            <button key={p.key} type="button" onClick={() => set("provider", p.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${activeProvider === p.key ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"}`}>
              {p.label}
            </button>
          ))}
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            {meta.sidLabel} {cfg.api_key_set && <span className="text-green-500 ml-1">✓ saved</span>}
          </label>
          <input type="password" value={val("api_key", cfg.api_key_set)}
            onFocus={() => clearMask("api_key")}
            onChange={e => set("api_key", e.target.value)}
            placeholder={cfg.api_key_set ? "Type new value to replace" : `Enter ${meta.sidLabel}`}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>

        {/* Auth Token */}
        {meta.hasSecret && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Auth Token {cfg.api_secret_set && <span className="text-green-500 ml-1">✓ saved</span>}
            </label>
            <input type="password" value={val("api_secret", cfg.api_secret_set)}
              onFocus={() => clearMask("api_secret")}
              onChange={e => set("api_secret", e.target.value)}
              placeholder={cfg.api_secret_set ? "Type new value to replace" : "Enter Auth Token"}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          </div>
        )}

        {/* Custom webhook */}
        {activeProvider === "custom" && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Webhook URL</label>
              <input value={val("webhook_url")} onChange={e => set("webhook_url", e.target.value)}
                placeholder="https://your-api.com/send-sms"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Extra Headers (JSON)</label>
              <textarea value={val("webhook_headers")} onChange={e => set("webhook_headers", e.target.value)}
                placeholder='{"Authorization": "Bearer your-key"}'
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono" />
            </div>
          </div>
        )}

        {/* SMS Number */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">💬 SMS Sender Number</label>
          <input value={val("from_number")} onChange={e => set("from_number", e.target.value)}
            placeholder="+91XXXXXXXXXX"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>

        {/* SMS enable toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-800">Enable SMS</p>
            <p className="text-xs text-gray-400">Fallback when WhatsApp is off or unavailable</p>
          </div>
          <div className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${bval("is_sms_enabled") ? "bg-blue-500" : "bg-gray-200"}`}
            onClick={() => set("is_sms_enabled", !bval("is_sms_enabled"))}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${bval("is_sms_enabled") ? "translate-x-5" : "translate-x-1"}`} />
          </div>
        </div>

        <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Encrypt
        </button>
      </div>
    </div>
  );
}


// ── WhatsApp Tab ──────────────────────────────────────────────────────────────

function WhatsAppTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-messaging"], queryFn: getMessagingConfig });
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [sameAsSMS, setSameAsSMS] = useState<boolean | null>(null);

  const cfg = data?.data ?? {};
  const effectiveSame = sameAsSMS !== null ? sameAsSMS : !cfg.whatsapp_api_key_set;

  const set = (k: string, v: string | boolean) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const val = (k: string, isSet = false) => {
    if (form[k] !== undefined) return form[k] as string;
    return isSet ? MASKED : ((cfg[k] ?? "") as string);
  };
  const bval = (k: string) => (form[k] !== undefined ? form[k] : cfg[k]) as boolean;
  const clearMask = (k: string) => { if (form[k] === undefined) set(k, ""); };

  const handleSameToggle = () => {
    const next = !effectiveSame;
    setSameAsSMS(next);
    setDirty(true);
    if (next) {
      setForm(f => ({ ...f, whatsapp_provider: "", whatsapp_api_key: "", whatsapp_api_secret: "" }));
    }
  };

  const mut = useMutation({
    mutationFn: () => updateMessagingConfig(form),
    onSuccess: () => {
      toast.success("WhatsApp config saved");
      setDirty(false); setForm({}); setSameAsSMS(null);
      qc.invalidateQueries({ queryKey: ["settings-messaging"] });
    },
    onError: () => toast.error("Failed to save"),
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;

  const WA_PROVIDERS = [
    { key: "twilio", label: "Twilio", hasSecret: true,  sidLabel: "Account SID" },
    { key: "msg91",  label: "MSG91",  hasSecret: false, sidLabel: "API Key" },
    { key: "custom", label: "Custom", hasSecret: false, sidLabel: "API Key" },
  ];

  const activeWAProvider = val("whatsapp_provider") || cfg.whatsapp_provider || "twilio";
  const waMeta = WA_PROVIDERS.find(p => p.key === activeWAProvider) ?? WA_PROVIDERS[0];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">WhatsApp Provider</h3>
            <p className="text-xs text-gray-400 mt-0.5">Confirmations, reminders, and cancel/reschedule via WhatsApp</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer" onClick={handleSameToggle}>
            <span className="text-xs text-gray-500 select-none">Same as SMS</span>
            <div className={`w-9 h-5 rounded-full transition-colors relative ${effectiveSame ? "bg-blue-500" : "bg-gray-200"}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${effectiveSame ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
          </label>
        </div>

        {effectiveSame ? (
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Using the same provider and credentials as SMS — configured in the SMS tab.
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {WA_PROVIDERS.map(p => (
                <button key={p.key} type="button" onClick={() => set("whatsapp_provider", p.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${activeWAProvider === p.key ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"}`}>
                  {p.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {waMeta.sidLabel} {cfg.whatsapp_api_key_set && <span className="text-green-500 ml-1">✓ saved</span>}
              </label>
              <input type="password" value={val("whatsapp_api_key", cfg.whatsapp_api_key_set)}
                onFocus={() => clearMask("whatsapp_api_key")}
                onChange={e => set("whatsapp_api_key", e.target.value)}
                placeholder={cfg.whatsapp_api_key_set ? "Type new value to replace" : `Enter ${waMeta.sidLabel}`}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>

            {waMeta.hasSecret && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Auth Token {cfg.whatsapp_api_secret_set && <span className="text-green-500 ml-1">✓ saved</span>}
                </label>
                <input type="password" value={val("whatsapp_api_secret", cfg.whatsapp_api_secret_set)}
                  onFocus={() => clearMask("whatsapp_api_secret")}
                  onChange={e => set("whatsapp_api_secret", e.target.value)}
                  placeholder={cfg.whatsapp_api_secret_set ? "Type new value to replace" : "Enter Auth Token"}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
              </div>
            )}
          </>
        )}

        {/* WhatsApp Number */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">💚 WhatsApp Business Number</label>
          <input value={val("whatsapp_number")} onChange={e => set("whatsapp_number", e.target.value)}
            placeholder="+91XXXXXXXXXX"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-800">Enable WhatsApp</p>
            <p className="text-xs text-gray-400">Confirmations sent on WhatsApp first, falls back to SMS</p>
          </div>
          <div className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${bval("is_whatsapp_enabled") ? "bg-blue-500" : "bg-gray-200"}`}
            onClick={() => set("is_whatsapp_enabled", !bval("is_whatsapp_enabled"))}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${bval("is_whatsapp_enabled") ? "translate-x-5" : "translate-x-1"}`} />
          </div>
        </div>

        <button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Encrypt
        </button>
      </div>
    </div>
  );
}
