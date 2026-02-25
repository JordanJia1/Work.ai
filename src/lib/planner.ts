export type TaskInput = {
  id: string;
  title: string;
  details: string;
  deadline: string;
};

export type TaskAnalysis = TaskInput & {
  estimatedHours: number;
  urgencyScore: number;
  priorityScore: number;
  priorityLabel: "Critical" | "High" | "Medium" | "Low";
  analysisReason?: string;
  isSplittable?: boolean;
  notBeforeISO?: string | null;
};

export type ScheduledBlock = {
  taskId: string;
  taskTitle: string;
  startISO: string;
  endISO: string;
  minutes: number;
  calendarDescription: string;
};

export type BusyInterval = {
  startISO: string;
  endISO: string;
};

const SCHEDULE_SLOT_MINUTES = 30;

export type DaySchedulePreference = {
  weekday: number; // 0=Sun ... 6=Sat
  enabled: boolean;
  startHour: number;
  endHour: number;
};

export type SchedulePreferences = {
  dayRules: DaySchedulePreference[];
  maxWorkMinutesPerDay: number;
  breakEveryFocusMinutes: number;
  shortBreakMinutes: number;
  maxContinuousFocusMinutes: number;
};

export const DEFAULT_SCHEDULE_PREFERENCES: SchedulePreferences = {
  dayRules: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: true,
    startHour: 8,
    endHour: 23,
  })),
  maxWorkMinutesPerDay: 8 * 60,
  breakEveryFocusMinutes: 90,
  shortBreakMinutes: 10,
  maxContinuousFocusMinutes: 120,
};

