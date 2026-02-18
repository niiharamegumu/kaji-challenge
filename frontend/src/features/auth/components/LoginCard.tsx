import { LogIn } from "lucide-react";

type Props = {
  status: string;
  onLogin: () => void;
};

export function LoginCard({ status, onLogin }: Props) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-matcha-50))] p-6 text-stone-800">
      <div className="mx-auto max-w-xl rounded-2xl border border-[color:var(--color-kohaku-200)] bg-white/90 p-6 shadow-sm backdrop-blur animate-enter">
        <h1 className="text-2xl font-bold tracking-wide">KajiChalle</h1>
        <button
          type="button"
          className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[color:var(--color-matcha-600)] px-4 py-2 text-white transition-colors duration-200 hover:bg-[color:var(--color-matcha-700)]"
          onClick={onLogin}
        >
          <LogIn size={18} aria-hidden="true" />
          <span>Googleでログイン</span>
        </button>
        <p className="mt-4 text-sm text-stone-700" data-testid="status-message">
          {status}
        </p>
      </div>
    </main>
  );
}
