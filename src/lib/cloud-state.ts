import { SchedulePreferences, ScheduledBlock, TaskAnalysis, TaskInput } from "@/lib/planner";

const DEFAULT_TABLE = "planner_states";

type CloudPayload = {
  tasks: TaskInput[];
  aiAnalysis: TaskAnalysis[] | null;
  schedulePreferences?: SchedulePreferences;
  ignoredCalendarIds?: string[];
  targetCalendarId?: string | null;
  schedule?: ScheduledBlock[];
  syncedEventTaskMap?: Record<string, string>;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
};

type SupabaseRow = {
  user_id: string;
  state: CloudPayload;
  updated_at?: string;
};

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = process.env.SUPABASE_PLANNER_TABLE || DEFAULT_TABLE;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey, table };
}

function supabaseHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

export async function resolveGoogleUserId(accessToken: string): Promise<string | null> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as GoogleUserInfo;

  return payload.sub || payload.email || null;
}

export async function getCloudPlannerState(userId: string): Promise<{
  state: CloudPayload | null;
  updatedAt: string | null;
  configured: boolean;
}> {
  const cfg = supabaseConfig();
  if (!cfg) {
    return { state: null, updatedAt: null, configured: false };
  }

  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    select: "state,updated_at",
    limit: "1",
  });

  const response = await fetch(
    `${cfg.url}/rest/v1/${cfg.table}?${query.toString()}`,
    {
      headers: supabaseHeaders(cfg.serviceRoleKey),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase fetch failed (${response.status})`);
  }

  const rows = (await response.json()) as Array<{ state?: CloudPayload; updated_at?: string }>;
  if (!rows.length || !rows[0].state) {
    return { state: null, updatedAt: null, configured: true };
  }

  return {
    state: rows[0].state,
    updatedAt: rows[0].updated_at ?? null,
    configured: true,
  };
}

export async function saveCloudPlannerState(
  userId: string,
  state: CloudPayload,
): Promise<{ updatedAt: string | null; configured: boolean }> {
  const cfg = supabaseConfig();
  if (!cfg) {
    return { updatedAt: null, configured: false };
  }

  const payload: SupabaseRow = {
    user_id: userId,
    state,
  };

  const response = await fetch(
    `${cfg.url}/rest/v1/${cfg.table}?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(cfg.serviceRoleKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase save failed (${response.status})`);
  }

  const rows = (await response.json()) as Array<{ updated_at?: string }>;
  return {
    updatedAt: rows[0]?.updated_at ?? null,
    configured: true,
  };
}
