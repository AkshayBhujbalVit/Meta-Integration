"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getClients, createClient, updateClient, deleteClient, connectMetaPage } from "@/lib/api";
import { toast } from "sonner";
import Link from "next/link";
import {
  Building2, Plus, Pencil, Trash2, X, Loader2, AlertTriangle,
  Phone, Mail, Check, Settings2, Globe, ExternalLink,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id: number;
  name: string;
  business_type: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  meta_page_id: string | null;
  meta_page_name: string | null;
  is_active: boolean;
  created_at: string;
}

type ClientForm = {
  name: string;
  business_type: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  notes: string;
};

type MetaForm = {
  meta_page_id: string;
  meta_page_name: string;
  meta_access_token: string;
};

const EMPTY_FORM: ClientForm = {
  name: "", business_type: "", phone: "", email: "",
  website: "", address: "", city: "", notes: "",
};

const BUSINESS_TYPES = [
  "Clinic / Healthcare", "Real Estate", "Insurance", "Education",
  "Finance / BFSI", "E-commerce", "Travel / Hospitality", "Other",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const qc = useQueryClient();

  const [addOpen, setAddOpen]               = useState<boolean>(false);
  const [editTarget, setEditTarget]         = useState<Client | null>(null);
  const [editForm, setEditForm]             = useState<ClientForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget]     = useState<Client | null>(null);
  const [metaTarget, setMetaTarget]         = useState<Client | null>(null);
  const [metaForm, setMetaForm]             = useState<MetaForm>({ meta_page_id: "", meta_page_name: "", meta_access_token: "" });
  const [newForm, setNewForm]               = useState<ClientForm>(EMPTY_FORM);

  const { data, isLoading } = useQuery<{ data: Client[] }>({
    queryKey: ["clients"],
    queryFn: () => getClients() as unknown as Promise<{ data: Client[] }>,
  });
  const clients: Client[] = data?.data ?? [];

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: () => createClient(newForm),
    onSuccess: () => {
      toast.success("Client created");
      setAddOpen(false);
      setNewForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["lead-filters"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to create client"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateClient(editTarget!.id, editForm),
    onSuccess: () => {
      toast.success("Client updated");
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["lead-filters"] });
    },
    onError: () => toast.error("Failed to update client"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteClient(deleteTarget!.id),
    onSuccess: () => {
      toast.success("Client deleted");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["lead-filters"] });
    },
    onError: () => toast.error("Failed to delete client"),
  });

  const metaMutation = useMutation({
    mutationFn: () => connectMetaPage(metaTarget!.id, metaForm),
    onSuccess: () => {
      toast.success("Meta page connected");
      setMetaTarget(null);
      setMetaForm({ meta_page_id: "", meta_page_name: "", meta_access_token: "" });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail || "Failed to connect Meta page"),
  });

  const openEdit = (client: Client) => {
    setEditForm({
      name: client.name || "",
      business_type: client.business_type || "",
      phone: client.phone || "",
      email: client.email || "",
      website: client.website || "",
      address: client.address || "",
      city: client.city || "",
      notes: client.notes || "",
    });
    setEditTarget(client);
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500">{clients.length} client{clients.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> Add Client
        </button>
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
                {["Client", "Business Type", "Contact", "Meta Page", "Status", ""].map(h => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-gray-400">
                    <Building2 className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                    No clients yet — add your first client
                  </td>
                </tr>
              ) : clients.map((client: Client) => (
                <tr key={client.id} className="group hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${client.id}`} className="font-medium text-gray-900 hover:text-blue-600 transition-colors">
                      {client.name}
                    </Link>
                    {client.city && <p className="text-xs text-gray-400">{client.city}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{client.business_type || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {client.phone && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Phone className="w-3 h-3 text-gray-300" /> {client.phone}
                        </div>
                      )}
                      {client.email && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Mail className="w-3 h-3 text-gray-300" /> {client.email}
                        </div>
                      )}
                      {!client.phone && !client.email && <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {client.meta_page_id ? (
                      <div className="flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-xs text-gray-600">{client.meta_page_name || client.meta_page_id}</span>
                      </div>
                    ) : (
                      <Link href={`/clients/${client.id}?tab=meta`}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                        + Connect
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${client.is_active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                      {client.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/clients/${client.id}`}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-blue-600 hover:bg-blue-50 font-medium transition-colors">
                        <Settings2 className="w-3.5 h-3.5" /> Manage
                      </Link>
                      <button
                        onClick={() => openEdit(client)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(client)}
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
      </div>

      {/* Add Client Modal */}
      {addOpen && (
        <ClientFormModal
          title="Add New Client"
          form={newForm}
          setForm={setNewForm}
          onSubmit={() => createMutation.mutate()}
          onClose={() => { setAddOpen(false); setNewForm(EMPTY_FORM); }}
          isPending={createMutation.isPending}
          submitLabel="Create Client"
        />
      )}

      {/* Edit Client Modal */}
      {editTarget && (
        <ClientFormModal
          title={`Edit — ${editTarget.name}`}
          form={editForm}
          setForm={setEditForm}
          onSubmit={() => updateMutation.mutate()}
          onClose={() => setEditTarget(null)}
          isPending={updateMutation.isPending}
          submitLabel="Save Changes"
        />
      )}

      {/* Connect Meta Modal */}
      {metaTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Connect Meta Page</h2>
                <p className="text-xs text-gray-400 mt-0.5">{metaTarget.name}</p>
              </div>
              <button onClick={() => setMetaTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 leading-relaxed">
                Go to <strong>Meta for Developers → Your App → Webhooks</strong> and subscribe to the <strong>leadgen</strong> field on the page below. Use the Page Access Token from Meta Business Suite.
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Facebook Page ID *</label>
                <input
                  value={metaForm.meta_page_id}
                  onChange={e => setMetaForm((p: MetaForm) => ({ ...p, meta_page_id: e.target.value }))}
                  placeholder="e.g. 123456789012345"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Page Name (optional)</label>
                <input
                  value={metaForm.meta_page_name}
                  onChange={e => setMetaForm((p: MetaForm) => ({ ...p, meta_page_name: e.target.value }))}
                  placeholder="e.g. Sharma Clinic Official"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Page Access Token *</label>
                <textarea
                  value={metaForm.meta_access_token}
                  onChange={e => setMetaForm((p: MetaForm) => ({ ...p, meta_access_token: e.target.value }))}
                  placeholder="EAAxxxxxxxxxxxxxxxx..."
                  rows={3}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setMetaTarget(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => metaMutation.mutate()}
                disabled={!metaForm.meta_page_id || !metaForm.meta_access_token || metaMutation.isPending}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                {metaMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1">Delete Client</h3>
            <p className="text-sm text-gray-500 mb-1">Delete <span className="font-semibold">{deleteTarget.name}</span>?</p>
            <p className="text-xs text-red-400 mb-6">All campaigns and associated data will be removed.</p>
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
  );
}

// ── Shared client form modal ──────────────────────────────────────────────────

function ClientFormModal({
  title, form, setForm, onSubmit, onClose, isPending, submitLabel,
}: {
  title: string;
  form: ClientForm;
  setForm: React.Dispatch<React.SetStateAction<ClientForm>>;
  onSubmit: () => void;
  onClose: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Business Name *</label>
              <input value={form.name}
                onChange={e => setForm((p: ClientForm) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Sharma Clinic"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Business Type</label>
              <select value={form.business_type}
                onChange={e => setForm((p: ClientForm) => ({ ...p, business_type: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Select type…</option>
                {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Phone</label>
              <input value={form.phone}
                onChange={e => setForm((p: ClientForm) => ({ ...p, phone: e.target.value }))}
                placeholder="+91…"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Email</label>
              <input value={form.email}
                onChange={e => setForm((p: ClientForm) => ({ ...p, email: e.target.value }))}
                placeholder="contact@example.com"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Website</label>
              <div className="mt-1 flex items-center gap-1 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 pr-3">
                <Globe className="w-3.5 h-3.5 text-gray-300 ml-3 shrink-0" />
                <input value={form.website}
                  onChange={e => setForm((p: ClientForm) => ({ ...p, website: e.target.value }))}
                  placeholder="https://example.com"
                  className="flex-1 px-2 py-2 text-sm bg-transparent focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">City</label>
              <input value={form.city}
                onChange={e => setForm((p: ClientForm) => ({ ...p, city: e.target.value }))}
                placeholder="e.g. Mumbai"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Address</label>
              <input value={form.address}
                onChange={e => setForm((p: ClientForm) => ({ ...p, address: e.target.value }))}
                placeholder="Full address"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Notes</label>
              <textarea value={form.notes}
                onChange={e => setForm((p: ClientForm) => ({ ...p, notes: e.target.value }))}
                placeholder="Any notes about this client…"
                rows={2}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button onClick={onClose}
            className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-white">Cancel</button>
          <button onClick={onSubmit} disabled={!form.name || isPending}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
