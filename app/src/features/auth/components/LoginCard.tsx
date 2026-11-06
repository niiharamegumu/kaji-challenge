import { LogIn } from "lucide-react";

import { useMarkInitialScreenReady } from "../../../app/boot";
import appLogo from "../../../shared/assets/app-logo.png?inline";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";

type Props = {
  status: string;
  onLogin: () => void;
};

export function LoginCard({ status, onLogin }: Props) {
  useMarkInitialScreenReady();

  return (
    <main className="ios-safe-main flex min-h-screen items-center justify-center bg-canvas px-2 py-4 text-ink md:p-6">
      <div
        className={`mx-auto max-w-4xl animate-enter px-0 py-3 md:p-8 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
        <section className="mx-auto max-w-2xl px-2 md:px-0">
          <div className="flex items-center justify-center gap-3 md:justify-start">
            <img
              src={appLogo}
              alt="KajiChalleのアプリアイコン"
              width={128}
              height={128}
              loading="eager"
              fetchPriority="high"
              className="app-logo h-14 w-14 shrink-0 md:h-16 md:w-16"
            />
            <h1 className="text-3xl font-bold tracking-wide text-heading md:text-4xl">
              KajiChalle
            </h1>
          </div>
          <p className="mt-4 text-left text-sm leading-7 text-body md:text-left md:text-base">
            家事を見える化して、分担と継続をチームで支えるサービスです。日々のタスクを共有し、進捗を確認しながら、無理なく続く家事運用をつくれます。
          </p>
        </section>

        <div className="mt-6 flex justify-center px-2 md:justify-start md:px-0">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-action px-4 py-2 text-on-action transition-colors duration-200 hover:bg-action-hover md:w-fit md:min-w-72"
            onClick={onLogin}
          >
            <LogIn size={18} aria-hidden="true" />
            <span>Googleでログイン</span>
          </button>
        </div>
        <p
          className="mt-4 px-2 text-sm text-body md:px-0"
          data-testid="status-message"
          aria-live="polite"
        >
          {status}
        </p>
      </div>
    </main>
  );
}
