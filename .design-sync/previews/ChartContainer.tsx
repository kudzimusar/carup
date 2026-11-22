import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  MoneyDisplay,
  type ChartConfig,
} from '@carup/design-system'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { ReactNode } from 'react'

// CarUp ships no --chart-N tokens: series colours come from the brand/status tokens.
// Orange (action) + blue (info) pass the dataviz validator for 2-series categorical use.
// Marks set isAnimationActive={false} so the static capture shows the finished chart.
const ORANGE = 'var(--carup-color-action)'
const BLUE = 'var(--carup-info)'

const Panel = ({ title, subtitle, aside, children }: { title: string; subtitle: string; aside?: ReactNode; children: ReactNode }) => (
  <div className="rounded-xl border bg-card p-5" style={{ width: 680 }}>
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {aside}
    </div>
    {children}
  </div>
)

const enquiries = [
  { week: '29 Sep', enquiries: 6 },
  { week: '06 Oct', enquiries: 9 },
  { week: '13 Oct', enquiries: 7 },
  { week: '20 Oct', enquiries: 14 },
  { week: '27 Oct', enquiries: 11 },
  { week: '03 Nov', enquiries: 17 },
  { week: '10 Nov', enquiries: 21 },
]

const enquiriesConfig = { enquiries: { label: 'Enquiries', color: ORANGE } } satisfies ChartConfig

export const EnquiriesBar = () => (
  <Panel title="Enquiries per week" subtitle="Toyota Hilux 2.8 GD-6 Raider · listed 29 Sep 2026" aside={<span className="text-2xl font-semibold tabular-nums">85</span>}>
    <ChartContainer config={enquiriesConfig} style={{ height: 240, width: '100%' }}>
      <BarChart data={enquiries} margin={{ left: 0, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar isAnimationActive={false} dataKey="enquiries" fill="var(--color-enquiries)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ChartContainer>
  </Panel>
)

const priceTrend = [
  { month: 'Jun', hilux: 41200, dmax: 30900 },
  { month: 'Jul', hilux: 40600, dmax: 30100 },
  { month: 'Aug', hilux: 40100, dmax: 29800 },
  { month: 'Sep', hilux: 39400, dmax: 29200 },
  { month: 'Oct', hilux: 38900, dmax: 28400 },
  { month: 'Nov', hilux: 38500, dmax: 28100 },
]

const priceConfig = {
  hilux: { label: 'Toyota Hilux 2.8 GD-6', color: ORANGE },
  dmax: { label: 'Isuzu D-Max 3.0', color: BLUE },
} satisfies ChartConfig

export const PriceTrend = () => (
  <Panel
    title="Median asking price, USD"
    subtitle="2020–2021 double cabs listed in Harare · Jun–Nov 2026"
    aside={<MoneyDisplay amount={38500} currency="USD" source="guide" size="lg" />}
  >
    <ChartContainer config={priceConfig} style={{ height: 260, width: '100%' }}>
      <LineChart data={priceTrend} margin={{ left: 0, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          domain={[26000, 42000]}
          tickFormatter={(v: number) => `${v / 1000}k`}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line isAnimationActive={false} dataKey="hilux" type="monotone" stroke="var(--color-hilux)" strokeWidth={2} dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="dmax" type="monotone" stroke="var(--color-dmax)" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ChartContainer>
  </Panel>
)

const channels = [
  { month: 'Jun', whatsapp: 48, inapp: 22 },
  { month: 'Jul', whatsapp: 55, inapp: 27 },
  { month: 'Aug', whatsapp: 51, inapp: 34 },
  { month: 'Sep', whatsapp: 62, inapp: 39 },
  { month: 'Oct', whatsapp: 66, inapp: 45 },
  { month: 'Nov', whatsapp: 71, inapp: 52 },
]

const channelConfig = {
  whatsapp: { label: 'WhatsApp', color: ORANGE },
  inapp: { label: 'In-app messages', color: BLUE },
} satisfies ChartConfig

export const EnquiryChannels = () => (
  <Panel title="Enquiries by channel" subtitle="Borrowdale Motors · all listings · Jun–Nov 2026">
    <ChartContainer config={channelConfig} style={{ height: 260, width: '100%' }}>
      <BarChart data={channels} margin={{ left: 0, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar isAnimationActive={false} dataKey="whatsapp" stackId="a" fill="var(--color-whatsapp)" radius={[0, 0, 4, 4]} maxBarSize={40} stroke="hsl(var(--card))" strokeWidth={2} />
        <Bar isAnimationActive={false} dataKey="inapp" stackId="a" fill="var(--color-inapp)" radius={[4, 4, 0, 0]} maxBarSize={40} stroke="hsl(var(--card))" strokeWidth={2} />
      </BarChart>
    </ChartContainer>
  </Panel>
)

const views = [
  { day: '04 Nov', views: 120 },
  { day: '05 Nov', views: 160 },
  { day: '06 Nov', views: 148 },
  { day: '07 Nov', views: 210 },
  { day: '08 Nov', views: 265 },
  { day: '09 Nov', views: 240 },
  { day: '10 Nov', views: 310 },
  { day: '11 Nov', views: 286 },
]

const viewsConfig = { views: { label: 'Views', color: BLUE } } satisfies ChartConfig

export const ViewsWithTooltip = () => (
  <Panel title="Listing views" subtitle="Mazda CX-5 2.0 Active · last 8 days">
    <ChartContainer config={viewsConfig} style={{ height: 240, width: '100%' }}>
      <AreaChart data={views} margin={{ left: 0, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip defaultIndex={6} active content={<ChartTooltipContent indicator="dot" />} />
        <Area isAnimationActive={false} dataKey="views" type="monotone" stroke="var(--color-views)" strokeWidth={2} fill="var(--color-views)" fillOpacity={0.12} />
      </AreaChart>
    </ChartContainer>
  </Panel>
)
