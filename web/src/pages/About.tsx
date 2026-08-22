import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Target, Eye, Shield, Brain, Users, Globe } from 'lucide-react'

const values = [
  { icon: Shield, title: 'Trust First', desc: 'Every feature we build prioritizes transparency and trust between all parties.' },
  { icon: Brain, title: 'AI-Powered', desc: 'We leverage artificial intelligence to make automotive intelligence accessible to everyone.' },
  { icon: Users, title: 'Community Driven', desc: 'Built with input from car owners, dealers, mechanics, and insurers across Zimbabwe.' },
  { icon: Globe, title: 'Zimbabwe First', desc: 'Purpose-built for Zimbabwe\'s unique automotive landscape and regulatory environment.' },
]

const team = [
  { name: 'Tendai Moyo', role: 'Founder & CEO', avatar: '/images/avatars/owner-1.jpg' },
  { name: 'Sarah Chikomo', role: 'Head of Product', avatar: '/images/avatars/owner-2.jpg' },
  { name: 'James Ncube', role: 'CTO', avatar: '/images/avatars/dealer-1.jpg' },
  { name: 'Ayesha Khan', role: 'Head of Operations', avatar: '/images/avatars/mechanic-1.jpg' },
]

export default function About() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-20">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <Badge className="mb-4 bg-orange-500/20 text-orange-300">About CarUp</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Building Zimbabwe's Automotive Future</h1>
          <p className="text-lg text-gray-300 max-w-2xl mx-auto">
            CarUp is Zimbabwe's first comprehensive automotive intelligence platform, combining AI, 
            a tamper-evident audit ledger, and a multi-stakeholder ecosystem to transform how vehicles are 
            bought, sold, and managed.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-16">
        {/* Mission & Vision */}
        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <Card className="border-0 card-shadow">
            <CardContent className="p-8">
              <Target className="w-10 h-10 text-orange-500 mb-4" />
              <h2 className="text-2xl font-bold mb-3">Our Mission</h2>
              <p className="text-gray-600 leading-relaxed">
                To become Zimbabwe's trusted source of truth for every vehicle. We aim to give every 
                car in Zimbabwe a digital identity — complete with ownership history, service records, 
                insurance data, and an AI-generated trust score.
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 card-shadow">
            <CardContent className="p-8">
              <Eye className="w-10 h-10 text-orange-500 mb-4" />
              <h2 className="text-2xl font-bold mb-3">Our Vision</h2>
              <p className="text-gray-600 leading-relaxed">
                Short-term: Zimbabwe's smartest car marketplace. Mid-term: Zimbabwe's automotive trust 
                engine. Long-term: Africa's automotive intelligence network, powered by a verifiable
                audit ledger and AI.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Values */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">Our Core Values</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {values.map((v) => (
              <Card key={v.title} className="border-0 card-shadow hover-lift">
                <CardContent className="p-6 text-center">
                  <div className="w-14 h-14 rounded-xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
                    <v.icon className="w-7 h-7 text-orange-500" />
                  </div>
                  <h3 className="font-semibold mb-2">{v.title}</h3>
                  <p className="text-sm text-gray-600">{v.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Team */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">Leadership Team</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {team.map((member) => (
              <Card key={member.name} className="border-0 card-shadow text-center overflow-hidden">
                <div className="h-48 overflow-hidden">
                  <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold">{member.name}</h3>
                  <p className="text-sm text-gray-500">{member.role}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="bg-gradient-to-r from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] rounded-2xl p-8 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '2024', label: 'Founded' },
              { value: '12,000+', label: 'Vehicles Registered' },
              { value: '850+', label: 'Partner Dealers' },
              { value: '98.7%', label: 'Fraud Detection' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-gray-400 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}