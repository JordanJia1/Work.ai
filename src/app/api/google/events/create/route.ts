import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-auth";
import { ScheduledBlock } from "@/lib/planner";

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
  }>;
};

type GoogleCalendarCreateResponse = {
  id?: string;
};

type GoogleEventCreateResponse = {
  id?: string;
};

const WORK_CALENDAR_NAME = "Work.ai";

function isScheduledBlock(value: unknown): value is ScheduledBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<ScheduledBlock>;
  return (
    typeof block.taskId === "string" &&
    typeof block.taskTitle === "string" &&
    typeof block.startISO === "string" &&
    typeof block.endISO === "string" &&
    typeof block.minutes === "number" &&
    typeof block.calendarDescription === "string"
  );
}

async function fetchCalendarList(accessToken: string): Promise<GoogleCalendarListResponse | null> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&maxResults=250",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  return (await response.json()) as GoogleCalendarListResponse;
}

async function resolveOrCreateWorkCalendarId(accessToken: string): Promise<string | null> {
  const existing = await fetchCalendarList(accessToken);
  const existingId = (existing?.items ?? []).find(
    (item) => item.id && item.summary?.trim().toLowerCase() === WORK_CALENDAR_NAME.toLowerCase(),
  )?.id;
  if (existingId) return existingId;

  const createResponse = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: WORK_CALENDAR_NAME,
      description: "Work.ai scheduled focus blocks",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
    }),
    cache: "no-store",
  });
  if (!createResponse.ok) return null;
  const created = (await createResponse.json()) as GoogleCalendarCreateResponse;
  return created.id ?? null;
}

async function createEvent(
  accessToken: string,
  calendarId: string,
  block: ScheduledBlock,
): Promise<{ ok: boolean; eventId?: string; errorText?: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: block.taskTitle,
        description: block.calendarDescription,
        start: { dateTime: block.startISO },
        end: { dateTime: block.endISO },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return { ok: false, errorText: await response.text() };
  }
  const payload = (await response.json()) as GoogleEventCreateResponse;
  return { ok: true, eventId: payload.id };
}

export async function POST(request: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 401 });
  }

  const body = (await request.json()) as { block?: unknown };
  if (!isScheduledBlock(body.block)) {
    return NextResponse.json({ error: "Invalid block payload" }, { status: 400 });
  }
  const block = body.block;

  const workCalendarId = await resolveOrCreateWorkCalendarId(accessToken);
  const targetCalendarId = workCalendarId ?? "primary";

  let result = await createEvent(accessToken, targetCalendarId, block);
  if (!result.ok && targetCalendarId !== "primary") {
    // Graceful fallback when dedicated calendar creation/use is unavailable.
    result = await createEvent(accessToken, "primary", block);
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        eventId: result.eventId,
        calendarId: "primary",
        fallback: true,
      });
    }
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Failed to create Google Calendar event",
        details: result.errorText,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    eventId: result.eventId,
    calendarId: targetCalendarId,
    fallback: false,
  });
}

