import { getUserAccess } from "@/lib/auth/session";
import { getModel } from "@/config/models";

// MOCK provider: streams a fake reply so the UI can be built before API keys arrive.
// Later this becomes: auth → ownership → budget reserve → provider adapter → reconcile.
type IncomingMessage = { role: "user" | "assistant"; content: string; modelId?: string };

export async function POST(request: Request) {
  const result = await getUserAccess();
  if (!result) return Response.json({ error: "not_signed_in" }, { status: 401 });
  // Waitlisted accounts must not reach any model, even by calling the API directly.
  if (result.access !== "app") return Response.json({ error: "waitlisted" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { modelId?: string; messages?: IncomingMessage[] }
    | null;
  const model = getModel(body?.modelId);
  if (!model || !model.enabled) return Response.json({ error: "unknown_model" }, { status: 400 });

  const messages = Array.isArray(body?.messages) ? body!.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const otherModels = new Set(
    messages.filter((m) => m.role === "assistant" && m.modelId && m.modelId !== model.id).map((m) => m.modelId),
  );

  const reply =
    `(${model.label} mock reply) You said: "${lastUser.slice(0, 200)}". ` +
    `I received ${messages.length} message${messages.length === 1 ? "" : "s"} of chat history` +
    (otherModels.size ? `, including replies from ${otherModels.size} other model${otherModels.size === 1 ? "" : "s"}.` : ".") +
    " Real answers will appear here once the API keys are connected.";

  const encoder = new TextEncoder();
  const words = reply.split(/(\s+)/);
  const stream = new ReadableStream({
    async start(controller) {
      for (const w of words) {
        if (request.signal.aborted) break;
        controller.enqueue(encoder.encode(w));
        await new Promise((r) => setTimeout(r, 25));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
