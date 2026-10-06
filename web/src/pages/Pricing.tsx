import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Building2, Wrench, Shield, Car, Info } from 'lucide-react'

const stakeholderSolutions = [
  { icon: Building2, title: 'Dealers', desc: 'Inventory, CRM, analytics, and lead-management capabilities.' },
  { icon: Wrench, title: 'Mechanics', desc: 'Service records, parts provenance, and customer-management capabilities.' },
  { icon: Shield, title: 'Insurance', desc: 'Provider integrations remain unavailable until an approved insurer is activated.' },
  { icon: Car, title: 'Enterprise', desc: 'Institutional capabilities are governed by explicit provider and authority activation.' },
]

export default function Pricing() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">CarUp Plans</h1>
          <p className="text-gray-300 max-w-2xl mx-auto">
            Commercial pricing has not yet been approved for publication. CarUp does not display placeholder,
            demo, or estimated subscription prices as real offers.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1100px] -mt-8 pb-16">
        <Card className="border-0 card-shadow">
          <CardContent className="p-8 md:p-10 text-center">
            <Info className="w-10 h-10 mx-auto mb-4 text-orange-500" />
            <h2 className="text-2xl font-bold mb-3">Pricing is not published yet</h2>
            <p className="text-gray-600 max-w-2xl mx-auto mb-6">
              Plan names, prices, billing intervals, discounts, and paid entitlements will appear here only
              after they are approved as canonical CarUp commercial configuration.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link to="/register">Create an account</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/contact">Contact CarUp</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="mt-12">
          <h2 className="text-2xl font-bold text-center mb-8">Stakeholder capabilities</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stakeholderSolutions.map((item) => (
              <Card key={item.title} className="border-0 card-shadow text-center p-6">
                <item.icon className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-gray-500">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
