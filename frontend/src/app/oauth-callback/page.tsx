"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { selectMetaPage } from "@/lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  cancelled:      "You cancelled the authorisation. Close this window and try again.",
  invalid_state:  "Security check failed (CSRF). Please close this window and click Connect again.",
  exchange_failed:"Could not connect to the platform's server. Check your .env App ID / Secret and try again.",
  no_pages:       "No pages found on this account. Make sure you have admin access to at least one page.",
  access_denied:  "You denied access. Close this window and try again.",
};

interface Page { id: string; name: string }

export default function OAuthCallbackPage() {
  const [state, setState] = useState<"loading" | "success" | "error" | "select">("loading");
  const [message, setMessage] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [session, setSession] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pl = params.get("platform") || "";
    const success = params.get("success");
    const error = params.get("error");
    const select = params.get("select");

    setPlatform(pl);

    if (success === "1") {
      const data = {
        type: "oauth-success",
        platform: pl,
        page_name: params.get("page_name") || "",
        page_id: params.get("page_id") || "",
        portal_id: params.get("portal_id") || "",
        hub_domain: params.get("hub_domain") || "",
      };
      if (window.opener) {
        window.opener.postMessage(data, window.location.origin);
        window.close();
      } else {
        setMessage(`${pl === "meta" ? data.page_name || data.page_id : data.hub_domain || data.portal_id} connected!`);
        setState("success");
      }
      return;
    }

    if (error) {
      const msg = ERROR_MESSAGES[error] || `Unknown error: ${error}`;
      if (window.opener) {
        window.opener.postMessage({ type: "oauth-error", platform: pl, error: msg }, window.location.origin);
      }
      setMessage(msg);
      setState("error");
      return;
    }

    if (select === "1") {
      // Multiple FB pages — parse and show selector
      const sid = params.get("session") || "";
      const raw = params.get("pages") || "";
      const parsed: Page[] = raw
        .split("|")
        .filter(Boolean)
        .map((entry) => {
          const colon = entry.indexOf(":");
          return { id: entry.slice(0, colon), name: entry.slice(colon + 1) };
        });
      setSession(sid);
      setPages(parsed);
      setState("select");
      return;
    }

    setState("error");
    setMessage("Something went wrong — no parameters received.");
  }, []);

  async function handleSelectPage(page: Page) {
    setSelecting(page.id);
    try {
      const res = await selectMetaPage(session, page.id);
      const data = res.data as { page_name: string; page_id: string };
      if (window.opener) {
        window.opener.postMessage(
          { type: "oauth-success", platform: "meta", page_name: data.page_name, page_id: data.page_id },
          window.location.origin
        );
        window.close();
      } else {
        setMessage(`${data.page_name} connected!`);
        setState("success");
      }
    } catch {
      setSelecting(null);
      setMessage("Failed to save page — please try again.");
      setState("error");
    }
  }

  const PLATFORM_LABEL: Record<string, string> = {
    meta: "Meta Ads",
    hubspot: "HubSpot",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 px-6 py-5">
          <p className="font-black text-white text-lg">{PLATFORM_LABEL[platform] || platform} Integration</p>
          <p className="text-xs text-blue-200 mt-0.5">Vidushi Infotech AI Platform</p>
        </div>

        <div className="p-6">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <p className="text-sm text-gray-500">Connecting…</p>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-bold text-gray-900 text-center">{message || "Connected successfully!"}</p>
              <p className="text-xs text-gray-400 text-center">You can close this window.</p>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <XCircle className="w-10 h-10 text-red-400" />
              <p className="text-sm text-gray-700 text-center leading-relaxed">{message}</p>
              <button
                onClick={() => window.close()}
                className="px-6 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl"
              >
                Close
              </button>
            </div>
          )}

          {state === "select" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-800">
                You manage {pages.length} Facebook pages. Which one should receive leads?
              </p>
              <div className="space-y-2">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => handleSelectPage(page)}
                    disabled={selecting !== null}
                    className="w-full flex items-center justify-between px-4 py-3 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{page.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{page.id}</p>
                    </div>
                    {selecting === page.id && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
