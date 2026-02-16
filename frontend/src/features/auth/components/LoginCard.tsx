type Props = {
  status: string;
  onLogin: () => void;
};

export function LoginCard({ status, onLogin }: Props) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-matcha-50))] p-6 text-stone-800">
      <div className="mx-auto max-w-xl rounded-2xl border border-[color:var(--color-kohaku-200)] bg-white/90 p-6 shadow-sm backdrop-blur animate-enter">
        <h1 className="text-2xl font-bold tracking-wide">家事チャレ MVP</h1>
        <p className="mt-2 text-sm text-stone-600">Google OIDCでログイン</p>
        <button
          type="button"
          className="mt-5 rounded-lg bg-[color:var(--color-matcha-600)] px-4 py-2 text-white transition-transform duration-200 hover:-translate-y-0.5"
          onClick={onLogin}
        >
          Googleでログイン
        </button>
        <p className="mt-4 text-sm text-stone-700" data-testid="status-message">
          {status}
        </p>
      </div>
    </main>
  );
}
