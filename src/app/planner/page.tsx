"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { WorkAiLogo } from "@/components/work-ai-logo";
import {
  DEFAULT_SCHEDULE_PREFERENCES,
  createGoogleCalendarLink,
  generateWeeklySchedule,
  normalizeSchedulePreferences,
  ScheduledBlock,
  SchedulePreferences,
  TaskAnalysis,
  TaskInput,
} from "@/lib/planner";

type FormState = {
  title: string;
  details: string;
  deadline: string;
};

type PhotoExtractResult = {
  title: string;
  details: string;
  deadline?: string | null;
};

type GoogleSession = {
  connected: boolean;
  expiresAt?: number;
  hasRefreshToken?: boolean;
};

type GoogleCalendarListItem = {
  id: string;
  summary: string;
  selected: boolean;
  primary: boolean;
};

type CalendarSnapshotEvent = {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  allDay: boolean;
  description: string;
};

type WeekCalendarEvent = CalendarSnapshotEvent & {
  hasOverlap: boolean;
};

type WeekDaySnapshot = {
  key: string;
  label: string;
  dateLabel: string;
  overlapCount: number;
  events: WeekCalendarEvent[];
};

type PendingCalendarMatch = {
  taskId: string;
  taskTitle: string;
  startISO: string;
  endISO: string;
  minutes: number;
};

type Theme = "light" | "dark" | "pink";
type PersistedData = {
  tasks: TaskInput[];
  aiAnalysis: TaskAnalysis[] | null;
  schedulePreferences: SchedulePreferences;
  ignoredCalendarIds: string[];
  schedule: ScheduledBlock[];
  syncedEventTaskMap: Record<string, string>;
  calendarSnapshot: CalendarSnapshotEvent[];
  googleCalendars: GoogleCalendarListItem[];
};

type TimelineDay = {
  key: string;
  label: string;
  minutes: number;
  blocks: number;
};

const STORAGE_KEY = "workflow_planner_v1";
const ONBOARDING_KEY = "work_ai_onboarded_v1";
const SETUP_PROMPT_KEY = "work_ai_setup_prompt_seen_v1";
const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

const initialForm: FormState = {
  title: "",
  details: "",
  deadline: "",
};

const ONBOARDING_STEPS = [
  {
    title: "Add your first task",
    description: "Use Brain Dump and click 'Add To Queue' with your own task details.",
  },
  {
    title: "Run Plan My Week",
    description: "Click 'Plan My Week' so AI builds your priority analysis and schedule.",
  },
  {
    title: "Send one block to Calendar",
    description: "Click 'Add to Google Calendar' on any suggested block to complete setup.",
  },
] as const;