export function normalizeSchedulePreferences(
  value: unknown,
): SchedulePreferences {
  const fallback = DEFAULT_SCHEDULE_PREFERENCES;
  if (!value || typeof value !== "object") return fallback;

  const raw = value as {
    dayRules?: unknown;
    startHour?: unknown;
    endHour?: unknown;
    activeWeekdays?: unknown;
    maxWorkMinutesPerDay?: unknown;
    breakEveryFocusMinutes?: unknown;
    shortBreakMinutes?: unknown;
    maxContinuousFocusMinutes?: unknown;
  };

  let parsedRules: DaySchedulePreference[] = [];
  if (Array.isArray(raw.dayRules)) {
    parsedRules = raw.dayRules
      .filter((item): item is Partial<DaySchedulePreference> => !!item && typeof item === "object")
      .map((item) => {
        const weekday =
          typeof item.weekday === "number" && Number.isInteger(item.weekday)
            ? item.weekday
            : -1;
        const enabled = typeof item.enabled === "boolean" ? item.enabled : true;
        const startHourRaw =
          typeof item.startHour === "number" ? Math.floor(item.startHour) : 8;
        const endHourRaw =
          typeof item.endHour === "number" ? Math.floor(item.endHour) : 23;
        const startHour = Math.max(0, Math.min(23, startHourRaw));
        const endHour = Math.max(1, Math.min(24, endHourRaw));
        return {
          weekday,
          enabled,
          startHour,
          endHour,
        };
      })
      .filter((rule) => rule.weekday >= 0 && rule.weekday <= 6)
      .map((rule) => {
        if (rule.startHour >= rule.endHour) {
          return { ...rule, startHour: 8, endHour: 23 };
        }
        return rule;
      });
  } else {
    // Backward compatibility with previously stored global preferences.
    const startHourRaw =
      typeof raw.startHour === "number" ? Math.floor(raw.startHour) : 8;
    const endHourRaw =
      typeof raw.endHour === "number" ? Math.floor(raw.endHour) : 23;
    const startHour = Math.max(0, Math.min(23, startHourRaw));
    const endHour = Math.max(1, Math.min(24, endHourRaw));

    const legacyActive = Array.isArray(raw.activeWeekdays)
      ? raw.activeWeekdays.filter(
          (day): day is number => Number.isInteger(day) && day >= 0 && day <= 6,
        )
      : [0, 1, 2, 3, 4, 5, 6];
    const activeSet = new Set(legacyActive);
    parsedRules = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      enabled: activeSet.has(weekday),
      startHour: startHour < endHour ? startHour : 8,
      endHour: startHour < endHour ? endHour : 23,
    }));
  }

  const byWeekday = new Map<number, DaySchedulePreference>();
  for (const defaultRule of fallback.dayRules) {
    byWeekday.set(defaultRule.weekday, { ...defaultRule });
  }
  for (const rule of parsedRules) {
    byWeekday.set(rule.weekday, rule);
  }

  const dayRules = [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday);
  const hasAnyEnabled = dayRules.some((rule) => rule.enabled);

  const maxWorkMinutesPerDayRaw =
    typeof raw.maxWorkMinutesPerDay === "number"
      ? Math.round(raw.maxWorkMinutesPerDay)
      : fallback.maxWorkMinutesPerDay;
  const maxWorkMinutesPerDay = Math.max(60, Math.min(16 * 60, maxWorkMinutesPerDayRaw));

  const breakEveryFocusMinutesRaw =
    typeof raw.breakEveryFocusMinutes === "number"
      ? Math.round(raw.breakEveryFocusMinutes)
      : fallback.breakEveryFocusMinutes;
  const breakEveryFocusMinutes = Math.max(30, Math.min(6 * 60, breakEveryFocusMinutesRaw));

  const shortBreakMinutesRaw =
    typeof raw.shortBreakMinutes === "number"
      ? Math.round(raw.shortBreakMinutes)
      : fallback.shortBreakMinutes;
  const shortBreakMinutes = Math.max(5, Math.min(60, shortBreakMinutesRaw));

  const maxContinuousFocusMinutesRaw =
    typeof raw.maxContinuousFocusMinutes === "number"
      ? Math.round(raw.maxContinuousFocusMinutes)
      : fallback.maxContinuousFocusMinutes;
  const maxContinuousFocusMinutes = Math.max(
    SCHEDULE_SLOT_MINUTES,
    Math.min(8 * 60, maxContinuousFocusMinutesRaw),
  );

  return {
    dayRules: hasAnyEnabled ? dayRules : fallback.dayRules,
    maxWorkMinutesPerDay,
    breakEveryFocusMinutes,
    shortBreakMinutes,
    maxContinuousFocusMinutes,
  };
}

function mergeSequentialBlocks(blocks: ScheduledBlock[]): ScheduledBlock[] {
  if (blocks.length <= 1) return blocks;

  const merged: ScheduledBlock[] = [];

  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.taskId === block.taskId &&
      last.endISO === block.startISO &&
      last.calendarDescription === block.calendarDescription
    ) {
      last.endISO = block.endISO;
      last.minutes += block.minutes;
      continue;
    }

    merged.push({ ...block });
  }

  return merged;
}

