interface SkeletonProps {
  /** Size/layout utilities only, e.g. "h-4 w-32". */
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`bg-surface-2 rounded-md animate-pulse ${className}`} />;
}
