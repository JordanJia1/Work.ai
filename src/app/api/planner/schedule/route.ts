import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-auth";
import {
  BusyInterval,
  generateWeeklySchedule,
  normalizeSchedulePreferences,
  TaskAnalysis,
} from "@/lib/planner";

type GoogleErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      ["@type"]?: string;
      metadata?: {
        activationUrl?: string;
      };
    }>;
  };
};

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    selected?: boolean;
    accessRole?: "owner" | "writer" | "reader" | "freeBusyReader" | string;
    primary?: boolean;
  }>;
};

type GoogleFreeBusyResponse = {
  calendars?: Record<
    string,
    {
      busy?: Array<{ start?: string; end?: string }>;
    }
  >;
};

type GoogleEventsResponse = {
  items?: Array<{
    status?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }>;
};

function isTaskAnalysisArray(value: unknown): value is TaskAnalysis[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const task = item as Partial<TaskAnalysis>;
    return (
      typeof task.id === "string" &&
      typeof task.title === "string" &&
      typeof task.details === "string" &&
      typeof task.deadline === "string" &&
      typeof task.estimatedHours === "number" &&
      typeof task.urgencyScore === "number" &&
      typeof task.priorityScore === "number"
    );
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseGoogleError(errorText: string): {
  message: string;
  status?: string;
  activationUrl?: string;
} {
  try {
    const parsed = JSON.parse(errorText) as GoogleErrorPayload;
    const message = parsed?.error?.message || errorText;
    const status = parsed?.error?.status;
    const activationUrl = parsed?.error?.details?.find(
      (detail) => detail?.metadata?.activationUrl,
    )?.metadata?.activationUrl;
    return { message, status, activationUrl };
  } catch {
    return { message: errorText };
  }
}

function toBusyIntervals(payload: GoogleFreeBusyResponse): BusyInterval[] {
  const intervals: BusyInterval[] = [];

  for (const calendarData of Object.values(payload.calendars ?? {})) {
    for (const block of calendarData.busy ?? []) {
      if (!block.start || !block.end) continue;
      const start = new Date(block.start);
      const end = new Date(block.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      if (end <= start) continue;

      intervals.push({
        startISO: start.toISOString(),
        endISO: end.toISOString(),
      });
    }
  }

  return intervals;
}

function toBusyIntervalsFromEvents(payloads: GoogleEventsResponse[]): BusyInterval[] {
  const intervals: BusyInterval[] = [];

  for (const payload of payloads) {
    for (const event of payload.items ?? []) {
      if (event.status === "cancelled") continue;
      const startRaw = event.start?.dateTime ?? event.start?.date;
      const endRaw = event.end?.dateTime ?? event.end?.date;
      if (!startRaw || !endRaw) continue;

      const start = new Date(startRaw);
      const end = new Date(endRaw);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      if (end <= start) continue;

      intervals.push({
        startISO: start.toISOString(),
        endISO: end.toISOString(),
      });
    }
  }

  return intervals;
}

function dedupeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const seen = new Set<string>();
  const deduped: BusyInterval[] = [];
  for (const interval of intervals) {
    const key = `${interval.startISO}|${interval.endISO}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(interval);
  }
  return deduped;
}

async function getSelectedCalendarIds(
  accessToken: string,
  ignoredCalendarIds: Set<string>,
): Promise<string[]> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false&maxResults=250",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return ignoredCalendarIds.has("primary") ? [] : ["primary"];
  }

  const payload = (await response.json()) as GoogleCalendarListResponse;
  const ids = (payload.items ?? [])
    .filter((cal) => cal.id)
    .filter((cal) => cal.selected !== false)
    .filter((cal) => !ignoredCalendarIds.has(cal.id as string))
    .map((cal) => cal.id as string);

  if (ids.length === 0) return [];
  if (!ids.includes("primary") && !ignoredCalendarIds.has("primary")) ids.unshift("primary");
  return ids;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    analysis?: unknown;
    schedulePreferences?: unknown;
    ignoredCalendarIds?: unknown;
  };

  if (!isTaskAnalysisArray(body.analysis)) {
    return NextResponse.json({ error: "Invalid analysis payload" }, { status: 400 });
  }
  if (body.ignoredCalendarIds !== undefined && !isStringArray(body.ignoredCalendarIds)) {
    return NextResponse.json({ error: "Invalid ignoredCalendarIds payload" }, { status: 400 });
  }

  const analysis = body.analysis;
  const schedulePreferences = normalizeSchedulePreferences(body.schedulePreferences);
  const ignoredCalendarIds = new Set((body.ignoredCalendarIds as string[] | undefined) ?? []);
  if (analysis.length === 0) {
    return NextResponse.json({ schedule: [] });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 401 });
  }

  const timeMin = new Date();
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 14);

  const calendarIds = await getSelectedCalendarIds(accessToken, ignoredCalendarIds);

  let busyIntervals: BusyInterval[] = [];
  if (calendarIds.length > 0) {
    const freeBusyResponse = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      }),
      cache: "no-store",
    });

    if (!freeBusyResponse.ok) {
      const errorText = await freeBusyResponse.text();
      const parsed = parseGoogleError(errorText);

      if (parsed.status === "PERMISSION_DENIED" && parsed.message.includes("disabled")) {
        return NextResponse.json(
          {
            error:
              "Google Calendar API is disabled for your Google Cloud project. Enable it, wait 1-5 minutes, then retry.",
            actionUrl: parsed.activationUrl,
          },
          { status: 502 },
        );
      }

      if (parsed.status === "PERMISSION_DENIED" && parsed.message.toLowerCase().includes("insufficient")) {
        return NextResponse.json(
          {
            error:
              "Google permissions are insufficient for conflict checks. Disconnect and reconnect Google Calendar to refresh scopes.",
          },
          { status: 502 },
        );
      }

      return NextResponse.json(
        { error: `Failed to fetch Google Calendar busy times. ${parsed.message}` },
        { status: 502 },
      );
    }
    const freeBusyPayload = (await freeBusyResponse.json()) as GoogleFreeBusyResponse;
    const freeBusyIntervals = toBusyIntervals(freeBusyPayload);

    const query = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: "250",
    });
    const eventResponses = await Promise.allSettled(
      calendarIds.map(async (id) => {
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${query.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
          },
        );
        if (!response.ok) return null;
        return (await response.json()) as GoogleEventsResponse;
      }),
    );
    const eventPayloads = eventResponses
      .filter(
        (result): result is PromiseFulfilledResult<GoogleEventsResponse | null> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value)
      .filter((payload): payload is GoogleEventsResponse => payload !== null);

    const eventBusyIntervals = toBusyIntervalsFromEvents(eventPayloads);
    busyIntervals = dedupeIntervals([...freeBusyIntervals, ...eventBusyIntervals]);
  }

  const schedule = generateWeeklySchedule(analysis, busyIntervals, schedulePreferences);
  return NextResponse.json({
    schedule,
    schedulePreferences,
    busyIntervalsCount: busyIntervals.length,
    calendarsConsidered: calendarIds.length,
  });
}