function formatDayTime(isoLike: string): string {
  return new Date(isoLike).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatEventRange(startISO: string, endISO: string, allDay: boolean): string {
  if (allDay) return "All day";

  const start = new Date(startISO);
  const end = new Date(endISO);
  return `${start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase();
}

function areCloseTimes(aISO: string, bISO: string, toleranceMs = 60_000): boolean {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= toleranceMs;
}

function findMatchingSnapshotEvent(
  block: ScheduledBlock,
  snapshotEvents: CalendarSnapshotEvent[],
): CalendarSnapshotEvent | null {
  const descriptionTaskIdMatch = snapshotEvents.find((event) => {
    if (event.allDay) return false;
    if (!event.description.includes(`Work.ai Task ID: ${block.taskId}`)) return false;
    const sameStart = areCloseTimes(event.startISO, block.startISO);
    const sameEnd = areCloseTimes(event.endISO, block.endISO);
    return sameStart && sameEnd;
  });
  if (descriptionTaskIdMatch) return descriptionTaskIdMatch;

  return (
    snapshotEvents.find((event) => {
      if (event.allDay) return false;
      const sameTitle = normalizedTitle(event.title) === normalizedTitle(block.taskTitle);
      const sameStart = areCloseTimes(event.startISO, block.startISO);
      const sameEnd = areCloseTimes(event.endISO, block.endISO);
      return sameTitle && sameStart && sameEnd;
    }) ?? null
  );
}

function taskColorIndex(taskId: string): number {
  let hash = 0;
  for (let index = 0; index < taskId.length; index += 1) {
    hash = (hash * 31 + taskId.charCodeAt(index)) >>> 0;
  }
  return hash % 6;
}

function taskLabelColorClass(taskId: string): string {
  const palette = [
    "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700/70 dark:bg-sky-900/30 dark:text-sky-200 pink:border-sky-300 pink:bg-sky-100 pink:text-sky-700",
    "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700/70 dark:bg-emerald-900/30 dark:text-emerald-200 pink:border-emerald-300 pink:bg-emerald-100 pink:text-emerald-700",
    "border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-700/70 dark:bg-violet-900/30 dark:text-violet-200 pink:border-violet-300 pink:bg-violet-100 pink:text-violet-700",
    "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700/70 dark:bg-amber-900/30 dark:text-amber-200 pink:border-amber-300 pink:bg-amber-100 pink:text-amber-700",
    "border-cyan-300 bg-cyan-100 text-cyan-700 dark:border-cyan-700/70 dark:bg-cyan-900/30 dark:text-cyan-200 pink:border-cyan-300 pink:bg-cyan-100 pink:text-cyan-700",
    "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-700/70 dark:bg-indigo-900/30 dark:text-indigo-200 pink:border-indigo-300 pink:bg-indigo-100 pink:text-indigo-700",
  ] as const;
  return palette[taskColorIndex(taskId)];
}

function taskEventColorClass(taskId: string): string {
  const palette = [
    "border-sky-300 bg-sky-50/95 dark:border-sky-700/70 dark:bg-sky-900/30 pink:border-sky-300 pink:bg-sky-100/80",
    "border-emerald-300 bg-emerald-50/95 dark:border-emerald-700/70 dark:bg-emerald-900/30 pink:border-emerald-300 pink:bg-emerald-100/80",
    "border-violet-300 bg-violet-50/95 dark:border-violet-700/70 dark:bg-violet-900/30 pink:border-violet-300 pink:bg-violet-100/80",
    "border-amber-300 bg-amber-50/95 dark:border-amber-700/70 dark:bg-amber-900/30 pink:border-amber-300 pink:bg-amber-100/80",
    "border-cyan-300 bg-cyan-50/95 dark:border-cyan-700/70 dark:bg-cyan-900/30 pink:border-cyan-300 pink:bg-cyan-100/80",
    "border-indigo-300 bg-indigo-50/95 dark:border-indigo-700/70 dark:bg-indigo-900/30 pink:border-indigo-300 pink:bg-indigo-100/80",
  ] as const;
  return palette[taskColorIndex(taskId)];
}

function buildCalendarWeekView(events: CalendarSnapshotEvent[]): WeekDaySnapshot[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: WeekDaySnapshot[] = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return {
      key: localDateKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      overlapCount: 0,
      events: [],
    };
  });

  const map = new Map(days.map((day) => [day.key, day]));
  for (const event of events) {
    const key = localDateKey(new Date(event.startISO));
    const day = map.get(key);
    if (!day) continue;
    day.events.push({ ...event, hasOverlap: false });
  }

  for (const day of days) {
    day.events.sort((a, b) => a.startISO.localeCompare(b.startISO));

    const overlapMap = new Map<string, boolean>();
    for (let i = 0; i < day.events.length; i += 1) {
      for (let j = i + 1; j < day.events.length; j += 1) {
        const a = day.events[i];
        const b = day.events[j];
        const aStart = new Date(a.startISO).getTime();
        const aEnd = new Date(a.endISO).getTime();
        const bStart = new Date(b.startISO).getTime();
        const bEnd = new Date(b.endISO).getTime();
        if (aStart < bEnd && aEnd > bStart) {
          overlapMap.set(a.id, true);
          overlapMap.set(b.id, true);
        }
      }
    }

    day.events = day.events.map((event) => ({
      ...event,
      hasOverlap: overlapMap.get(event.id) ?? false,
    }));
    day.overlapCount = day.events.filter((event) => event.hasOverlap).length;
  }

  return days;
}

function dateTimeLocalFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function isDateTimeLocal(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

function fallbackDeadlineLocal(): string {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(17, 0, 0, 0);
  return dateTimeLocalFromDate(fallback);
}

function formatHourLabel(hour24: number): string {
  if (hour24 === 0 || hour24 === 24) return "12:00 AM";
  if (hour24 === 12) return "12:00 PM";
  if (hour24 < 12) return `${hour24}:00 AM`;
  return `${hour24 - 12}:00 PM`;
}

function getRuleForWeekday(preferences: SchedulePreferences, weekday: number) {
  return (
    preferences.dayRules.find((rule) => rule.weekday === weekday) ??
    DEFAULT_SCHEDULE_PREFERENCES.dayRules[weekday]
  );
}

function createSampleTasks(): TaskInput[] {
  const now = new Date();
  const tomorrow1830 = new Date(now);
  tomorrow1830.setDate(now.getDate() + 1);
  tomorrow1830.setHours(18, 30, 0, 0);

  const inTwoDays1600 = new Date(now);
  inTwoDays1600.setDate(now.getDate() + 2);
  inTwoDays1600.setHours(16, 0, 0, 0);

  const inThreeDays1200 = new Date(now);
  inThreeDays1200.setDate(now.getDate() + 3);
  inThreeDays1200.setHours(12, 0, 0, 0);

  return [
    {
      id: crypto.randomUUID(),
      title: "Launch prep for investor update",
      details: "Finalize metrics, tighten deck narrative, and prep Q&A notes.",
      deadline: dateTimeLocalFromDate(tomorrow1830),
    },
    {
      id: crypto.randomUUID(),
      title: "Fix onboarding drop-off",
      details: "Review analytics, identify friction points, and draft experiment plan.",
      deadline: dateTimeLocalFromDate(inTwoDays1600),
    },
    {
      id: crypto.randomUUID(),
      title: "Team planning sync notes",
      details: "Prepare roadmap notes and assign next sprint owners.",
      deadline: dateTimeLocalFromDate(inThreeDays1200),
    },
  ];
}

function priorityBadgeColor(priority: string): string {
  if (priority === "Critical") return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200 pink:bg-rose-200 pink:text-rose-800";
  if (priority === "High") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200 pink:bg-amber-100 pink:text-amber-800";
  if (priority === "Medium") return "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 pink:bg-fuchsia-100 pink:text-fuchsia-800";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 pink:bg-pink-100 pink:text-fuchsia-800";
}

function priorityLabelFromScore(score: number): TaskAnalysis["priorityLabel"] {
  if (score >= 85) return "Critical";
  if (score >= 65) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function urgencyDotClass(index: number, score: number): string {
  const activeDots = Math.max(1, Math.min(5, Math.ceil(score / 20)));
  const active = index < activeDots;
  if (!active) {
    return "bg-slate-200 dark:bg-slate-700 pink:bg-fuchsia-200";
  }
  if (score >= 85) return "bg-rose-500";
  if (score >= 65) return "bg-amber-500";
  if (score >= 45) return "bg-sky-500";
  return "bg-emerald-500";
}

function effortMeterWidth(hours: number): number {
  return Math.max(6, Math.min(100, Math.round((hours / 10) * 100)));
}

function buildTimeline(schedule: ReturnType<typeof generateWeeklySchedule>): TimelineDay[] {
  const byDay = new Map<string, TimelineDay>();

  for (const block of schedule) {
    const date = new Date(block.startISO);
    const key = localDateKey(date);
    const existing = byDay.get(key);
    if (existing) {
      existing.minutes += block.minutes;
      existing.blocks += 1;
      continue;
    }
    byDay.set(key, {
      key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      minutes: block.minutes,
      blocks: 1,
    });
  }

  return [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(0, 7);
}

function timelineWidth(minutes: number): number {
  const maxMinutesPerDay = 15 * 60;
  return Math.max(5, Math.min(100, Math.round((minutes / maxMinutesPerDay) * 100)));
}

function scheduleSignature(blocks: ScheduledBlock[]): string {
  return blocks
    .map((block) => `${block.taskId}|${block.startISO}|${block.endISO}|${block.minutes}`)
    .join("||");
}

function scheduleBlockKey(block: ScheduledBlock): string {
  return `${block.taskId}|${block.startISO}|${block.endISO}|${block.minutes}`;
}

function PlayfulEmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="empty-float rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-5 text-center dark:border-slate-700 dark:bg-slate-900/40 pink:border-fuchsia-200 pink:bg-pink-100/70">
      <p className="text-base font-bold text-slate-700 dark:text-slate-200 pink:text-fuchsia-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">{subtitle}</p>
    </div>
  );
}

function DoodleDivider() {
  return (
    <div className="fun-enter [animation-delay:200ms] flex items-center gap-2 px-1">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-sky-300 to-transparent dark:via-sky-700 pink:via-fuchsia-300" />
      <span className="h-2 w-2 rounded-full bg-sky-400 dark:bg-sky-500 pink:bg-fuchsia-500" />
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dark:bg-amber-500 pink:bg-rose-400" />
      <span className="h-2 w-2 rounded-full bg-indigo-400 dark:bg-indigo-500 pink:bg-pink-500" />
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-sky-300 to-transparent dark:via-sky-700 pink:via-fuchsia-300" />
    </div>
  );
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem("theme");
    return stored === "dark" || stored === "light" || stored === "pink" ? stored : null;
  } catch {
    return null;
  }
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem("theme", theme);
  } catch {
    // Ignore localStorage write failures.
  }
}

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

function isCalendarSnapshotEventArray(value: unknown): value is CalendarSnapshotEvent[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const event = item as Partial<CalendarSnapshotEvent>;
    return (
      typeof event.id === "string" &&
      typeof event.title === "string" &&
      typeof event.startISO === "string" &&
      typeof event.endISO === "string" &&
      typeof event.allDay === "boolean" &&
      (event.description === undefined || typeof event.description === "string")
    );
  });
}

function isGoogleCalendarListArray(value: unknown): value is GoogleCalendarListItem[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const calendar = item as Partial<GoogleCalendarListItem>;
    return (
      typeof calendar.id === "string" &&
      typeof calendar.summary === "string" &&
      typeof calendar.selected === "boolean" &&
      typeof calendar.primary === "boolean"
    );
  });
}

function loadPersistedData(): PersistedData | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      tasks?: unknown;
      aiAnalysis?: unknown;
      schedulePreferences?: unknown;
      ignoredCalendarIds?: unknown;
      schedule?: unknown;
      syncedEventTaskMap?: unknown;
      calendarSnapshot?: unknown;
      googleCalendars?: unknown;
    };

    if (!isTaskInputArray(parsed.tasks)) return null;
    if (parsed.aiAnalysis !== null && !isTaskAnalysisArray(parsed.aiAnalysis)) return null;

    return {
      tasks: parsed.tasks,
      aiAnalysis: (parsed.aiAnalysis as TaskAnalysis[] | null) ?? null,
      schedulePreferences: normalizeSchedulePreferences(parsed.schedulePreferences),
      ignoredCalendarIds: isStringArray(parsed.ignoredCalendarIds)
        ? parsed.ignoredCalendarIds
        : [],
      schedule: isScheduledBlockArray(parsed.schedule) ? parsed.schedule : [],
      syncedEventTaskMap: isStringRecord(parsed.syncedEventTaskMap)
        ? parsed.syncedEventTaskMap
        : {},
      calendarSnapshot: isCalendarSnapshotEventArray(parsed.calendarSnapshot)
        ? parsed.calendarSnapshot.map((event) => ({
            ...event,
            description: event.description ?? "",
          }))
        : [],
      googleCalendars: isGoogleCalendarListArray(parsed.googleCalendars)
        ? parsed.googleCalendars
        : [],
    };
  } catch {
    return null;
  }
}

function persistPlannerData(data: PersistedData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore localStorage write failures.
  }
}

export default function Home() {
  const [tasks, setTasks] = useState<TaskInput[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<TaskAnalysis[] | null>(null);
  const [schedule, setSchedule] = useState<ScheduledBlock[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleActionUrl, setScheduleActionUrl] = useState<string | null>(null);
  const [lastConflictCheckLabel, setLastConflictCheckLabel] = useState<string | null>(null);
  const [autoReplanNotice, setAutoReplanNotice] = useState<string | null>(null);
  const [cloudSyncLabel, setCloudSyncLabel] = useState<string>("local only");
  const [calendarSnapshot, setCalendarSnapshot] = useState<CalendarSnapshotEvent[]>([]);
  const [syncedEventTaskMap, setSyncedEventTaskMap] = useState<Record<string, string>>({});
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [googleCalendarsLoading, setGoogleCalendarsLoading] = useState(false);
  const [googleCalendarsError, setGoogleCalendarsError] = useState<string | null>(null);
  const [ignoredCalendarIds, setIgnoredCalendarIds] = useState<string[]>([]);
  const [calendarSnapshotError, setCalendarSnapshotError] = useState<string | null>(null);
  const [calendarSnapshotLabel, setCalendarSnapshotLabel] = useState<string | null>(null);
  const [calendarSnapshotLoading, setCalendarSnapshotLoading] = useState(false);
  const [googleSession, setGoogleSession] = useState<GoogleSession>({
    connected: false,
  });
  const [schedulePreferences, setSchedulePreferences] = useState<SchedulePreferences>(
    DEFAULT_SCHEDULE_PREFERENCES,
  );
  const [theme, setTheme] = useState<Theme | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showInitialSetupPrompt, setShowInitialSetupPrompt] = useState(false);
  const [sampleModeActive, setSampleModeActive] = useState(false);
  const [guidedCalendarClicked, setGuidedCalendarClicked] = useState(false);
  const [showTimePreferences, setShowTimePreferences] = useState(false);
  const [showCalendarWeekView, setShowCalendarWeekView] = useState(true);
  const [showConflictFilters, setShowConflictFilters] = useState(false);
  const [overrideTaskId, setOverrideTaskId] = useState<string | null>(null);
  const [overrideHoursInput, setOverrideHoursInput] = useState<string>("");
  const [overridePriorityInput, setOverridePriorityInput] = useState<string>("");
  const [overrideUrgencyInput, setOverrideUrgencyInput] = useState<string>("");
  const [photoUploadLoading, setPhotoUploadLoading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [photoUploadMessage, setPhotoUploadMessage] = useState<string | null>(null);
  const celebrationTimer = useRef<number | null>(null);
  const autoReplanTimer = useRef<number | null>(null);
  const scheduleRequestInFlight = useRef(false);
  const queuedScheduleRefresh = useRef<{ queued: boolean; silent: boolean }>({
    queued: false,
    silent: true,
  });
  const scheduleSignatureRef = useRef<string>("");
  const scheduleRef = useRef<ScheduledBlock[]>([]);
  const localHydratedRef = useRef(false);
  const cloudSyncTimer = useRef<number | null>(null);
  const cloudHydratedRef = useRef(false);
  const hasLocalStateRef = useRef(false);
  const calendarSnapshotPollTimer = useRef<number | null>(null);
  const calendarSnapshotRefreshAfterAddTimers = useRef<number[]>([]);
  const committedBlockKeysRef = useRef<Set<string>>(new Set());
  const pendingCalendarMatchesRef = useRef<PendingCalendarMatch[]>([]);
  const suppressNextAutoScheduleRefreshRef = useRef(false);
  const photoFileInputRef = useRef<HTMLInputElement | null>(null);

  const analysis = useMemo(() => aiAnalysis ?? [], [aiAnalysis]);
  const analyzedIds = useMemo(() => new Set(analysis.map((task) => task.id)), [analysis]);
  const pendingTasks = useMemo(
    () => tasks.filter((task) => !analyzedIds.has(task.id)),
    [tasks, analyzedIds],
  );
  const timeline = useMemo(() => buildTimeline(schedule), [schedule]);
  const calendarWeekView = useMemo(
    () => buildCalendarWeekView(calendarSnapshot),
    [calendarSnapshot],
  );
  const unscheduledAnalyzedTasks = useMemo(() => {
    const scheduledTaskIds = new Set(schedule.map((block) => block.taskId));
    return analysis.filter(
      (task) => task.estimatedHours > 0 && !scheduledTaskIds.has(task.id),
    );
  }, [analysis, schedule]);
  const syncedBlocksByTaskId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const taskId of Object.values(syncedEventTaskMap)) {
      counts[taskId] = (counts[taskId] ?? 0) + 1;
    }
    return counts;
  }, [syncedEventTaskMap]);

  const totalHours = analysis.reduce((sum, task) => sum + task.estimatedHours, 0);
  const connectedCalendar = googleSession.connected;

  const markOnboardingSeen = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // Ignore localStorage write failures.
    }
  }, []);

  const markSetupPromptSeen = useCallback(() => {
    setShowInitialSetupPrompt(false);
    try {
      window.localStorage.setItem(SETUP_PROMPT_KEY, "1");
    } catch {
      // Ignore localStorage write failures.
    }
  }, []);

  const openSetupPanels = useCallback(() => {
    setShowTimePreferences(true);
    setShowConflictFilters(true);
    markSetupPromptSeen();
  }, [markSetupPromptSeen]);

  const closeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    setOnboardingStep(0);
    setGuidedCalendarClicked(false);
    markOnboardingSeen();
  }, [markOnboardingSeen]);

  const loadSampleMode = useCallback(() => {
    const sampleTasks = createSampleTasks();
    setTasks(sampleTasks);
    setAiAnalysis(null);
    setAiError(null);
    setScheduleError(null);
    setScheduleActionUrl(null);
    setAutoReplanNotice(null);
    setSampleModeActive(true);
    setShowOnboarding(false);
    setOnboardingStep(0);
    setGuidedCalendarClicked(false);
    markOnboardingSeen();
  }, [markOnboardingSeen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAuthError(params.get("authError"));

    const requestedOnboarding = params.get("onboarding") === "1";
    const requestedSample = params.get("sample") === "1";

    if (requestedSample) {
      loadSampleMode();
      setShowOnboarding(false);
      setOnboardingStep(0);
    } else if (requestedOnboarding) {
      setShowOnboarding(true);
      setOnboardingStep(0);
      setGuidedCalendarClicked(false);
    }

    if (requestedOnboarding || requestedSample || params.has("authError")) {
      params.delete("onboarding");
      params.delete("sample");
      params.delete("authError");
      const query = params.toString();
      const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.replaceState({}, "", nextUrl);
    }
  }, [loadSampleMode]);

  useEffect(() => {
    try {
      const promptSeen = window.localStorage.getItem(SETUP_PROMPT_KEY) === "1";
      if (!promptSeen) {
        setShowInitialSetupPrompt(true);
      }
    } catch {
      setShowInitialSetupPrompt(true);
    }
  }, []);

  useEffect(() => {
    const savedTheme = readStoredTheme();
    const initialTheme =
      savedTheme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    document.documentElement.classList.toggle("dark", initialTheme === "dark");
    document.documentElement.classList.toggle("pink", initialTheme === "pink");
    setTheme(initialTheme);
    persistTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("pink", theme === "pink");
    persistTheme(theme);
  }, [theme]);

  function applyTheme(nextTheme: Theme) {
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.classList.toggle("pink", nextTheme === "pink");
    persistTheme(nextTheme);
    setTheme(nextTheme);
  }

  useEffect(() => {
    const persisted = loadPersistedData();
    if (persisted) {
      setTasks(persisted.tasks);
      setAiAnalysis(persisted.aiAnalysis);
      setSchedulePreferences(persisted.schedulePreferences);
      setIgnoredCalendarIds(persisted.ignoredCalendarIds);
      setSchedule(persisted.schedule);
      setSyncedEventTaskMap(persisted.syncedEventTaskMap);
      setCalendarSnapshot(persisted.calendarSnapshot);
      setGoogleCalendars(persisted.googleCalendars);
      scheduleSignatureRef.current = scheduleSignature(persisted.schedule);
      hasLocalStateRef.current =
        persisted.tasks.length > 0 ||
        (persisted.aiAnalysis?.length ?? 0) > 0 ||
        persisted.schedule.length > 0 ||
        persisted.calendarSnapshot.length > 0 ||
        persisted.googleCalendars.length > 0 ||
        Object.keys(persisted.syncedEventTaskMap).length > 0 ||
        persisted.ignoredCalendarIds.length > 0;
    }
    localHydratedRef.current = true;
  }, []);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    if (!localHydratedRef.current) return;
    persistPlannerData({
      tasks,
      aiAnalysis,
      schedulePreferences,
      ignoredCalendarIds,
      schedule,
      syncedEventTaskMap,
      calendarSnapshot,
      googleCalendars,
    });
  }, [
    tasks,
    aiAnalysis,
    schedulePreferences,
    ignoredCalendarIds,
    schedule,
    syncedEventTaskMap,
    calendarSnapshot,
    googleCalendars,
  ]);

  useEffect(() => {
    let active = true;

    async function hydrateCloudState() {
      if (!connectedCalendar) {
        cloudHydratedRef.current = true;
        setCloudSyncLabel("local only");
        return;
      }

      setCloudSyncLabel("syncing...");
      try {
        const response = await fetch("/api/cloud/state", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as {
          state?:
            | {
                tasks?: TaskInput[];
                aiAnalysis?: TaskAnalysis[] | null;
                schedulePreferences?: unknown;
                ignoredCalendarIds?: unknown;
                schedule?: unknown;
                syncedEventTaskMap?: unknown;
              }
            | null;
          updatedAt?: string | null;
          error?: string;
        };

        if (response.status === 503) {
          if (active) setCloudSyncLabel("cloud not configured");
          return;
        }

        if (!response.ok) {
          if (active) setCloudSyncLabel("sync error");
          return;
        }

        if (active && data.state && !hasLocalStateRef.current) {
          setTasks((current) =>
            current.length > 0
              ? current
              : isTaskInputArray(data.state?.tasks)
                ? data.state.tasks
                : current,
          );
          setAiAnalysis((current) =>
            current && current.length > 0
              ? current
              : data.state?.aiAnalysis === null || isTaskAnalysisArray(data.state?.aiAnalysis)
                ? (data.state.aiAnalysis as TaskAnalysis[] | null)
                : current,
          );
          setSchedulePreferences((current) => {
            if (data.state?.schedulePreferences === undefined) return current;
            return normalizeSchedulePreferences(data.state.schedulePreferences);
          });
          setIgnoredCalendarIds((current) =>
            isStringArray(data.state?.ignoredCalendarIds)
              ? data.state.ignoredCalendarIds
              : current,
          );
          setSchedule((current) => {
            if (current.length > 0) return current;
            if (isScheduledBlockArray(data.state?.schedule)) {
              scheduleSignatureRef.current = scheduleSignature(data.state.schedule);
              return data.state.schedule;
            }
            return current;
          });
          setSyncedEventTaskMap((current) =>
            Object.keys(current).length > 0
              ? current
              : isStringRecord(data.state?.syncedEventTaskMap)
              ? data.state.syncedEventTaskMap
              : current,
          );
          setCloudSyncLabel(
            data.updatedAt
              ? `synced ${new Date(data.updatedAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "synced",
          );
        } else if (active) {
          setCloudSyncLabel("synced");
        }
      } catch {
        if (active) setCloudSyncLabel("sync error");
      } finally {
        cloudHydratedRef.current = true;
      }
    }

    hydrateCloudState();

    return () => {
      active = false;
    };
  }, [connectedCalendar]);

  useEffect(() => {
    if (!connectedCalendar) return;
    if (!cloudHydratedRef.current) return;

    if (cloudSyncTimer.current !== null) {
      window.clearTimeout(cloudSyncTimer.current);
    }

    cloudSyncTimer.current = window.setTimeout(async () => {
      try {
        setCloudSyncLabel("syncing...");
        const response = await fetch("/api/cloud/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tasks,
            aiAnalysis,
            schedulePreferences,
            ignoredCalendarIds,
            schedule,
            syncedEventTaskMap,
          }),
        });

        const data = (await response.json()) as {
          ok?: boolean;
          updatedAt?: string | null;
          error?: string;
        };

        if (response.status === 503) {
          setCloudSyncLabel("cloud not configured");
          return;
        }

        if (!response.ok || !data.ok) {
          setCloudSyncLabel("sync error");
          return;
        }

        setCloudSyncLabel(
          data.updatedAt
            ? `synced ${new Date(data.updatedAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "synced",
        );
      } catch {
        setCloudSyncLabel("sync error");
      }
    }, 900);

    return () => {
      if (cloudSyncTimer.current !== null) {
        window.clearTimeout(cloudSyncTimer.current);
      }
    };
  }, [
    tasks,
    aiAnalysis,
    schedulePreferences,
    ignoredCalendarIds,
    schedule,
    syncedEventTaskMap,
    connectedCalendar,
  ]);

  useEffect(() => {
    if (!showOnboarding) return;

    if (onboardingStep === 0 && tasks.length > 0) {
      setOnboardingStep(1);
      return;
    }

    if (onboardingStep === 1 && analysis.length > 0) {
      setOnboardingStep(2);
      return;
    }

    if (onboardingStep === 2 && guidedCalendarClicked) {
      closeOnboarding();
      setShowCelebration(true);
      if (celebrationTimer.current !== null) {
        window.clearTimeout(celebrationTimer.current);
      }
      celebrationTimer.current = window.setTimeout(() => {
        setShowCelebration(false);
      }, 2800);
    }
  }, [
    showOnboarding,
    onboardingStep,
    tasks.length,
    analysis.length,
    guidedCalendarClicked,
    closeOnboarding,
  ]);

  const refreshSchedule = useCallback(
    async ({ silent }: { silent: boolean }) => {
      if (scheduleRequestInFlight.current) {
        queuedScheduleRefresh.current = {
          queued: true,
          // if any caller requested a visible refresh, keep it visible
          silent: queuedScheduleRefresh.current.silent && silent,
        };
        return;
      }

      scheduleRequestInFlight.current = true;

      if (analysis.length === 0) {
        setSchedule([]);
        setScheduleLoading(false);
        setScheduleError(null);
        setScheduleActionUrl(null);
        setAutoReplanNotice(null);
        setLastConflictCheckLabel(null);
        scheduleSignatureRef.current = "";
        scheduleRequestInFlight.current = false;
        return;
      }

      if (!connectedCalendar) {
        const localSchedule = generateWeeklySchedule(analysis, [], schedulePreferences);
        setSchedule(localSchedule);
        setScheduleLoading(false);
        setScheduleError(null);
        setScheduleActionUrl(null);
        setAutoReplanNotice(null);
        setLastConflictCheckLabel(null);
        scheduleSignatureRef.current = scheduleSignature(localSchedule);
        scheduleRequestInFlight.current = false;
        return;
      }

      if (!silent) {
        setScheduleLoading(true);
      }

      try {
        const response = await fetch("/api/planner/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysis,
            schedulePreferences,
            ignoredCalendarIds,
          }),
        });

        const data = (await response.json()) as {
          schedule?: ScheduledBlock[];
          error?: string;
          actionUrl?: string;
        };

        if (!response.ok || !data.schedule) {
          const error = new Error(data.error || "Could not generate conflict-aware schedule");
          (error as Error & { actionUrl?: string }).actionUrl = data.actionUrl;
          throw error;
        }

        const nextSignature = scheduleSignature(data.schedule);
        const hadSignature = scheduleSignatureRef.current.length > 0;
        const changed = hadSignature && scheduleSignatureRef.current !== nextSignature;
        scheduleSignatureRef.current = nextSignature;

        setSchedule(data.schedule);
        setScheduleError(null);
        setScheduleActionUrl(null);
        setLastConflictCheckLabel(
          new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
        );

        if (changed) {
          setAutoReplanNotice("New calendar activity detected. Game Plan was auto-adjusted.");
          if (autoReplanTimer.current !== null) {
            window.clearTimeout(autoReplanTimer.current);
          }
          autoReplanTimer.current = window.setTimeout(() => {
            setAutoReplanNotice(null);
          }, 4200);
        }
      } catch (error) {
        const actionUrl =
          error && typeof error === "object" && "actionUrl" in error
            ? (error as { actionUrl?: string }).actionUrl
            : undefined;
        const localFallback = generateWeeklySchedule(analysis, [], schedulePreferences);
        setSchedule(localFallback);
        scheduleSignatureRef.current = scheduleSignature(localFallback);
        setScheduleError(
          error instanceof Error
            ? `${error.message}. Showing a local fallback schedule.`
            : "Could not check calendar conflicts. Showing a local fallback schedule.",
        );
        setScheduleActionUrl(actionUrl ?? null);
      } finally {
        setScheduleLoading(false);
        scheduleRequestInFlight.current = false;

        if (queuedScheduleRefresh.current.queued) {
          const nextSilent = queuedScheduleRefresh.current.silent;
          queuedScheduleRefresh.current = { queued: false, silent: true };
          void refreshSchedule({ silent: nextSilent });
        }
      }
    },
    [
      analysis,
      connectedCalendar,
      schedulePreferences,
      ignoredCalendarIds,
    ],
  );

  const refreshCalendarSnapshot = useCallback(
    async ({ silent }: { silent: boolean }) => {
      if (!connectedCalendar) {
        if (!authLoading) {
          setCalendarSnapshot([]);
          setCalendarSnapshotLabel(null);
          setCalendarSnapshotError(null);
          setCalendarSnapshotLoading(false);
        }
        // Avoid wiping persisted sync labels during initial auth/session bootstrap.
        if (!authLoading) {
          setSyncedEventTaskMap({});
        }
        return;
      }

      if (!silent) {
        setCalendarSnapshotLoading(true);
      }

      try {
        const params = new URLSearchParams({
          days: "7",
          limit: "80",
        });
        if (ignoredCalendarIds.length > 0) {
          params.set("ignoredCalendarIds", ignoredCalendarIds.join(","));
        }

        const response = await fetch(`/api/google/upcoming?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          events?: CalendarSnapshotEvent[];
          refreshedAt?: string;
          error?: string;
        };

        if (!response.ok || !data.events) {
          throw new Error(data.error || "Could not load calendar snapshot");
        }

        setCalendarSnapshot(data.events);
        const matchedFromSchedule: Array<{ eventId: string; taskId: string; minutes: number }> = [];
        setSchedule((current) => {
          const remaining = current.filter((block) => {
            const matchedEvent = findMatchingSnapshotEvent(block, data.events ?? []);
            if (!matchedEvent) return true;
            matchedFromSchedule.push({
              eventId: matchedEvent.id,
              taskId: block.taskId,
              minutes: block.minutes,
            });
            return false;
          });
          if (remaining.length !== current.length) {
            scheduleSignatureRef.current = scheduleSignature(remaining);
          }
          return remaining;
        });
        if (matchedFromSchedule.length > 0) {
          const minutesByTask = new Map<string, number>();
          for (const pair of matchedFromSchedule) {
            minutesByTask.set(pair.taskId, (minutesByTask.get(pair.taskId) ?? 0) + pair.minutes);
          }
          suppressNextAutoScheduleRefreshRef.current = true;
          setAiAnalysis((current) => {
            if (!current) return current;
            return current.map((task) => {
              const syncedMinutes = minutesByTask.get(task.id) ?? 0;
              if (syncedMinutes <= 0) return task;
              const nextHours = Math.max(0, task.estimatedHours - syncedMinutes / 60);
              return {
                ...task,
                estimatedHours: Math.round(nextHours * 100) / 100,
              };
            });
          });
        }
        const matchedFromPending: Array<{ eventId: string; taskId: string; minutes: number }> = [];
        if (pendingCalendarMatchesRef.current.length > 0) {
          const unmatchedPending: PendingCalendarMatch[] = [];
          const claimedEventIds = new Set(matchedFromSchedule.map((pair) => pair.eventId));

          for (const pending of pendingCalendarMatchesRef.current) {
            const matchedEvent = findMatchingSnapshotEvent(
              {
                taskId: pending.taskId,
                taskTitle: pending.taskTitle,
                startISO: pending.startISO,
                endISO: pending.endISO,
                minutes: pending.minutes,
                calendarDescription: "",
              },
              data.events ?? [],
            );

            if (!matchedEvent || claimedEventIds.has(matchedEvent.id)) {
              unmatchedPending.push(pending);
              continue;
            }

            claimedEventIds.add(matchedEvent.id);
            matchedFromPending.push({
              eventId: matchedEvent.id,
              taskId: pending.taskId,
              minutes: pending.minutes,
            });
          }

          pendingCalendarMatchesRef.current = unmatchedPending;
        }
        setSyncedEventTaskMap((current) => {
          const next: Record<string, string> = {};
          const visibleEventIds = new Set((data.events ?? []).map((event) => event.id));
          for (const [eventId, taskId] of Object.entries(current)) {
            if (visibleEventIds.has(eventId)) next[eventId] = taskId;
          }
          for (const pair of [...matchedFromSchedule, ...matchedFromPending]) {
            next[pair.eventId] = pair.taskId;
          }
          return next;
        });
        setCalendarSnapshotLabel(
          new Date(data.refreshedAt ?? Date.now()).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
        setCalendarSnapshotError(null);
      } catch (error) {
        setCalendarSnapshotError(
          error instanceof Error ? error.message : "Could not load calendar snapshot",
        );
      } finally {
        setCalendarSnapshotLoading(false);
      }
    },
    [connectedCalendar, ignoredCalendarIds, authLoading],
  );

  const refreshGoogleCalendars = useCallback(async () => {
    if (!connectedCalendar) {
      if (!authLoading) {
        setGoogleCalendars([]);
        setGoogleCalendarsError(null);
      }
      setGoogleCalendarsLoading(false);
      return;
    }

    setGoogleCalendarsLoading(true);
    try {
      const response = await fetch("/api/google/calendars", { cache: "no-store" });
      const data = (await response.json()) as {
        calendars?: GoogleCalendarListItem[];
        error?: string;
      };

      if (!response.ok || !data.calendars) {
        throw new Error(data.error || "Could not load calendars");
      }

      setGoogleCalendars(data.calendars);
      const validIds = new Set(data.calendars.map((calendar) => calendar.id));
      setIgnoredCalendarIds((current) => current.filter((id) => validIds.has(id)));
      setGoogleCalendarsError(null);
    } catch (error) {
      setGoogleCalendarsError(
        error instanceof Error ? error.message : "Could not load calendars",
      );
    } finally {
      setGoogleCalendarsLoading(false);
    }
  }, [connectedCalendar, authLoading]);

  const markBlockAdded = useCallback((block: ScheduledBlock) => {
    const key = scheduleBlockKey(block);
    if (committedBlockKeysRef.current.has(key)) return;
    committedBlockKeysRef.current.add(key);
    suppressNextAutoScheduleRefreshRef.current = true;
    pendingCalendarMatchesRef.current.push({
      taskId: block.taskId,
      taskTitle: block.taskTitle,
      startISO: block.startISO,
      endISO: block.endISO,
      minutes: block.minutes,
    });

    setSchedule((current) => {
      const next = current.filter((candidate) => scheduleBlockKey(candidate) !== key);
      if (next.length !== current.length) {
        scheduleSignatureRef.current = scheduleSignature(next);
      }
      return next;
    });

    setAiAnalysis((current) => {
      if (!current) return current;
      return current.map((task) => {
        if (task.id !== block.taskId) return task;
        const nextHours = Math.max(0, task.estimatedHours - block.minutes / 60);
        return {
          ...task,
          estimatedHours: Math.round(nextHours * 100) / 100,
        };
      });
    });
  }, []);

  useEffect(() => {
    if (suppressNextAutoScheduleRefreshRef.current) {
      suppressNextAutoScheduleRefreshRef.current = false;
      return;
    }
    refreshSchedule({ silent: false });
  }, [refreshSchedule]);

  useEffect(() => {
    refreshCalendarSnapshot({ silent: false });
  }, [refreshCalendarSnapshot]);

  useEffect(() => {
    refreshGoogleCalendars();
  }, [refreshGoogleCalendars]);

  useEffect(() => {
    if (!connectedCalendar) {
      if (calendarSnapshotPollTimer.current !== null) {
        window.clearInterval(calendarSnapshotPollTimer.current);
        calendarSnapshotPollTimer.current = null;
      }
      return;
    }

    calendarSnapshotPollTimer.current = window.setInterval(() => {
      refreshCalendarSnapshot({ silent: true });
    }, 60000);

    return () => {
      if (calendarSnapshotPollTimer.current !== null) {
        window.clearInterval(calendarSnapshotPollTimer.current);
        calendarSnapshotPollTimer.current = null;
      }
    };
  }, [connectedCalendar, refreshCalendarSnapshot]);

  useEffect(() => {
    return () => {
      if (celebrationTimer.current !== null) {
        window.clearTimeout(celebrationTimer.current);
      }
      if (autoReplanTimer.current !== null) {
        window.clearTimeout(autoReplanTimer.current);
      }
      if (cloudSyncTimer.current !== null) {
        window.clearTimeout(cloudSyncTimer.current);
      }
      if (calendarSnapshotPollTimer.current !== null) {
        window.clearInterval(calendarSnapshotPollTimer.current);
      }
      for (const timerId of calendarSnapshotRefreshAfterAddTimers.current) {
        window.clearTimeout(timerId);
      }
      calendarSnapshotRefreshAfterAddTimers.current = [];
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      setAuthLoading(true);
      try {
        const response = await fetch("/api/auth/google/session", {
          cache: "no-store",
        });

        if (!response.ok) {
          if (active) setGoogleSession({ connected: false });
          return;
        }

        const data = (await response.json()) as GoogleSession;
        if (active) setGoogleSession(data);
      } catch {
        if (active) setGoogleSession({ connected: false });
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    loadSession();

    return () => {
      active = false;
    };
  }, []);

  async function disconnectGoogle() {
    await fetch("/api/auth/google/logout", {
      method: "POST",
    });
    setGoogleSession({ connected: false });
  }

  const runAIAnalysis = useCallback(async () => {
    if (tasks.length === 0) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      });

      const data = (await response.json()) as {
        analyses?: TaskAnalysis[];
        error?: string;
      };

      if (!response.ok || !data.analyses) {
        throw new Error(data.error || "AI analysis failed");
      }

      setAiAnalysis(data.analyses);
      setOverrideTaskId(null);
      setOverrideHoursInput("");
      setOverridePriorityInput("");
      setOverrideUrgencyInput("");
      setShowCelebration(true);
      if (celebrationTimer.current !== null) {
        window.clearTimeout(celebrationTimer.current);
      }
      celebrationTimer.current = window.setTimeout(() => {
        setShowCelebration(false);
      }, 2800);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI analysis failed");
      setAiAnalysis(null);
      setOverrideTaskId(null);
      setOverrideHoursInput("");
      setOverridePriorityInput("");
      setOverrideUrgencyInput("");
    } finally {
      setAiLoading(false);
    }
  }, [tasks]);

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.title.trim() || !form.deadline) return;

    const newTask: TaskInput = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      details: form.details.trim(),
      deadline: form.deadline,
    };

    setTasks((current) => [...current, newTask]);
    setAiAnalysis(null);
    setAiError(null);
    setOverrideTaskId(null);
    setOverrideHoursInput("");
    setOverridePriorityInput("");
    setOverrideUrgencyInput("");
    setSampleModeActive(false);
    setForm(initialForm);
  }

  async function handleTaskPhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPhotoUploadLoading(true);
    setPhotoUploadError(null);
    setPhotoUploadMessage(null);

    try {
      const payload = new FormData();
      payload.append("image", file);

      const response = await fetch("/api/ai/extract-task-image", {
        method: "POST",
        body: payload,
      });

      const data = (await response.json()) as {
        tasks?: PhotoExtractResult[];
        task?: PhotoExtractResult;
        error?: string;
      };

      const extracted = Array.isArray(data.tasks)
        ? data.tasks
        : data.task
          ? [data.task]
          : [];
      if (!response.ok || extracted.length === 0) {
        throw new Error(data.error || "Could not extract task from image");
      }

      const newTasks: TaskInput[] = extracted
        .map((task) => {
          const title = task.title?.trim();
          if (!title) return null;
          const details = (task.details ?? "").trim();
          const deadline =
            task.deadline && isDateTimeLocal(task.deadline)
              ? task.deadline
              : fallbackDeadlineLocal();
          return {
            id: crypto.randomUUID(),
            title,
            details,
            deadline,
          };
        })
        .filter((task): task is TaskInput => task !== null);

      if (newTasks.length === 0) {
        throw new Error("AI could not detect a task title in the image");
      }

      setTasks((current) => [...current, ...newTasks]);
      setAiAnalysis(null);
      setAiError(null);
      setOverrideTaskId(null);
      setOverrideHoursInput("");
      setOverridePriorityInput("");
      setOverrideUrgencyInput("");
      setSampleModeActive(false);
      setPhotoUploadMessage(
        `Added ${newTasks.length} task${newTasks.length === 1 ? "" : "s"} from photo.`,
      );
      const first = newTasks[0];
      setForm({
        title: first.title,
        details: first.details,
        deadline: first.deadline,
      });
    } catch (error) {
      setPhotoUploadError(
        error instanceof Error ? error.message : "Could not extract task from image",
      );
    } finally {
      setPhotoUploadLoading(false);
    }
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
    setAiAnalysis(null);
    setAiError(null);
    setScheduleError(null);
    setScheduleActionUrl(null);
    setAutoReplanNotice(null);
    if (overrideTaskId === id) {
      setOverrideTaskId(null);
      setOverrideHoursInput("");
      setOverridePriorityInput("");
      setOverrideUrgencyInput("");
    }
  }

  function exitSampleMode() {
    setSampleModeActive(false);
    setTasks([]);
    setAiAnalysis(null);
    setSchedule([]);
    setAiError(null);
    setScheduleError(null);
    setScheduleActionUrl(null);
    setAutoReplanNotice(null);
    setShowCelebration(false);
    setOverrideTaskId(null);
    setOverrideHoursInput("");
    setOverridePriorityInput("");
    setOverrideUrgencyInput("");
  }

  function openOverrideEditor(task: TaskAnalysis) {
    setOverrideTaskId(task.id);
    setOverrideHoursInput(String(task.estimatedHours));
    setOverridePriorityInput(String(task.priorityScore));
    setOverrideUrgencyInput(String(task.urgencyScore));
  }

  function cancelOverrideEditor() {
    setOverrideTaskId(null);
    setOverrideHoursInput("");
    setOverridePriorityInput("");
    setOverrideUrgencyInput("");
  }

  function saveOverrideEditor(taskId: string) {
    const parsedHours = Number(overrideHoursInput);
    const parsedPriority = Number(overridePriorityInput);
    const parsedUrgency = Number(overrideUrgencyInput);
    if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedPriority) || !Number.isFinite(parsedUrgency)) return;

    const estimatedHours = Math.max(0.5, Math.min(80, Math.round(parsedHours * 10) / 10));
    const priorityScore = Math.max(0, Math.min(100, Math.round(parsedPriority)));
    const urgencyScore = Math.max(0, Math.min(100, Math.round(parsedUrgency)));
    const priorityLabel = priorityLabelFromScore(priorityScore);

    setAiAnalysis((current) => {
      if (!current) return current;
      return current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              estimatedHours,
              urgencyScore,
              priorityScore,
              priorityLabel,
              analysisReason:
                task.analysisReason && task.analysisReason.toLowerCase().includes("manual override")
                  ? task.analysisReason
                  : task.analysisReason
                    ? `${task.analysisReason} (manual override)`
                    : "Manual override",
            }
          : task,
      );
    });

    cancelOverrideEditor();
  }

  function updateDayStartHour(weekday: number, nextStartHour: number) {
    setSchedulePreferences((current) => {
      const dayRule = getRuleForWeekday(current, weekday);
      const safeStart = Math.max(0, Math.min(23, nextStartHour));
      const nextEnd = safeStart >= dayRule.endHour ? Math.min(24, safeStart + 1) : dayRule.endHour;

      return normalizeSchedulePreferences({
        ...current,
        dayRules: current.dayRules.map((rule) =>
          rule.weekday === weekday
            ? { ...rule, startHour: safeStart, endHour: nextEnd }
            : rule,
        ),
      });
    });
  }

  function updateDayEndHour(weekday: number, nextEndHour: number) {
    setSchedulePreferences((current) => {
      const dayRule = getRuleForWeekday(current, weekday);
      const safeEnd = Math.max(1, Math.min(24, nextEndHour));
      const nextStart = safeEnd <= dayRule.startHour ? Math.max(0, safeEnd - 1) : dayRule.startHour;

      return normalizeSchedulePreferences({
        ...current,
        dayRules: current.dayRules.map((rule) =>
          rule.weekday === weekday
            ? { ...rule, startHour: nextStart, endHour: safeEnd }
            : rule,
        ),
      });
    });
  }

  function toggleDayEnabled(weekday: number) {
    setSchedulePreferences((current) =>
      normalizeSchedulePreferences({
        ...current,
        dayRules: current.dayRules.map((rule) =>
          rule.weekday === weekday ? { ...rule, enabled: !rule.enabled } : rule,
        ),
      }),
    );
  }

  function applyDayWindowToAll(weekday: number) {
    setSchedulePreferences((current) => {
      const source = getRuleForWeekday(current, weekday);
      return normalizeSchedulePreferences({
        ...current,
        dayRules: current.dayRules.map((rule) => ({
          ...rule,
          startHour: source.startHour,
          endHour: source.endHour,
        })),
      });
    });
  }

  function updateWellnessPreference(
    key:
      | "maxWorkMinutesPerDay"
      | "maxContinuousFocusMinutes",
    value: number,
  ) {
    setSchedulePreferences((current) =>
      normalizeSchedulePreferences({
        ...current,
        [key]: value,
      }),
    );
  }

  function toggleIgnoredCalendar(calendarId: string) {
    setIgnoredCalendarIds((current) =>
      current.includes(calendarId)
        ? current.filter((id) => id !== calendarId)
        : [...current, calendarId],
    );
  }

  function themeDotClass(value: Theme): string {
    const selected = theme === value;
    const base =
      "h-4 w-4 rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";
    if (value === "light") {
      return `${base} border-slate-300 bg-white ${selected ? "ring-2 ring-slate-400 scale-110" : ""}`;
    }
    if (value === "dark") {
      return `${base} border-slate-300 bg-slate-900 ${selected ? "ring-2 ring-slate-400 scale-110" : ""}`;
    }
    return `${base} border-fuchsia-300 bg-fuchsia-400 ${selected ? "ring-2 ring-fuchsia-500 scale-110" : ""}`;
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 md:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.2),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(250,204,21,0.2),transparent_35%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.2),transparent_38%),radial-gradient(circle_at_80%_0%,rgba(251,191,36,0.1),transparent_30%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] pink:bg-[radial-gradient(circle_at_18%_20%,rgba(244,114,182,0.24),transparent_40%),radial-gradient(circle_at_85%_5%,rgba(217,70,239,0.22),transparent_35%),linear-gradient(180deg,#fff1f7_0%,#ffe4ef_100%)]" />
      <main className="relative mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="fun-enter rounded-2xl border border-slate-300/60 bg-white/75 p-6 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/70 pink:border-fuchsia-200 pink:bg-pink-50/80 md:p-8">
          <div className="flex items-start justify-between gap-3">
            <Link href="/" aria-label="Go to homepage">
              <WorkAiLogo />
            </Link>
            <div className="flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/70 pink:border-fuchsia-200 pink:bg-pink-100/80">
              <button
                type="button"
                aria-label="Use light theme"
                title="Light theme"
                onClick={() => applyTheme("light")}
                className={themeDotClass("light")}
              />
              <button
                type="button"
                aria-label="Use dark theme"
                title="Dark theme"
                onClick={() => applyTheme("dark")}
                className={themeDotClass("dark")}
              />
              <button
                type="button"
                aria-label="Use pink theme"
                title="Pink theme"
                onClick={() => applyTheme("pink")}
                className={themeDotClass("pink")}
              />
            </div>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100 pink:text-fuchsia-950 md:text-4xl">
            Plan your week, prioritize tasks, sync to Google Calendar.
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-600 dark:text-slate-300 pink:text-fuchsia-900/80 md:text-base">
            Let Work.ai turn chaos into a calm week. Drop in tasks, run AI, and
            get a plan that feels realistic instead of overwhelming.
          </p>
          {sampleModeActive && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-xs font-semibold text-fuchsia-700 dark:border-fuchsia-700/60 dark:bg-fuchsia-900/20 dark:text-fuchsia-200 pink:border-fuchsia-300 pink:bg-fuchsia-100 pink:text-fuchsia-800">
                Sample mode active
              </p>
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={exitSampleMode}
              >
                Exit Sample Mode
              </Button>
            </div>
          )}
          {authError && (
            <p className="mt-3 rounded-md bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700">
              Google auth error: {authError}
            </p>
          )}
        </section>

        {showInitialSetupPrompt && !showOnboarding && (
          <section className="fun-enter rounded-xl border border-sky-200 bg-sky-50/90 p-4 shadow-sm dark:border-sky-700/60 dark:bg-sky-900/25 pink:border-fuchsia-300 pink:bg-fuchsia-100/80">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300 pink:text-fuchsia-800">
              Start Here
            </p>
            <h2 className="mt-1 text-base font-black text-slate-900 dark:text-slate-100 pink:text-fuchsia-950">
              Set your Time Preferences and Conflict Calendar Filters first.
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 pink:text-fuchsia-900/80">
              This makes your schedule realistic and conflict-aware before you run Plan My Week.
            </p>
            {!connectedCalendar && (
              <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300 pink:text-amber-800">
                Connect Google Calendar to configure conflict filters.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" className="h-8 px-3 text-xs" onClick={openSetupPanels}>
                Open Setup Settings
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3 text-xs"
                onClick={markSetupPromptSeen}
              >
                Dismiss
              </Button>
            </div>
          </section>
        )}

        <section
          className={`grid gap-6 xl:grid-cols-[1.2fr_1fr] ${
            showCalendarWeekView ? "items-start" : "items-stretch"
          }`}
        >
          <Card className="fun-enter [animation-delay:80ms]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Brain Dump</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
              Capture it fast. Refine it later.
            </p>
            <form onSubmit={addTask} className="mt-4 space-y-3">
              <Input
                placeholder="Task title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                required
              />
              <Textarea
                placeholder="Task details"
                value={form.details}
                onChange={(event) =>
                  setForm((current) => ({ ...current, details: event.target.value }))
                }
              />
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Deadline (Date & Time)
                </label>
                <Input
                  type="datetime-local"
                  value={form.deadline}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, deadline: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="relative">
                {showOnboarding && onboardingStep === 0 && (
                  <div className="pointer-events-none absolute -top-12 left-1/2 z-10 w-64 -translate-x-1/2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-center text-[11px] font-semibold text-indigo-700 shadow-sm dark:border-indigo-700/60 dark:bg-indigo-900/30 dark:text-indigo-200 pink:border-fuchsia-300 pink:bg-fuchsia-100/90 pink:text-fuchsia-800">
                    Guided setup: add your own task, then click this.
                  </div>
                )}
                <Button
                  type="submit"
                  className={`w-full ${showOnboarding && onboardingStep === 0 ? "ring-2 ring-indigo-300 dark:ring-indigo-500 pink:ring-fuchsia-400" : ""}`}
                >
                  Add To Queue
                </Button>
              </div>
              <div className="space-y-2">
                <input
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleTaskPhotoUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={photoUploadLoading}
                  onClick={() => photoFileInputRef.current?.click()}
                >
                  {photoUploadLoading ? "Reading photo..." : "Upload Photo To Add Task"}
                </Button>
                {photoUploadError && (
                  <p className="rounded-md bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700">
                    {photoUploadError}
                  </p>
                )}
                {photoUploadMessage && (
                  <p className="rounded-md bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-700">
                    {photoUploadMessage}
                  </p>
                )}
              </div>
            </form>
          </Card>

          <Card className="fun-enter [animation-delay:140ms]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Calendar Bridge</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              One click to push your plan into your real calendar.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!connectedCalendar ? (
                <a href="/api/auth/google/start?callbackUrl=/planner">
                  <Button type="button" disabled={authLoading}>
                    {authLoading ? "Checking..." : "Connect Google Calendar"}
                  </Button>
                </a>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={disconnectGoogle}
                >
                  Disconnect Google Calendar
                </Button>
              )}
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noreferrer"
              >
                <Button type="button" variant="ghost">
                  Open Calendar
                </Button>
              </a>
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Connection status: {connectedCalendar ? "Connected" : "Not connected"}
              {googleSession.expiresAt
                ? ` · token expires ${new Date(googleSession.expiresAt).toLocaleString()}`
                : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
              Cloud sync: {cloudSyncLabel}
            </p>
            {connectedCalendar && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 pink:border-fuchsia-200 pink:bg-pink-50/80">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
                    Conflict Calendar Filters
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setShowConflictFilters((current) => !current)}
                    aria-expanded={showConflictFilters}
                    aria-controls="conflict-calendar-filters-panel"
                  >
                    {showConflictFilters ? "Hide" : "Show"}
                  </Button>
                </div>
                {showConflictFilters && (
                  <div id="conflict-calendar-filters-panel">
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                      Select calendars to ignore during conflict checks.
                    </p>
                    {googleCalendarsLoading && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                        Loading calendars...
                      </p>
                    )}
                    {googleCalendarsError && (
                      <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {googleCalendarsError}
                      </p>
                    )}
                    {!googleCalendarsLoading && !googleCalendarsError && googleCalendars.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {googleCalendars.map((calendar) => {
                          const ignored = ignoredCalendarIds.includes(calendar.id);
                          return (
                            <label
                              key={calendar.id}
                              className="flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded border border-slate-200 bg-white/70 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950/40 pink:border-fuchsia-200 pink:bg-white/80"
                            >
                              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200 pink:text-fuchsia-900">
                                {calendar.summary}
                                {calendar.primary ? " (Primary)" : ""}
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                                  Ignore
                                </span>
                                <input
                                  type="checkbox"
                                  checked={ignored}
                                  onChange={() => toggleIgnoredCalendar(calendar.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 pink:text-fuchsia-600 pink:focus:ring-fuchsia-500"
                                />
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 pink:border-fuchsia-200 pink:bg-pink-50/80">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
                  Live Calendar Week View
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setShowCalendarWeekView((current) => !current)}
                  aria-expanded={showCalendarWeekView}
                  aria-controls="calendar-week-view-panel"
                >
                  {showCalendarWeekView ? "Hide" : "Show"}
                </Button>
              </div>
              {calendarSnapshotLabel && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                  Updated {calendarSnapshotLabel}
                </p>
              )}
              {showCalendarWeekView && (
                <div id="calendar-week-view-panel">
                  {calendarSnapshotLoading && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                      Refreshing calendar view...
                    </p>
                  )}
                  {calendarSnapshotError && (
                    <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      {calendarSnapshotError}
                    </p>
                  )}
                  {!calendarSnapshotLoading && !calendarSnapshotError && calendarSnapshot.length === 0 && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                      No upcoming events this week.
                    </p>
                  )}
                  <div className="mt-2 overflow-x-auto">
                    <div className="grid min-w-[780px] grid-cols-7 gap-2">
                      {calendarWeekView.map((day) => (
                        <div
                          key={day.key}
                          className="relative rounded-md border border-slate-200 bg-white/80 p-2 dark:border-slate-700 dark:bg-slate-950/60 pink:border-fuchsia-200 pink:bg-pink-100/70"
                        >
                          <div className="min-h-[2rem]">
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 pink:text-fuchsia-900">
                              {day.label}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                              {day.dateLabel}
                            </p>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {day.events.length === 0 && (
                              <p className="rounded border border-dashed border-slate-200 px-2 py-1 text-[10px] text-slate-400 dark:border-slate-700 dark:text-slate-500 pink:border-fuchsia-200 pink:text-fuchsia-500">
                                No events
                              </p>
                            )}
                            {day.events.map((event) => (
                              <div
                                key={event.id}
                                className={`rounded border px-2 py-1 text-[10px] ${
                                  event.hasOverlap
                                    ? "border-rose-300 bg-rose-50/95 dark:border-rose-700/70 dark:bg-rose-900/30 pink:border-rose-300 pink:bg-rose-100/80"
                                    : syncedEventTaskMap[event.id]
                                      ? taskEventColorClass(syncedEventTaskMap[event.id])
                                      : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 pink:border-fuchsia-200 pink:bg-white/80"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <p className="font-semibold text-slate-700 dark:text-slate-200 pink:text-fuchsia-900">
                                    {event.title}
                                  </p>
                                  {event.hasOverlap && (
                                    <span className="shrink-0 rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/40 dark:text-rose-200 pink:border-rose-300 pink:bg-rose-100 pink:text-rose-700">
                                      Overlap
                                    </span>
                                  )}
                                  {!event.hasOverlap && syncedEventTaskMap[event.id] && (
                                    <span
                                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${taskLabelColorClass(
                                        syncedEventTaskMap[event.id],
                                      )}`}
                                    >
                                      Synced
                                    </span>
                                  )}
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                                  {formatEventRange(event.startISO, event.endISO, event.allDay)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </section>

        <DoodleDivider />

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="fun-enter [animation-delay:180ms]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Priority Radar</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {analysis.length} analyzed · {pendingTasks.length} pending
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Pending Tasks
              </h3>
              {pendingTasks.length === 0 && (
                <PlayfulEmptyState
                  title="Queue is clear."
                  subtitle="Drop a task into Brain Dump and it will show up here."
                />
              )}
              {pendingTasks.map((task) => (
                <div
                  key={task.id}
                  className="fun-enter rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{task.title}</p>
                    <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 pink:bg-fuchsia-200 pink:text-fuchsia-800">
                      Pending
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Due {task.deadline}
                  </p>
                  {task.details && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {task.details}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 h-8 px-2 text-xs"
                    onClick={() => removeTask(task.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="relative">
                {(sampleModeActive && analysis.length === 0 && tasks.length > 0) ||
                (showOnboarding && onboardingStep === 1) ? (
                  <div className="pointer-events-none absolute -top-12 left-1/2 z-10 w-64 -translate-x-1/2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-center text-[11px] font-semibold text-sky-700 shadow-sm dark:border-sky-700/60 dark:bg-sky-900/30 dark:text-sky-200 pink:border-fuchsia-300 pink:bg-fuchsia-100/90 pink:text-fuchsia-800">
                    Press <span className="underline">Plan My Week</span> to run AI analysis.
                  </div>
                ) : null}
                <Button
                  type="button"
                  onClick={runAIAnalysis}
                  disabled={tasks.length === 0 || aiLoading}
                  className={
                    (sampleModeActive && analysis.length === 0 && tasks.length > 0) ||
                    (showOnboarding && onboardingStep === 1)
                      ? "ring-2 ring-sky-300 dark:ring-sky-600 pink:ring-fuchsia-400"
                      : ""
                  }
                >
                  {aiLoading ? "Mapping Your Week..." : "Plan My Week"}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              AI scores urgency, predicts effort, and builds a doable schedule.
            </p>
            {aiError && (
              <p className="mt-2 rounded-md bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700">
                {aiError}
              </p>
            )}
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Analyzed Tasks
              </h3>
              {analysis.length === 0 && (
                <PlayfulEmptyState
                  title="Radar waiting for signal."
                  subtitle="Hit 'Plan My Week' to turn tasks into priority and effort scores."
                />
              )}
              {analysis.map((task) => (
                <div
                  key={task.id}
                  className="fun-enter rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{task.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {syncedBlocksByTaskId[task.id] ? (
                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-semibold ${taskLabelColorClass(task.id)}`}
                        >
                          {syncedBlocksByTaskId[task.id]} synced
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${priorityBadgeColor(task.priorityLabel)}`}
                      >
                        {task.priorityLabel}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Score {task.priorityScore}/100 · {task.estimatedHours}h est. · Due {" "}
                    {task.deadline}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                        Effort Meter
                      </p>
                      <div className="mt-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 pink:bg-fuchsia-100">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 dark:from-sky-400 dark:to-blue-500 pink:from-fuchsia-500 pink:to-rose-500"
                          style={{ width: `${effortMeterWidth(task.estimatedHours)}%` }}
                        />
                      </div>
                    </div>
                    <div className="sm:ml-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                        Urgency Heat
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <span
                            key={`${task.id}-urgency-${index}`}
                            className={`h-2.5 w-2.5 rounded-full ${urgencyDotClass(index, task.urgencyScore)}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  {task.analysisReason && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{task.analysisReason}</p>
                  )}
                  {overrideTaskId === task.id && (
                    <div className="mt-2 rounded-md border border-sky-200 bg-sky-50/80 p-2 dark:border-sky-700/60 dark:bg-sky-900/20 pink:border-fuchsia-300 pink:bg-fuchsia-100/70">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300 pink:text-fuchsia-800">
                        Manual Override
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 pink:text-fuchsia-800">
                          Hours
                          <Input
                            type="number"
                            min={0.5}
                            max={80}
                            step={0.5}
                            value={overrideHoursInput}
                            onChange={(event) => setOverrideHoursInput(event.target.value)}
                            className="mt-1 h-8"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 pink:text-fuchsia-800">
                          Urgency (0-100)
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={overrideUrgencyInput}
                            onChange={(event) => setOverrideUrgencyInput(event.target.value)}
                            className="mt-1 h-8"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 pink:text-fuchsia-800">
                          Priority (0-100)
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={overridePriorityInput}
                            onChange={(event) => setOverridePriorityInput(event.target.value)}
                            className="mt-1 h-8"
                          />
                        </label>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          className="h-8 px-2 text-xs"
                          onClick={() => saveOverrideEditor(task.id)}
                        >
                          Save Override
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={cancelOverrideEditor}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() =>
                        overrideTaskId === task.id ? cancelOverrideEditor() : openOverrideEditor(task)
                      }
                    >
                      {overrideTaskId === task.id ? "Close Override" : "Manual Override"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      onClick={() => removeTask(task.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {analysis.length > 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Total estimated effort: {totalHours.toFixed(1)}h
              </p>
            )}
          </Card>

          <Card className="fun-enter [animation-delay:240ms]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Game Plan</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
              Time blocks that fit your real week.
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 pink:border-fuchsia-200 pink:bg-pink-50/80">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
                  Time Preferences
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setShowTimePreferences((current) => !current)}
                  aria-expanded={showTimePreferences}
                  aria-controls="time-preferences-panel"
                >
                  {showTimePreferences ? "Hide" : "Edit"}
                </Button>
              </div>
              {showTimePreferences && (
                <div id="time-preferences-panel">
                  <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                    Set a custom schedule window for each day.
                  </p>
                  <div className="mt-2 space-y-2">
                    {WEEKDAY_OPTIONS.map((day) => {
                      const rule = getRuleForWeekday(schedulePreferences, day.value);
                      return (
                        <div
                          key={day.value}
                          className="grid grid-cols-[2.5rem_1fr_1fr_auto] items-center gap-2 rounded-md border border-slate-200 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/40 pink:border-fuchsia-200 pink:bg-white/80"
                        >
                          <button
                            type="button"
                            onClick={() => toggleDayEnabled(day.value)}
                            className={`h-7 rounded-full border px-2 text-[11px] font-semibold transition ${
                              rule.enabled
                                ? "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700/70 dark:bg-sky-900/30 dark:text-sky-200 pink:border-fuchsia-300 pink:bg-fuchsia-100 pink:text-fuchsia-800"
                                : "border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 pink:border-fuchsia-200 pink:bg-white pink:text-fuchsia-500"
                            }`}
                          >
                            {day.label}
                          </button>
                          <select
                            value={rule.startHour}
                            disabled={!rule.enabled}
                            onChange={(event) => updateDayStartHour(day.value, Number(event.target.value))}
                            className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 pink:border-fuchsia-200 pink:bg-white pink:text-fuchsia-950 pink:focus-visible:ring-fuchsia-400/50"
                          >
                            {Array.from({ length: 24 }, (_, hour) => (
                              <option key={`${day.value}-start-${hour}`} value={hour}>
                                Start {formatHourLabel(hour)}
                              </option>
                            ))}
                          </select>
                          <select
                            value={rule.endHour}
                            disabled={!rule.enabled}
                            onChange={(event) => updateDayEndHour(day.value, Number(event.target.value))}
                            className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 pink:border-fuchsia-200 pink:bg-white pink:text-fuchsia-950 pink:focus-visible:ring-fuchsia-400/50"
                          >
                            {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                              <option key={`${day.value}-end-${hour}`} value={hour}>
                                End {formatHourLabel(hour)}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2 text-[10px]"
                            onClick={() => applyDayWindowToAll(day.value)}
                          >
                            Apply all
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 rounded-md border border-slate-200 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/40 pink:border-fuchsia-200 pink:bg-white/80">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
                      Wellness Constraints
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 pink:text-fuchsia-800">
                        Max hours / day
                        <Input
                          type="number"
                          min={1}
                          max={16}
                          step={0.5}
                          value={(schedulePreferences.maxWorkMinutesPerDay / 60).toString()}
                          onChange={(event) =>
                            updateWellnessPreference(
                              "maxWorkMinutesPerDay",
                              Math.round(Number(event.target.value || 8) * 60),
                            )
                          }
                          className="mt-1 h-8"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 pink:text-fuchsia-800">
                        Max continuous focus (min)
                        <Input
                          type="number"
                          min={30}
                          max={480}
                          step={10}
                          value={schedulePreferences.maxContinuousFocusMinutes}
                          onChange={(event) =>
                            updateWellnessPreference(
                              "maxContinuousFocusMinutes",
                              Number(event.target.value || 120),
                            )
                          }
                          className="mt-1 h-8"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {showOnboarding && onboardingStep === 2 && (
              <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300 pink:border-fuchsia-300 pink:bg-fuchsia-100/80 pink:text-fuchsia-800">
                Click any <span className="underline">Add to Google Calendar</span> button.
              </p>
            )}
            {connectedCalendar && lastConflictCheckLabel && (
              <p className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                Conflict sync: last checked {lastConflictCheckLabel}
              </p>
            )}
            {scheduleLoading && (
              <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                Checking your Google Calendar conflicts...
              </p>
            )}
            {autoReplanNotice && (
              <p className="celebration-pop mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 dark:border-sky-700/60 dark:bg-sky-900/20 dark:text-sky-300 pink:border-fuchsia-300 pink:bg-fuchsia-100/80 pink:text-fuchsia-800">
                {autoReplanNotice}
              </p>
            )}
            {scheduleError && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300 pink:border-amber-300 pink:bg-amber-100/70 pink:text-amber-800">
                {scheduleError}
                {scheduleActionUrl && (
                  <>
                    {" "}
                    <a
                      href={scheduleActionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Enable API
                    </a>
                  </>
                )}
              </p>
            )}
            {unscheduledAnalyzedTasks.length > 0 && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300 pink:border-amber-300 pink:bg-amber-100/70 pink:text-amber-800">
                {unscheduledAnalyzedTasks.length} analyzed task
                {unscheduledAnalyzedTasks.length === 1 ? "" : "s"} could not be placed before
                deadline/time constraints:{" "}
                {unscheduledAnalyzedTasks
                  .slice(0, 4)
                  .map((task) => `"${task.title}"`)
                  .join(", ")}
                {unscheduledAnalyzedTasks.length > 4
                  ? ` +${unscheduledAnalyzedTasks.length - 4} more`
                  : ""}. Expand availability or reduce work hours.
              </p>
            )}
            {timeline.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 pink:border-fuchsia-200 pink:bg-pink-50/80">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
                  Weekly Rhythm
                </p>
                <div className="mt-2 space-y-2">
                  {timeline.map((day) => (
                    <div key={day.key} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 pink:text-fuchsia-800">
                        {day.label}
                      </span>
                      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 pink:bg-fuchsia-100">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 dark:from-sky-400 dark:to-blue-500 pink:from-fuchsia-500 pink:to-rose-500"
                          style={{ width: `${timelineWidth(day.minutes)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
                        {Math.round(day.minutes / 60)}h · {day.blocks}b
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 space-y-2">
              {schedule.length === 0 && (
                <PlayfulEmptyState
                  title="Your board is waiting."
                  subtitle="Run AI analysis and we will draft your week here."
                />
              )}
              {schedule.map((block) => (
                <div
                  key={scheduleBlockKey(block)}
                  className="fun-enter flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{block.taskTitle}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {formatDayTime(block.startISO)} - {formatDayTime(block.endISO)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={createGoogleCalendarLink(block)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        markBlockAdded(block);
                        void refreshCalendarSnapshot({ silent: false });
                        for (const timerId of calendarSnapshotRefreshAfterAddTimers.current) {
                          window.clearTimeout(timerId);
                        }
                        calendarSnapshotRefreshAfterAddTimers.current = [];

                        const retryOne = window.setTimeout(() => {
                          void refreshCalendarSnapshot({ silent: true });
                        }, 2000);
                        const retryTwo = window.setTimeout(() => {
                          void refreshCalendarSnapshot({ silent: true });
                        }, 8000);
                        calendarSnapshotRefreshAfterAddTimers.current.push(retryOne, retryTwo);
                        if (showOnboarding && onboardingStep === 2) {
                          setGuidedCalendarClicked(true);
                        }
                      }}
                    >
                      <Button
                        type="button"
                        variant={connectedCalendar ? "default" : "outline"}
                        className={`h-8 px-3 text-xs ${showOnboarding && onboardingStep === 2 ? "ring-2 ring-emerald-300 dark:ring-emerald-600 pink:ring-fuchsia-400" : ""}`}
                      >
                        Add to Google Calendar
                      </Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {showOnboarding && (
          <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 w-[min(92vw,380px)] max-h-[min(52vh,420px)] overflow-y-auto rounded-2xl border border-slate-300/70 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95 pink:border-fuchsia-200 pink:bg-pink-50/95 md:bottom-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-300 pink:text-fuchsia-700">
              Guided Setup {onboardingStep + 1}/{ONBOARDING_STEPS.length}
            </p>
            <h3 className="mt-1 text-base font-black text-slate-900 dark:text-slate-100 pink:text-fuchsia-950">
              {ONBOARDING_STEPS[onboardingStep].title}
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 pink:text-fuchsia-900/80">
              {ONBOARDING_STEPS[onboardingStep].description}
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              {ONBOARDING_STEPS.map((step, index) => (
                <span
                  key={step.title}
                  className={`h-1.5 flex-1 rounded-full ${
                    index <= onboardingStep
                      ? "bg-sky-500 dark:bg-sky-400 pink:bg-fuchsia-500"
                      : "bg-slate-200 dark:bg-slate-700 pink:bg-fuchsia-200"
                  }`}
                />
              ))}
            </div>
            {!connectedCalendar && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300 pink:border-amber-300 pink:bg-amber-100/70 pink:text-amber-800">
                Connect Google Calendar on this page so step 3 can complete.
              </p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={closeOnboarding}>
                Skip setup
              </Button>
              <Button type="button" variant="outline" className="h-8 px-2 text-xs" onClick={loadSampleMode}>
                Try sample instead
              </Button>
            </div>
          </div>
        )}
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
        <p
          aria-hidden={!showCelebration}
          className={`rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-lg transition-all duration-300 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300 pink:border-emerald-300 pink:bg-emerald-100/90 pink:text-emerald-800 ${
            showCelebration
              ? "celebration-pop translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          }`}
        >
          Nice. Priority Radar is locked in.
        </p>
      </div>
    </div>
  );
}
