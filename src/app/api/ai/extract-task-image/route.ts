import { NextRequest, NextResponse } from "next/server";

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function parseJSONContent(content: string): { task?: { title?: string; details?: string; deadline?: string | null } } {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain JSON object");
  }
  return JSON.parse(content.slice(start, end + 1)) as {
    task?: { title?: string; details?: string; deadline?: string | null };
  };
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
  const userPrompt = `Today is ${now}. Extract one primary task from this image and structure it for task intake.\n\nRules:\n- title: short and actionable\n- details: useful context from the image (optional, max 300 chars)\n- deadline: return datetime-local format YYYY-MM-DDTHH:MM when clearly present, otherwise null\n- If multiple tasks are visible, pick the clearest highest-priority one.\n\nReturn only JSON in this shape:\n{\"task\":{\"title\":\"...\",\"details\":\"...\",\"deadline\":null}}`;

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
    const title = parsed.task?.title?.trim();
    const details = parsed.task?.details?.trim() ?? "";
    const deadline = parsed.task?.deadline ?? null;

    if (!title) {
      return NextResponse.json(
        { error: "Could not detect a task title from the image." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      task: {
        title,
        details,
        deadline: typeof deadline === "string" ? deadline : null,
      },
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

