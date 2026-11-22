import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@carup/design-system'
import { FileText, History, LayoutList } from 'lucide-react'

export const VehicleDetail = () => (
  <Tabs defaultValue="overview" style={{ width: 460 }}>
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="history">History</TabsTrigger>
      <TabsTrigger value="evidence">Evidence</TabsTrigger>
    </TabsList>
    <TabsContent value="overview">
      <Card>
        <CardHeader>
          <CardTitle>Toyota Hilux 2.8 GD-6 Raider</CardTitle>
          <CardDescription>Double cab · 4x4 · Automatic</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Year</dt>
            <dd className="text-right font-medium">2021</dd>
            <dt className="text-muted-foreground">Odometer</dt>
            <dd className="text-right font-medium">62,400 km</dd>
            <dt className="text-muted-foreground">Fuel</dt>
            <dd className="text-right font-medium">Diesel</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd className="text-right font-medium">Harare</dd>
          </dl>
        </CardContent>
      </Card>
    </TabsContent>
    <TabsContent value="history">Service and ownership records.</TabsContent>
    <TabsContent value="evidence">Documents and photos submitted for this vehicle.</TabsContent>
  </Tabs>
)

export const WithIconsAndCounts = () => (
  <Tabs defaultValue="history" style={{ width: 460 }}>
    <TabsList>
      <TabsTrigger value="overview"><LayoutList /> Overview</TabsTrigger>
      <TabsTrigger value="history"><History /> History <Badge variant="secondary">4</Badge></TabsTrigger>
      <TabsTrigger value="evidence"><FileText /> Evidence <Badge variant="secondary">7</Badge></TabsTrigger>
    </TabsList>
    <TabsContent value="history" className="space-y-2 pt-2 text-sm">
      <div className="flex justify-between"><span>Major service · Harare Auto Hub</span><span className="text-muted-foreground">12 Sep 2026</span></div>
      <div className="flex justify-between"><span>Brake pads replaced</span><span className="text-muted-foreground">03 Apr 2026</span></div>
      <div className="flex justify-between"><span>Oil and filter change</span><span className="text-muted-foreground">18 Nov 2025</span></div>
    </TabsContent>
  </Tabs>
)

export const FullWidthWithDisabled = () => (
  <Tabs defaultValue="active" style={{ width: 460 }}>
    <TabsList className="w-full">
      <TabsTrigger value="active">Active (3)</TabsTrigger>
      <TabsTrigger value="drafts">Drafts (1)</TabsTrigger>
      <TabsTrigger value="sold">Sold</TabsTrigger>
      <TabsTrigger value="archived" disabled>Archived</TabsTrigger>
    </TabsList>
    <TabsContent value="active" className="flex items-center justify-between rounded-lg border p-4 text-sm">
      <div>
        <p className="font-medium">Honda Fit 1.3 Hybrid 2017</p>
        <p className="text-muted-foreground">Listed 9 days ago · 14 enquiries</p>
      </div>
      <Button size="sm" variant="outline">Manage</Button>
    </TabsContent>
  </Tabs>
)
