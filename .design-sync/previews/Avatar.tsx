import { Avatar, AvatarFallback, AvatarImage, Badge } from '@carup/design-system'

// Inline SVG dealer logo (data URI - no network): a monogram on the brand navy.
const dealerLogo =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#13233f"/>' +
      '<path d="M14 40h36l-4-10a6 6 0 0 0-5.6-4H23.6A6 6 0 0 0 18 30z" fill="#f97316"/>' +
      '<circle cx="22" cy="42" r="4" fill="#fff"/><circle cx="42" cy="42" r="4" fill="#fff"/>' +
      '</svg>',
  )

export const Fallbacks = () => (
  <div className="flex items-center gap-3">
    <Avatar><AvatarFallback>TM</AvatarFallback></Avatar>
    <Avatar><AvatarFallback>RC</AvatarFallback></Avatar>
    <Avatar><AvatarFallback className="bg-carup-action-soft text-carup-action font-medium">BM</AvatarFallback></Avatar>
    <Avatar><AvatarFallback className="bg-status-info-soft text-status-info font-medium">KN</AvatarFallback></Avatar>
  </div>
)

export const Sizes = () => (
  <div className="flex items-end gap-4">
    <Avatar className="size-6"><AvatarFallback className="text-[10px]">TM</AvatarFallback></Avatar>
    <Avatar><AvatarFallback className="text-xs">TM</AvatarFallback></Avatar>
    <Avatar className="size-10"><AvatarFallback className="text-sm">TM</AvatarFallback></Avatar>
    <Avatar style={{ width: 56, height: 56 }}><AvatarFallback className="text-lg font-medium">TM</AvatarFallback></Avatar>
  </div>
)

export const ImageAndFallback = () => (
  <div className="flex items-center gap-6">
    <div className="flex items-center gap-2 text-sm">
      <Avatar className="size-10">
        <AvatarImage src={dealerLogo} alt="Borrowdale Motors logo" />
        <AvatarFallback>BM</AvatarFallback>
      </Avatar>
      <span className="font-medium">Logo loaded</span>
    </div>
    <div className="flex items-center gap-2 text-sm">
      <Avatar className="size-10">
        <AvatarImage src="/uploads/sellers/missing-photo.jpg" alt="Tendai Moyo" />
        <AvatarFallback>TM</AvatarFallback>
      </Avatar>
      <span className="text-muted-foreground">Photo unavailable, initials shown</span>
    </div>
  </div>
)

export const SellerIdentity = () => (
  <div className="flex w-[360px] items-center gap-3 rounded-lg border bg-card p-4">
    <Avatar style={{ width: 48, height: 48 }}>
      <AvatarImage src={dealerLogo} alt="Borrowdale Motors logo" />
      <AvatarFallback>BM</AvatarFallback>
    </Avatar>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <p className="truncate font-semibold">Borrowdale Motors</p>
        <Badge variant="secondary">Dealer</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Harare · 42 vehicles listed</p>
    </div>
  </div>
)

// Stacked avatars: a 2px ring in the page background separates overlapping faces.
const ring = { boxShadow: '0 0 0 2px hsl(var(--background))' }

export const Group = () => (
  <div className="flex items-center gap-3">
    <div className="flex">
      <Avatar style={ring}><AvatarFallback className="text-xs">TM</AvatarFallback></Avatar>
      <Avatar style={{ ...ring, marginLeft: -6 }}><AvatarFallback className="bg-carup-action-soft text-carup-action text-xs">BM</AvatarFallback></Avatar>
      <Avatar style={{ ...ring, marginLeft: -6 }}><AvatarFallback className="bg-status-info-soft text-status-info text-xs">KN</AvatarFallback></Avatar>
      <Avatar style={{ ...ring, marginLeft: -6 }}><AvatarFallback className="text-xs">+5</AvatarFallback></Avatar>
    </div>
    <span className="text-sm text-muted-foreground">8 buyers saved this Toyota Hilux</span>
  </div>
)
