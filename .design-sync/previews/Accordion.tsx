import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@carup/design-system'

export const FAQ = () => (
  <Accordion type="single" collapsible defaultValue="history" style={{ width: 560 }}>
    <AccordionItem value="history">
      <AccordionTrigger>How does CarUp check a vehicle's history in Zimbabwe?</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">
        CarUp is not connected to ZINARA, the CVR or any insurance database. Its trust position reflects the
        documents a seller supplied and CarUp's own review of them. Confirm registration and licensing directly
        with the relevant body.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="payments">
      <AccordionTrigger>What payment options are accepted?</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">
        Plans and reports are priced in USD and ZiG. For a vehicle purchase, money moves directly between buyer
        and seller - CarUp holds no funds.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="dealer">
      <AccordionTrigger>How do I register a dealership on CarUp?</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">
        Register through the Dealer Registration portal and upload your company documents.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="transit">
      <AccordionTrigger>Can I list an imported vehicle that is still in transit?</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">
        Yes - use the In Transit category and attach the export certificate, bill of lading and auction sheet.
      </AccordionContent>
    </AccordionItem>
  </Accordion>
)

const Spec = ({ rows }: { rows: [string, string][] }) => (
  <dl className="grid grid-cols-2 gap-y-2">
    {rows.map(([k, v]) => (
      <div key={k} className="contents">
        <dt className="text-muted-foreground">{k}</dt>
        <dd className="text-right font-medium">{v}</dd>
      </div>
    ))}
  </dl>
)

export const VehicleSpecs = () => (
  <Accordion type="multiple" defaultValue={['engine', 'dimensions']} style={{ width: 480 }}>
    <AccordionItem value="engine">
      <AccordionTrigger>Engine & drivetrain</AccordionTrigger>
      <AccordionContent>
        <Spec rows={[['Engine', '2.8 GD-6 turbo diesel'], ['Power', '150 kW'], ['Transmission', '6-speed automatic'], ['Drive', '4x4 with diff lock']]} />
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="dimensions">
      <AccordionTrigger>Dimensions & capacity</AccordionTrigger>
      <AccordionContent>
        <Spec rows={[['Seats', '5'], ['Load bed', '1,525 mm'], ['Towing (braked)', '3,500 kg'], ['Fuel tank', '80 L']]} />
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="features">
      <AccordionTrigger>Comfort & safety features</AccordionTrigger>
      <AccordionContent>
        <Spec rows={[['Airbags', '7'], ['Reverse camera', 'Yes'], ['Cruise control', 'Yes']]} />
      </AccordionContent>
    </AccordionItem>
  </Accordion>
)

export const Bordered = () => (
  <Accordion type="single" collapsible defaultValue="bulawayo" className="rounded-lg border bg-card px-4" style={{ width: 480 }}>
    <AccordionItem value="harare">
      <AccordionTrigger>Harare branch · Borrowdale Rd</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">Mon–Sat, 08:00–17:00 · 28 vehicles on the lot</AccordionContent>
    </AccordionItem>
    <AccordionItem value="bulawayo">
      <AccordionTrigger>Bulawayo branch · Fife Street</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">Mon–Fri, 08:00–16:30 · 14 vehicles on the lot · Test drives by appointment</AccordionContent>
    </AccordionItem>
    <AccordionItem value="mutare">
      <AccordionTrigger>Mutare branch · Herbert Chitepo St</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">Mon–Fri, 08:30–16:00 · 6 vehicles on the lot</AccordionContent>
    </AccordionItem>
  </Accordion>
)

export const WithDisabledItem = () => (
  <Accordion type="single" collapsible style={{ width: 480 }}>
    <AccordionItem value="inspection">
      <AccordionTrigger>Pre-purchase inspection</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">Book an independent garage to inspect the vehicle before you pay.</AccordionContent>
    </AccordionItem>
    <AccordionItem value="delivery">
      <AccordionTrigger>Delivery to Mutare</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">The seller arranges delivery; agree the cost before you commit.</AccordionContent>
    </AccordionItem>
    <AccordionItem value="finance" disabled>
      <AccordionTrigger>Vehicle finance (not offered on this listing)</AccordionTrigger>
      <AccordionContent />
    </AccordionItem>
  </Accordion>
)
