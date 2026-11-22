import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@carup/design-system'

export const Default = () => (
  <Field className="w-[360px]">
    <FieldLabel htmlFor="field-model">Model</FieldLabel>
    <Input id="field-model" placeholder="e.g. Hilux 2.8 GD-6" />
    <FieldDescription>Use the model name on the registration book.</FieldDescription>
  </Field>
)

export const Horizontal = () => (
  <FieldGroup className="w-[400px]">
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="field-show-phone">Show my number on the listing</FieldLabel>
        <FieldDescription>Buyers can call you directly instead of messaging through CarUp.</FieldDescription>
      </FieldContent>
      <Switch id="field-show-phone" />
    </Field>
    <Field orientation="horizontal">
      <Checkbox id="field-negotiable" defaultChecked />
      <FieldLabel htmlFor="field-negotiable">Price is negotiable</FieldLabel>
    </Field>
  </FieldGroup>
)

export const Invalid = () => (
  <FieldGroup className="w-[360px]">
    <Field data-invalid="true">
      <FieldLabel htmlFor="field-mileage">Mileage (km)</FieldLabel>
      <Input id="field-mileage" defaultValue="62,400 miles" aria-invalid />
      <FieldError>Enter the odometer reading in kilometres, numbers only.</FieldError>
    </Field>
    <Field data-invalid="true">
      <FieldLabel htmlFor="field-photos">Photos</FieldLabel>
      <Input id="field-photos" type="file" aria-invalid />
      <FieldError
        errors={[
          { message: 'Add at least 6 photos, including the odometer.' },
          { message: 'Each photo must be under 10 MB.' },
        ]}
      />
    </Field>
  </FieldGroup>
)

export const Disabled = () => (
  <Field data-disabled="true" className="w-[360px]">
    <FieldLabel htmlFor="field-chassis">Chassis number</FieldLabel>
    <Input id="field-chassis" className="font-mono" defaultValue="ZW1234567890" disabled />
    <FieldDescription>Locked after the vehicle passport was issued.</FieldDescription>
  </Field>
)

export const InspectionBooking = () => (
  <form className="w-[400px]">
    <FieldSet>
      <FieldLegend>Book an inspection</FieldLegend>
      <FieldDescription>A CarUp partner workshop inspects the vehicle before you buy.</FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="field-name">Full name</FieldLabel>
          <Input id="field-name" defaultValue="Tendai Moyo" />
        </Field>
        <Field>
          <FieldLabel htmlFor="field-city">City</FieldLabel>
          <Select defaultValue="harare">
            <SelectTrigger id="field-city" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="harare">Harare</SelectItem>
              <SelectItem value="bulawayo">Bulawayo</SelectItem>
              <SelectItem value="mutare">Mutare</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <FieldSeparator>Then</FieldSeparator>
        <Field orientation="horizontal">
          <Checkbox id="field-notify-seller" defaultChecked />
          <FieldLabel htmlFor="field-notify-seller">Tell the seller I've booked</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Button type="button">Request inspection</Button>
          <Button type="button" variant="outline">Cancel</Button>
        </Field>
      </FieldGroup>
    </FieldSet>
  </form>
)

export const ChoiceSet = () => (
  <FieldSet className="w-[400px]">
    <FieldLegend variant="label">Who is selling?</FieldLegend>
    <FieldDescription>This decides which documents we ask for.</FieldDescription>
    <RadioGroup defaultValue="private">
      <Field orientation="horizontal">
        <RadioGroupItem value="private" id="field-seller-private" />
        <FieldLabel htmlFor="field-seller-private" className="font-normal">Private owner</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <RadioGroupItem value="dealer" id="field-seller-dealer" />
        <FieldLabel htmlFor="field-seller-dealer" className="font-normal">Registered dealer</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <RadioGroupItem value="agent" id="field-seller-agent" />
        <FieldLabel htmlFor="field-seller-agent" className="font-normal">Agent selling for the owner</FieldLabel>
      </Field>
    </RadioGroup>
  </FieldSet>
)
