"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { IMAGE_MODELS, PROVIDERS, defaultModelFor, getModel, type ProviderId } from "@/config/models";
import { THEMES } from "@/config/themes";
import { signOut } from "../login/actions";
import { ProviderLogo } from "@/components/provider-logo";
import { ModelMenu } from "@/components/model-menu";
import { ToolsMenu } from "@/components/tools-menu";
import { ProjectDialog } from "@/components/project-dialog";

// Chats, projects and usage live in Supabase (see app/api/*). Each AI app has its own chats and projects.
type Message = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "image";
  content: string;
  imageUrl?: string | null;
  modelId?: string;
  status: "complete" | "partial" | "streaming" | "error";
  error?: string; // friendly error text for a failed reply
};
type ConvSummary = { id: string; title: string; modelId: string; projectId: string | null; updatedAt: string };
type Project = { id: string; name: string; instructions: string };
type Usage = { live: boolean; allowance: number; spent: number; reserved: number };

const APP_KEY = "polar.app.v1";
const DRAFT = "draft"; // messages key for a chat that hasn't been saved yet
const tmpId = () => `tmp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const perProvider = <T,>(v: () => T) => Object.fromEntries(PROVIDERS.map((p) => [p, v()])) as Record<ProviderId, T>;
const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

function errorText(code: string, label: string, appName: string): string {
  switch (code) {
    case "budget": return "You've used your budget, so this reply was paused. Your chat is saved.";
    case "paused": return "Polar AI is paused by the team right now. Your chat is saved — try again later.";
    case "rate_limited": return "That's a lot of messages in a minute. Wait a moment, then try again.";
    case "not_configured": return `${label} isn't set up yet (missing API key or price).`;
    case "provider_disabled": return `${appName} is turned off by the team right now. Try another app on the left.`;
    case "no_image_model": return `${appName} can't make images.`;
    case "message_too_long": return "That message is too long. Try splitting it up.";
    case "bad_request": return `${label} couldn't handle that request.`;
    default: return `${label} didn't respond. Your chat is saved.`;
  }
}

