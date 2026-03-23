type BootScreenProps = {
  mode?: "overlay" | "page";
};

const baseClassName =
  "flex items-center justify-center bg-white text-stone-700";

export function BootScreen({ mode = "page" }: BootScreenProps) {
  return (
    <output
      className={
        mode === "overlay"
          ? `${baseClassName} fixed inset-0 z-[100]`
          : `${baseClassName} ios-safe-main min-h-screen px-2 py-3 md:p-6`
      }
      data-testid="boot-screen"
      aria-live="polite"
      aria-label="読み込み中"
    >
      <span className="flex flex-col items-center justify-center">
        <img
          src="/icons/pwa-192x192.png"
          alt=""
          width={96}
          height={96}
          fetchPriority="high"
          className="h-16 w-16 animate-pulse motion-reduce:animate-none md:h-20 md:w-20"
        />
        <span className="sr-only">読み込み中</span>
      </span>
    </output>
  );
}
