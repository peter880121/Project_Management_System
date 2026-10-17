export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-md bg-slate-200 motion-safe:animate-pulse ${className}`} />;
}
export function TaskDetailSkeleton() {
  return <div role="status" aria-label="正在加载任务详情" className="space-y-6 p-5"><span className="sr-only">正在加载任务详情</span><Skeleton className="h-7 w-3/4" /><Skeleton className="h-5 w-24" /><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-32 w-full" /></div>;
}
