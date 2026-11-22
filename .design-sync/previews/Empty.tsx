import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@carup/design-system'
import { ArrowRight, Heart, MessageSquare, SearchX } from 'lucide-react'

export const SavedCars = () => (
  <Empty className="border" style={{ width: 420 }}>
    <EmptyHeader>
      <EmptyMedia variant="icon"><Heart /></EmptyMedia>
      <EmptyTitle>No saved cars yet</EmptyTitle>
      <EmptyDescription>
        Tap the heart on any listing to keep it here. We'll tell you when a saved car drops in price.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button>Browse marketplace <ArrowRight /></Button>
    </EmptyContent>
  </Empty>
)

export const NoSearchResults = () => (
  <Empty className="border" style={{ width: 420 }}>
    <EmptyHeader>
      <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
      <EmptyTitle>No vehicles match these filters</EmptyTitle>
      <EmptyDescription>
        Nothing listed for Toyota Hilux under $15,000 in Mutare. Widen the price range or search all of Zimbabwe.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <div className="flex gap-2">
        <Button variant="outline">Clear filters</Button>
        <Button>Save this search</Button>
      </div>
    </EmptyContent>
  </Empty>
)

export const NoEnquiries = () => (
  <Empty style={{ width: 420 }}>
    <EmptyHeader>
      <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
      <EmptyTitle>No enquiries yet</EmptyTitle>
      <EmptyDescription>
        Buyers' questions about your listings will appear here. <a href="#">Tips for a stronger listing</a>
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
)
