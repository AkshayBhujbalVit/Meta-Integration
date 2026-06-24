"use client";

import { useState } from "react";
import {
  BookOpen, CheckCircle2, ChevronDown, ChevronRight,
  ExternalLink, Globe, Link2, Mail, Phone,
  Search, Share2, Zap, Shield, ArrowRight, Copy, Check,
  BarChart3, Megaphone, AlertTriangle, Users, Bot,
  ClipboardCheck, CalendarCheck, KeyRound, PhoneCall,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CopyBox({ children, label = "Your link" }: { children: string; label?: string }) {
  return (
    <div className="relative bg-gray-900 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
        <span className="text-[10px] font-mono text-gray-500 uppercase">{label}</span>
      </div>
      <div className="relative p-4">
        <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto pr-8">{children}</pre>
        <CopyCode code={children} />
      </div>
    </div>
  );
}

function InfoBadge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
  );
}

function SectionCard({ id, icon: Icon, title, badge, color, children }: {
  id: string; icon: React.ElementType; title: string;
  badge?: { label: string; cls: string }; color: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div id={id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center shrink-0 shadow-sm`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-gray-900">{title}</p>
            {badge && <InfoBadge label={badge.label} cls={badge.cls} />}
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-50">{children}</div>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 pt-4">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center shadow">
          {n}
        </div>
        <div className="w-px flex-1 bg-blue-100 mt-2 min-h-4" />
      </div>
      <div className="pb-5 min-w-0 flex-1">
        <p className="font-bold text-gray-900 mb-2">{title}</p>
        <div className="text-sm text-gray-600 space-y-2">{children}</div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <code className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>;
}

// ── TOC ───────────────────────────────────────────────────────────────────────

const TOC = [
  { id: "flow",       icon: ArrowRight,   label: "How it works" },
  { id: "quickstart", icon: CheckCircle2, label: "Getting started" },
  { id: "meta",       icon: Share2,       label: "Meta Lead Ads" },
  { id: "hubspot",    icon: Globe,        label: "HubSpot CRM" },
  { id: "google",     icon: Search,       label: "Google Ads" },
  { id: "klaviyo",    icon: Mail,         label: "Klaviyo" },
  { id: "agent",      icon: Bot,          label: "Your AI Agent" },
  { id: "dashboard",  icon: BarChart3,    label: "Your dashboard" },
  { id: "security",   icon: Shield,       label: "Privacy & security" },
  { id: "faq",        icon: AlertTriangle,label: "FAQ" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SetupGuidePage() {
  return (
    <div className="min-h-full bg-gray-50/60">
      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.15),_transparent_60%)]" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-black text-xl">Setup Guide</p>
                <p className="text-slate-400 text-sm">Vidushi Infotech AI Calling Platform</p>
              </div>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed max-w-2xl">
              A simple guide to connecting your lead sources and getting your AI calling agent live —
              no technical knowledge required.
            </p>
          </div>
        </div>

        {/* TOC */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">On this page</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TOC.map(({ id, icon: Icon, label }) => (
              <a key={id} href={`#${id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors group">
                <Icon className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500 shrink-0" />
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* ── How it works ───────────────────────────────────────────────── */}
        <SectionCard id="flow" icon={ArrowRight} title="How it works — end to end"
          color="bg-blue-600">
          <div className="pt-4 space-y-4">
            <p className="text-sm text-gray-600">
              Once you&apos;re connected, you don&apos;t need to do anything else — every new lead is
              handled automatically, from the moment they fill in a form to the moment a meeting
              lands on your calendar.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { n: 1, icon: Share2,       color: "bg-blue-100 text-blue-600",     title: "A lead comes in",      desc: "Someone fills out your Facebook/Instagram ad, HubSpot form, Google lead form, or signs up via Klaviyo." },
                { n: 2, icon: ClipboardCheck, color: "bg-purple-100 text-purple-600", title: "We capture it instantly", desc: "The lead shows up in your Leads list right away, matched to the right campaign automatically." },
                { n: 3, icon: PhoneCall,    color: "bg-emerald-100 text-emerald-600", title: "Your AI agent calls",  desc: "Within minutes, your AI agent calls the lead's phone number — as long as it's inside your calling hours." },
                { n: 4, icon: Bot,          color: "bg-orange-100 text-orange-600",   title: "A real conversation happens", desc: "The agent talks naturally, following the script and goals you set for that campaign." },
                { n: 5, icon: CalendarCheck, color: "bg-pink-100 text-pink-600",      title: "A meeting gets booked", desc: "If the lead is interested, the agent books an appointment — synced straight to your calendar." },
                { n: 6, icon: BarChart3,    color: "bg-sky-100 text-sky-600",         title: "You watch it all happen", desc: "Your dashboard shows every call, every booking, and your conversion rate in real time." },
              ].map(({ n, icon: Icon, color, title, desc }) => (
                <div key={n} className="flex gap-3 p-4 rounded-xl bg-gray-50 border border-gray-100">
                  <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center shrink-0 text-sm font-black`}>
                    {n}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <Icon className={`w-3.5 h-3.5 ${color.split(" ")[1]}`} />
                      {title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── Getting started ────────────────────────────────────────────── */}
        <SectionCard id="quickstart" icon={CheckCircle2} title="Getting started — 4 things to do"
          color="bg-emerald-600">
          <div className="pt-4 space-y-3">
            {[
              { n: "1", title: "Connect your lead sources", desc: "Head to Integrations and connect whichever platforms you advertise on — Meta, HubSpot, Google Ads, Klaviyo.", icon: Link2 },
              { n: "2", title: "Set up your AI Agent", desc: "Go to Campaigns and tell us how your agent should sound, what it should say, and when it should call.", icon: Bot },
              { n: "3", title: "Turn it on", desc: "Flip your campaign to Active. From this point on, new leads trigger calls automatically.", icon: Zap },
              { n: "4", title: "Watch it work", desc: "Check Leads, Calls, and Appointments to see results coming in live.", icon: BarChart3 },
            ].map(({ n, title, desc, icon: Icon }) => (
              <div key={n} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 font-black text-sm">
                  {n}
                </div>
                <Icon className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="flex-1">
                  <span className="text-sm font-semibold text-gray-900">{title}</span>
                  <span className="text-xs text-gray-500 ml-2">{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── Meta ───────────────────────────────────────────────────────── */}
        <SectionCard id="meta" icon={Share2} title="Connect Meta Lead Ads"
          badge={{ label: "One click", cls: "bg-blue-50 text-blue-700" }}
          color="bg-blue-600">
          <div className="pt-4 space-y-4">
            <p className="text-sm text-gray-600">
              Connect your Facebook Page once, and every lead from your Facebook and Instagram lead
              ads flows straight into your dashboard — no spreadsheets, no manual downloads.
            </p>
            <Step n={1} title="Open Integrations">
              <p>Go to <strong>Integrations → Meta Ads</strong>.</p>
            </Step>
            <Step n={2} title="Click Connect with Facebook">
              <p>A Facebook login window opens. Log in and select the Page that runs your ads.</p>
            </Step>
            <Step n={3} title="That's it">
              <p>The window closes and your account shows as <strong>Connected</strong>. New leads from your lead ad forms start arriving automatically.</p>
            </Step>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
              <p className="font-bold flex items-center gap-1.5 mb-1"><AlertTriangle className="w-3.5 h-3.5" /> Tip</p>
              <p>If the login window doesn&apos;t open, your browser may be blocking pop-ups — allow pop-ups for this site and try again.</p>
            </div>
          </div>
        </SectionCard>

        {/* ── HubSpot ─────────────────────────────────────────────────────── */}
        <SectionCard id="hubspot" icon={Globe} title="Connect HubSpot CRM"
          badge={{ label: "OAuth or token", cls: "bg-orange-50 text-orange-700" }}
          color="bg-orange-500">
          <div className="pt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border-2 border-orange-200 bg-orange-50 rounded-xl p-4">
                <p className="text-sm font-bold text-orange-900 mb-1 flex items-center gap-1.5">
                  <Link2 className="w-4 h-4" /> Option A — one-click connect (recommended)
                </p>
                <p className="text-xs text-orange-700 leading-relaxed">Click the button, log in to HubSpot, authorise access — done in under a minute.</p>
              </div>
              <div className="border border-gray-200 bg-gray-50 rounded-xl p-4">
                <p className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4" /> Option B — paste an access key
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">Prefer not to log in directly? Paste an access key from your own HubSpot account settings instead.</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-bold text-gray-800 mb-1">Option A</p>
              <Step n={1} title="Open Integrations">
                <p><strong>Integrations → HubSpot CRM → Connect with HubSpot.</strong></p>
              </Step>
              <Step n={2} title="Authorise">
                <p>A HubSpot window opens — log in and approve access. The window closes automatically when it&apos;s done.</p>
              </Step>
              <Step n={3} title="Turn on live sync (optional)">
                <p>For new contacts to sync the moment they&apos;re created, copy the link shown in the HubSpot panel and add it as a webhook under HubSpot → Settings → Integrations → Webhooks.</p>
              </Step>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-bold text-gray-800 mb-1">Option B — paste an access key</p>
              <p className="text-xs text-gray-600">In your HubSpot account, go to Settings → Integrations → Private Apps, create one, and copy its access token. Paste it into the platform under <strong>Integrations → HubSpot → Access Key tab</strong>.</p>
            </div>
          </div>
        </SectionCard>

        {/* ── Google Ads ────────────────────────────────────────────────────── */}
        <SectionCard id="google" icon={Search} title="Connect Google Ads"
          badge={{ label: "Copy & paste a link", cls: "bg-red-50 text-red-700" }}
          color="bg-red-500">
          <div className="pt-4 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
              <p className="font-bold mb-1">No login needed</p>
              <p className="text-xs leading-relaxed">Google Ads sends leads straight to a private link we generate for you. You just copy it and paste it into Google Ads — that&apos;s the whole setup.</p>
            </div>

            <Step n={1} title="Generate your link">
              <p><strong>Integrations → Google Ads → Generate Link.</strong></p>
              <CopyBox label="example link">{`https://app.vidushiinfotech.com/leads/google/your-unique-id`}</CopyBox>
            </Step>
            <Step n={2} title="Paste it into Google Ads">
              <p>In Google Ads, go to <strong>Assets → Lead Form Asset</strong>, open your form, and under <strong>Lead Delivery</strong> choose <strong>Webhook</strong> — paste the link there.</p>
            </Step>
            <Step n={3} title="Tell us which form it is">
              <p>Back in the platform, open your campaign's <strong>Lead Source</strong> tab and enter that form&apos;s name or ID, so leads land in the right campaign.</p>
            </Step>
          </div>
        </SectionCard>

        {/* ── Klaviyo ────────────────────────────────────────────────────── */}
        <SectionCard id="klaviyo" icon={Mail} title="Connect Klaviyo"
          badge={{ label: "API key", cls: "bg-purple-50 text-purple-700" }}
          color="bg-purple-600">
          <div className="pt-4 space-y-4">
            <Step n={1} title="Get your Klaviyo key">
              <p>In Klaviyo: Account (top-right) → Settings → <strong>API Keys</strong> → Create Private Key.</p>
              <p className="mt-1"><a href="https://www.klaviyo.com/account#api-keys-tab" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">Open Klaviyo API Keys <ExternalLink className="w-3 h-3" /></a></p>
            </Step>
            <Step n={2} title="Paste it into the platform">
              <p><strong>Integrations → Klaviyo → paste key → Save.</strong> A private link will appear once it&apos;s saved.</p>
            </Step>
            <Step n={3} title="Add it as a webhook in Klaviyo">
              <p>Klaviyo → Integrations → <strong>Webhooks → Add Webhook</strong> → paste the link, and choose the events you want to trigger calls (e.g. <Tag>Subscribed to List</Tag> or <Tag>Filled Out Form</Tag>).</p>
            </Step>
          </div>
        </SectionCard>

        {/* ── AI Agent ─────────────────────────────────────────────────────── */}
        <SectionCard id="agent" icon={Bot} title="Set up your AI Agent"
          color="bg-indigo-600">
          <div className="pt-4 space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
              <p className="font-bold flex items-center gap-1.5 mb-1"><AlertTriangle className="w-4 h-4" /> This is the most important step</p>
              <p className="text-xs leading-relaxed">Your AI agent lives inside a <strong>Campaign</strong>. Without an active campaign linked to your lead source, leads will sit in your list but the AI won&apos;t call them.</p>
            </div>

            <Step n={1} title="Create a Campaign">
              <p><strong>Campaigns → New Campaign.</strong> Give it a name you&apos;ll recognise, like &quot;Summer Promo&quot; or &quot;Website Leads&quot;.</p>
            </Step>
            <Step n={2} title="Set up the AI Agent tab">
              <div className="space-y-1 text-xs text-gray-600">
                <p><strong>Agent Name</strong> — what the AI introduces itself as ("Hi, I&apos;m Priya from Vidushi Infotech")</p>
                <p><strong>Agent Script</strong> — what you want it to say and ask, in your own words</p>
                <p><strong>Language</strong> — Hindi, English, or Hinglish</p>
                <p><strong>Calling Hours</strong> — the window it&apos;s allowed to call in (e.g. 9 AM to 8 PM)</p>
                <p><strong>Caller Number</strong> — the number that shows up on the lead&apos;s phone</p>
              </div>
            </Step>
            <Step n={3} title="Link it to a lead source">
              <p>Open the <strong>Lead Source</strong> tab and choose which connected platform feeds this campaign — Meta, HubSpot, Google Ads, or Klaviyo — then enter that platform&apos;s form or list name/ID.</p>
            </Step>
            <Step n={4} title="Turn it on">
              <p>Switch the campaign to <strong>Active</strong>. From now on, every matching lead triggers a call automatically.</p>
            </Step>
          </div>
        </SectionCard>

        {/* ── Your dashboard ──────────────────────────────────────────────── */}
        <SectionCard id="dashboard" icon={BarChart3} title="Your dashboard"
          color="bg-teal-600">
          <div className="pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Users,        color: "bg-blue-50 text-blue-600",    title: "Leads",        desc: "Every lead that's come in, which campaign it belongs to, and its current status." },
                { icon: Phone,        color: "bg-emerald-50 text-emerald-600", title: "Calls",       desc: "Every call your AI agent made — outcome, duration, and a summary of what was discussed." },
                { icon: CalendarCheck, color: "bg-pink-50 text-pink-600",    title: "Appointments", desc: "Every meeting booked, synced with your calendar so you never miss one." },
                { icon: BarChart3,    color: "bg-sky-50 text-sky-600",      title: "Analytics",     desc: "Conversion rates and trends, so you can see what's working." },
                { icon: Zap,          color: "bg-orange-50 text-orange-600", title: "Usage",        desc: "How many calls and minutes you've used this billing period." },
                { icon: Megaphone,    color: "bg-indigo-50 text-indigo-600", title: "Campaigns",    desc: "Manage your AI agents, scripts, and calling hours from one place." },
              ].map(({ icon: Icon, color, title, desc }) => (
                <div key={title} className="flex gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50">
                  <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── Security ───────────────────────────────────────────────────── */}
        <SectionCard id="security" icon={Shield} title="Privacy & security"
          color="bg-gray-800">
          <div className="pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: "Your accounts stay yours",  desc: "You can disconnect any integration at any time from the Integrations page." },
                { title: "Your data is encrypted",     desc: "Everything you connect is stored securely and never shared with other businesses on the platform." },
                { title: "You control your AI agent",  desc: "Calling hours, scripts, and campaign status are fully in your hands — pause or change anything, anytime." },
                { title: "No surprise calls",          desc: "Your agent only calls within the hours you set and only for active campaigns." },
              ].map(({ title, desc }) => (
                <div key={title} className="flex gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-gray-800">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <SectionCard id="faq" icon={AlertTriangle} title="Frequently asked questions"
          color="bg-red-600">
          <div className="pt-4 space-y-2">
            {[
              {
                problem: "My leads are showing up, but the AI isn't calling them",
                fix: "Check three things: your campaign is set to Active, the current time is inside your calling hours, and the lead has a valid phone number.",
              },
              {
                problem: "Leads aren't landing in the right campaign",
                fix: "Make sure the form/list ID is filled in on your campaign's Lead Source tab — without it, we can't tell which campaign a lead belongs to.",
              },
              {
                problem: "\"Connect with Facebook\" or \"Connect with HubSpot\" shows an error",
                fix: "Try again — it's usually a temporary login hiccup. If it keeps happening, contact us and we'll take a look.",
              },
              {
                problem: "The connect pop-up doesn't open",
                fix: "Your browser is probably blocking pop-ups for this site. Allow pop-ups (usually a small icon in the address bar) and try again.",
              },
              {
                problem: "I disconnected an integration by mistake",
                fix: "No data is lost — just reconnect it from the Integrations page and everything resumes.",
              },
              {
                problem: "I want to pause calls temporarily",
                fix: "Switch the campaign to Inactive in Campaigns. Leads will still be captured, but no calls will go out until you reactivate it.",
              },
            ].map(({ problem, fix }) => (
              <details key={problem} className="border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors select-none">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-sm font-medium text-gray-800">{problem}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 ml-auto group-open:rotate-90 transition-transform" />
                </summary>
                <div className="px-4 pb-4 pt-1 text-sm text-gray-600 bg-amber-50 leading-relaxed">
                  {fix}
                </div>
              </details>
            ))}
          </div>
        </SectionCard>

        <p className="text-xs text-gray-400 text-center pb-4">
          Questions? Contact{" "}
          <a href="mailto:dev@vidushiinfotech.com" className="text-blue-500 hover:underline font-medium">
            dev@vidushiinfotech.com
          </a>
        </p>
      </div>
    </div>
  );
}
