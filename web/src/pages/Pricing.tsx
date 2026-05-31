// @ts-nocheck
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Check, X, Zap, Building2, Wrench, Shield, Car } from 'lucide-react'
import { subscriptionPlans } from '@/data/mockData'

export default function Pricing() {
  const [annual, setAnnual] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p className="text-gray-300 max-w-xl mx-auto">Choose the plan that works for you. All plans include core vehicle tracking and marketplace access.</p>
          <div className="flex items-center justify-center gap-3 mt-8">
            <span className={`text-sm ${!annual ? 'text-white' : 'text-gray-400'}`}>Monthly</span>
            <Switch checked={annual} onCheckedChange={setAnnual} />
            <span className={`text-sm ${annual ? 'text-white' : 'text-gray-400'}`}>Annual <Badge className="ml-1 bg-green-500 text-white text-[10px]">Save 20%</Badge></span>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] -mt-8 pb-16">
        <div className="grid md:grid-cols-3 gap-6">
          {subscriptionPlans.map((plan) => (
            <Card key={plan.name} className={`border-0 card-shadow ${plan.popular ? 'ring-2 ring-orange-500 relative' : ''}`}>
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white">
                  Most Popular
                </Badge>
              )}
              <CardHeader className="text-center pb-2">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="text-sm text-gray-500">{plan.description}</p>
                <div className="mt-4">
                  {plan.price === 0 ? (
                    <span className="text-4xl font-bold">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold">${annual ? (plan.price * 0.8 * 12).toFixed(0) : plan.price}</span>
                      <span className="text-gray-500">/{annual ? 'year' : 'month'}</span>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3 mb-6">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <span className="text-sm">{f}</span>
                    </div>
                  ))}
                  {plan.notIncluded.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-gray-400">
                      <X className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="text-sm">{f}</span>
                    </div>
                  ))}
                </div>
                <Button
                  className={`w-full ${plan.popular ? 'bg-orange-500 hover:bg-orange-600' : ''}`}
                  variant={plan.popular ? 'default' : 'outline'}
                  asChild
                >
                  <Link to="/register">{plan.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Stakeholder Pricing */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-8">Stakeholder Solutions</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Building2, title: 'Dealers', price: '$99/mo', desc: 'Inventory, CRM, analytics, and lead management' },
              { icon: Wrench, title: 'Mechanics', price: '$49/mo', desc: 'Service logs, parts ledger, and customer management' },
              { icon: Shield, title: 'Insurance', price: 'Custom', desc: 'Risk intelligence, fraud analytics, and API access' },
              { icon: Car, title: 'Enterprise', price: 'Custom', desc: 'Government, banks, and large fleet operators' },
            ].map((item) => (
              <Card key={item.title} className="border-0 card-shadow text-center p-6">
                <item.icon className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-xl font-bold text-orange-600 mb-2">{item.price}</p>
                <p className="text-sm text-gray-500">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}