import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ChartColumn,
  Ellipsis,
  House,
  LogOut,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  ShoppingCart,
  UserCircle2,
} from "lucide-react";
import type {
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  getReadableTextColor,
  resolveUserColor,
} from "../../../shared/utils/userColor";

type Props = {
  currentUserName: string;
  currentUserColorHex?: string | null;
  isRefreshing: boolean;
  onRouteIntent: (path: string) => void;
  onRefresh: () => void;
  onLogout: () => void;
};

type PrimaryNavItem = {
  id: "home" | "shopping" | "calendar" | "summary";
  label: string;
  icon: LucideIcon;
  path?: string;
  intentPath?: string;
};

type SecondaryNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  intentPath?: string;
  tone?: "default" | "danger";
  action?: () => void;
};

type PointerDragState = {
  dragging: boolean;
  lastIndex: number;
  originIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
};

const primaryItems: PrimaryNavItem[] = [
  {
    id: "home",
    label: "ホーム",
    icon: House,
    path: "/",
    intentPath: "/",
  },
  {
    id: "shopping",
    label: "買い物",
    icon: ShoppingCart,
    path: "/shopping-list",
    intentPath: "/shopping-list",
  },
  {
    id: "calendar",
    label: "カレンダー",
    icon: CalendarDays,
    path: "/calendar",
    intentPath: "/calendar",
  },
  {
    id: "summary",
    label: "サマリー",
    icon: ChartColumn,
    path: "/admin/summary",
    intentPath: "/admin/summary",
  },
];

const dragThresholdPx = 10;

function getPrimaryIndex(pathname: string) {
  if (pathname === "/") {
    return 0;
  }
  if (pathname.startsWith("/shopping-list")) {
    return 1;
  }
  if (pathname.startsWith("/calendar")) {
    return 2;
  }
  if (pathname.startsWith("/admin/summary")) {
    return 3;
  }
  return null;
}

