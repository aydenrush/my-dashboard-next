import Anthropic from "@anthropic-ai/sdk";
import { layout } from "@/lib/clusterLayout";

const COLORS = ["slate", "blue", "emerald", "amber", "rose", "violet"];
const MAX_NOTES = 300;
const MAX_CHARS = 1500;

const SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          theme: { type: "string" },
          color: { type: "string", enum: COLORS },
          note_ids: { type: "array", items: { type: "string" } },
        },
        required: ["theme", "color", "note_ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["clusters"],
  additionalProperties: false,
};

export async function GET() {
  return Response.json({ enabled: !!process.env.ANTHROPIC_API_KEY });
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const notes = Array.isArray(body?.notes) ? body.notes : null;
  if (!notes || !notes.length) return Response.json({ error: "notes array required" }, { status: 400 });
  if (notes.length > MAX_NOTES) return Response.json({ error: `max ${MAX_NOTES} notes` }, { status: 400 });
  const clean = notes
    .filter((n) => typeof n?.id === "string" && typeof n?.content === "string")
    .map((n) => ({ id: n.id.slice(0, 64), content: n.content.slice(0, MAX_CHARS) }));
  if (!clean.length) return Response.json({ error: "no valid notes" }, { status: 400 });

  const client = new Anthropic();
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You group brain-dump notes by theme. Put every note id in exactly one cluster. " +
        "Use 2-6 clusters with short theme names (1-3 words), and give each cluster a different color.",
      messages: [{ role: "user", content: JSON.stringify(clean) }],
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 502 });
  }
  if (msg.stop_reason === "refusal") return Response.json({ error: "Claude declined to cluster these notes" }, { status: 422 });

  let clusters;
  try {
    clusters = JSON.parse(msg.content.find((b) => b.type === "text")?.text || "").clusters;
  } catch {
    return Response.json({ error: "couldn't parse Claude's response" }, { status: 502 });
  }

  // keep only known ids, each once; anything Claude skipped goes into "Other"
  const known = new Set(clean.map((n) => n.id));
  const seen = new Set();
  clusters = clusters
    .map((c) => ({ ...c, note_ids: c.note_ids.filter((id) => known.has(id) && !seen.has(id) && seen.add(id)) }))
    .filter((c) => c.note_ids.length);
  const leftover = clean.map((n) => n.id).filter((id) => !seen.has(id));
  if (leftover.length) clusters.push({ theme: "Other", color: "slate", note_ids: leftover });

  return Response.json({ clusters: clusters.map(({ theme, color }) => ({ theme, color })), notes: layout(clusters) });
}
