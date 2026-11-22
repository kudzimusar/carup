import { Button, ButtonGroup, ButtonGroupSeparator, ButtonGroupText, Input } from '@carup/design-system'
import { ChevronDown, Mail, Minus, Phone, Plus, Search } from 'lucide-react'

export const ContactActions = () => (
  <ButtonGroup aria-label="Contact seller">
    <Button variant="outline"><Phone /> Call</Button>
    <Button variant="outline">WhatsApp</Button>
    <Button variant="outline"><Mail /> Email</Button>
  </ButtonGroup>
)

export const SplitButton = () => (
  <ButtonGroup>
    <Button>Save search</Button>
    <ButtonGroupSeparator />
    <Button size="icon" aria-label="Alert options"><ChevronDown /></Button>
  </ButtonGroup>
)

export const WithInput = () => (
  <ButtonGroup style={{ width: 380 }}>
    <Input placeholder="Make, model or plate number" />
    <Button variant="outline" aria-label="Search"><Search /></Button>
  </ButtonGroup>
)

export const WithText = () => (
  <ButtonGroup>
    <ButtonGroupText>Sort</ButtonGroupText>
    <Button variant="outline">Newest</Button>
    <Button variant="outline">Price</Button>
    <Button variant="outline">Mileage</Button>
  </ButtonGroup>
)

export const Vertical = () => (
  <ButtonGroup orientation="vertical" aria-label="Map zoom">
    <Button variant="outline" size="icon" aria-label="Zoom in"><Plus /></Button>
    <Button variant="outline" size="icon" aria-label="Zoom out"><Minus /></Button>
  </ButtonGroup>
)
