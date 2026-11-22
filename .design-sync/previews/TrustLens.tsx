import { Card, CardContent, CardHeader, CardTitle, MoneyDisplay, TrustLens, VehicleIdentity } from '@carup/design-system'

export const States = () => (
  <div className="flex flex-col items-start gap-2.5">
    <TrustLens state="evaluated" sourceCount={3} freshness="12 Nov 2026" />
    <TrustLens state="partial" sourceCount={2} freshness="12 Nov 2026" />
    <TrustLens state="stale" sourceCount={3} freshness="14 Mar 2026" />
    <TrustLens state="not-evaluated" sourceCount={0} freshness="12 Nov 2026" />
    <TrustLens state="insufficient-data" sourceCount={1} freshness="09 Nov 2026" />
    <TrustLens state="unavailable" />
  </div>
)

export const Provenance = () => (
  <div className="flex flex-col items-start gap-2.5">
    <TrustLens state="evaluated" sourceCount={4} freshness="12 Nov 2026" />
    <TrustLens state="evaluated" sourceCount={1} freshness="2026-11-12" />
    <TrustLens state="evaluated" />
  </div>
)

export const OnListing = () => (
  <Card className="w-[400px]">
    <CardHeader>
      <CardTitle>Vehicle history</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <VehicleIdentity title="Nissan NP200 1.6 8V" year={2017} mileageKm={143900} location="Mutare" variant="row" />
      <div><MoneyDisplay amount={6750} currency="USD" source="asking" size="lg" /></div>
      <div><TrustLens state="stale" sourceCount={2} freshness="14 Mar 2026" /></div>
    </CardContent>
  </Card>
)
