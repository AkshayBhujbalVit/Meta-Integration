"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getKBSections, getKBItems, addKBItem, updateKBItem, deleteKBItem, uploadKBDoc } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Check, X, Upload, Loader2, BookOpen } from "lucide-react";

export default function KnowledgeBasePage() {
  const qc = useQueryClient();
  const [activeSlug, setActiveSlug] = useState<string>("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: sectionsData } = useQuery({
    queryKey: ["kb-sections"],
    queryFn: () => getKBSections(),
  });

  const sections: Section[] = sectionsData?.data ?? [];

  // Auto-select first section (About Doctor) when sections load
  useEffect(() => {
    if (!activeSlug && sections.length > 0) {
      setActiveSlug(sections[0].slug);
    }
  }, [sections, activeSlug]);

  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ["kb-items", activeSlug],
    queryFn: () => getKBItems(activeSlug),
    enabled: !!activeSlug,
  });

  const items: KBItem[] = itemsData?.data?.items ?? [];

  const addMutation = useMutation({
    mutationFn: () => addKBItem(activeSlug, { question: newQ, answer: newA }),
    onSuccess: () => {
      toast.success("Item added");
      setNewQ(""); setNewA(""); setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["kb-items", activeSlug] });
    },
    onError: () => toast.error("Failed to add item"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id }: { id: number }) => updateKBItem(id, { question: editQ, answer: editA }),
    onSuccess: () => {
      toast.success("Updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["kb-items", activeSlug] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteKBItem(id),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["kb-items", activeSlug] });
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadKBDoc(activeSlug, file);
      toast.success(`Uploaded — extracted ${res.data.extracted_length} chars`);
      qc.invalidateQueries({ queryKey: ["kb-items", activeSlug] });
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const startEdit = (item: KBItem) => {
    setEditing(item.id);
    setEditQ(item.question);
    setEditA(item.answer);
  };

  const activeSection = sections.find((s) => s.slug === activeSlug);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 bg-white border-r border-gray-100 flex-shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-500" /> Knowledge Base
          </h2>
        </div>
        <nav className="p-2 space-y-0.5">
          {sections.map((s) => (
            <button key={s.slug} onClick={() => { setActiveSlug(s.slug); setShowAdd(false); setEditing(null); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition ${activeSlug === s.slug ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"}`}>
              {s.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {!activeSlug ? (
          <div className="flex items-center justify-center h-48 text-gray-400">Select a section</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-gray-900">{activeSection?.name}</h1>
                <p className="text-sm text-gray-400">{activeSection?.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className={`flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-600 transition ${uploading ? "opacity-60" : ""}`}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Upload PDF/DOCX
                  <input type="file" accept=".pdf,.docx" className="hidden" onChange={handleUpload} />
                </label>
                <button onClick={() => { setShowAdd(true); setEditing(null); }}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
                  <Plus className="w-4 h-4" /> Add Q&A
                </button>
              </div>
            </div>

            {/* Add form */}
            {showAdd && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-medium text-blue-800">New Q&A Item</h3>
                <input value={newQ} onChange={(e) => setNewQ(e.target.value)}
                  placeholder="Question…"
                  className="w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                <textarea value={newA} onChange={(e) => setNewA(e.target.value)}
                  placeholder="Answer…" rows={3}
                  className="w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => addMutation.mutate()} disabled={!newQ || !newA || addMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition">
                    {addMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
                  </button>
                  <button onClick={() => { setShowAdd(false); setNewQ(""); setNewA(""); }}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Items */}
            {itemsLoading ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No items yet — add one above</div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4">
                    {editing === item.id ? (
                      <div className="space-y-3">
                        <input value={editQ} onChange={(e) => setEditQ(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <textarea value={editA} onChange={(e) => setEditA(e.target.value)} rows={3}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                        <div className="flex gap-2">
                          <button onClick={() => updateMutation.mutate({ id: item.id })}
                            disabled={updateMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg transition">
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                          </button>
                          <button onClick={() => setEditing(null)}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50 transition">
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-gray-800">Q: {item.question}</p>
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => startEdit(item)}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-400 hover:text-blue-600 transition">
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => { if (confirm("Delete this item?")) deleteMutation.mutate(item.id); }}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">A: {item.answer}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface Section { id: number; name: string; slug: string; description: string; }
interface KBItem { id: number; question: string; answer: string; }