export function FloatingNav({
  currentUserName,
  currentUserColorHex,
  isRefreshing,
  onRouteIntent,
  onRefresh,
  onLogout,
}: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dragStateRef = useRef<PointerDragState | null>(null);
  const suppressClickRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [settledIndex, setSettledIndex] = useState<number | null>(null);
  const [indicator, setIndicator] = useState({ width: 0, x: 0 });
  const activeIndex = getPrimaryIndex(pathname);
  const indicatorIndex =
    dragIndex ?? hoverIndex ?? focusIndex ?? settledIndex ?? activeIndex;
  const hasInteractiveHoverOrFocus = hoverIndex != null || focusIndex != null;
  const isInteractiveGlass =
    dragIndex != null || (!menuOpen && hasInteractiveHoverOrFocus);
  const isMoreSelected = menuOpen || activeIndex == null;
  const indicatorX = isInteractiveGlass ? indicator.x - 3 : indicator.x;
  const indicatorWidth = isInteractiveGlass
    ? indicator.width + 6
    : indicator.width;
  const userBgColor = resolveUserColor(currentUserColorHex);
  const userTextColor = getReadableTextColor(userBgColor);

  const secondaryItems: SecondaryNavItem[] = [
    {
      id: "tasks",
      label: "タスク",
      icon: Shield,
      path: "/admin/tasks",
      intentPath: "/admin/tasks",
    },
    {
      id: "penalties",
      label: "ペナルティ",
      icon: ShieldAlert,
      path: "/admin/penalties",
      intentPath: "/admin/penalties",
    },
    {
      id: "settings",
      label: "設定",
      icon: Settings,
      path: "/admin/settings",
      intentPath: "/admin/settings",
    },
    {
      id: "logout",
      label: "ログアウト",
      icon: LogOut,
      tone: "danger",
      action: onLogout,
    },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setDragIndex(null);
        setHoverIndex(null);
        setFocusIndex(null);
        setSettledIndex(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (settledIndex == null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSettledIndex(null);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [settledIndex]);

  useEffect(() => {
    const updateIndicator = () => {
      if (indicatorIndex == null) {
        setIndicator({ width: 0, x: 0 });
        return;
      }

      const navRect = navRef.current?.getBoundingClientRect();
      const itemRect =
        itemRefs.current[indicatorIndex]?.getBoundingClientRect();

      if (navRect == null || itemRect == null) {
        return;
      }

      setIndicator({
        width: Math.max(itemRect.width - 2, 0),
        x: itemRect.left - navRect.left + 1,
      });
    };

    updateIndicator();

    window.addEventListener("resize", updateIndicator);
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            updateIndicator();
          })
        : null;

    if (observer != null && navRef.current != null) {
      observer.observe(navRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateIndicator);
      observer?.disconnect();
    };
  }, [indicatorIndex]);

  const finishInteraction = () => {
    const pointerId = dragStateRef.current?.pointerId;
    if (pointerId != null && navRef.current?.hasPointerCapture?.(pointerId)) {
      navRef.current.releasePointerCapture(pointerId);
    }

    dragStateRef.current = null;
    setDragIndex(null);
    setHoverIndex(null);
  };

  const handlePrimaryHover = (index: number) => {
    setHoverIndex(index);
    const item = primaryItems[index];
    if (item?.intentPath != null) {
      onRouteIntent(item.intentPath);
    }
  };

  const handlePrimaryPointerEnter = (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType !== "mouse") {
      return;
    }

    handlePrimaryHover(index);
  };

  const handlePrimaryPointerLeave = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType !== "mouse") {
      return;
    }

    setHoverIndex(null);
  };

  const handlePrimaryFocus = (
    index: number,
    event: ReactFocusEvent<HTMLButtonElement>,
  ) => {
    if (!event.currentTarget.matches(":focus-visible")) {
      return;
    }

    setFocusIndex(index);
    const item = primaryItems[index];
    if (item?.intentPath != null) {
      onRouteIntent(item.intentPath);
    }
  };

  const handlePrimaryBlur = (event: ReactFocusEvent<HTMLButtonElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      navRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }

    setFocusIndex(null);
  };

  const commitPrimarySelection = (index: number) => {
    const item = primaryItems[index];
    if (item == null) {
      return;
    }

    setSettledIndex(index);
    setMenuOpen(false);
    if (item.path != null && pathname !== item.path) {
      navigate(item.path);
    }
  };

  const updateClosestIndex = (clientX: number) => {
    const navRect = navRef.current?.getBoundingClientRect();
    if (navRect == null) {
      return;
    }

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const [index] of primaryItems.entries()) {
      const rect = itemRefs.current[index]?.getBoundingClientRect();
      const centerX =
        rect != null
          ? rect.left + rect.width / 2
          : navRect.left +
            (navRect.width / primaryItems.length) * (index + 0.5);
      const distance = Math.abs(centerX - clientX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    const dragState = dragStateRef.current;
    if (dragState == null || dragState.lastIndex === closestIndex) {
      return;
    }

    dragState.lastIndex = closestIndex;
    setDragIndex(closestIndex);
    const intentPath = primaryItems[closestIndex]?.intentPath;
    if (intentPath != null) {
      onRouteIntent(intentPath);
    }
  };

  const handlePrimaryPointerDown = (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const item = primaryItems[index];
    if (item?.intentPath != null) {
      onRouteIntent(item.intentPath);
    }

    // Keep desktop mouse interactions on the normal click path.
    // Drag-follow is reserved for touch/pen so Safari/mobile behavior stays intact.
    if (event.pointerType === "mouse") {
      return;
    }

    dragStateRef.current = {
      dragging: false,
      lastIndex: index,
      originIndex: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    navRef.current?.setPointerCapture?.(event.pointerId);
  };

  const handleNavPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState == null || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (
      dragState.dragging === false &&
      Math.abs(deltaX) < dragThresholdPx &&
      Math.abs(deltaY) < dragThresholdPx
    ) {
      return;
    }

    if (dragState.dragging === false) {
      dragState.dragging = true;
      setDragIndex(dragState.lastIndex);
    }

    updateClosestIndex(event.clientX);
  };

  const handleNavPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState == null || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.dragging) {
      suppressClickRef.current = dragState.lastIndex;
      commitPrimarySelection(dragState.lastIndex);
    }

    finishInteraction();
  };

  const handlePrimaryClick = (index: number) => {
    if (suppressClickRef.current === index) {
      suppressClickRef.current = null;
      return;
    }

    suppressClickRef.current = null;

    finishInteraction();
    const item = primaryItems[index];
    if (item == null) {
      return;
    }

    setSettledIndex(index);
    setMenuOpen(false);
    if (item.path != null && pathname !== item.path) {
      navigate(item.path);
    }
  };

  const handleMoreClick = () => {
    finishInteraction();
    setHoverIndex(null);
    setFocusIndex(null);
    setSettledIndex(null);
    setMenuOpen((prev) => !prev);
  };

  const handleSecondaryClick = (item: SecondaryNavItem) => {
    setMenuOpen(false);
    setSettledIndex(null);

    if (item.intentPath != null) {
      onRouteIntent(item.intentPath);
    }

    if (item.action != null) {
      item.action();
      return;
    }

    if (item.path != null && pathname !== item.path) {
      navigate(item.path);
    }
  };

  return (
    <>
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-stone-500/18 backdrop-blur-[4px]"
          aria-label="その他メニューを閉じる"
          onClick={() => {
            setMenuOpen(false);
            setSettledIndex(null);
            setHoverIndex(null);
            setFocusIndex(null);
          }}
        />
      ) : null}

      <div
        className="fixed bottom-5 left-1/2 z-50 w-[min(96vw,34rem)] -translate-x-1/2"
        data-testid="floating-nav"
      >
        <div
          className={`pointer-events-auto absolute inset-x-0 bottom-[calc(100%+10px)] origin-bottom overflow-hidden rounded-[1.8rem] border border-white/40 p-3 shadow-[0_24px_48px_-30px_rgba(68,56,36,0.42),inset_0_1px_0_rgba(255,255,255,0.62)] transition-all duration-200 ease-out motion-reduce:transition-none ${
            menuOpen
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-4 scale-[0.98] opacity-0"
          }`}
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.5), rgba(246,241,232,0.34))",
            backdropFilter: "blur(26px) saturate(180%)",
            WebkitBackdropFilter: "blur(26px) saturate(180%)",
          }}
        >
          <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/85" />
          <div className="pointer-events-none absolute inset-x-8 top-2 h-8 rounded-full bg-white/20 blur-xl" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <span
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28),inset_0_1px_0_rgba(255,255,255,0.34),0_10px_18px_-16px_rgba(34,29,21,0.28)]"
              style={{ backgroundColor: userBgColor, color: userTextColor }}
            >
              <UserCircle2 size={14} aria-hidden="true" />
              {currentUserName}
            </span>
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-full bg-white/40 px-3 text-xs text-stone-700 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,0.82),0_10px_18px_-16px_rgba(34,29,21,0.22)] transition-colors hover:bg-white/55"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="最新状態に更新"
            >
              <RefreshCw
                size={15}
                className={isRefreshing ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>更新</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              const isDanger = item.tone === "danger";

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex min-h-12 items-center gap-3 rounded-[1.55rem] border px-3 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_14px_20px_-20px_rgba(58,48,31,0.32)] transition-colors duration-200 motion-reduce:transition-none ${
                    isDanger
                      ? "border-rose-200/55 bg-[linear-gradient(180deg,rgba(255,248,249,0.52),rgba(255,242,244,0.34))] text-rose-800"
                      : "border-white/28 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.24))] text-stone-800"
                  }`}
                  onClick={() => handleSecondaryClick(item)}
                  onMouseEnter={() => {
                    if (item.intentPath != null) {
                      onRouteIntent(item.intentPath);
                    }
                  }}
                  onFocus={() => {
                    if (item.intentPath != null) {
                      onRouteIntent(item.intentPath);
                    }
                  }}
                  onTouchStart={() => {
                    if (item.intentPath != null) {
                      onRouteIntent(item.intentPath);
                    }
                  }}
                  aria-label={item.label}
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-transparent">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-end gap-2.5">
          <div
            ref={navRef}
            data-testid="floating-nav-primary"
            className="relative min-w-0 flex-1 grid grid-cols-4 gap-0.5 overflow-hidden rounded-[2rem] border border-white/34 p-1 shadow-[0_18px_40px_-26px_rgba(68,56,36,0.44),0_8px_22px_-18px_rgba(34,29,21,0.22),inset_0_1px_0_rgba(255,255,255,0.62),inset_0_0_0_1px_rgba(158,150,138,0.12)]"
            style={{
              background:
                "linear-gradient(180deg, rgba(244,242,238,0.52), rgba(225,221,214,0.22))",
              backdropFilter:
                "blur(30px) saturate(220%) brightness(0.94) contrast(1.08)",
              WebkitBackdropFilter:
                "blur(30px) saturate(220%) brightness(0.94) contrast(1.08)",
              touchAction: "pan-y",
            }}
            onPointerMove={handleNavPointerMove}
            onPointerUp={handleNavPointerEnd}
            onPointerCancel={finishInteraction}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-90"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,0.34), rgba(255,255,255,0) 48%), radial-gradient(120% 100% at 50% 120%, rgba(176,184,204,0.14), rgba(255,255,255,0) 52%), linear-gradient(90deg, rgba(214,224,255,0.08), rgba(255,255,255,0) 14%, rgba(255,255,255,0) 86%, rgba(255,215,190,0.08))",
              }}
            />
            <div className="pointer-events-none absolute inset-y-2 left-0 w-px bg-stone-500/10 blur-[1px]" />
            <div className="pointer-events-none absolute inset-y-2 right-0 w-px bg-stone-500/8 blur-[1px]" />
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-white/82" />
            <div className="pointer-events-none absolute inset-x-7 top-1 h-7 rounded-full bg-white/28 blur-xl" />
            <div
              className={`pointer-events-none absolute overflow-hidden rounded-[1.6rem] transition-all duration-200 ease-out motion-reduce:transition-none ${
                indicatorIndex == null ? "opacity-0" : "opacity-100"
              } ${
                isInteractiveGlass
                  ? "top-0 bottom-0 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.54),inset_0_-16px_22px_rgba(255,255,255,0.06),0_24px_34px_-24px_rgba(255,255,255,0.78),0_18px_34px_-24px_rgba(100,85,62,0.22)]"
                  : "top-1 bottom-1 border border-white/34 shadow-[inset_0_1px_0_rgba(255,255,255,0.52),inset_0_-8px_14px_rgba(255,255,255,0.08),0_10px_18px_-18px_rgba(85,80,74,0.2)]"
              }`}
              style={{
                background: isInteractiveGlass
                  ? "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02))"
                  : "linear-gradient(180deg, rgba(228,228,232,0.72), rgba(208,208,214,0.5))",
                backdropFilter: isInteractiveGlass
                  ? "blur(30px) saturate(340%) brightness(1.16) contrast(1.04)"
                  : "blur(14px) saturate(160%) brightness(1.02)",
                WebkitBackdropFilter: isInteractiveGlass
                  ? "blur(30px) saturate(340%) brightness(1.16) contrast(1.04)"
                  : "blur(14px) saturate(160%) brightness(1.02)",
                transform: `translateX(${indicatorX}px)`,
                width: `${indicatorWidth}px`,
              }}
            >
              <div
                className={`absolute inset-0 ${isInteractiveGlass ? "opacity-100" : "opacity-90"}`}
                style={{
                  background: isInteractiveGlass
                    ? "radial-gradient(145% 92% at 50% -12%, rgba(255,255,255,0.32), rgba(255,255,255,0) 50%), radial-gradient(92% 92% at 18% 20%, rgba(255,255,255,0.14), rgba(255,255,255,0) 42%), radial-gradient(110% 92% at 82% 78%, rgba(255,255,255,0.1), rgba(255,255,255,0) 46%), radial-gradient(120% 90% at 50% 120%, rgba(255,255,255,0.08), rgba(255,255,255,0) 54%)"
                    : "radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,0.2), rgba(255,255,255,0) 54%), radial-gradient(90% 90% at 50% 70%, rgba(255,255,255,0.08), rgba(255,255,255,0) 55%)",
                }}
              />
              {isInteractiveGlass ? (
                <>
                  <div
                    className="absolute inset-0 opacity-55 blur-lg"
                    style={{
                      background:
                        "radial-gradient(55% 22% at 50% 0%, rgba(255,255,255,0.3), rgba(255,255,255,0) 72%), radial-gradient(48% 22% at 50% 100%, rgba(160,210,255,0.18), rgba(255,255,255,0) 70%)",
                    }}
                  />
                  <div
                    className="absolute -top-1 left-[28%] right-[28%] h-3 rounded-full opacity-55 blur-md"
                    style={{
                      background:
                        "linear-gradient(90deg, rgba(255,180,200,0), rgba(255,180,200,0.32), rgba(180,220,255,0.38), rgba(255,240,180,0.28), rgba(255,180,200,0))",
                    }}
                  />
                  <div
                    className="absolute -bottom-1 left-[30%] right-[30%] h-2.5 rounded-full opacity-35 blur-md"
                    style={{
                      background:
                        "linear-gradient(90deg, rgba(255,255,255,0), rgba(190,230,255,0.24), rgba(255,220,180,0.2), rgba(255,255,255,0))",
                    }}
                  />
                </>
              ) : null}
              <div
                className={`absolute inset-x-3 top-1.5 rounded-full blur-md ${
                  isInteractiveGlass ? "h-2 bg-white/08" : "h-2.5 bg-white/8"
                }`}
              />
              <div
                className={`absolute inset-x-2 bottom-1 rounded-full blur-md ${
                  isInteractiveGlass ? "h-4 bg-white/[0.06]" : "h-4 bg-white/6"
                }`}
              />
              <div
                className={`absolute left-1.5 top-2 bottom-2 w-px blur-[1px] ${
                  isInteractiveGlass ? "bg-white/[0.08]" : "bg-white/[0.04]"
                }`}
              />
              <div
                className={`absolute right-1.5 top-2 bottom-2 w-px blur-[1px] ${
                  isInteractiveGlass ? "bg-white/[0.06]" : "bg-white/[0.03]"
                }`}
              />
            </div>

            {primaryItems.map((item, index) => {
              const Icon = item.icon;
              const isSelected = indicatorIndex === index;

              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  className={`relative z-10 flex min-h-[50px] min-w-11 flex-col items-center justify-center gap-0.5 rounded-[1.5rem] px-1 py-1.5 text-center transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none ${
                    isSelected ? "text-stone-950" : "text-stone-600"
                  }`}
                  onClick={() => handlePrimaryClick(index)}
                  onPointerDown={(event) =>
                    handlePrimaryPointerDown(index, event)
                  }
                  onPointerEnter={(event) =>
                    handlePrimaryPointerEnter(index, event)
                  }
                  onPointerLeave={handlePrimaryPointerLeave}
                  onFocus={(event) => {
                    handlePrimaryFocus(index, event);
                  }}
                  onBlur={handlePrimaryBlur}
                  onTouchStart={() => {
                    if (item.intentPath != null) {
                      onRouteIntent(item.intentPath);
                    }
                  }}
                  aria-current={activeIndex === index ? "page" : undefined}
                  aria-label={item.label}
                >
                  <Icon size={20} strokeWidth={2.1} aria-hidden="true" />
                  <span className="text-[10.5px] leading-none">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={`relative z-[55] flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-full border text-center transition-all duration-200 motion-reduce:transition-none focus-visible:outline-none ${
              isMoreSelected
                ? "border-white/34 text-stone-950 shadow-[0_18px_34px_-24px_rgba(68,56,36,0.42),0_8px_22px_-18px_rgba(34,29,21,0.2),inset_0_1px_0_rgba(255,255,255,0.62),inset_0_0_0_1px_rgba(158,150,138,0.12)]"
                : "border-white/34 text-stone-700 shadow-[0_18px_34px_-24px_rgba(68,56,36,0.42),0_8px_22px_-18px_rgba(34,29,21,0.2),inset_0_1px_0_rgba(255,255,255,0.62),inset_0_0_0_1px_rgba(158,150,138,0.12)]"
            }`}
            style={{
              background:
                "linear-gradient(180deg, rgba(244,242,238,0.52), rgba(225,221,214,0.22))",
              backdropFilter:
                "blur(30px) saturate(220%) brightness(0.94) contrast(1.08)",
              WebkitBackdropFilter:
                "blur(30px) saturate(220%) brightness(0.94) contrast(1.08)",
            }}
            onClick={handleMoreClick}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="その他"
          >
            {isMoreSelected ? (
              <span
                className="pointer-events-none absolute inset-[4px] rounded-[1.6rem] border border-white/34"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(228,228,232,0.72), rgba(208,208,214,0.5))",
                  backdropFilter: "blur(14px) saturate(160%) brightness(1.02)",
                  WebkitBackdropFilter:
                    "blur(14px) saturate(160%) brightness(1.02)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.52), inset 0 -8px 14px rgba(255,255,255,0.08), 0 10px 18px -18px rgba(85,80,74,0.2)",
                }}
              />
            ) : null}
            <span
              className="pointer-events-none absolute inset-0 opacity-90"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,0.34), rgba(255,255,255,0) 48%), radial-gradient(120% 100% at 50% 120%, rgba(176,184,204,0.14), rgba(255,255,255,0) 52%), linear-gradient(90deg, rgba(214,224,255,0.08), rgba(255,255,255,0) 18%, rgba(255,255,255,0) 82%, rgba(255,215,190,0.08))",
              }}
            />
            {isMoreSelected ? (
              <>
                <span className="pointer-events-none absolute inset-x-4 top-2 h-2.5 rounded-full bg-white/8 blur-md" />
                <span className="pointer-events-none absolute inset-x-3 bottom-2 h-4 rounded-full bg-white/6 blur-md" />
              </>
            ) : null}
            <span className="pointer-events-none absolute inset-x-3 top-1 h-6 rounded-full bg-white/18 blur-lg" />
            <span className="relative z-10 flex flex-col items-center gap-1">
              <Ellipsis size={20} strokeWidth={2.1} aria-hidden="true" />
              <span className="text-[10.5px] leading-none">その他</span>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
