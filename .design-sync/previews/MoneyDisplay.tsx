import { Card, CardContent, CardDescription, CardHeader, CardTitle, MoneyDisplay } from '@carup/design-system'

export const Sources = () => (
  <div className="flex flex-col items-start gap-3">
    <MoneyDisplay amount={38500} currency="USD" source="asking" />
    <MoneyDisplay amount={36900} currency="USD" source="agreed" />
    <MoneyDisplay amount={35200} currency="USD" source="estimate" />
    <MoneyDisplay amount={34000} currency="USD" source="guide" />
  </div>
)

export const Currencies = () => (
  <div className="flex flex-col items-start gap-3">
    <MoneyDisplay amount={18500} currency="USD" source="asking" />
    <MoneyDisplay amount={7200} currency="ZiG" source="agreed" />
    <MoneyDisplay amount={245000} currency="ZAR" source="guide" />
    <MoneyDisplay amount={182000} currency="BWP" source="estimate" />
  </div>
)

export const Sizes = () => (
  <div className="flex flex-col items-start gap-3">
    <MoneyDisplay amount={15900} currency="USD" source="estimate" size="lg" />
    <MoneyDisplay amount={15900} currency="USD" source="estimate" />
  </div>
)

export const ProvenanceStates = () => (
  <div className="flex flex-col items-start gap-3">
    <MoneyDisplay currency="USD" source="asking" />
    <MoneyDisplay amount={500} currency="EUR" source="agreed" />
    <MoneyDisplay amount={500} source="estimate" />
  </div>
)

export const PriceSummary = () => (
  <Card className="w-[340px]">
    <CardHeader>
      <CardTitle>Honda Fit 1.3 Hybrid · 2014</CardTitle>
      <CardDescription>Bulawayo · private seller</CardDescription>
    </CardHeader>
    <CardContent>
      <dl className="grid gap-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Seller</dt>
          <dd><MoneyDisplay amount={8900} currency="USD" source="asking" size="lg" /></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Market</dt>
          <dd><MoneyDisplay amount={8400} currency="USD" source="guide" /></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Trade-in</dt>
          <dd><MoneyDisplay currency="USD" source="estimate" /></dd>
        </div>
      </dl>
    </CardContent>
  </Card>
)
