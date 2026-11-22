import { Card, CardContent, CardDescription, CardHeader, CardTitle, EvidenceLine, TrustLens } from '@carup/design-system'

export const Complete = () => (
  <div className="w-[500px]">
    <EvidenceLine actor="Roadworthiness centre HW-12" source="Roadworthiness certificate" at="2026-11-01" />
  </div>
)

export const MissingProvenance = () => (
  <div className="flex w-[500px] flex-col gap-2">
    <EvidenceLine actor="Dealer audit" source="Stock reconciliation" />
    <EvidenceLine actor="" source="Import clearance (ZIMRA)" at="2026-06-18" />
    <EvidenceLine actor="Seller" source="" at="2026-10-04" />
  </div>
)

export const WithStatus = () => (
  <div className="flex w-[500px] flex-col gap-2">
    <EvidenceLine actor="Service centre" source="Service invoice" at="2026-09-12" status="awaiting review" />
    <EvidenceLine actor="CMED Harare" source="Odometer reading" at="2026-08-30" status="accepted" />
    <EvidenceLine actor="Seller" source="Logbook scan" at="2025-12-02" status="superseded" />
  </div>
)

export const EvidenceTrail = () => (
  <Card className="w-[500px]">
    <CardHeader>
      <CardTitle>Evidence for this vehicle</CardTitle>
      <CardDescription>Toyota Hilux 2.8 GD-6 Raider · 2021</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <TrustLens state="evaluated" sourceCount={3} freshness="12 Nov 2026" />
      <div className="space-y-1.5">
        <EvidenceLine actor="Roadworthiness centre HW-12" source="Roadworthiness certificate" at="2026-11-01" />
        <EvidenceLine actor="Toyota Zimbabwe, Msasa" source="Service invoice" at="2026-09-12" />
        <EvidenceLine actor="ZINARA" source="Vehicle licence disc" at="2026-07-03" />
      </div>
    </CardContent>
  </Card>
)
