import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  teamName: string;
  todayLabel: string;
  children: ReactNode;
};

export function AppHeader({ teamName, todayLabel, children }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const membersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    const members = membersRef.current;
    if (!slot || !members) return;

    let frameId: number | null = null;
    let compact = window.scrollY > 16;
    const update = () => {
      frameId = null;
      // 上端付近の小さな往復では切り替えず、上端まで戻ったときだけ復元する。
      if (window.scrollY > 16) compact = true;
      else if (window.scrollY <= 0) compact = false;
      const next = String(compact);
      if (slot.dataset.compact !== next) slot.dataset.compact = next;
    };
    const onScroll = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(update);
    };

    const updateMembersWidth = () => {
      slot.style.setProperty("--app-header-members-width", `${members.offsetWidth}px`);
    };
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(updateMembersWidth) : null;

    updateMembersWidth();
    observer?.observe(members);
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={slotRef} className="app-header-slot sticky z-30 mb-3 shrink-0">
      <header className="app-header-content relative flex items-start justify-between gap-3 p-[11px] md:items-center md:p-[17px]">
        <div
          aria-hidden="true"
          className="app-glass-surface app-header-surface absolute top-0 right-0 h-full w-full rounded-3xl border border-white/40"
        />
        <div className="app-header-info flex min-h-10 min-w-0 flex-1 flex-col justify-center md:flex-row md:items-center md:justify-between md:gap-3">
          <h1
            title={teamName}
            className="app-header-title min-w-0 truncate text-xl font-semibold tracking-normal md:text-2xl md:font-bold md:tracking-wide"
          >
            {teamName}
          </h1>
          <span className="shrink-0 whitespace-nowrap text-xs text-stone-700 md:text-sm">
            {todayLabel}
          </span>
        </div>
        <div ref={membersRef} className="app-header-members relative shrink-0">
          {children}
        </div>
      </header>
    </div>
  );
}
