import { ScrollArea, ScrollBar, Separator } from '@carup/design-system'
import { Fragment } from 'react'

const enquiries = [
  { name: 'Farai Chikwanha', vehicle: 'Toyota Hilux 2.8 GD-6', when: '10:42', text: 'Is the price negotiable for cash?' },
  { name: 'Rudo Ncube', vehicle: 'Toyota Hilux 2.8 GD-6', when: '09:15', text: 'Can I view it in Borrowdale on Saturday?' },
  { name: 'Tatenda Banda', vehicle: 'Honda Fit 1.3 Hybrid', when: 'Yesterday', text: 'Has the hybrid battery been replaced?' },
  { name: 'Kudakwashe Dube', vehicle: 'Toyota Hilux 2.8 GD-6', when: 'Yesterday', text: 'Do you have the service book?' },
  { name: 'Nyasha Mlambo', vehicle: 'Honda Fit 1.3 Hybrid', when: 'Mon', text: 'Would you take a trade-in?' },
  { name: 'Blessing Sibanda', vehicle: 'Toyota Hilux 2.8 GD-6', when: 'Mon', text: 'Is ZIMRA duty fully paid?' },
  { name: 'Chipo Marufu', vehicle: 'Honda Fit 1.3 Hybrid', when: 'Sun', text: 'Can a mechanic inspect it first?' },
  { name: 'Tinashe Gumbo', vehicle: 'Toyota Hilux 2.8 GD-6', when: 'Sat', text: 'What tyres are fitted?' },
]

export const EnquiryInbox = () => (
  <ScrollArea type="always" className="w-[340px] rounded-md border" style={{ height: 280 }}>
    <div className="p-4">
      <h4 className="mb-3 text-sm font-medium leading-none">Enquiries · 8 unread</h4>
      {enquiries.map((e, i) => (
        <Fragment key={e.name}>
          {i > 0 ? <Separator className="my-2" /> : null}
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="font-medium">{e.name}</span>
              <span className="text-xs text-muted-foreground">{e.when}</span>
            </div>
            <p className="text-xs text-muted-foreground">{e.vehicle}</p>
            <p className="truncate">{e.text}</p>
          </div>
        </Fragment>
      ))}
    </div>
  </ScrollArea>
)

const similar = [
  { name: 'Toyota Hilux 2.4 GD-6', meta: '2019 · Bulawayo', price: '$31,900' },
  { name: 'Toyota Fortuner 2.8', meta: '2020 · Harare', price: '$42,000' },
  { name: 'Nissan Navara 2.3D', meta: '2018 · Mutare', price: '$24,500' },
  { name: 'Isuzu D-Max 3.0', meta: '2021 · Harare', price: '$33,750' },
  { name: 'Ford Ranger 2.2 XLS', meta: '2017 · Gweru', price: '$21,800' },
]

export const HorizontalGallery = () => (
  <ScrollArea type="always" className="whitespace-nowrap rounded-md border" style={{ width: 420 }}>
    <div className="flex w-max gap-3 p-4">
      {similar.map((v) => (
        <figure key={v.name} className="shrink-0" style={{ width: 160 }}>
          <div style={{ height: 96 }} className="flex items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">Photo</div>
          <figcaption className="pt-2 text-sm">
            <p className="truncate font-medium">{v.name}</p>
            <p className="text-xs text-muted-foreground">{v.meta}</p>
            <p className="text-xs font-semibold">{v.price} asking</p>
          </figcaption>
        </figure>
      ))}
    </div>
    <ScrollBar orientation="horizontal" />
  </ScrollArea>
)