export function ChatApp({ email }: { email: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [convs, setConvs] = useState<Record<ProviderId, ConvSummary[] | null>>(() => perProvider<ConvSummary[] | null>(() => null));
  const [projects, setProjects] = useState<Record<ProviderId, Project[]>>(() => perProvider<Project[]>(() => []));
  const [activeIds, setActiveIds] = useState<Record<ProviderId, string | null>>(() => perProvider<string | null>(() => null));
  const [projectFilter, setProjectFilter] = useState<Record<ProviderId, string | null>>(() => perProvider<string | null>(() => null));
  const [draftModels, setDraftModels] = useState<Record<ProviderId, string>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p, defaultModelFor(p)])) as Record<ProviderId, string>,
  );
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [dropped, setDropped] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [imageMode, setImageMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [ready, setReady] = useState(false); // saved app choice restored
  const [projectDialog, setProjectDialog] = useState<null | { editing?: Project }>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const theme = THEMES[provider];
  const appConvs = convs[provider];
  const filter = projectFilter[provider];
  const visibleConvs = (appConvs ?? []).filter((c) => !filter || c.projectId === filter);
  const activeId = activeIds[provider];
  const active = appConvs?.find((c) => c.id === activeId) ?? null;
  const msgKey = active ? active.id : `${DRAFT}:${provider}`;
  const thread = messages[msgKey] ?? [];
  const modelId = getModel(active?.modelId)?.provider === provider ? active!.modelId : draftModels[provider];
  const currentModel = getModel(modelId);
  const empty = thread.length === 0;
  const activeProject = projects[provider].find((p) => p.id === (active?.projectId ?? filter)) ?? null;
  const imageModel = IMAGE_MODELS[provider];

  // ---------------------------------------------------------------- loading
  const handleAuth = useCallback((res: Response) => {
    if (res.status === 401 || res.status === 403 || res.redirected) {
      router.replace("/");
      router.refresh();
      return true;
    }
    return false;
  }, [router]);

  const loadUsage = useCallback(async () => {
    const res = await fetch("/api/usage").catch(() => null);
    if (res?.ok) setUsage(await res.json());
  }, []);

  useEffect(() => {
    let saved: ProviderId = "openai";
    try {
      const v = localStorage.getItem(APP_KEY) as ProviderId | null;
      if (v && PROVIDERS.includes(v)) saved = v;
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(saved);
    setReady(true);
    loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    // Wait until the saved choice is restored, or we'd overwrite it (React runs effects twice in dev).
    if (!ready) return;
    try {
      localStorage.setItem(APP_KEY, provider);
    } catch {}
    if (convs[provider] !== null) return;
    (async () => {
      const [c, p] = await Promise.all([
        fetch(`/api/conversations?provider=${provider}`).catch(() => null),
        fetch(`/api/projects?provider=${provider}`).catch(() => null),
      ]);
      if (c && handleAuth(c)) return;
      const list: ConvSummary[] = c?.ok ? (await c.json()).conversations : [];
      const projs: Project[] = p?.ok ? (await p.json()).projects : [];
      setConvs((prev) => ({ ...prev, [provider]: list }));
      setProjects((prev) => ({ ...prev, [provider]: projs }));
      setActiveIds((prev) => (prev[provider] ? prev : { ...prev, [provider]: list[0]?.id ?? null }));
    })();
  }, [ready, provider, convs, handleAuth]);

  // Load an opened chat's messages once.
  useEffect(() => {
    if (!active || messages[active.id]) return;
    const id = active.id;
    (async () => {
      const res = await fetch(`/api/conversations/${id}`).catch(() => null);
      if (!res || handleAuth(res) || !res.ok) return;
      const { messages: rows } = (await res.json()) as { messages: Message[] };
      setMessages((prev) => (prev[id] ? prev : { ...prev, [id]: rows }));
    })();
  }, [active, messages, handleAuth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, msgKey]);

  // ---------------------------------------------------------------- helpers
  const patchMessages = (key: string, fn: (m: Message[]) => Message[]) =>
    setMessages((prev) => ({ ...prev, [key]: fn(prev[key] ?? []) }));

  const setActive = (id: string | null) => setActiveIds((prev) => ({ ...prev, [provider]: id }));

  function adoptConversation(newId: string, title: string, fromKey: string) {
    setMessages((prev) => {
      const next = { ...prev, [newId]: prev[fromKey] ?? [] };
      if (fromKey !== newId) delete next[fromKey];
      return next;
    });
    setConvs((prev) => {
      const list = prev[provider] ?? [];
      const existing = list.find((c) => c.id === newId);
      const summary: ConvSummary = existing
        ? { ...existing, modelId, updatedAt: new Date().toISOString() }
        : { id: newId, title, modelId, projectId: filter, updatedAt: new Date().toISOString() };
      return { ...prev, [provider]: [summary, ...list.filter((c) => c.id !== newId)] };
    });
    setActive(newId);
  }

  async function setModel(id: string) {
    if (getModel(id)?.provider !== provider) return;
    if (active) {
      setConvs((prev) => ({ ...prev, [provider]: (prev[provider] ?? []).map((c) => (c.id === active.id ? { ...c, modelId: id } : c)) }));
      fetch(`/api/conversations/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: id }) });
    } else setDraftModels((prev) => ({ ...prev, [provider]: id }));
  }

  function pickProvider(p: ProviderId) {
    if (busy) return;
    setProvider(p);
    setInput("");
    setImageMode(false);
    setSidebarOpen(false);
  }

  function newChat() {
    setActive(null);
    setMessages((prev) => ({ ...prev, [`${DRAFT}:${provider}`]: [] }));
    setSidebarOpen(false);
  }

  async function deleteChat(id: string) {
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return;
    setConvs((prev) => ({ ...prev, [provider]: (prev[provider] ?? []).filter((c) => c.id !== id) }));
    if (activeId === id) setActive(null);
  }

  async function renameChat(id: string, title: string) {
    setRenaming(null);
    const t = title.trim();
    if (!t) return;
    setConvs((prev) => ({ ...prev, [provider]: (prev[provider] ?? []).map((c) => (c.id === id ? { ...c, title: t } : c)) }));
    await fetch(`/api/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) });
  }

  async function moveToProject(id: string, projectId: string | null) {
    const res = await fetch(`/api/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
    if (res.ok) setConvs((prev) => ({ ...prev, [provider]: (prev[provider] ?? []).map((c) => (c.id === id ? { ...c, projectId } : c)) }));
  }

  async function saveProject(v: { name: string; instructions: string }) {
    const editing = projectDialog?.editing;
    const res = await fetch(editing ? `/api/projects/${editing.id}` : "/api/projects", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? v : { ...v, provider }),
    });
    if (!res.ok) return;
    const { project } = (await res.json()) as { project: Project };
    setProjects((prev) => ({
      ...prev,
      [provider]: editing ? prev[provider].map((p) => (p.id === project.id ? project : p)) : [project, ...prev[provider]],
    }));
    if (!editing) {
      setProjectFilter((prev) => ({ ...prev, [provider]: project.id }));
      newChat();
    }
    setProjectDialog(null);
  }

  async function deleteProject(id: string) {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setProjects((prev) => ({ ...prev, [provider]: prev[provider].filter((p) => p.id !== id) }));
    setConvs((prev) => ({ ...prev, [provider]: (prev[provider] ?? []).map((c) => (c.projectId === id ? { ...c, projectId: null } : c)) }));
    setProjectFilter((prev) => ({ ...prev, [provider]: null }));
    setProjectDialog(null);
  }

  // ---------------------------------------------------------------- sending
  async function send(text: string, retry = false) {
    const content = text.trim();
    if ((!content && !retry) || busy) return;
    const key = msgKey;
    const label = currentModel?.label ?? theme.appName;

    if (!retry) {
      patchMessages(key, (m) => [...m, { id: tmpId(), role: "user", kind: "text", content, status: "complete" }]);
      setInput("");
    } else {
      // Drop the failed reply; the server does the same.
      patchMessages(key, (m) => {
        const last = m.map((x) => x.role).lastIndexOf("user");
        return m.slice(0, last + 1);
      });
    }

    if (imageMode && !retry) return sendImage(content, key);

    const replyTmp = tmpId();
    patchMessages(key, (m) => [...m, { id: replyTmp, role: "assistant", kind: "text", content: "", modelId, status: "streaming" }]);
    let currentKey = key;
    const patchReply = (fn: (m: Message) => Message) => patchMessages(currentKey, (list) => list.map((x) => (x.id === replyTmp ? fn(x) : x)));

    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, modelId, content, retry, conversationId: active?.id, projectId: active ? undefined : filter }),
        signal: controller.signal,
      });
      if (handleAuth(res)) return;
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; conversationId?: string };
        if (err.conversationId && !active) {
          adoptConversation(err.conversationId, content.slice(0, 60), key);
          currentKey = err.conversationId;
        }
        patchReply((m) => ({ ...m, status: "error", error: errorText(err.error ?? "unknown", label, theme.appName) }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === "meta") {
            if (!active) {
              adoptConversation(ev.conversationId, ev.title, key);
              currentKey = ev.conversationId;
            }
            setDropped((prev) => ({ ...prev, [ev.conversationId]: ev.dropped }));
          } else if (ev.t === "delta") patchReply((m) => ({ ...m, content: m.content + ev.v }));
          else if (ev.t === "done") patchReply((m) => ({ ...m, status: ev.status === "partial" ? "partial" : "complete" }));
          else if (ev.t === "error") patchReply((m) => ({ ...m, status: "error", error: errorText(ev.code, label, theme.appName) }));
        }
      }
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      patchReply((m) => ({ ...m, status: stopped ? "partial" : "error", error: stopped ? undefined : errorText("unknown", label, theme.appName) }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      loadUsage();
    }
  }

  async function sendImage(prompt: string, key: string) {
    const replyTmp = tmpId();
    patchMessages(key, (m) => [...m, { id: replyTmp, role: "assistant", kind: "image", content: prompt, modelId: `${provider}-image`, status: "streaming" }]);
    let currentKey = key;
    setBusy(true);
    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, prompt, conversationId: active?.id, projectId: active ? undefined : filter }),
      });
      if (handleAuth(res)) return;
      const out = (await res.json().catch(() => ({}))) as { conversationId?: string; title?: string; error?: string; message?: Message };
      if (out.conversationId && !active) {
        adoptConversation(out.conversationId, out.title ?? prompt.slice(0, 60), key);
        currentKey = out.conversationId;
      }
      patchMessages(currentKey, (list) =>
        list.map((x) =>
          x.id !== replyTmp ? x
            : out.message ? out.message
            : { ...x, kind: "text", status: "error", error: errorText(out.error ?? "unknown", imageModel?.label ?? "Image model", theme.appName) },
        ),
      );
    } finally {
      setBusy(false);
      loadUsage();
    }
  }

  // ---------------------------------------------------------------- UI pieces
  const sendButton = busy && !imageMode ? (
    <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop"
      className={`grid shrink-0 place-items-center bg-brand text-on-brand transition hover:bg-brand-strong ${theme.sendClass}`}>
      <span className="h-3 w-3 rounded-[2px] bg-current" />
    </button>
  ) : (
    <button type="submit" disabled={!input.trim() || busy} aria-label={imageMode ? "Create image" : "Send"}
      className={`grid shrink-0 place-items-center bg-brand text-on-brand transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-30 ${theme.sendClass}`}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  const placeholder = imageMode ? "Describe an image" : empty ? `Ask ${theme.appName}` : `Reply to ${theme.appName}…`;
  const textarea = (
    <textarea
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send(input);
        }
      }}
      rows={theme.inlineComposer ? 1 : empty ? 2 : 1}
      aria-label="Message"
      placeholder={placeholder}
      className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-base text-ink outline-none placeholder:text-ink-subtle"
    />
  );
  const tools = <ToolsMenu imageLabel={imageModel?.label ?? null} imageMode={imageMode} onImageMode={setImageMode} disabled={busy} />;
  const modelMenu = imageMode ? null : <ModelMenu provider={provider} value={modelId} onChange={setModel} disabled={busy} />;

  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="w-full">
      {theme.inlineComposer ? (
        <div className={`mx-auto flex max-w-3xl items-center gap-1.5 py-2.5 pl-3 pr-3 transition ${theme.composerClass}`}>
          {tools}
          {textarea}
          {modelMenu}
          {sendButton}
        </div>
      ) : (
        <div className={`mx-auto max-w-3xl p-2.5 pl-4 transition ${theme.composerClass}`}>
          {textarea}
          <div className="mt-1 flex items-center gap-1.5">
            {tools}
            <span className="flex-1" />
            {modelMenu}
            {sendButton}
          </div>
        </div>
      )}
    </form>
  );

  const remaining = usage?.live ? usage.allowance - usage.spent - usage.reserved : 0;
  const usedPct = usage?.live && usage.allowance > 0 ? Math.min(100, ((usage.spent + usage.reserved) / usage.allowance) * 100) : 0;

  return (
    <div data-theme={provider} className="flex h-dvh bg-surface-000 font-ui text-ink">
      {/* App rail */}
      <nav aria-label="AI apps" className="hidden w-[76px] shrink-0 flex-col items-center gap-3 border-r border-line bg-surface-100 py-4 md:flex">
        <Image src="/brand/polar-ai-mark.png" alt="Polar AI" width={32} height={32} className="mb-3 h-8 w-8 object-contain" />
        {PROVIDERS.map((p) => {
          const on = p === provider;
          return (
            <button key={p} onClick={() => pickProvider(p)} disabled={busy && !on} aria-pressed={on} title={THEMES[p].appName}
              className="group flex flex-col items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50">
              <span className={`grid h-11 w-11 place-items-center rounded-2xl border transition ${on ? "border-line-strong bg-surface-300 shadow-composer" : "border-transparent group-hover:bg-surface-200"}`}>
                <ProviderLogo provider={p} size={24} />
              </span>
              <span className={`text-[11px] ${on ? "font-semibold text-ink" : "text-ink-subtle group-hover:text-ink-muted"}`}>{THEMES[p].appName}</span>
            </button>
          );
        })}
      </nav>

      {/* This app's projects + chats */}
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col bg-surface-100 transition-transform md:static md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
          <ProviderLogo provider={provider} size={22} />
          <span className="text-[22px] font-normal tracking-tight">{theme.appName}</span>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto rounded-md p-1 text-ink-muted hover:text-ink md:hidden" aria-label="Close menu">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="px-3">
          <button onClick={newChat} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[15px] transition hover:bg-surface-200 ${theme.itemClass}`}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
              <path d="M11.5 4.5H5.5a1.5 1.5 0 0 0-1.5 1.5v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5v-6M13.6 3.4a1.4 1.4 0 0 1 2 2L10 11l-2.6.6.6-2.6 5.6-5.6z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New chat
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {/* Projects */}
          <div className="mt-5 flex items-center justify-between px-3">
            <p className="text-sm text-ink-subtle">Projects</p>
            <button onClick={() => setProjectDialog({})} aria-label="New project" className="grid h-6 w-6 place-items-center rounded-full text-ink-subtle hover:bg-surface-200 hover:text-ink">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="mt-1 space-y-0.5">
            {projects[provider].length === 0 && (
              <button onClick={() => setProjectDialog({})} className={`w-full px-3 py-2 text-left text-sm text-ink-subtle hover:bg-surface-200 ${theme.itemClass}`}>
                + Create a project
              </button>
            )}
            {projects[provider].map((p) => {
              const on = filter === p.id;
              return (
                <button key={p.id}
                  onClick={() => { setProjectFilter((prev) => ({ ...prev, [provider]: on ? null : p.id })); if (!on) newChat(); }}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] ${theme.itemClass} ${on ? "bg-surface-300 font-medium" : "hover:bg-surface-200"}`}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden className="shrink-0 text-ink-muted">
                    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>

          {/* Chats */}
          <p className="mt-5 px-3 text-sm text-ink-subtle">{filter ? "Chats in this project" : "Recents"}</p>
          <nav className="mt-1 space-y-0.5" aria-label={`${theme.appName} chats`}>
            {appConvs === null && <p className="px-3 py-2 text-sm text-ink-subtle">Loading…</p>}
            {appConvs !== null && visibleConvs.length === 0 && <p className="px-3 py-2 text-sm text-ink-subtle">No chats yet.</p>}
            {visibleConvs.map((c) => (
              <div key={c.id} className={`group flex items-center ${theme.itemClass} ${c.id === activeId ? "bg-surface-300 font-medium" : "hover:bg-surface-200"}`}>
                {renaming === c.id ? (
                  <input autoFocus defaultValue={c.title} aria-label="Chat name"
                    onBlur={(e) => renameChat(c.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
                    className="min-w-0 flex-1 rounded-lg bg-surface-000 px-3 py-2 text-[15px] outline-none ring-1 ring-brand" />
                ) : (
                  <button onClick={() => { setActive(c.id); setSidebarOpen(false); }} onDoubleClick={() => setRenaming(c.id)}
                    aria-current={c.id === activeId ? "page" : undefined} className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-[15px]">
                    {c.title || "Untitled"}
                  </button>
                )}
                <button onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.title || "chat"}`}
                  className="px-1.5 py-1 text-ink-subtle opacity-0 transition hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                </button>
                <button onClick={() => deleteChat(c.id)} aria-label={`Delete ${c.title || "chat"}`}
                  className="py-1 pl-1.5 pr-3 text-ink-subtle opacity-0 transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden><path d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 9h4.8L11 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            ))}
          </nav>
        </div>

        {/* Usage */}
        <div className="m-3 rounded-2xl bg-surface-200 p-4 text-sm">
          <div className="mb-1.5 flex justify-between">
            <span className="font-medium">{usage?.live ? "Budget" : "Demo mode"}</span>
            <span className="tabular-nums text-ink-muted">
              {usage?.live ? `${dollars(remaining)} left of ${dollars(usage.allowance)}` : "Replies are fake"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-300" role="meter" aria-label="Budget used"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${usedPct}%` }} />
          </div>
          <p className="mt-3 truncate text-xs text-ink-subtle">{email}</p>
          <form action={signOut}>
            <button className="mt-0.5 text-xs text-ink-subtle underline underline-offset-[3px] hover:text-ink-muted">Sign out</button>
          </form>
        </div>
      </aside>
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center gap-2 px-4 py-2.5">
          <button onClick={() => setSidebarOpen(true)} className="rounded-md p-1 text-ink-muted hover:text-ink md:hidden" aria-label="Open menu">
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          {activeProject && (
            <button onClick={() => setProjectDialog({ editing: activeProject })} title="Edit project"
              className="flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-200 hover:text-ink">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="shrink-0"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
              <span className="truncate">{activeProject.name}</span>
            </button>
          )}
          {active && projects[provider].length > 0 && (
            <label className="ml-auto hidden items-center gap-1.5 text-xs text-ink-subtle sm:flex">
              Project
              <select value={active.projectId ?? ""} onChange={(e) => moveToProject(active.id, e.target.value || null)}
                className="rounded-full border border-line bg-surface-100 px-2.5 py-1 text-xs text-ink outline-none">
                <option value="">None</option>
                {projects[provider].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <div className={`flex gap-1 md:hidden ${active && projects[provider].length > 0 ? "" : "ml-auto"}`} role="group" aria-label="AI apps">
            {PROVIDERS.map((p) => (
              <button key={p} onClick={() => pickProvider(p)} disabled={busy && p !== provider} aria-pressed={p === provider} aria-label={THEMES[p].appName}
                className={`grid h-9 w-9 place-items-center rounded-xl ${p === provider ? "bg-surface-300" : ""}`}>
                <ProviderLogo provider={p} size={20} />
              </button>
            ))}
          </div>
        </header>

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
            {activeProject && <p className="mb-2 text-sm text-ink-subtle">New chat in {activeProject.name}</p>}
            <h1 className={`mb-8 text-center ${theme.greetingClass}`}>{imageMode ? "What should I create?" : theme.greeting}</h1>
            {composer}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 py-6">
                {active && dropped[active.id] && (
                  <p className="mb-6 rounded-xl bg-surface-200 px-4 py-2.5 text-center text-xs text-ink-muted">
                    Older messages not included — this chat is longer than {currentModel?.label ?? "the model"} is sent at once.
                  </p>
                )}
                <ul className="space-y-8">
                  {thread.map((m) => {
                    const model = getModel(m.modelId);
                    if (m.role === "user") {
                      return (
                        <li key={m.id} className="flex justify-end">
                          <div className={`max-w-[80%] whitespace-pre-wrap leading-relaxed ${theme.userBubbleClass}`}>{m.content}</div>
                        </li>
                      );
                    }
                    return (
                      <li key={m.id}>
                        <div className="mb-1.5 text-xs font-medium text-ink-subtle">
                          {m.kind === "image" || m.modelId?.endsWith("-image") ? (imageModel?.label ?? "Image") : model?.label}
                        </div>
                        {m.kind === "image" ? (
                          m.status === "streaming" ? (
                            <div className="grid aspect-square w-full max-w-sm animate-pulse place-items-center rounded-2xl bg-surface-200 text-sm text-ink-subtle">Creating image…</div>
                          ) : m.imageUrl ? (
                            <a href={m.imageUrl} target="_blank" rel="noreferrer" className="block w-full max-w-sm">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.imageUrl} alt={m.content} className="w-full rounded-2xl border border-line" />
                            </a>
                          ) : (
                            <p className="text-sm text-ink-subtle">Image unavailable.</p>
                          )
                        ) : (
                          <div className={`whitespace-pre-wrap ${theme.replyClass}`}>
                            {m.content}
                            {m.status === "streaming" && <span aria-label="Writing" className="polar-caret ml-0.5 inline-block h-4 w-1.5 rounded-sm bg-ice align-middle" />}
                            {m.status === "partial" && <span className="ml-1 text-xs text-ink-subtle">[stopped]</span>}
                          </div>
                        )}
                        {m.status === "error" && (
                          <div className="mt-2 rounded-xl border border-danger/30 bg-danger-surface p-3 text-sm text-danger">
                            {m.error ?? `${model?.label ?? "The model"} didn't respond. Your chat is saved.`}{" "}
                            {m.kind === "text" && <button onClick={() => send("", true)} disabled={busy} className="font-medium underline underline-offset-[3px]">Try again</button>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div ref={bottomRef} />
              </div>
            </div>
            <div className="px-3 pb-1">{composer}</div>
          </>
        )}
        <p className="px-4 pb-3 pt-2 text-center text-xs text-ink-muted">
          {theme.disclaimer}
          {usage && !usage.live && <span className="text-ink-subtle"> Demo mode: replies are fake until LIVE_MODELS=on.</span>}
        </p>
      </main>

      <ProjectDialog
        open={projectDialog !== null}
        appName={theme.appName}
        initial={projectDialog?.editing}
        onClose={() => setProjectDialog(null)}
        onSave={saveProject}
        onDelete={projectDialog?.editing ? () => deleteProject(projectDialog.editing!.id) : undefined}
      />
    </div>
  );
}
