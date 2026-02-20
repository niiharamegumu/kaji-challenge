import {
  ChartColumn,
  CirclePlus,
  House,
  LogOut,
  Shield,
  ShieldAlert,
  ShieldPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

type Props = {
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

export function FloatingNav({ onLogout }: Props) {
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
            <NavLink to="/admin/invites" className={linkClass}>
              <ShieldPlus size={18} aria-hidden="true" />
              <span>招待</span>
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
            className="flex min-h-14 min-w-14 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-900 shadow-lg transition-transform duration-200 motion-reduce:transition-none"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={
              open ? "ナビゲーションを閉じる" : "ナビゲーションを開く"
            }
          >
            <CirclePlus
              size={28}
              aria-hidden="true"
              className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-45" : "rotate-0"}`}
            />
          </button>
        </div>
      </div>
    </>
  );
}