function parseDeadline(deadline: string): Date {
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function isOverlappingBusyWindow(
  start: Date,
  end: Date,
  busyIntervals: BusyInterval[],
): boolean {
  return busyIntervals.some((interval) => {
    const busyStart = new Date(interval.startISO);
    const busyEnd = new Date(interval.endISO);
    if (Number.isNaN(busyStart.getTime()) || Number.isNaN(busyEnd.getTime())) return false;
    return start < busyEnd && end > busyStart;
  });
}

function blockOverlapsBusy(block: ScheduledBlock, busyIntervals: BusyInterval[]): boolean {
  const start = new Date(block.startISO);
  const end = new Date(block.endISO);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
  return isOverlappingBusyWindow(start, end, busyIntervals);
}

function formatLocalDateToISO(date: Date): string {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  const localTime = new Date(date.getTime() - timezoneOffset);
  return localTime.toISOString().slice(0, 19);
}

function nextCalendarDays(start: Date, count: number): Date[] {
  const result: Date[] = [];
  const current = new Date(start);

  while (result.length < count) {
    result.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function moveToNextEligibleDayStart(
  date: Date,
  preferences: SchedulePreferences,
): Date {
  const next = new Date(date);

  let safety = 0;
  while (safety < 14) {
    const dayRule =
      preferences.dayRules.find((rule) => rule.weekday === next.getDay()) ??
      DEFAULT_SCHEDULE_PREFERENCES.dayRules[next.getDay()];
    if (dayRule.enabled) {
      next.setHours(dayRule.startHour, 0, 0, 0);
      return next;
    }
    next.setDate(next.getDate() + 1);
    safety += 1;
  }

  next.setHours(8, 0, 0, 0);
  return next;
}

function getSchedulingStart(now: Date, preferences: SchedulePreferences): Date {
  const start = new Date(now);
  const todayRule =
    preferences.dayRules.find((rule) => rule.weekday === start.getDay()) ??
    DEFAULT_SCHEDULE_PREFERENCES.dayRules[start.getDay()];

  if (!todayRule.enabled) {
    return moveToNextEligibleDayStart(start, preferences);
  }

  const dayStart = new Date(start);
  dayStart.setHours(todayRule.startHour, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(todayRule.endHour, 0, 0, 0);

  if (start < dayStart) {
    return dayStart;
  }

  if (start >= dayEnd) {
    const nextDay = new Date(start);
    nextDay.setDate(nextDay.getDate() + 1);
    return moveToNextEligibleDayStart(nextDay, preferences);
  }

  const rounded = new Date(start);
  const hasPartialMinute = rounded.getSeconds() > 0 || rounded.getMilliseconds() > 0;
  let minuteRemainder = rounded.getMinutes() % SCHEDULE_SLOT_MINUTES;
  if (hasPartialMinute) minuteRemainder = SCHEDULE_SLOT_MINUTES;

  if (minuteRemainder !== 0) {
    rounded.setMinutes(
      rounded.getMinutes() + (SCHEDULE_SLOT_MINUTES - (rounded.getMinutes() % SCHEDULE_SLOT_MINUTES)),
      0,
      0,
    );
  } else {
    rounded.setSeconds(0, 0);
  }

  if (rounded >= dayEnd) {
    const nextDay = new Date(start);
    nextDay.setDate(nextDay.getDate() + 1);
    return moveToNextEligibleDayStart(nextDay, preferences);
  }

  if (rounded < dayStart) return dayStart;
  return rounded;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function addMinutes(date: Date, minutes: number): Date {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

export function generateWeeklySchedule(
  analysis: TaskAnalysis[],
  busyIntervals: BusyInterval[] = [],
  preferencesInput: unknown = DEFAULT_SCHEDULE_PREFERENCES,
): ScheduledBlock[] {
  const preferences = normalizeSchedulePreferences(preferencesInput);
  const schedulingStart = getSchedulingStart(new Date(), preferences);
  const latestDeadlineMs = analysis.reduce((latest, task) => {
    const ms = parseDeadline(task.deadline).getTime();
    return Number.isFinite(ms) ? Math.max(latest, ms) : latest;
  }, schedulingStart.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntilLatestDeadline = Math.max(
    7,
    Math.ceil((latestDeadlineMs - schedulingStart.getTime()) / dayMs) + 1,
  );
  const planningDays = Math.max(7, Math.min(60, daysUntilLatestDeadline));
  const workDays = nextCalendarDays(schedulingStart, planningDays).filter((day) => {
    const dayRule = preferences.dayRules.find((rule) => rule.weekday === day.getDay());
    return !!dayRule?.enabled;
  });
  const slotMinutes = SCHEDULE_SLOT_MINUTES;
  const blocks: ScheduledBlock[] = [];
  const plannedBusyIntervals: BusyInterval[] = [];

  const queue = analysis
    .map((task) => {
      const rawMinutes = task.estimatedHours * 60;
      if (rawMinutes <= 0) return null;
      const roundedMinutes = Math.max(
        slotMinutes,
        Math.ceil(rawMinutes / slotMinutes) * slotMinutes,
      );
    const deadlineMs = parseDeadline(task.deadline).getTime();
    const parsedNotBefore = task.notBeforeISO ? new Date(task.notBeforeISO) : null;
    const notBeforeMs =
      parsedNotBefore && Number.isFinite(parsedNotBefore.getTime())
        ? parsedNotBefore.getTime()
        : null;

    return {
      ...task,
      isSplittable: task.isSplittable !== false,
      deadlineMs,
      notBeforeMs,
      totalRoundedMinutes: roundedMinutes,
      remainingMinutes: roundedMinutes,
    };
    })
    .filter((task): task is NonNullable<typeof task> => task !== null);

  function canFitContiguousBlock(
    start: Date,
    dayEnd: Date,
    totalMinutes: number,
    deadlineMs: number,
    notBeforeMs: number | null,
  ): boolean {
    if (notBeforeMs !== null && start.getTime() < notBeforeMs) return false;
    const blockEnd = addMinutes(start, totalMinutes);
    if (blockEnd > dayEnd) return false;
    if (deadlineMs < blockEnd.getTime()) return false;

    for (let cursor = new Date(start); cursor < blockEnd; cursor = addMinutes(cursor, slotMinutes)) {
      const slotEnd = addMinutes(cursor, slotMinutes);
      if (isOverlappingBusyWindow(cursor, slotEnd, busyIntervals)) {
        return false;
      }
      if (isOverlappingBusyWindow(cursor, slotEnd, plannedBusyIntervals)) {
        return false;
      }
    }

    return true;
  }

  function pushBlock(
    task: (typeof queue)[number],
    start: Date,
    minutes: number,
  ): void {
    const end = addMinutes(start, minutes);
    blocks.push({
      taskId: task.id,
      taskTitle: task.title,
      startISO: formatLocalDateToISO(start),
      endISO: formatLocalDateToISO(end),
      minutes,
      calendarDescription: `${task.details}\nPriority: ${task.priorityLabel} (${task.priorityScore}/100)\nEstimated effort: ${task.estimatedHours}h\nDeadline: ${task.deadline}\nWork.ai Task ID: ${task.id}`,
    });
    plannedBusyIntervals.push({
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    });
  }

  for (const day of workDays) {
    const dayRule =
      preferences.dayRules.find((rule) => rule.weekday === day.getDay()) ??
      DEFAULT_SCHEDULE_PREFERENCES.dayRules[day.getDay()];
    if (!dayRule.enabled) continue;

    const dayStart = new Date(day);
    dayStart.setHours(dayRule.startHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(dayRule.endHour, 0, 0, 0);
    const firstSlotStart = isSameLocalDate(day, schedulingStart)
      ? maxDate(schedulingStart, dayStart)
      : dayStart;
    let workedMinutesToday = 0;
    let focusMinutesSinceBreak = 0;

    for (
      let start = new Date(firstSlotStart);
      start < dayEnd;
      start = addMinutes(start, slotMinutes)
    ) {
      const end = addMinutes(start, slotMinutes);
      if (end > dayEnd) break;
      if (workedMinutesToday >= preferences.maxWorkMinutesPerDay) break;

      if (isOverlappingBusyWindow(start, end, busyIntervals)) {
        continue;
      }
      if (isOverlappingBusyWindow(start, end, plannedBusyIntervals)) {
        focusMinutesSinceBreak = 0;
        continue;
      }
      const breakTriggerMinutes = Math.min(
        preferences.breakEveryFocusMinutes,
        preferences.maxContinuousFocusMinutes,
      );
      if (focusMinutesSinceBreak >= breakTriggerMinutes) {
        const breakEnd = addMinutes(start, Math.min(slotMinutes, preferences.shortBreakMinutes));
        plannedBusyIntervals.push({
          startISO: start.toISOString(),
          endISO: breakEnd.toISOString(),
        });
        focusMinutesSinceBreak = 0;
        continue;
      }

      const candidates = queue
        .filter((task) => task.remainingMinutes > 0)
        .filter((task) => task.deadlineMs >= end.getTime())
        .filter((task) => task.notBeforeMs === null || start.getTime() >= task.notBeforeMs)
        .filter(
          (task) =>
            workedMinutesToday +
              (task.isSplittable ? slotMinutes : task.totalRoundedMinutes) <=
            preferences.maxWorkMinutesPerDay,
        )
        .sort((a, b) => {
          const aHoursToDeadline = (a.deadlineMs - start.getTime()) / (60 * 60 * 1000);
          const bHoursToDeadline = (b.deadlineMs - start.getTime()) / (60 * 60 * 1000);
          const dueSoonThresholdHours = 72;
          const dueSoonGapHours = 24;
          const aDueSoon = aHoursToDeadline <= dueSoonThresholdHours;
          const bDueSoon = bHoursToDeadline <= dueSoonThresholdHours;
          if (aDueSoon !== bDueSoon) return aDueSoon ? -1 : 1;
          if (
            Math.abs(aHoursToDeadline - bHoursToDeadline) >= dueSoonGapHours &&
            (aDueSoon || bDueSoon)
          ) {
            return aHoursToDeadline - bHoursToDeadline;
          }
          const aCriticalSoon = a.priorityScore >= 85 && aHoursToDeadline <= 48 ? 1 : 0;
          const bCriticalSoon = b.priorityScore >= 85 && bHoursToDeadline <= 48 ? 1 : 0;
          if (aCriticalSoon !== bCriticalSoon) return bCriticalSoon - aCriticalSoon;
          if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
          if (a.urgencyScore !== b.urgencyScore) return b.urgencyScore - a.urgencyScore;
          const aSlack =
            a.deadlineMs - start.getTime() - Math.max(a.remainingMinutes, slotMinutes) * 60_000;
          const bSlack =
            b.deadlineMs - start.getTime() - Math.max(b.remainingMinutes, slotMinutes) * 60_000;
          if (aSlack !== bSlack) return aSlack - bSlack;
          const deadlineDiff = a.deadlineMs - b.deadlineMs;
          if (deadlineDiff !== 0) return deadlineDiff;
          return 0;
        });

      const chosen = candidates.find((task) => {
        if (task.isSplittable) return true;
        if (task.remainingMinutes < task.totalRoundedMinutes) return false;
        return canFitContiguousBlock(
          start,
          dayEnd,
          task.totalRoundedMinutes,
          task.deadlineMs,
          task.notBeforeMs,
        );
      });

      if (!chosen) continue;

      if (!chosen.isSplittable) {
        pushBlock(chosen, start, chosen.totalRoundedMinutes);
        chosen.remainingMinutes = 0;
        workedMinutesToday += chosen.totalRoundedMinutes;
        focusMinutesSinceBreak += chosen.totalRoundedMinutes;
        continue;
      }

      pushBlock(chosen, start, slotMinutes);
      chosen.remainingMinutes -= slotMinutes;
      workedMinutesToday += slotMinutes;
      focusMinutesSinceBreak += slotMinutes;
    }
  }

  const mergedBlocks = mergeSequentialBlocks(blocks);
  return mergedBlocks.filter((block) => !blockOverlapsBusy(block, busyIntervals));
}

export function toGoogleCalendarDate(isoLikeLocal: string): string {
  const date = new Date(isoLikeLocal);
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function createGoogleCalendarLink(block: ScheduledBlock): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: block.taskTitle,
    details: block.calendarDescription,
    dates: `${toGoogleCalendarDate(block.startISO)}/${toGoogleCalendarDate(block.endISO)}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
