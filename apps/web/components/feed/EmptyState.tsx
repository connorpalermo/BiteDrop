interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-lg font-semibold text-fg">No food drops found</p>
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
