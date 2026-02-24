import {
  ChartColumn,
  House,
  LogOut,
  Settings,
  Shield,
  ShieldAlert,
  UserCircle2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

type Props = {
  currentUserName: string;
  onLogout: () => void;
};

const itemClass =
  "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors duration-200 motion-reduce:transition-none";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `${itemClass} ${
    isActive
      ? "border-stone-900 bg-stone-900 text-white hover:bg-stone-800"
      : "border-stone-200 bg-white text-stone-800 hover:bg-stone-50 hover:text-stone-900"
  }`;

export function FloatingNav({ currentUserName, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (location.pathname) {
      setOpen(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/10"
          onClick={() => setOpen(false)}
          aria-label="ナビを閉じる"
        />
      )}

      <div
        className="pointer-events-none fixed left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div
          className={`origin-bottom rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-xl backdrop-blur transition-all duration-200 motion-reduce:transition-none ${
            open
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          }`}
        >
          <div className="mb-2 flex justify-start">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-700">
              <UserCircle2 size={14} aria-hidden="true" />
              {currentUserName}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <NavLink to="/" end className={linkClass}>
              <House size={18} aria-hidden="true" />
              <span>ホーム</span>
            </NavLink>
            <NavLink to="/admin/summary" className={linkClass}>
              <ChartColumn size={18} aria-hidden="true" />
              <span>サマリー</span>
            </NavLink>
            <NavLink to="/admin/tasks" className={linkClass}>
              <Shield size={18} aria-hidden="true" />
              <span>タスク</span>
            </NavLink>
            <NavLink to="/admin/penalties" className={linkClass}>
              <ShieldAlert size={18} aria-hidden="true" />
              <span>ペナルティ</span>
            </NavLink>
            <NavLink to="/admin/settings" className={linkClass}>
              <Settings size={18} aria-hidden="true" />
              <span>設定</span>
            </NavLink>
            <button
              type="button"
              className={`${itemClass} cursor-pointer border-stone-200 bg-white text-stone-800 hover:bg-rose-50 hover:text-rose-800`}
              onClick={onLogout}
              aria-label="ログアウトする"
            >
              <LogOut size={18} aria-hidden="true" />
              <span>ログアウト</span>
            </button>
          </div>
        </div>

        <div className="pointer-events-auto mt-2 flex justify-center">
          <button
            type="button"
            className="relative flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-stone-900 backdrop-blur-sm transition-transform duration-200 motion-reduce:transition-none"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={
              open ? "ナビゲーションを閉じる" : "ナビゲーションを開く"
            }
          >
            <span className="relative block h-7 w-7" aria-hidden="true">
              <span
                className={`absolute top-1/2 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-current shadow-[0_2px_6px_rgba(0,0,0,0.2)] transition-all duration-200 ease-out motion-reduce:transition-none ${
                  open
                    ? "-translate-y-0 rotate-45"
                    : "-translate-y-1.5 rotate-0"
                }`}
              />
              <span
                className={`absolute top-1/2 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-current shadow-[0_2px_6px_rgba(0,0,0,0.2)] transition-all duration-200 ease-out motion-reduce:transition-none ${
                  open
                    ? "-translate-y-0 -rotate-45"
                    : "translate-y-1.5 rotate-0"
                }`}
              />
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
