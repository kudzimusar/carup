// @ts-nocheck
import { useState, useRef, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Bot, User, Image, FileText, TrendingUp, Shield, Wrench, Car, Sparkles } from 'lucide-react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

const gutuWelcomeMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Mhoroi! I am Gutu AI, your CarUp intelligent assistant. I can help you with vehicle valuations, maintenance schedules, document scanning, and fraud checking. How can I help you today?',
    timestamp: new Date().toISOString()
  }
]
const suggestedQuestions = [
  'What is my vehicle worth?',
  'When is my next service due?',
  'Scan my logbook',
  'Check insurance expiry',
  'Find mechanics near me',
  'Is this price fair?',
]

const aiResponses: Record<string, string> = {
  'worth': 'Based on current market data for your Toyota Corolla Quest (2019) with 67,800km in Harare, the estimated market value is **$11,800**. This represents a 3.2% decrease from last month due to increased supply. Similar vehicles are selling between $10,600 and $13,000.',
  'service': 'Your Toyota Corolla Quest is due for service in approximately **500km or 30 days**, whichever comes first. Based on your last service (April 2026 at 67,000km), the next service should include: oil change, filter replacement, and brake inspection. Would you like me to recommend garages?',
  'insurance': 'Your NicozDiamond comprehensive policy (NDI-MOT-2026-45678) expires on **December 31, 2026**. That is 223 days from now. Your premium of $680/year is competitive. I recommend starting renewal discussions 30 days before expiry.',
  'mechanics': 'Here are 3 highly-rated mechanics near you in Harare:\n\n1. **AutoTech Pro Garage** (4.9★) - 2.3km away\n   Specializes: European & Japanese cars\n\n2. **Elite Auto Care** (4.8★) - 4.1km away\n   Specializes: Luxury vehicles & detailing\n\n3. **QuickFix Motors** (4.6★) - 5.7km away\n   Specializes: Toyota, Nissan, Mazda',
  'price': 'To evaluate if a price is fair, I need the vehicle details. Please share the make, model, year, mileage, and condition. I will compare it against recent sales data and provide a market analysis with confidence score.',
  'scan': 'I can help scan and parse your logbook! Please upload a photo or PDF of your vehicle registration book (logbook), insurance papers, or police clearance. I will extract all relevant data and auto-fill your vehicle profile.',
}

function getAIResponse(input: string): string {
  const lower = input.toLowerCase()
  for (const [key, response] of Object.entries(aiResponses)) {
    if (lower.includes(key)) return response
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('mhoroi')) {
    return 'Mhoroi! Welcome to CarUp. I am Gutu AI, your automotive assistant. I can help with vehicle valuations, service scheduling, document scanning, fraud detection, and much more. What would you like to know?'
  }
  if (lower.includes('fraud') || lower.includes('scam')) {
    return 'CarUp uses multiple layers of fraud detection:\n\n- **VIN Verification**: Cross-referenced with manufacturer databases\n- **Document Authenticity**: AI-powered forgery detection on logbooks and certificates\n- **Ownership Chain**: Blockchain-verified ownership history\n- **PartSentry**: Tracks part replacements to detect accident concealment\n- **Price Analysis**: Flags listings priced significantly above or below market value\n\nCurrent fraud detection rate: **98.7%**'
  }
  if (lower.includes('partsentry') || lower.includes('part')) {
    return 'PartSentry is CarUp\'s blockchain-backed parts tracking system. Every part replacement is recorded with:\n- What changed, who changed it, when and why\n- Mechanic and supplier information\n- Warranty data and part origin\- Before/after service records\n\nThis creates an immutable record that increases resale value, prevents fraud, and helps insurance claims.'
  }
  return 'That\'s a great question! I can help with that. To give you the most accurate answer, could you provide a few more details? Alternatively, I can connect you with a specialist or search our knowledge base for more information.'
}

export default function AIDashboard() {
  const [messages, setMessages] = useState<ChatMessage[]>(gutuWelcomeMessages)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const sendMessage = () => {
    if (!input.trim()) return
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: input, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setTyping(true)
    setTimeout(() => {
      const response = getAIResponse(userMsg.content)
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: response, timestamp: new Date().toISOString() }
      setMessages(prev => [...prev, aiMsg])
      setTyping(false)
    }, 1200)
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Gutu AI
              <Badge className="bg-purple-100 text-purple-700 text-[10px]">BETA</Badge>
            </h1>
            <p className="text-xs text-gray-500">Your personal automotive intelligence assistant</p>
          </div>
        </div>
      </div>

      <Card className="flex-1 border-0 card-shadow flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  msg.role === 'assistant' ? 'bg-gradient-to-br from-purple-500 to-indigo-600' : 'bg-orange-500'
                }`}>
                  {msg.role === 'assistant' ? <Sparkles className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-white" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'assistant' ? 'bg-gray-100 text-gray-800' : 'bg-orange-500 text-white'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="bg-gray-100 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {messages.length === 1 && (
          <div className="px-4 pb-2">
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-orange-50 hover:text-orange-700 rounded-full text-xs transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" className="shrink-0"><Image className="w-5 h-5 text-gray-400" /></Button>
            <Input
              placeholder="Ask Gutu AI anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              className="flex-1"
            />
            <Button onClick={sendMessage} disabled={!input.trim()} className="bg-orange-500 hover:bg-orange-600 shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-400 text-center mt-2">Gutu AI can make mistakes. Always verify important information.</p>
        </div>
      </Card>
    </div>
  )
}