// @ts-nocheck
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Card, CardContent } from '@/components/ui/card'
import { Car, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

export default function OTPVerification() {
  const [otp, setOtp] = useState('')
  const [timer, setTimer] = useState(60)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000)
      return () => clearInterval(interval)
    }
  }, [timer])

  const handleVerify = () => {
    if (otp.length !== 6) return
    setVerifying(true)
    setTimeout(() => {
      setVerifying(false)
      toast.success('Phone number verified!')
      window.location.href = '/kyc'
    }, 1500)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">Car<span className="text-orange-500">Up</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Verify Your Phone</h1>
          <p className="text-gray-400">Enter the 6-digit code sent to +263 7XX XXX XXX</p>
        </div>
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 text-center">
            <div className="flex justify-center mb-6">
              <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map(i => (
                    <InputOTPSlot key={i} index={i} className="w-12 h-14 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button onClick={handleVerify} className="w-full bg-orange-500 hover:bg-orange-600 mb-4" disabled={otp.length !== 6 || verifying}>
              {verifying ? 'Verifying...' : 'Verify'} <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-sm text-gray-500">
              {timer > 0 ? `Resend code in ${timer}s` : (
                <button onClick={() => setTimer(60)} className="text-orange-600 hover:underline">Resend code</button>
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}