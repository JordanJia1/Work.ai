import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-auth";
import {
  getCloudPlannerState,
  resolveGoogleUserId,
  saveCloudPlannerState,
} from "@/lib/cloud-state";
import {
  normalizeSchedulePreferences,
  ScheduledBlock,
  TaskAnalysis,
  TaskInput,
} from "@/lib/planner";

function isPriorityLabel(value: unknown): value is TaskAnalysis["priorityLabel"] {
  return value === "Critical" || value === "High" || value === "Medium" || value === "Low";
}

function isTaskInputArray(value: unknown): value is TaskInput[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const task = item as Partial<TaskInput>;
    return (
      typeof task.id === "string" &&
      typeof task.title === "string" &&
      typeof task.details === "string" &&
      typeof task.deadline === "string"
    );
  });
}

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
      typeof task.priorityScore === "number" &&
      isPriorityLabel(task.priorityLabel)
    );
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function isScheduledBlockArray(value: unknown): value is ScheduledBlock[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const block = item as Partial<ScheduledBlock>;
    return (
      typeof block.taskId === "string" &&
      typeof block.taskTitle === "string" &&
      typeof block.startISO === "string" &&
      typeof block.endISO === "string" &&
      typeof block.minutes === "number" &&
      typeof block.calendarDescription === "string"
    );
  });
}

async function authorizeUser(): Promise<{ userId: string } | { error: NextResponse }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      error: NextResponse.json({ error: "Google Calendar not connected" }, { status: 401 }),
    };
  }

  const userId = await resolveGoogleUserId(accessToken);
  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unable to resolve Google user" }, { status: 401 }),
    };
  }

  return { userId };
}

export async function GET() {
  const auth = await authorizeUser();
  if ("error" in auth) return auth.error;

  try {
    const result = await getCloudPlannerState(auth.userId);
    if (!result.configured) {
      return NextResponse.json(
        { error: "Cloud sync not configured" },
        { status: 503 },
      );
    }

    return NextResponse.json({
      state: result.state,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load cloud planner state",
      },
      { status: 502 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeUser();
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as {
    tasks?: unknown;
    aiAnalysis?: unknown;
    schedulePreferences?: unknown;
    ignoredCalendarIds?: unknown;
    schedule?: unknown;
    syncedEventTaskMap?: unknown;
  };

  if (!isTaskInputArray(body.tasks)) {
    return NextResponse.json({ error: "Invalid tasks payload" }, { status: 400 });
  }

  if (body.aiAnalysis !== null && !isTaskAnalysisArray(body.aiAnalysis)) {
    return NextResponse.json({ error: "Invalid aiAnalysis payload" }, { status: 400 });
  }
  if (body.ignoredCalendarIds !== undefined && !isStringArray(body.ignoredCalendarIds)) {
    return NextResponse.json({ error: "Invalid ignoredCalendarIds payload" }, { status: 400 });
  }
  if (body.schedule !== undefined && !isScheduledBlockArray(body.schedule)) {
    return NextResponse.json({ error: "Invalid schedule payload" }, { status: 400 });
  }
  if (body.syncedEventTaskMap !== undefined && !isStringRecord(body.syncedEventTaskMap)) {
    return NextResponse.json({ error: "Invalid syncedEventTaskMap payload" }, { status: 400 });
  }

  try {
    const schedulePreferences = normalizeSchedulePreferences(body.schedulePreferences);

    const result = await saveCloudPlannerState(auth.userId, {
      tasks: body.tasks,
      aiAnalysis: (body.aiAnalysis as TaskAnalysis[] | null) ?? null,
      schedulePreferences,
      ignoredCalendarIds: (body.ignoredCalendarIds as string[] | undefined) ?? [],
      schedule: (body.schedule as ScheduledBlock[] | undefined) ?? [],
      syncedEventTaskMap:
        (body.syncedEventTaskMap as Record<string, string> | undefined) ?? {},
    });

    if (!result.configured) {
      return NextResponse.json(
        { error: "Cloud sync not configured" },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save cloud planner state",
      },
      { status: 502 },
    );
  }
}
