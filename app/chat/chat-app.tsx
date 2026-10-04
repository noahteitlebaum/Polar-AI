"use client";

import { useEffect, useRef, useState } from "react";
import { MODELS, DEFAULT_MODEL_ID, getModel } from "@/config/models";
import { signOut } from "../login/actions";

// MVP: chats are kept in this browser (localStorage) until the database step.
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelId?: string;
  status: "complete" | "streaming" | "error";
};
type Conversation = { id: string; title: string; modelId: string; messages: Message[]; updatedAt: number };

const STORAGE_KEY = "polar.chats.v1";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const PROVIDER_DOT: Record<string, string> = {
  openai: "bg-emerald-500",
  anthropic: "bg-orange-500",
  google: "bg-blue-500",
  xai: "bg-zinc-500",
};

function loadChats(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

export function ChatApp({ email }: { email: string }) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState(DEFAULT_MODEL_ID);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const saved = loadChats();
    setChats(saved);
    setActiveId(saved[0]?.id ?? null);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch {}
  }, [chats]);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const modelId = active?.modelId ?? draftModel;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages]);

  function updateChat(id: string, fn: (c: Conversation) => Conversation) {
    setChats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }

  function setModel(id: string) {
    if (active) updateChat(active.id, (c) => ({ ...c, modelId: id }));
    else setDraftModel(id);
  }

  function newChat() {
    setActiveId(null);
    setSidebarOpen(false);
  }

  function deleteChat(id: string) {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function send(text: string, history?: Message[]) {
    const content = text.trim();
    if (!content || busy) return;

    let chatId = active?.id;
    const userMsg: Message = { id: uid(), role: "user", content, status: "complete" };
    const base = history ?? active?.messages ?? [];
    const messages = [...base, userMsg];

    if (!chatId) {
      chatId = uid();
      const chat: Conversation = {
        id: chatId,
        title: content.slice(0, 40),
        modelId,
        messages,
        updatedAt: Date.now(),
      };
      setChats((prev) => [chat, ...prev]);
      setActiveId(chatId);
    } else {
      updateChat(chatId, (c) => ({ ...c, messages, updatedAt: Date.now() }));
    }
    setInput("");

    const replyId = uid();
    const reply: Message = { id: replyId, role: "assistant", content: "", modelId, status: "streaming" };
    const id = chatId;
    updateChat(id, (c) => ({ ...c, messages: [...messages, reply] }));
    const patchReply = (fn: (m: Message) => Message) =>
      updateChat(id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === replyId ? fn(m) : m)) }));

    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          messages: messages.map(({ role, content, modelId }) => ({ role, content, modelId })),
        }),
        signal: controller.signal,
      });
      if (res.status === 401 || res.redirected) {
        window.location.href = "/login"; // session expired
        return;
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        patchReply((m) => ({ ...m, content: m.content + chunk }));
      }
      patchReply((m) => ({ ...m, status: "complete" }));
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      patchReply((m) => ({
        ...m,
        status: stopped ? "complete" : "error",
        content: stopped ? m.content + " [stopped]" : m.content,
      }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function retry() {
    if (!active) return;
    const msgs = active.messages;
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    // Drop the failed reply and the user message, then resend (no duplicates stored).
    send(msgs[lastUserIdx].content, msgs.slice(0, lastUserIdx));
  }

  const current = getModel(modelId);

  return (
    <div className="flex h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform dark:border-zinc-800 dark:bg-zinc-900 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4">
          <span className="text-lg font-semibold">Polar AI</span>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden" aria-label="Close menu">✕</button>
        </div>
        <div className="px-3">
          <button
            onClick={newChat}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-left text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + New chat
          </button>
        </div>
        <nav className="mt-3 flex-1 overflow-y-auto px-2">
          {chats.length === 0 && <p className="px-2 text-sm text-zinc-500">No chats yet.</p>}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-lg ${
                c.id === activeId ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              }`}
            >
              <button
                onClick={() => {
                  setActiveId(c.id);
                  setSidebarOpen(false);
                }}
                className="flex-1 truncate px-3 py-2 text-left text-sm"
              >
                {c.title || "Untitled"}
              </button>
              <button
                onClick={() => deleteChat(c.id)}
                className="px-2 text-zinc-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                aria-label="Delete chat"
              >
                🗑
              </button>
            </div>
          ))}
        </nav>
        {/* Usage (placeholder until billing is built) */}
        <div className="border-t border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <div className="mb-1 flex justify-between">
            <span className="font-medium">Trial</span>
            <span className="text-zinc-500">$0.00 of $5.00</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-1.5 w-0 rounded-full bg-zinc-900 dark:bg-zinc-100" />
          </div>
          <p className="mt-3 truncate text-xs text-zinc-500">{email}</p>
          <form action={signOut}>
            <button className="mt-1 text-xs underline">Sign out</button>
          </form>
        </div>
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden" aria-label="Open menu">☰</button>
          <label htmlFor="model" className="sr-only">Model</label>
          <div className="relative">
            <span className={`pointer-events-none absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${PROVIDER_DOT[current?.provider ?? "openai"]}`} />
            <select
              id="model"
              value={modelId}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
              className="appearance-none rounded-lg border border-zinc-300 bg-transparent py-1.5 pl-7 pr-8 text-sm font-medium dark:border-zinc-700"
            >
              {MODELS.filter((m) => m.enabled).map((m) => (
                <option key={m.id} value={m.id} className="text-zinc-900">
                  {m.label} · {m.providerLabel}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">▾</span>
          </div>
          <span className="ml-auto hidden text-xs text-zinc-500 sm:block">Switch models anytime — context carries over</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            {!active || active.messages.length === 0 ? (
              <div className="mt-24 text-center">
                <h1 className="text-2xl font-semibold">What can I help with?</h1>
                <p className="mt-2 text-sm text-zinc-500">
                  GPT, Claude, Gemini and Grok in one chat. Pick a model above.
                </p>
              </div>
            ) : (
              <ul className="space-y-6">
                {active.messages.map((m) => {
                  const model = getModel(m.modelId);
                  return m.role === "user" ? (
                    <li key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800">
                        {m.content}
                      </div>
                    </li>
                  ) : (
                    <li key={m.id}>
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-500">
                        <span className={`h-2 w-2 rounded-full ${PROVIDER_DOT[model?.provider ?? "openai"]}`} />
                        {model ? `${model.label} · ${model.providerLabel}` : "Assistant"}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {m.content}
                        {m.status === "streaming" && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400 align-middle" />}
                      </div>
                      {m.status === "error" && (
                        <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                          {model?.label ?? "The model"} didn&apos;t respond. Your chat is saved.{" "}
                          <button onClick={retry} className="font-medium underline">Try again</button> or pick another model above.
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-zinc-200 p-3 dark:border-zinc-800"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder={`Message ${current?.label ?? ""}…`}
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-xl bg-zinc-200 px-3 py-2 text-sm font-medium dark:bg-zinc-700"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Send
              </button>
            )}
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-zinc-500">
            Demo mode: replies are fake until API keys are connected.
          </p>
        </form>
      </main>
    </div>
  );
}
