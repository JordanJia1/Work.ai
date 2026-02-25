import { NextRequest, NextResponse } from "next/server";
import { TaskInput } from "@/lib/planner";

type AIResult = {
  id: string;
  estimatedHours: number;
  urgencyScore: number;
  priorityScore: number;
  priorityLabel: "Critical" | "High" | "Medium" | "Low";
  analysisReason: string;
  isSplittable?: boolean;
  notBeforeISO?: string | null;
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseJSONContent(content: string): AIResult[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain JSON object");
  }

  const parsed = JSON.parse(content.slice(start, end + 1)) as {
    analyses?: AIResult[];
  };

  if (!Array.isArray(parsed.analyses)) {
    throw new Error("Invalid JSON schema returned by model");
  }

  return parsed.analyses;
}

function sanitizeResults(tasks: TaskInput[], results: AIResult[]) {
  const byId = new Map(results.map((result) => [result.id, result]));

  function deriveSplitSignal(task: TaskInput, result?: AIResult): boolean {
    if (typeof result?.isSplittable === "boolean") return result.isSplittable;
    const text = `${task.title} ${task.details}`.toLowerCase();
    const singleBlockSignals = [
      "shopping trip",
      "doctor appointment",
      "dentist appointment",
      "interview",
      "flight",
      "drive to",
      "commute to",
      "meeting with",
      "client call",
      "haircut",
      "grocery run",
      "errand",
      "pickup",
    ];
    return !singleBlockSignals.some((signal) => text.includes(signal));
  }

  function deriveNotBeforeISO(task: TaskInput, result?: AIResult): string | null {
    const modelValue = result?.notBeforeISO;
    if (typeof modelValue === "string" && modelValue.trim().length > 0) {
      const parsed = new Date(modelValue);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    const text = `${task.title} ${task.details}`;
    const patterns = [
      /\b(?:opens?|available|unlocks?|starts?)\s+(?:on|at)\s+([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i,
      /\b(?:opens?|available|unlocks?|starts?)\s+(?:on|at)\s+(\d{4}-\d{2}-\d{2})/i,
      /\b(?:after)\s+([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i,
      /\b(?:after)\s+(\d{4}-\d{2}-\d{2})/i,
      /\b(?:not before)\s+([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i,
      /\b(?:not before)\s+(\d{4}-\d{2}-\d{2})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;
      const candidate = new Date(match[1]);
      if (Number.isNaN(candidate.getTime())) continue;
      candidate.setHours(0, 0, 0, 0);
      return candidate.toISOString();
    }

    return null;
  }

  return tasks
    .map((task) => {
      const result = byId.get(task.id);
      if (!result) {
        return {
          ...task,
          estimatedHours: 2,
          urgencyScore: 50,
          priorityScore: 50,
          priorityLabel: "Medium" as const,
          analysisReason: "AI response missing this task; defaulted to medium priority.",
          isSplittable: deriveSplitSignal(task),
          notBeforeISO: deriveNotBeforeISO(task),
        };
      }

      return {
        ...task,
        estimatedHours: clamp(Number(result.estimatedHours) || 2, 0.5, 80),
        urgencyScore: clamp(Math.round(Number(result.urgencyScore) || 50), 0, 100),
        priorityScore: clamp(Math.round(Number(result.priorityScore) || 50), 0, 100),
        priorityLabel:
          result.priorityLabel === "Critical" ||
          result.priorityLabel === "High" ||
          result.priorityLabel === "Medium" ||
          result.priorityLabel === "Low"
            ? result.priorityLabel
            : "Medium",
        analysisReason: (result.analysisReason || "").slice(0, 240),
        isSplittable: deriveSplitSignal(task, result),
        notBeforeISO: deriveNotBeforeISO(task, result),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY in environment." },
      { status: 500 },
    );
  }

  const body = (await request.json()) as { tasks?: TaskInput[] };
  const tasks = body.tasks ?? [];

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({ analyses: [] });
  }

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt =
    "You are an expert workload planning assistant. Return only strict JSON that matches the requested schema.";

  const userPrompt = `Today is ${today}. Analyze each task for realistic effort and priority for a weekly execution plan.\n\nRules:\n- Infer complexity and business impact from title/details/deadline only.\n- estimatedHours: numeric hours (0.5 to 80)\n- urgencyScore: integer 0-100 based on exact deadline proximity\n- priorityScore: integer 0-100 combining urgency, inferred impact, inferred complexity, and dependency/risk clues\n- priorityLabel: one of Critical|High|Medium|Low\n- analysisReason: <= 180 chars concise rationale\n- isSplittable: boolean. False only if task should be done in one continuous block (e.g., shopping trip, appointment, interview).\n- notBeforeISO: ISO datetime string or null. Use when details imply work cannot start before a specific date/time (e.g., opens on March 1).\n\nReturn JSON only as:\n{\"analyses\":[{\"id\":\"...\",\"estimatedHours\":0,\"urgencyScore\":0,\"priorityScore\":0,\"priorityLabel\":\"Medium\",\"analysisReason\":\"...\",\"isSplittable\":true,\"notBeforeISO\":null}]}\n\nTasks:\n${JSON.stringify(tasks)}`;

  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!openaiResponse.ok) {
    const errorText = await openaiResponse.text();
    return NextResponse.json(
      { error: `OpenAI request failed: ${errorText}` },
      { status: 502 },
    );
  }

  const payload = (await openaiResponse.json()) as OpenAIChatResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return NextResponse.json(
      { error: "OpenAI returned empty content." },
      { status: 502 },
    );
  }

  try {
    const parsed = parseJSONContent(content);
    return NextResponse.json({ analyses: sanitizeResults(tasks, parsed) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Failed to parse model output: ${error.message}`
            : "Failed to parse model output",
      },
      { status: 502 },
    );
  }
}
