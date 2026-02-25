export function WorkAiLogo() {
  return (
    <div className="group inline-flex items-center gap-3">
      <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/50 bg-gradient-to-br from-sky-500 via-cyan-400 to-indigo-500 shadow-[0_8px_24px_-8px_rgba(2,132,199,0.7)] dark:border-slate-700 dark:from-sky-400 dark:via-blue-400 dark:to-indigo-500 pink:border-fuchsia-200 pink:from-pink-500 pink:via-fuchsia-500 pink:to-rose-500">
        <div className="absolute -right-3 -top-3 h-8 w-8 rounded-full bg-white/35 blur-sm" />
        <svg
          viewBox="0 0 48 48"
          className="absolute inset-0 h-full w-full p-2 text-white transition-transform duration-300 group-hover:scale-110"
          aria-hidden="true"
        >
          <path
            d="M7 10h7l4.5 17L24 10h7l5.5 17L41 10h0"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="39" cy="35" r="3.3" fill="currentColor" />
        </svg>
      </div>
      <div className="leading-tight">
        <p className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 pink:text-fuchsia-950">
          Work<span className="text-sky-600 dark:text-sky-300 pink:text-fuchsia-600">.ai</span>
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 pink:text-fuchsia-700">
          Plan With Intent
        </p>
      </div>
    </div>
  );
}
