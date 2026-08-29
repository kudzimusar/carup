import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class SellerRouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[seller-route] render failure', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-8" data-testid="seller-route-recovery">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="h-6 w-6 text-amber-700" />
          <h1 className="mt-3 text-xl font-bold text-slate-950">Your Seller draft is still in this browser</h1>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            The Seller workspace could not render this view. CarUp has not converted that failure
            into a blank screen or silently discarded your browser draft.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry this Seller page
            </Button>
            <Button asChild variant="outline">
              <Link to="/sell">Return to Seller Studio</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
