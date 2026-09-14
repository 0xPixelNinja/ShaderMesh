"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { Card, CardHead, Empty } from "@/components/ui";
import { ORCHESTRATOR_URL } from "@/lib/config";
import type { ModelInfo } from "@/lib/types";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function ModelsPage() {
  const models = useApi<ModelInfo[]>("/models").data ?? [];
  const [selected, setSelected] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ total: number; routedTo?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && models.length) setSelected(models[0].model);
  }, [models, selected]);

  async function send() {
    if (!input.trim() || !selected) return;
    const next = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: selected, messages: next, temperature: 0.7 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const content = json?.choices?.[0]?.message?.content ?? "(no content)";
      setMessages((m) => [...m, { role: "assistant", content }]);
      setUsage({ total: json?.usage?.total_tokens ?? 0, routedTo: json?.routedTo });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[260px_1fr] items-start gap-5">
      <Card>
        <CardHead title="Models" sub={`${models.length} served`} />
        {models.length === 0 ? (
          <Empty title="No models served" hint="Start a provider serving a model" />
        ) : (
          <div className="p-2">
            {models.map((m) => (
              <button
                key={m.model}
                onClick={() => setSelected(m.model)}
                className={`block w-full rounded-md border px-3 py-2.5 text-left ${
                  selected === m.model ? "border-line bg-panel" : "border-transparent hover:bg-hover"
                }`}
              >
                <div className="text-[13px] font-medium">{m.model}</div>
                <div className="mono mt-0.5 text-[11px] text-faint">{m.providers} provider{m.providers === 1 ? "" : "s"}</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="flex h-[calc(100vh-9rem)] flex-col">
        <CardHead
          title={selected || "Playground"}
          sub={usage?.routedTo ? `routed to ${usage.routedTo.slice(0, 6)}…${usage.routedTo.slice(-4)}` : "OpenAI-compatible gateway"}
        />
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {messages.length === 0 && <Empty title="Ask the model something" hint="Requests are routed to a serving provider and metered" />}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-[10px] border px-3 py-2.5 text-[13px] ${
                  m.role === "user" ? "border-line bg-panel" : "border-line bg-surface text-ink2"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {err && <div className="text-[13px] text-danger">Gateway error: {err}</div>}
        </div>
        <div className="flex items-end gap-2.5 border-t border-line p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask anything, or paste a prompt…"
            className="mono min-h-[40px] flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent"
          />
          <button
            onClick={send}
            disabled={busy || !selected}
            className="rounded-md border border-accent bg-accent px-4 py-2.5 text-[13px] font-semibold text-[#1A1205] hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </Card>
    </div>
  );
}
