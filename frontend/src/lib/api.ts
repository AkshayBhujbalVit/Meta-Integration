import axios from "axios";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8009";

export const api = axios.create({ baseURL: BASE });

// Attach token on every request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (email: string, password: string) =>
  api.post("/auth/login", { email, password });

export const getMe = () => api.get("/auth/me");

export const logout = () => api.post("/auth/logout");

// ── Leads ─────────────────────────────────────────────────────────────────────
export const getLeads = (params?: Record<string, string | number>) =>
  api.get("/leads/", { params });

export const getLead = (id: number) => api.get(`/leads/${id}`);

export const createLead = (data: {
  full_name: string; phone: string; city?: string;
  inquiry_type?: string; second_inquiry_type?: string;
  problem_description?: string; consultation_type?: string; email?: string;
  client_id?: number; campaign_id?: number; source_platform?: string;
}) => api.post("/leads/", data);

export const updateLeadStatus = (id: number, status: string, notes?: string) =>
  api.patch(`/leads/${id}/status`, { status, notes });

export const updateLead = (id: number, data: Partial<{
  full_name: string; phone: string; email: string; city: string;
  inquiry_type: string; second_inquiry_type: string;
  problem_description: string; consultation_type: string; notes: string;
}>) => api.patch(`/leads/${id}`, data);

export const deleteLead = (id: number) => api.delete(`/leads/${id}`);

export const assignToHuman = (id: number) =>
  api.patch(`/leads/${id}/status`, { assign_to_human: true });

export const uploadCSV = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/leads/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const getLeadUploads = () => api.get("/leads/uploads");

export const getLeadFilters = () => api.get("/leads/meta/filters");

export const resetStuckCalls = () => api.post("/leads/reset-stuck");

// ── Calls ─────────────────────────────────────────────────────────────────────
export const getCallLogs = (params?: Record<string, string | number>) =>
  api.get("/calling/logs", { params });

export const triggerCall = (leadId: number) =>
  api.post(`/calling/call/${leadId}`);

export const previewVoice = (voice: string) =>
  api.get(`/calling/preview-voice/${voice}`, { responseType: "blob" });

export const getCallHistory = (leadId: number) =>
  api.get(`/calling/call/${leadId}/history`);

export const previewPrompt = (leadId: number) =>
  api.get(`/calling/call/${leadId}/preview`);

// ── Appointments ──────────────────────────────────────────────────────────────
export const getAppointments = (params?: Record<string, string>) =>
  api.get("/appointments/", { params });

export const getLeadAppointments = (leadId: number) =>
  api.get(`/appointments/lead/${leadId}`);

export const bookAppointment = (data: {
  lead_id: number;
  appointment_date: string;
  appointment_type?: string;
  inquiry_type?: string;
  notes?: string;
  language?: string;
}) => api.post("/appointments/", data);

export const deleteUploadBatch = (uploadId: number) =>
  api.delete(`/leads/uploads/${uploadId}`);

export const cancelAppointment = (id: number, reason?: string) =>
  api.post(`/appointments/${id}/cancel`, null, { params: { reason } });

export const updateAppointmentStatus = (id: number, status: string) =>
  api.patch(`/appointments/${id}`, { status });

// ── SMS ───────────────────────────────────────────────────────────────────────
export const getSMSHistory = (leadId: number) =>
  api.get(`/sms/history/${leadId}`);

export const sendFollowup = (leadId: number, language = "hindi") =>
  api.post(`/sms/followup/${leadId}`, null, { params: { language } });

export const sendReminder = (appointmentId: number, language = "hindi") =>
  api.post(`/sms/reminder/${appointmentId}`, null, { params: { language } });

// ── Knowledge Base ────────────────────────────────────────────────────────────
export const getKBSections = () => api.get("/kb/sections");

export const getKBItems = (slug: string) =>
  api.get(`/kb/sections/${slug}/items`);

export const addKBItem = (slug: string, data: { question: string; answer: string }) =>
  api.post(`/kb/sections/${slug}/items`, data);

export const updateKBItem = (id: number, data: Partial<{ question: string; answer: string; is_active: boolean }>) =>
  api.put(`/kb/items/${id}`, data);

export const deleteKBItem = (id: number) => api.delete(`/kb/items/${id}`);

