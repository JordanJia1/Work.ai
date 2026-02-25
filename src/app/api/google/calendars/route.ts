import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-auth";

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    selected?: boolean;
    primary?: boolean;
    accessRole?: "owner" | "writer" | "reader" | "freeBusyReader" | string;
  }>;
};

export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 401 });
  }

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
    const errorText = await response.text();
    return NextResponse.json(
      { error: `Failed to fetch calendars. ${errorText}` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as GoogleCalendarListResponse;
  const calendars = (payload.items ?? [])
    .filter((item) => item.id && item.summary)
    .map((item) => ({
      id: item.id as string,
      summary: item.summary as string,
      selected: item.selected !== false,
      primary: Boolean(item.primary),
    }))
    .sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.summary.localeCompare(b.summary);
    });

  return NextResponse.json({ calendars });
}
