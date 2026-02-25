import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default:
    "bg-sky-600 text-white hover:bg-sky-500 focus-visible:ring-sky-500/50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 pink:bg-fuchsia-600 pink:text-white pink:hover:bg-fuchsia-500",
  outline:
    "border border-slate-300 bg-white/70 text-slate-800 hover:bg-slate-100 focus-visible:ring-slate-400/50 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800 pink:border-fuchsia-300 pink:bg-pink-50/80 pink:text-fuchsia-800 pink:hover:bg-pink-100",
  ghost:
    "bg-transparent text-slate-700 hover:bg-slate-200/50 focus-visible:ring-slate-400/50 dark:text-slate-300 dark:hover:bg-slate-800/70 pink:text-fuchsia-800 pink:hover:bg-fuchsia-100/70",
};

export function Button({
  className = "",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
