"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCallingConfig, updateCallingConfig, getLeads, getLeadUploads, uploadCSV, batchCall, triggerCall, previewVoice, deleteUploadBatch } from "@/lib/api";
import { toast } from "sonner";
import { Bot, Upload, Play, Loader2, Save, CheckCircle2, Phone, PhoneCall, Volume2, Square, ChevronDown, Check, Trash2 } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

export default function AgentPage() {
  const qc = useQueryClient();

  const [agentName, setAgentName] = useState("");
  const [agentVoice, setAgentVoice] = useState("alloy");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [autoCallOnUpload, setAutoCallOnUpload] = useState(false);
  const [callStartTime, setCallStartTime] = useState("09:00");
  const [callEndTime, setCallEndTime] = useState("20:00");
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [calling, setCalling] = useState(false);
  const [callingBack, setCallingBack] = useState<number | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceDropRef = useRef<HTMLDivElement | null>(null);

  // Close voice dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (voiceDropRef.current && !voiceDropRef.current.contains(e.target as Node))
        setVoiceOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handlePreviewVoice = async (voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't select the voice when clicking play
    // Stop existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingVoice === voiceId) { setPlayingVoice(null); return; }

    setPreviewingVoice(voiceId);
    try {
      const res = await previewVoice(voiceId);
      const url = URL.createObjectURL(res.data);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingVoice(voiceId);
      audio.play();
      audio.onended = () => { setPlayingVoice(null); URL.revokeObjectURL(url); };
    } catch {
      toast.error("Preview failed");
    } finally {
      setPreviewingVoice(null);
    }
  };

  const { data: cfgData } = useQuery({
    queryKey: ["calling-config"],
    queryFn: getCallingConfig,
  });
  const cfg = cfgData?.data;

  useEffect(() => {
    if (cfg) {
      setAgentName(cfg.agent_name ?? "AI Calling Assistant");
      setAgentVoice(cfg.agent_voice ?? "alloy");
      setSystemPrompt(cfg.system_prompt || cfg.default_system_prompt || "");
      setPhoneNumberId(cfg.phone_number_id ?? "");
      setAutoCallOnUpload(cfg.auto_call_on_upload ?? false);
      setCallStartTime(cfg.call_start_time ?? "09:00");
      setCallEndTime(cfg.call_end_time ?? "20:00");
    }
  }, [cfg]);

  // New leads — auto-refresh every 15s so newly added leads appear without a page reload
  const { data: newLeadsData, isLoading: newLeadsLoading } = useQuery({
    queryKey: ["agent-leads-new"],
    queryFn: () => getLeads({ status: "new", limit: 100 }),
    refetchInterval: 15000,
  });
  const newLeads: Lead[] = newLeadsData?.data?.leads ?? newLeadsData?.data ?? [];

  // Call queue — leads waiting to be called sequentially (call_scheduled)
  const { data: queueData } = useQuery({
    queryKey: ["agent-leads-queue"],
    queryFn: () => getLeads({ status: "call_scheduled", limit: 200 }),
    refetchInterval: 5000,
  });
  const queueLeads: Lead[] = queueData?.data?.leads ?? queueData?.data ?? [];

  // Active call — currently dialing
  const { data: activeData } = useQuery({
    queryKey: ["agent-leads-calling"],
    queryFn: () => getLeads({ status: "calling", limit: 5 }),
    refetchInterval: 3000,
  });
  const callingLeads: Lead[] = activeData?.data?.leads ?? activeData?.data ?? [];

  // Callback queue — ONLY patients who explicitly asked for a callback during the call
  const { data: cbData } = useQuery({
    queryKey: ["agent-leads-callback"],
    queryFn: () => getLeads({ status: "callback_requested", limit: 100 }),
  });
  const callbackLeads: Lead[] = cbData?.data?.leads ?? cbData?.data ?? [];

  // Save agent config → auto-syncs to Vapi
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | number | boolean | null> = {
        agent_name: agentName,
        agent_voice: agentVoice,
        system_prompt: systemPrompt,
        phone_number_id: phoneNumberId || null,
        auto_call_on_upload: autoCallOnUpload,
        call_start_time: callStartTime,
        call_end_time: callEndTime,
      };
      return updateCallingConfig(payload);
    },
    onSuccess: (res) => {
      toast.success(res.data?.message ?? "Agent saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["calling-config"] });
    },
    onError: () => toast.error("Save failed"),
  });

  // Upload CSV
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadCSV(file);
      const count = res.data.imported ?? res.data.leads_created ?? 0;
      toast.success(`${count} leads imported`);
      qc.invalidateQueries({ queryKey: ["agent-leads-new"] });
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Start batch calls
  const startCalls = async () => {
    setCalling(true);
    try {
      const ids = selected.length > 0 ? selected : undefined;
      const res = await batchCall(ids);
      const { triggered, queued } = res.data as { triggered: number; queued: number; skipped: number };

      if (triggered > 0) {
        const qMsg = queued > 0 ? ` · ${queued} more in queue` : "";
        toast.success(`First call started — AI is dialing${qMsg}`);
      } else {
        toast.error("No leads triggered — they may already be queued or calling");
      }

      setSelected([]);
      qc.invalidateQueries({ queryKey: ["agent-leads-new"] });
      qc.invalidateQueries({ queryKey: ["agent-leads-queue"] });
      qc.invalidateQueries({ queryKey: ["agent-leads-calling"] });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Failed to start calls");
    } finally {
      setCalling(false);
    }
  };

  // Call back a single lead
  const callBack = async (leadId: number) => {
    setCallingBack(leadId);
    try {
      await triggerCall(leadId);
      toast.success("Callback triggered — AI is dialing");
      qc.invalidateQueries({ queryKey: ["agent-leads-callback"] });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Callback failed", { duration: 6000 });
    } finally {
      setCallingBack(null);
    }
  };

  const toggleLead = (id: number) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleAll = () =>
    setSelected(selected.length === newLeads.length ? [] : newLeads.map((l) => l.id));

  const mark = (field: () => void) => { field(); setDirty(true); };

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">

      {/* ── Agent Setup ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">AI Calling Agent</h1>
            <p className="text-xs text-gray-400">
              {cfg?.agent_id
                ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3 inline" /> Agent active</span>
                : "Set your instructions and save to activate the agent"}
            </p>
          </div>
        </div>

        {/* Agent Name + Voice */}
        <div className="grid grid-cols-2 gap-4 items-start">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Agent Name</label>
            <input
              value={agentName}
              onChange={(e) => mark(() => setAgentName(e.target.value))}
              placeholder="e.g. AI Calling Assistant"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Voice picker */}
          {(() => {
            const VOICES = [
              { id: "alloy",   label: "Alloy",   gender: "Neutral", desc: "Warm, balanced" },
              { id: "nova",    label: "Nova",    gender: "Female",  desc: "Bright, energetic" },
              { id: "shimmer", label: "Shimmer", gender: "Female",  desc: "Soft, friendly" },
              { id: "coral",   label: "Coral",   gender: "Female",  desc: "Clear, professional" },
              { id: "echo",    label: "Echo",    gender: "Male",    desc: "Smooth, calm" },
              { id: "onyx",    label: "Onyx",    gender: "Male",    desc: "Deep, confident" },
              { id: "ash",     label: "Ash",     gender: "Male",    desc: "Natural, conversational" },
              { id: "sage",    label: "Sage",    gender: "Neutral", desc: "Thoughtful, clear" },
              { id: "verse",   label: "Verse",   gender: "Neutral", desc: "Expressive, versatile" },
            ];
            const GENDER_STYLE: Record<string, string> = {
              Female:  "bg-pink-50 text-pink-600 border-pink-100",
              Male:    "bg-blue-50 text-blue-600 border-blue-100",
              Neutral: "bg-gray-100 text-gray-500 border-gray-200",
            };
            const selected = VOICES.find((v) => v.id === agentVoice) ?? VOICES[0];
            return (
              <div ref={voiceDropRef} className="relative">
                <label className="block text-xs font-medium text-gray-500 mb-1">AI Voice</label>

                {/* Trigger */}
                <button
                  type="button"
                  onClick={() => setVoiceOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded-lg hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center">
                      <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-gray-800 text-sm leading-tight">{selected.label}</p>
                      <p className="text-[11px] text-gray-400 leading-tight">{selected.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${GENDER_STYLE[selected.gender]}`}>
                      {selected.gender}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${voiceOpen ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {/* Dropdown panel */}
                {voiceOpen && (
                  <div className="absolute z-50 mt-1.5 w-full bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-50 bg-gray-50/70">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Choose a voice</p>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {VOICES.map((v) => {
                        const isSelected = agentVoice === v.id;
                        const isPreviewing = previewingVoice === v.id;
                        const isPlaying = playingVoice === v.id;
                        return (
                          <div
                            key={v.id}
                            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition
                              ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
                            onClick={() => { mark(() => setAgentVoice(v.id)); setVoiceOpen(false); }}
                          >
                            {/* Check or playing indicator */}
                            <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                              {isSelected
                                ? <Check className="w-4 h-4 text-blue-600" />
                                : isPlaying
                                ? <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse block" />
                                : null}
                            </div>

                            {/* Voice info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-medium ${isSelected ? "text-blue-700" : "text-gray-800"}`}>{v.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${GENDER_STYLE[v.gender]}`}>
                                  {v.gender}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-400 mt-0.5">{v.desc}</p>
                            </div>

                            {/* Preview button */}
                            <button
                              type="button"
                              onClick={(e) => handlePreviewVoice(v.id, e)}
                              className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition
                                ${isPlaying
                                  ? "bg-blue-50 text-blue-600 border-blue-200"
                                  : "bg-gray-50 text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600"}`}
                              title="Preview voice"
                            >
                              {isPreviewing
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : isPlaying
                                ? <><Square className="w-3 h-3" /> Stop</>
                                : <><Play className="w-3 h-3" /> Play</>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* System Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-500">
              Agent Instructions — what the agent should say and do
            </label>
            {cfg?.default_system_prompt && (
              <button
                type="button"
                onClick={() => { setSystemPrompt(cfg.default_system_prompt); setDirty(true); }}
                className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
              >
                Reset to default template
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mb-1.5">
            A default template is pre-filled — edit it freely or write your own.
            Use <code className="bg-gray-100 px-0.5 rounded">{"{business_name}"}</code>{" "}
            <code className="bg-gray-100 px-0.5 rounded">{"{first_name}"}</code>{" "}
            <code className="bg-gray-100 px-0.5 rounded">{"{full_name}"}</code>{" "}
            <code className="bg-gray-100 px-0.5 rounded">{"{campaign_name}"}</code> as dynamic placeholders.
          </p>
          <textarea
            value={systemPrompt}
            onChange={(e) => mark(() => setSystemPrompt(e.target.value))}
            rows={14}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none leading-relaxed"
            placeholder="Enter agent instructions…"
          />
        </div>

        {/* Phone Number (optional) */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Caller Phone Number ID <span className="text-gray-400 font-normal">(optional — leave blank to use default)</span>
          </label>
          <input
            value={phoneNumberId}
            onChange={(e) => mark(() => setPhoneNumberId(e.target.value))}
            placeholder="Enter phone number ID…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* ── Calling Schedule ── */}
        <div className="border border-gray-100 rounded-xl p-4 space-y-4 bg-gray-50/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">Auto-Call Schedule</p>
              <p className="text-xs text-gray-400 mt-0.5">Automatically start calling when leads are added or CSV is uploaded</p>
            </div>
            <button
              type="button"
              onClick={() => mark(() => setAutoCallOnUpload((v) => !v))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${autoCallOnUpload ? "bg-blue-600" : "bg-gray-200"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoCallOnUpload ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          {autoCallOnUpload && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Calling From</label>
                <input
                  type="time"
                  value={callStartTime}
                  onChange={(e) => mark(() => setCallStartTime(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Stop Calling At</label>
                <input
                  type="time"
                  value={callEndTime}
                  onChange={(e) => mark(() => setCallEndTime(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <p className="col-span-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                Leads added between <strong>{callStartTime}</strong> and <strong>{callEndTime}</strong> will be queued and called automatically, one by one.
              </p>
            </div>
          )}
        </div>

        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Agent
        </button>
      </div>

      {/* ── Upload & Call ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Leads Ready to Call</h2>
            <p className="text-xs text-gray-400 mt-0.5">{newLeads.length} new leads</p>
          </div>
          <div className="flex items-center gap-2">
            <label className={`flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-600 transition ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload CSV
              <input type="file" accept=".csv,.tsv" className="hidden" onChange={handleUpload} />
            </label>
            <button
              onClick={startCalls}
              disabled={calling || newLeads.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
            >
              {calling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {selected.length > 0 ? `Call ${selected.length} Selected` : "Start Calling"}
            </button>
          </div>
        </div>

        {newLeadsLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          </div>
        ) : newLeads.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No new leads — upload a CSV to get started</p>
          </div>
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/70 text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={selected.length === newLeads.length && newLeads.length > 0} onChange={toggleAll} className="rounded border-gray-300 accent-blue-600" />
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Inquiry</th>
                  <th className="px-4 py-3 text-left font-medium">City</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {newLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => toggleLead(lead.id)}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleLead(lead.id)} onClick={(e) => e.stopPropagation()} className="rounded border-gray-300 accent-blue-600" />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{lead.full_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{lead.phone}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{lead.inquiry_type || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{lead.city || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lead.consultation_type === "in_person" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                        {lead.consultation_type === "in_person" ? "In-Person" : "Online"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Calling Queue ── */}
      {(callingLeads.length > 0 || queueLeads.length > 0) && (
        <div className="bg-white rounded-2xl border border-blue-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                </span>
                Call Queue Running
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {callingLeads.length > 0 && <span className="text-blue-600 font-medium">1 active call</span>}
                {callingLeads.length > 0 && queueLeads.length > 0 && " · "}
                {queueLeads.length > 0 && `${queueLeads.length} waiting in queue`}
              </p>
            </div>
            <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-3 py-1.5 rounded-full">
              {callingLeads.length + queueLeads.length} total
            </span>
          </div>

          <div className="border border-blue-50 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-50/60 text-xs text-gray-400 border-b border-blue-100">
                  <th className="px-4 py-3 text-left font-medium w-10">#</th>
                  <th className="px-4 py-3 text-left font-medium">Patient Name</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Inquiry</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-50/60">
                {callingLeads.map((lead) => (
                  <tr key={lead.id} className="bg-blue-50/30">
                    <td className="px-4 py-3">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{lead.full_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{lead.phone}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[160px]">{lead.inquiry_type || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600">
                        <Loader2 className="w-3 h-3 animate-spin" /> Calling now
                      </span>
                    </td>
                  </tr>
                ))}
                {queueLeads.map((lead, i) => (
                  <tr key={lead.id} className="hover:bg-gray-50/40">
                    <td className="px-4 py-3 text-xs text-gray-400 font-medium">{i + 2}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">{lead.full_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{lead.phone}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[160px]">{lead.inquiry_type || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Waiting #{i + 2}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Callback Queue ── */}
      {callbackLeads.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-100 p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-amber-500" />
              Callback Queue
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{callbackLeads.length} lead{callbackLeads.length !== 1 ? "s" : ""} — patient asked to be called back during the call</p>
          </div>
          <div className="border border-amber-50 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-50/60 text-xs text-gray-400 border-b border-amber-100">
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Inquiry</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Calls Made</th>
                  <th className="px-4 py-3 w-36"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-50">
                {callbackLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-amber-50/40">
                    <td className="px-4 py-3 font-medium text-gray-800">{lead.full_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{lead.phone}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{lead.inquiry_type || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lead.status === "callback_requested" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
                        {lead.status === "callback_requested" ? "Callback Requested" : "No Answer"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{lead.call_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => callBack(lead.id)}
                        disabled={callingBack === lead.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
                      >
                        {callingBack === lead.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />}
                        Call Back
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface Lead {
  id: number;
  full_name: string;
  phone: string;
  inquiry_type: string;
  city: string;
  consultation_type: string;
  status: string;
  call_count: number;
}
