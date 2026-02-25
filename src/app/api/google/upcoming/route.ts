import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-auth";

type GoogleEvent = {
  id?: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

type GoogleEventsResponse = {
  items?: GoogleEvent[];
};

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    selected?: boolean;
    accessRole?: "owner" | "writer" | "reader" | "freeBusyReader" | string;
  }>;
};

type CalendarSnapshotEvent = {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  allDay: boolean;
  description: string;
};

function normalizeEvent(event: GoogleEvent): CalendarSnapshotEvent | null {
  if (event.status === "cancelled") return null;

  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (!startRaw || !endRaw) return null;
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) return null;

  return {
    id: event.id ?? crypto.randomUUID(),
    title: event.summary?.trim() || "Busy",
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    allDay,
    description: event.description?.trim() ?? "",
  };
}

export async function GET(request: NextRequest) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.max(1, Math.min(60, Number(searchParams.get("days") ?? 14)));
  const pastDays = Math.max(0, Math.min(30, Number(searchParams.get("pastDays") ?? 0)));
  const limit = Math.max(5, Math.min(500, Number(searchParams.get("limit") ?? 200)));
  const ignoredCalendarIds = new Set(
    (searchParams.get("ignoredCalendarIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );

  const timeMin = new Date();
  if (pastDays > 0) {
    timeMin.setDate(timeMin.getDate() - pastDays);
  }
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + days);

  const calendarListResponse = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false&maxResults=250",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!calendarListResponse.ok) {
    const errorText = await calendarListResponse.text();
    return NextResponse.json(
      { error: `Failed to fetch calendars for snapshot. ${errorText}` },
      { status: 502 },
    );
  }

  const calendarListPayload = (await calendarListResponse.json()) as GoogleCalendarListResponse;
  const calendarIds = (calendarListPayload.items ?? [])
    .filter((calendar) => calendar.id)
    .map((calendar) => calendar.id as string)
    .filter((calendarId) => !ignoredCalendarIds.has(calendarId));

  if (calendarIds.length === 0) {
    return NextResponse.json({
      events: [],
      refreshedAt: new Date().toISOString(),
    });
  }

  const query = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: String(limit),
  });

  const eventResponses = await Promise.allSettled(
    calendarIds.map(async (calendarId) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Calendar ${calendarId} events fetch failed (${response.status})`);
      }
      return (await response.json()) as GoogleEventsResponse;
    }),
  );

  const successfulPayloads = eventResponses
    .filter(
      (result): result is PromiseFulfilledResult<GoogleEventsResponse> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);

  if (successfulPayloads.length === 0) {
    const firstError = eventResponses.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    return NextResponse.json(
      { error: firstError?.reason?.message ?? "Failed to fetch calendar snapshot events" },
      { status: 502 },
    );
  }

  const events = successfulPayloads
    .flatMap((payload) => payload.items ?? [])
    .map(normalizeEvent)
    .filter((event): event is CalendarSnapshotEvent => event !== null)
    .sort((a, b) => a.startISO.localeCompare(b.startISO));

  return NextResponse.json({
    events,
    refreshedAt: new Date().toISOString(),
  });
}
