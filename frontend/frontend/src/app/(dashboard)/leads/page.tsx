"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLeads, getLead, triggerCall, getCallHistory, getLeadAppointments, getSMSHistory, sendFollowup, bookAppointment, createLead, resetStuckCalls, updateLead, deleteLead } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDateTime, fmtRelative } from "@/lib/utils";
import { toast } from "sonner";
import {
  Phone, CalendarPlus, MessageSquare,
  Search, Loader2, X, UserPlus, RotateCcw, Pencil, Trash2, AlertTriangle,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";


export default function LeadsPage() {
  const qc = useQueryClient();
  const [search, setSearch]           = useState("");
  const [cityFilter, setCityFilter]   = useState("");
  const [typeFilter, setTypeFilter]   = useState("");
  const [inquiryFilter, setInquiryFilter] = useState("");
  const [page, setPage]               = useState(0);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [drawerTab, setDrawerTab] = useState<"info" | "calls" | "appointments" | "messages">("info");

  // Poll the selected lead every 5s while its status is "calling" — picks up call completion automatically
  const { data: liveLeadData } = useQuery({
    queryKey: ["lead-live", selectedLead?.id],
    queryFn: () => getLead(selectedLead!.id),
    enabled: !!selectedLead,
    refetchInterval: (query) =>
      query.state.data?.data?.status === "calling" ? 5000 : false,
  });
  // Use fresh polled data in the drawer; fall back to clicked row data
  const activeLead: Lead | null = (liveLeadData?.data as Lead) ?? selectedLead;
  const isCallInProgress = activeLead?.status === "calling";
  const [bookingDate, setBookingDate] = useState("");
  const [bookingType, setBookingType] = useState("online");

  // Add Lead modal
  const [addOpen, setAddOpen] = useState(false);
  const [newLead, setNewLead] = useState({
    full_name: "", phone: "", city: "", inquiry_type: "",
    problem_description: "", consultation_type: "online", email: "",
  });

  // Edit Lead modal
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: "", phone: "", email: "", city: "",
    inquiry_type: "", problem_description: "", consultation_type: "online",
  });

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);

  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["leads", search, cityFilter, typeFilter, inquiryFilter, page],
    queryFn: () => getLeads({
      limit: LIMIT,
      offset: page * LIMIT,
      ...(search        && { search }),
      ...(cityFilter    && { city: cityFilter }),
      ...(typeFilter    && { consultation_type: typeFilter }),
      ...(inquiryFilter && { inquiry_type: inquiryFilter }),
    }),
  });

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

  const resetStuckMutation = useMutation({
    mutationFn: resetStuckCalls,
    onSuccess: (res) => {
      toast.success(res.data.message || "Stuck calls reset");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-live", selectedLead?.id] });
    },
    onError: () => toast.error("Failed to reset"),
  });

  const addLeadMutation = useMutation({
    mutationFn: () => createLead(newLead),
    onSuccess: () => {
      toast.success("Lead added successfully");
      setAddOpen(false);
      setNewLead({ full_name: "", phone: "", city: "", inquiry_type: "", problem_description: "", consultation_type: "online", email: "" });
      qc.invalidateQueries({ queryKey: ["leads"] });
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
    onSuccess: (_, leadId) => {
      toast.success("Call triggered — AI is dialing the patient...");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-live", leadId] }); // start polling
      if (selectedLead?.id === leadId) qc.invalidateQueries({ queryKey: ["calls", leadId] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to trigger call"),
  });

  const followupMutation = useMutation({
    mutationFn: (leadId: number) => sendFollowup(leadId),
    onSuccess: () => { toast.success("Follow-up message sent"); qc.invalidateQueries({ queryKey: ["sms"] }); },
    onError: () => toast.error("Failed to send message — check messaging config"),
  });

  const bookMutation = useMutation({
    mutationFn: () => bookAppointment({
      lead_id: selectedLead!.id,
      appointment_date: new Date(bookingDate).toISOString(),
      appointment_type: bookingType,
      language: "hindi",
    }),
    onSuccess: () => {
      toast.success("Appointment booked & confirmation sent");
      setBookingDate("");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-appts", selectedLead?.id] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail || "Failed to book appointment"),
  });

  const openEdit = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditForm({
      full_name: lead.full_name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      city: lead.city || "",
      inquiry_type: lead.inquiry_type || "",
      problem_description: lead.problem_description || "",
      consultation_type: lead.consultation_type || "online",
    });
    setEditLead(lead);
  };

  const openDelete = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(lead);
  };

  const leads: Lead[] = data?.data?.leads ?? [];
  const total: number = data?.data?.total ?? 0;

  // Build unique city + inquiry lists from ALL loaded leads (unfiltered for dropdown options)
  const { data: allData } = useQuery({
    queryKey: ["leads-all-meta"],
    queryFn: () => getLeads({ limit: 500, offset: 0 }),
    staleTime: 60_000,
  });
  const allLeads: Lead[] = allData?.data?.leads ?? [];
  const cities    = [...new Set(allLeads.map((l) => l.city).filter(Boolean))].sort();
  const inquiries = [...new Set(allLeads.map((l) => l.inquiry_type).filter(Boolean))].sort();

  const hasFilter = !!(search || cityFilter || typeFilter || inquiryFilter);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500">{total} total leads</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => resetStuckMutation.mutate()}
            disabled={resetStuckMutation.isPending}
            title="Reset any leads stuck in 'Calling' state"
            className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 text-gray-500 hover:text-amber-600 hover:border-amber-300 rounded-lg transition disabled:opacity-50">
            {resetStuckMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Reset Stuck
          </button>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition">
            <UserPlus className="w-4 h-4" /> Add Lead
          </button>
        </div>
      </div>

      {/* Edit Lead Modal */}
      {editLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Lead</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editLead.phone}</p>
              </div>
              <button onClick={() => setEditLead(null)} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
              {[
                { label: "Full Name", key: "full_name", placeholder: "e.g. Priya Sharma" },
                { label: "Phone Number", key: "phone", placeholder: "+918766642142" },
                { label: "Email", key: "email", placeholder: "patient@email.com" },
                { label: "City", key: "city", placeholder: "e.g. Mumbai" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-600">{label}</label>
                  <input
                    value={editForm[key as keyof typeof editForm]}
                    onChange={e => setEditForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-600">Inquiry Type</label>
                <select value={editForm.inquiry_type} onChange={e => setEditForm(p => ({ ...p, inquiry_type: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                  <option value="">Select inquiry</option>
                  {["IVF / IUI","PCOS / PCOD","Hormonal Health","Pregnancy","Menopause","Gynaecological","Second Opinion"].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Consultation Type</label>
                <select value={editForm.consultation_type} onChange={e => setEditForm(p => ({ ...p, consultation_type: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                  <option value="online">Online (Video Call)</option>
                  <option value="in_clinic">In-Clinic (Agra)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Problem Description</label>
                <textarea value={editForm.problem_description} onChange={e => setEditForm(p => ({ ...p, problem_description: e.target.value }))}
                  rows={2} placeholder="Brief description..."
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setEditLead(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-white transition">
                Cancel
              </button>
              <button
                onClick={() => editMutation.mutate()}
                disabled={!editForm.full_name || !editForm.phone || editMutation.isPending}
                className="flex-1 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition flex items-center justify-center gap-2">
                {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1">Delete Lead</h3>
              <p className="text-sm text-gray-500 mb-1">
                Are you sure you want to delete <span className="font-semibold text-gray-800">{deleteTarget.full_name || deleteTarget.phone}</span>?
              </p>
              <p className="text-xs text-red-400">This will permanently remove the lead and all associated data.</p>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition flex items-center justify-center gap-2">
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Add New Lead</h2>
              <button onClick={() => setAddOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="text-xs font-medium text-gray-600">Full Name *</label>
                <input value={newLead.full_name} onChange={e => setNewLead(p => ({ ...p, full_name: e.target.value }))}
                  placeholder="e.g. Priya Sharma"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              {/* Phone */}
              <div>
                <label className="text-xs font-medium text-gray-600">Phone Number *</label>
                <input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+918766642142"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              {/* City */}
              <div>
                <label className="text-xs font-medium text-gray-600">City</label>
                <input value={newLead.city} onChange={e => setNewLead(p => ({ ...p, city: e.target.value }))}
                  placeholder="e.g. Mumbai"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              {/* Inquiry */}
              <div>
                <label className="text-xs font-medium text-gray-600">Inquiry Type</label>
                <select value={newLead.inquiry_type} onChange={e => setNewLead(p => ({ ...p, inquiry_type: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                  <option value="">Select inquiry</option>
                  <option value="IVF / IUI">IVF / IUI</option>
                  <option value="PCOS / PCOD">PCOS / PCOD</option>
                  <option value="Hormonal Health">Hormonal Health</option>
                  <option value="Pregnancy">Pregnancy</option>
                  <option value="Menopause">Menopause</option>
                  <option value="Gynaecological">Gynaecological</option>
                  <option value="Second Opinion">Second Opinion</option>
                </select>
              </div>
              {/* Consultation Type */}
              <div>
                <label className="text-xs font-medium text-gray-600">Consultation Type</label>
                <select value={newLead.consultation_type} onChange={e => setNewLead(p => ({ ...p, consultation_type: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                  <option value="online">Online (Video Call)</option>
                  <option value="in_clinic">In-Clinic (Agra)</option>
                </select>
              </div>
              {/* Problem */}
              <div>
                <label className="text-xs font-medium text-gray-600">Problem Description</label>
                <textarea value={newLead.problem_description} onChange={e => setNewLead(p => ({ ...p, problem_description: e.target.value }))}
                  placeholder="Brief description of patient's problem..."
                  rows={2}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setAddOpen(false)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                onClick={() => addLeadMutation.mutate()}
                disabled={!newLead.full_name || !newLead.phone || addLeadMutation.isPending}
                className="flex-1 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition flex items-center justify-center gap-2">
                {addLeadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Add Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search name, phone…"
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 w-52"
          />
        </div>

        {/* City filter */}
        <select value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
          <option value="">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Type filter */}
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
          <option value="">All Types</option>
          <option value="online">Online</option>
          <option value="in_clinic">In-Clinic</option>
        </select>

        {/* Inquiry filter */}
        <select value={inquiryFilter} onChange={(e) => { setInquiryFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white max-w-[220px]">
          <option value="">All Inquiries</option>
          {inquiries.map(i => <option key={i} value={i}>{i.replace(/_/g, " ")}</option>)}
        </select>

        {hasFilter && (
          <button onClick={() => { setSearch(""); setCityFilter(""); setTypeFilter(""); setInquiryFilter(""); setPage(0); }}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table — only CSV columns, no call button */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/50">
                {["Name", "Phone", "City", "Inquiry", "Type", "Status"].map(h => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leads.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No leads found</td></tr>
              ) : leads.map((lead) => (
                <tr key={lead.id} className="group hover:bg-gray-50/80 cursor-pointer transition-colors"
                  onClick={() => { setSelectedLead(lead); setDrawerTab("info"); }}>
                  <td className="px-4 py-3 font-medium text-gray-900">{lead.full_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{lead.phone}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs capitalize">{lead.city || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-[180px] truncate">{lead.inquiry_type || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lead.consultation_type === "in_clinic" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                      {lead.consultation_type === "in_clinic" ? "In-Clinic" : "Online"}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => openEdit(lead, e)}
                        title="Edit lead"
                        className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => openDelete(lead, e)}
                        title="Delete lead"
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}</p>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Lead Detail Drawer */}
      <Sheet open={!!selectedLead} onOpenChange={(o) => !o && setSelectedLead(null)}>
        <SheetContent className="w-[750px] sm:max-w-[750px] overflow-y-auto">
          {selectedLead && activeLead && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-base">{activeLead.full_name || "Lead Detail"}</SheetTitle>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <StatusBadge status={activeLead.status} />
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${activeLead.consultation_type === "in_clinic" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                    {activeLead.consultation_type === "in_clinic" ? "In-Clinic" : "Online"}
                  </span>
                  {activeLead.assigned_to_human && <span className="text-xs px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 font-medium">Human Caller</span>}
                  {isCallInProgress && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" /> Live call active
                    </span>
                  )}
                </div>
              </SheetHeader>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                <button
                  onClick={() => callMutation.mutate(selectedLead.id)}
                  disabled={callMutation.isPending || isCallInProgress}
                  className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition
                    ${isCallInProgress
                      ? "bg-amber-50 text-amber-600 border border-amber-200 cursor-not-allowed"
                      : "bg-violet-600 hover:bg-violet-700 text-white"}`}
                >
                  {callMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Triggering...</>
                    : isCallInProgress
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Call In Progress</>
                    : <><Phone className="w-4 h-4" /> Trigger Call</>}
                </button>
                <button onClick={() => { setDrawerTab("messages"); followupMutation.mutate(selectedLead.id); }}
                  disabled={followupMutation.isPending}
                  className="flex items-center justify-center gap-2 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition">
                  {followupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                  Send WhatsApp
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-100 mb-4">
                {(["info", "calls", "appointments", "messages"] as const).map((tab) => (
                  <button key={tab} onClick={() => setDrawerTab(tab)}
                    className={`px-4 py-2 text-xs font-medium border-b-2 transition capitalize ${drawerTab === tab ? "border-violet-500 text-violet-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                    {tab}
                  </button>
                ))}
              </div>

              {/* Info Tab */}
              {drawerTab === "info" && (
                <div className="space-y-5">

                  {/* Patient info — 2 column grid */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    {[
                      ["Phone", activeLead.phone],
                      ["City", activeLead.city],
                      ["Email", activeLead.email],
                      ["Platform", activeLead.platform],
                      ["Primary Inquiry", activeLead.inquiry_type],
                      ["Second Inquiry", activeLead.second_inquiry_type],
                      ["Tests Done", activeLead.tests_done],
                      ["Working Professional", activeLead.is_working_professional],
                      ["Campaign", activeLead.campaign_name],
                      ["Ad Name", activeLead.ad_name],
                      ["Created", fmtDateTime(activeLead.created_at)],
                    ].map(([k, v]) => v ? (
                      <div key={k} className="bg-gray-50/80 rounded-xl px-3 py-2.5 border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">{k}</p>
                        <p className="text-sm text-gray-800 font-medium truncate">{v}</p>
                      </div>
                    ) : null)}
                  </div>

                  {/* Problem description — full width */}
                  {activeLead.problem_description && (
                    <div className="bg-violet-50/60 rounded-xl px-4 py-3 border border-violet-100">
                      <p className="text-[10px] text-violet-500 font-semibold uppercase tracking-wide mb-1">Problem Description</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{activeLead.problem_description}</p>
                    </div>
                  )}

                  {/* Book appointment — side by side */}
                  <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
                      <CalendarPlus className="w-4 h-4 text-violet-500" /> Book Appointment
                    </h4>
                    <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                      <input type="datetime-local" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 col-span-1" />
                      <select value={bookingType} onChange={(e) => setBookingType(e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white col-span-1">
                        <option value="online">Online (Video Call)</option>
                        <option value="in_clinic">In-Clinic (Agra)</option>
                      </select>
                    </div>
                    <button onClick={() => bookMutation.mutate()} disabled={!bookingDate || bookMutation.isPending}
                      className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2">
                      {bookMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Confirm & Send WhatsApp Confirmation
                    </button>
                  </div>
                </div>
              )}

              {/* Calls Tab */}
              {drawerTab === "calls" && (
                <div className="space-y-4">
                  {(callsData?.data ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No calls yet</p>
                  ) : (callsData?.data ?? []).map((c: CallLog) => (
                    <div key={c.id} className="rounded-xl border border-gray-100 overflow-hidden">
                      {/* Call header */}
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-gray-500">Attempt #{c.attempt_number}</span>
                          <span className="text-xs text-gray-400">{fmtDateTime(c.started_at)}</span>
                          {c.duration_seconds ? (
                            <span className="text-xs text-gray-400">
                              · {Math.floor(c.duration_seconds / 60)}:{String(c.duration_seconds % 60).padStart(2, "0")}
                            </span>
                          ) : null}
                          {c.language_used && <span className="text-[10px] px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500 capitalize">{c.language_used}</span>}
                        </div>
                        {c.outcome && <StatusBadge status={c.outcome} />}
                      </div>

                      {/* Summary */}
                      {c.summary && (
                        <div className="px-4 py-2.5 bg-white border-b border-gray-50">
                          <p className="text-xs text-gray-500 italic">{c.summary}</p>
                        </div>
                      )}

                      {/* Transcript as chat bubbles */}
                      {c.transcript && (
                        <div className="px-4 py-3 bg-white space-y-2 max-h-64 overflow-y-auto">
                          {c.transcript.split("\n").filter(Boolean).map((line, i) => {
                            const isAI = line.startsWith("assistant:");
                            const isUser = line.startsWith("user:");
                            const text = line.replace(/^(assistant|user):\s*/, "");
                            return (
                              <div key={i} className={`flex gap-2 ${isAI ? "justify-start" : "justify-end"}`}>
                                {isAI && <span className="text-[9px] font-bold text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">AI</span>}
                                <p className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] leading-relaxed
                                  ${isAI ? "bg-violet-50 text-violet-900 rounded-tl-none" : isUser ? "bg-gray-100 text-gray-800 rounded-tr-none" : "bg-gray-50 text-gray-500"}`}>
                                  {text}
                                </p>
                                {isUser && <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded self-start mt-0.5 shrink-0">P</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Appointments Tab */}
              {drawerTab === "appointments" && (
                <div className="space-y-3">
                  {(apptsData?.data ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No appointments</p>
                  ) : (apptsData?.data ?? []).map((a: Appt) => (
                    <div key={a.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-800">{fmtDateTime(a.appointment_date)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.status === "booked" ? "bg-green-50 text-green-600" : a.status === "cancelled" ? "bg-red-50 text-red-600" : "bg-gray-50 text-gray-600"}`}>{a.status}</span>
                      </div>
                      <p className="text-xs text-gray-500">{a.appointment_type} · {a.inquiry_type || "General"}</p>
                      {a.notes && <p className="text-xs text-gray-400 mt-1">{a.notes}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Messages Tab */}
              {drawerTab === "messages" && (
                <div className="space-y-3">
                  {(smsData?.data ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No messages sent</p>
                  ) : (smsData?.data ?? []).map((s: SMS) => (
                    <div key={s.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-600 capitalize">{s.sms_type?.replace("_", " ")}</span>
                        <div className="flex gap-2">
                          <span className="text-xs text-gray-400 capitalize">{s.language}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${s.status === "sent" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>{s.status}</span>
                        </div>
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

// Local types
interface Lead {
  id: number; full_name: string; phone: string; email: string; city: string;
  inquiry_type: string; second_inquiry_type: string; problem_description: string;
  tests_done: string; is_working_professional: string; platform: string;
  campaign_name: string; ad_name: string; status: string; consultation_type: string;
  call_count: number; last_called_at: string; assigned_to_human: boolean; created_at: string;
}
interface CallLog { id: number; attempt_number: number; status: string; outcome: string; language_used: string; duration_seconds: number; started_at: string; summary: string; transcript: string; }
interface Appt { id: number; appointment_date: string; appointment_type: string; inquiry_type: string; status: string; notes: string; }
interface SMS { id: number; sms_type: string; language: string; status: string; message: string; sent_at: string; }
