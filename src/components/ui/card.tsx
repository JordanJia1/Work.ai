import { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_10px_30px_-15px_rgba(15,23,42,0.3)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70 dark:shadow-[0_16px_45px_-20px_rgba(2,6,23,0.9)] pink:border-fuchsia-200/70 pink:bg-pink-50/80 pink:shadow-[0_12px_35px_-18px_rgba(190,24,93,0.45)] ${className}`}
      {...props}
    />
  );
}
