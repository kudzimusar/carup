import { Card, CardContent, CardFooter, CardHeader, Skeleton } from '@carup/design-system'

export const ListingCard = () => (
  <Card className="w-[340px] overflow-hidden pt-0" aria-busy="true" aria-label="Loading listing">
    <Skeleton className="w-full rounded-none" style={{ height: 180 }} />
    <CardHeader className="space-y-2">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </CardHeader>
    <CardContent className="space-y-2">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-40" />
    </CardContent>
    <CardFooter className="gap-2">
      <Skeleton className="h-9 flex-1" />
      <Skeleton className="h-9 w-20" />
    </CardFooter>
  </Card>
)

export const EnquiryRows = () => (
  <div className="w-[360px] space-y-4" aria-busy="true" aria-label="Loading enquiries">
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    ))}
  </div>
)

export const SpecTable = () => (
  <div className="grid w-[360px] grid-cols-2 gap-x-6 gap-y-3" aria-busy="true" aria-label="Loading specifications">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="contents">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto h-4 w-20" />
      </div>
    ))}
  </div>
)
