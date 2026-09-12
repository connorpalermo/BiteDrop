import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

export function SkeletonCard() {
  return (
    <Card className="flex h-full flex-col">
      <Skeleton className="aspect-[4/3] w-full" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </Card>
  );
}
