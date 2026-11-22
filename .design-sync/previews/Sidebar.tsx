import {
  Badge,
  BrandMark,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MoneyDisplay,
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@carup/design-system'
import { Car, Heart, HelpCircle, MessageSquare, Plus, Settings, Tag, Wrench } from 'lucide-react'

const workspace = [
  { label: 'My Garage', icon: Car, active: true },
  { label: 'Listings', icon: Tag, badge: '2' },
  { label: 'Enquiries', icon: MessageSquare, badge: '5' },
  { label: 'Saved', icon: Heart, badge: '12' },
  { label: 'Service history', icon: Wrench },
]

const OwnerSidebar = () => (
  <Sidebar>
    <SidebarHeader className="p-4">
      <BrandMark slot="workspace-rail" tone="ink" compact />
      <p className="px-1 pt-1 text-xs text-sidebar-foreground/70">Owner workspace</p>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {workspace.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton isActive={item.active}>
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
                {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Account</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton><Settings /><span>Settings</span></SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton><HelpCircle /><span>Help centre</span></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter className="border-t border-sidebar-border p-4">
      <div className="text-sm">
        <p className="font-medium">Tendai Moyo</p>
        <p className="text-xs text-sidebar-foreground/70">Private seller · Harare</p>
      </div>
    </SidebarFooter>
  </Sidebar>
)

export const OwnerWorkspace = () => (
  <SidebarProvider>
    <OwnerSidebar />
    <SidebarInset>
      <header className="flex h-14 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="#">Workspace</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>My Garage</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My Garage</h1>
            <p className="text-sm text-muted-foreground">2 vehicles · Vehicle Passports and service records</p>
          </div>
          <Button><Plus /> Add vehicle</Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Toyota Hilux 2.8 GD-6 Raider</CardTitle>
              <CardDescription>2021 · 62,400 km · Listed for sale</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <MoneyDisplay amount={38500} currency="USD" source="asking" />
              <Badge variant="secondary">2 new enquiries</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Honda Fit 1.3 Hybrid</CardTitle>
              <CardDescription>2017 · 98,200 km · Not listed</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last service 12 Sep 2026</span>
              <Button size="sm" variant="outline">Sell this car</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
)
