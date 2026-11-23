import { JWT } from "google-auth-library";

export type CalendarEvent = {
  id: string;
  summary?: string;
  start: string;
  end?: string;
  location?: string;
};

function getCalendarClient(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error("Google service account is not configured");
  }
  return new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
}

export async function listUpcomingCalendarEvents(
  daysAhead = 90,
): Promise<CalendarEvent[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID is not configured");

  const client = getCalendarClient();
  const { access_token: accessToken } = await client.authorize();

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set(
    "timeMax",
    new Date(Date.now() + daysAhead * 86400000).toISOString(),
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google Calendar API error: ${res.status}`);
  }
  const data = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };

  return (data.items ?? [])
    .filter((item) => item.start?.dateTime || item.start?.date)
    .map((item) => ({
      id: item.id,
      summary: item.summary,
      location: item.location,
      start: (item.start!.dateTime ?? item.start!.date)!,
      end: item.end?.dateTime ?? item.end?.date,
    }));
}
