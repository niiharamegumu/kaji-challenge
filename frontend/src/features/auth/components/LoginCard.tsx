import { LogIn } from "lucide-react";

type Props = {
  status: string;
  onLogin: () => void;
};

export function LoginCard({ status, onLogin }: Props) {
  return (
    <main className="ios-safe-main flex min-h-screen items-center justify-center bg-[color:var(--color-washi-50)] px-2 py-4 text-stone-800 md:p-6">
      <div className="mx-auto max-w-4xl rounded-xl border border-stone-200 bg-white/90 p-3 shadow-sm backdrop-blur animate-enter md:rounded-2xl md:p-8">
        <section className="mx-auto max-w-2xl">
          <div className="flex items-center justify-center gap-3 md:justify-start">
            <img
              src="/icons/pwa-192x192.png"
              alt="KajiChalleのアプリアイコン"
              width={128}
              height={128}
              loading="eager"
              fetchPriority="high"
              className="h-14 w-14 shrink-0 md:h-16 md:w-16"
            />
            <h1 className="text-3xl font-bold tracking-wide text-stone-900 md:text-4xl">
              KajiChalle
            </h1>
          </div>
          <p className="mt-4 text-left text-sm leading-7 text-stone-700 md:text-left md:text-base">
            家事を見える化して、分担と継続をチームで支えるサービスです。日々のタスクを共有し、進捗を確認しながら、無理なく続く家事運用をつくれます。
          </p>
        </section>

        <div className="mt-6 flex justify-center md:justify-start">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-white transition-colors duration-200 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white md:w-fit md:min-w-72"
            onClick={onLogin}
          >
            <LogIn size={18} aria-hidden="true" />
            <span>Googleでログイン</span>
          </button>
        </div>
        <p
          className="mt-4 text-sm text-stone-700"
          data-testid="status-message"
          aria-live="polite"
        >
          {status}
        </p>
      </div>
    </main>
  );
}
