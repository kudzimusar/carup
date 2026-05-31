// @ts-nocheck
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Phone, Mail, MapPin, Clock, Send, MessageSquare, Car } from 'lucide-react'
import { toast } from 'sonner'

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' })
  const [sending, setSending] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setTimeout(() => {
      setSending(false)
      toast.success('Message sent! We will get back to you within 24 hours.')
      setForm({ name: '', email: '', phone: '', subject: '', message: '' })
    }, 1500)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <Badge className="mb-4 bg-orange-500/20 text-orange-300">Contact Us</Badge>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Get in Touch</h1>
          <p className="text-gray-300 max-w-xl mx-auto">
            Have questions about CarUp? Our team is here to help you with anything you need.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-16">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Contact Info */}
          <div className="space-y-6">
            <Card className="border-0 card-shadow">
              <CardContent className="p-6 space-y-4">
                <h2 className="font-semibold text-lg">Contact Information</h2>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Phone</p>
                      <p className="text-sm text-gray-600">+263 242 700 000</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Email</p>
                      <p className="text-sm text-gray-600">info@carup.co.zw</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Address</p>
                      <p className="text-sm text-gray-600">123 Samora Machel Ave<br />Harare, Zimbabwe</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Business Hours</p>
                      <p className="text-sm text-gray-600">Mon-Fri: 8AM - 5PM<br />Sat: 9AM - 1PM</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow bg-gradient-to-br from-orange-500 to-amber-500 text-white">
              <CardContent className="p-6">
                <MessageSquare className="w-8 h-8 mb-3" />
                <h3 className="font-semibold text-lg mb-2">Need Immediate Help?</h3>
                <p className="text-sm opacity-90 mb-4">Chat with Gutu AI, our intelligent assistant available 24/7.</p>
                <Button variant="secondary" className="w-full" asChild>
                  <a href="/dashboard/ai">Chat with Gutu AI</a>
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Contact Form */}
          <Card className="lg:col-span-2 border-0 card-shadow">
            <CardContent className="p-8">
              <h2 className="text-xl font-semibold mb-6">Send us a Message</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Full Name</label>
                    <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Email</label>
                    <Input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="your@email.com" />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Phone</label>
                    <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+263 7XX XXX XXX" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Subject</label>
                    <Input required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="How can we help?" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Message</label>
                  <Textarea required value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Tell us more about your inquiry..." rows={5} />
                </div>
                <Button type="submit" className="bg-orange-500 hover:bg-orange-600 gap-2" disabled={sending}>
                  <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send Message'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}