import { NextRequest, NextResponse } from "next/server";

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

type ExtractedTask = {
  title?: string;
  details?: string;
  rawText?: string;
  deadline?: string | null;
};

function parseJSONContent(content: string): { tasks?: ExtractedTask[]; task?: ExtractedTask } {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain JSON object");
  }
  return JSON.parse(content.slice(start, end + 1)) as { tasks?: ExtractedTask[]; task?: ExtractedTask };
}

function toDataURL(mimeType: string, bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY in environment." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "Missing image upload" }, { status: 400 });
  }

  if (image.size === 0) {
    return NextResponse.json({ error: "Uploaded image is empty" }, { status: 400 });
  }
  if (image.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Image is too large (max 10MB)" }, { status: 400 });
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const imageDataUrl = toDataURL(image.type || "image/jpeg", bytes);
  const now = new Date().toISOString().slice(0, 10);

  const systemPrompt =
    "You extract task details from images of assignments, notes, screenshots, and to-do lists. Return strict JSON only.";
  const userPrompt = `Today is ${now}. Extract tasks from this image and structure them for task intake.\n\nRules:\n- title: short and actionable.\n- details: include all important task description context, not a tiny summary.\n- Preserve specifics when visible: requirements, steps, constraints, materials, rubric points, page/word limits, dates, times, location, and special instructions.\n- Keep details concise but complete (prefer 1-5 sentences; do not omit key instructions).\n- rawText: include relevant verbatim excerpt(s) from the image for this task when available.\n- deadline: return datetime-local format YYYY-MM-DDTHH:MM when clearly present, otherwise null.\n- If multiple tasks are visible, return all clear actionable tasks.\n- If no task is visible, return an empty list.\n\nReturn only JSON in this shape:\n{\"tasks\":[{\"title\":\"...\",\"details\":\"...\",\"rawText\":\"...\",\"deadline\":null}]}`;

  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
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
    return NextResponse.json({ error: "OpenAI returned empty content." }, { status: 502 });
  }

  try {
    const parsed = parseJSONContent(content);
    const rawTasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
      : parsed.task
        ? [parsed.task]
        : [];
    const tasks = rawTasks
      .map((task) => ({
        title: task.title?.trim() ?? "",
        details: (task.details?.trim() || task.rawText?.trim() || "").slice(0, 1200),
        deadline: typeof task.deadline === "string" ? task.deadline : null,
      }))
      .filter((task) => task.title.length > 0);

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: "Could not detect any tasks from the image." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      tasks,
    });
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
