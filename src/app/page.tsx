"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkAiLogo } from "@/components/work-ai-logo";

type Theme = "light" | "dark" | "pink";

type GoogleSession = {
  connected: boolean;
};

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

export default function LandingPage() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [connected, setConnected] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

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
    let active = true;

    async function loadSession() {
      setAuthLoading(true);
      try {
        const response = await fetch("/api/auth/google/session", { cache: "no-store" });
        if (!response.ok) {
          if (active) setConnected(false);
          return;
        }

        const data = (await response.json()) as GoogleSession;
        if (active) setConnected(Boolean(data.connected));
      } catch {
        if (active) setConnected(false);
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    loadSession();
    return () => {
      active = false;
    };
  }, []);

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
      <main className="relative mx-auto flex min-h-[85vh] w-full max-w-5xl flex-col justify-center gap-8">
        <section className="rounded-2xl border border-slate-300/60 bg-white/75 p-6 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/70 pink:border-fuchsia-200 pink:bg-pink-50/80 md:p-10">
          <div className="flex items-start justify-between gap-3">
            <WorkAiLogo />
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

          <h1 className="mt-8 text-4xl font-black tracking-tight text-slate-900 dark:text-slate-100 pink:text-fuchsia-950 md:text-5xl">
            AI-first planning that turns messy tasks into a realistic week.
          </h1>
          <p className="mt-4 max-w-3xl text-base text-slate-600 dark:text-slate-300 pink:text-fuchsia-900/80 md:text-lg">
            Work.ai analyzes your task list, estimates time, ranks urgency, and builds
            a schedule around your deadlines and available hours. Connect Google Calendar
            to push planned blocks straight into your calendar.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {!connected ? (
              <a href="/api/auth/google/start?callbackUrl=/planner">
                <Button type="button" className="h-11 px-5" disabled={authLoading}>
                  {authLoading ? "Checking..." : "Connect Google Calendar"}
                </Button>
              </a>
            ) : (
              <Link href="/planner">
                <Button type="button" className="h-11 px-5">
                  Open Planner
                </Button>
              </Link>
            )}
            <Link href="/planner">
              <Button type="button" variant="outline" className="h-11 px-5">
                Explore App
              </Button>
            </Link>
            <Link href="/planner?onboarding=1">
              <Button
                type="button"
                className="h-11 px-5 shadow-md shadow-sky-500/25 ring-2 ring-sky-300/60 dark:ring-sky-500/40 pink:ring-fuchsia-400/60"
              >
                Start Guided Setup →
              </Button>
            </Link>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50 pink:border-fuchsia-200 pink:bg-pink-100/70">
              <p className="font-semibold text-slate-800 dark:text-slate-200 pink:text-fuchsia-900">
                1. Guided setup
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                Short walkthrough for first-time users.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50 pink:border-fuchsia-200 pink:bg-pink-100/70">
              <p className="font-semibold text-slate-800 dark:text-slate-200 pink:text-fuchsia-900">
                2. Sample mode
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                Auto-load realistic tasks and instantly plan a demo week.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50 pink:border-fuchsia-200 pink:bg-pink-100/70">
              <p className="font-semibold text-slate-800 dark:text-slate-200 pink:text-fuchsia-900">
                3. Connect calendar
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 pink:text-fuchsia-700/80">
                Push conflict-aware schedule blocks into Google Calendar.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