export const uploadKBDoc = (slug: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/kb/sections/${slug}/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const getClinicSettings = () => api.get("/settings/clinic");
export const updateClinicSettings = (data: Record<string, string>) =>
  api.patch("/settings/clinic", data);

export const getCallingConfig = () => api.get("/settings/calling");
export const updateCallingConfig = (data: Record<string, string | number | boolean | null>) =>
  api.patch("/settings/calling", data);

export const getCallingCredentials = () => api.get("/settings/calling/credentials");
export const updateCallingCredentials = (data: Record<string, string>) =>
  api.patch("/settings/calling/credentials", data);

export const activateProvider = (data: { provider: string }) =>
  api.post("/settings/calling/activate-provider", data);

export const batchCall = (leadIds?: number[]) =>
  api.post("/calling/batch", { lead_ids: leadIds ?? null });

export const getMessagingConfig = () => api.get("/settings/messaging");
export const updateMessagingConfig = (data: Record<string, string | boolean>) =>
  api.patch("/settings/messaging", data);

export const getCalendarConfig = () => api.get("/settings/calendar");
export const updateCalendarConfig = (data: Record<string, string | boolean | null | undefined>) =>
  api.patch("/settings/calendar", data);
export const testCalendarConnection = (credentials_json: string, calendar_id: string) =>
  api.post("/settings/calendar/test", { credentials_json, calendar_id });
export const testCalDavConnection = (url: string, username: string, password: string) =>
  api.post("/settings/calendar/test-caldav", { url, username, password });

// ── Analytics ─────────────────────────────────────────────────────────────────
export const getAnalyticsOverview = () => api.get("/analytics/overview");
export const getAnalyticsFunnel = () => api.get("/analytics/funnel");
export const getAnalyticsHeatmap = () => api.get("/analytics/heatmap");
export const getAnalyticsTrends = (period: "7d" | "30d" | "90d") =>
  api.get("/analytics/trends", { params: { period } });
export const getInquiryBreakdown = () => api.get("/analytics/inquiry-breakdown");
export const getCityBreakdown = () => api.get("/analytics/city-breakdown");
export const exportLeads = (format: "excel" | "csv" = "excel") =>
  api.get("/analytics/export", { params: { format }, responseType: "blob" });

// ── WhatsApp ──────────────────────────────────────────────────────────────────
export const getWhatsAppHistory = (leadId: number) =>
  api.get(`/whatsapp/history/${leadId}`);

// ── Usage ─────────────────────────────────────────────────────────────────────
export const getUsageOverview = (period: "7d" | "30d" | "90d" | "all" = "30d") =>
  api.get("/usage/overview", { params: { period } });

// ── Clients ───────────────────────────────────────────────────────────────────
export const getClients = (params?: { is_active?: boolean }) =>
  api.get("/clients", { params });

export const getClient = (id: number) => api.get(`/clients/${id}`);

export const createClient = (data: {
  name: string; business_type?: string; phone?: string; email?: string;
  website?: string; address?: string; city?: string; notes?: string;
}) => api.post("/clients", data);

export const updateClient = (id: number, data: Record<string, string | boolean | null>) =>
  api.patch(`/clients/${id}`, data);

export const deleteClient = (id: number) => api.delete(`/clients/${id}`);

export const uploadClientLogo = (id: number, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/clients/${id}/logo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const connectMetaPage = (clientId: number, data: {
  meta_page_id: string; meta_page_name?: string; meta_access_token: string;
}) => api.post(`/clients/${clientId}/connect-meta`, data);

export const getClientCallingConfig = (clientId: number) =>
  api.get(`/clients/${clientId}/calling-config`);
export const updateClientCallingConfig = (clientId: number, data: {
  provider?: string; account_sid?: string; auth_token?: string;
  from_number?: string; sip_trunk_id?: string;
}) => api.put(`/clients/${clientId}/calling-config`, data);

export const getClientSmsConfig = (clientId: number) =>
  api.get(`/clients/${clientId}/sms-config`);
export const updateClientSmsConfig = (clientId: number, data: {
  provider?: string; from_number?: string; sender_id?: string; api_key?: string;
}) => api.put(`/clients/${clientId}/sms-config`, data);

export const getClientWhatsappConfig = (clientId: number) =>
  api.get(`/clients/${clientId}/whatsapp-config`);
export const updateClientWhatsappConfig = (clientId: number, data: {
  provider?: string; phone_number_id?: string; access_token?: string; business_account_id?: string;
}) => api.put(`/clients/${clientId}/whatsapp-config`, data);

// ── Campaigns ─────────────────────────────────────────────────────────────────
export const getCampaigns = (params?: { client_id?: number; status?: string }) =>
  api.get("/campaigns", { params });

export const getCampaign = (id: number) => api.get(`/campaigns/${id}`);

export const createCampaign = (data: {
  client_id: number; name: string; description?: string;
  agent_name?: string; agent_prompt?: string; language_default?: string;
  call_start_time?: string; call_end_time?: string;
  caller_phone_number?: string; lead_sources?: string;
  meta_form_id?: string; meta_form_name?: string;
  hubspot_list_id?: string;
  google_form_id?: string; google_campaign_id?: string;
  klaviyo_list_id?: string; website_form_id?: string;
}) => api.post("/campaigns", data);

export const updateCampaign = (id: number, data: Record<string, string | number | boolean | null>) =>
  api.patch(`/campaigns/${id}`, data);

export const deleteCampaign = (id: number) => api.delete(`/campaigns/${id}`);

export const getCampaignLeads = (id: number, params?: { status?: string; limit?: number; offset?: number }) =>
  api.get(`/campaigns/${id}/leads`, { params });

export const assignLeadToCampaign = (campaignId: number, leadId: number) =>
  api.post(`/campaigns/${campaignId}/assign-lead/${leadId}`);

export const startCampaignCalls = (campaignId: number) =>
  api.post(`/campaigns/${campaignId}/start-calls`);

// ── Multi-tenant dashboard ────────────────────────────────────────────────────
export const getDashboardOverview = () => api.get("/analytics/dashboard-overview");

// ── Platform-level integrations (org-wide, no per-client selection) ───────────
export const getPlatformIntegrations = () => api.get("/integrations");
export const getPlatformIntegration = (source: string) => api.get(`/integrations/${source}`);

export const connectPlatformMeta = (data: {
  meta_page_id: string; meta_page_name?: string; meta_access_token: string;
}) => api.post("/integrations/meta", data);
export const disconnectPlatformMeta = () => api.delete("/integrations/meta");

export const connectPlatformHubSpot = (data: {
  portal_id?: string; api_key: string; client_secret?: string;
}) => api.post("/integrations/hubspot", data);
export const disconnectPlatformHubSpot = () => api.delete("/integrations/hubspot");

// ── OAuth flows (one-click connect) ───────────────────────────────────────────
export const startMetaOAuth = () => api.post("/oauth/meta/start");
export const selectMetaPage = (session: string, page_id: string) =>
  api.post(`/oauth/meta/select-page?session=${encodeURIComponent(session)}&page_id=${encodeURIComponent(page_id)}`);
export const startHubSpotOAuth = () => api.post("/oauth/hubspot/start");

export const connectPlatformGoogle = (data: { customer_id?: string }) =>
  api.post("/integrations/google", data);
export const disconnectPlatformGoogle = () => api.delete("/integrations/google");

export const connectPlatformKlaviyo = (data: {
  account_id?: string; api_key: string;
}) => api.post("/integrations/klaviyo", data);
export const disconnectPlatformKlaviyo = () => api.delete("/integrations/klaviyo");

export const regeneratePlatformToken = (source: string) =>
  api.post(`/integrations/${source}/regenerate-token`);

export const setIntegrationPaused = (source: string, is_paused: boolean) =>
  api.patch(`/integrations/${source}`, { is_paused });

// ── Meta Ads — campaign/ad-set visibility + lead-form AI toggle ───────────────
export const getMetaAdAccounts = () => api.get("/integrations/meta/ad-accounts");
export const selectMetaAdAccount = (ad_account_id: string) =>
  api.patch("/integrations/meta/ad-account", { ad_account_id });

export const syncMetaCampaigns = () => api.post("/integrations/meta/sync");
export const getMetaSyncedCampaigns = () => api.get("/integrations/meta/campaigns");
export const getMetaLeadForms = () => api.get("/integrations/meta/lead-forms");

export const toggleMetaLeadForm = (formId: number, data: {
  ai_enabled: boolean;
  campaign_id?: number;
  create_campaign?: { client_id: number; name: string };
}) => api.patch(`/integrations/meta/lead-forms/${formId}`, data);

// ── Legacy per-client webhook helpers (kept for existing client records) ──────
export const generateWebhookToken = (clientId: number) =>
  api.post(`/clients/${clientId}/generate-webhook-token`);

export const connectHubSpot = (clientId: number, data: {
  portal_id?: string; api_key: string; client_secret?: string;
}) => api.post(`/clients/${clientId}/connect-hubspot`, data);

export const connectKlaviyo = (clientId: number, data: {
  account_id?: string; api_key: string;
}) => api.post(`/clients/${clientId}/connect-klaviyo`, data);
