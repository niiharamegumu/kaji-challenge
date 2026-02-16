type Props = {
  message: string;
};

export function StatusBanner({ message }: Props) {
  return (
    <p className="mt-3 rounded-lg bg-stone-100/80 px-3 py-2 text-sm text-stone-700" data-testid="status-message">
      {message}
    </p>
  );
}
