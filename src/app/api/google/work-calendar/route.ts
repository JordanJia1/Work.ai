import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-auth";

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
  }>;
};

type GoogleCalendarCreateResponse = {
  id?: string;
};

const WORK_CALENDAR_NAME = "Work.ai";

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

export async function POST() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 401 });
  }

  const existing = await fetchCalendarList(accessToken);
  const existingId = (existing?.items ?? []).find(
    (item) => item.id && item.summary?.trim().toLowerCase() === WORK_CALENDAR_NAME.toLowerCase(),
  )?.id;
  if (existingId) {
    return NextResponse.json({ calendarId: existingId, created: false });
  }

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

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    return NextResponse.json(
      {
        error:
          "Could not create a dedicated Work.ai calendar. Reconnect Google to refresh scopes or create it manually.",
        details: errorText,
      },
      { status: 502 },
    );
  }

  const created = (await createResponse.json()) as GoogleCalendarCreateResponse;
  if (!created.id) {
    return NextResponse.json(
      { error: "Google Calendar creation succeeded but returned no calendar id." },
      { status: 502 },
    );
  }

  return NextResponse.json({ calendarId: created.id, created: true });
}

