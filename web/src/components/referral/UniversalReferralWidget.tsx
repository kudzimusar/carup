import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Share2, Copy, CheckCircle2, Download, MessageCircle, Send } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export function UniversalReferralWidget() {
  const { getReferralSummary } = useCarUpApi()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let mounted = true
    const fetchSummary = async () => {
      try {
        const res = await getReferralSummary()
        if (mounted && res.success) {
          setSummary(res.summary)
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load referral summary')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    fetchSummary()
    return () => { mounted = false }
  }, [getReferralSummary])

  if (loading) return <div className="p-4 text-center text-gray-500 animate-pulse">Loading referral details...</div>
  if (error) return <div className="p-4 text-center text-red-500 bg-red-50 rounded-lg">{error}</div>
  if (!summary?.permanent_code) return null

  const code = summary.permanent_code.code
  const shareUrl = `${window.location.origin}/r/${code}`
  const shareText = `Join CarUp using my referral code ${code}!`

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join CarUp', text: shareText, url: shareUrl })
      } catch (err) {
        // user aborted or error
      }
    } else {
      handleCopy()
    }
  }

  const handleDownloadQR = () => {
    const svg = document.getElementById('referral-qr-code')
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `CarUp_Referral_QR_${code}.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const w = summary.wallet_totals

  return (
    <div className="space-y-6">
      {/* Code & Actions */}
      <Card className="overflow-hidden border-indigo-100 shadow-sm bg-gradient-to-br from-indigo-50/50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
            
            {/* QR Section */}
            <div className="flex flex-col items-center space-y-4 shrink-0">
              <div className="p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                <QRCodeSVG
                  id="referral-qr-code"
                  value={shareUrl}
                  size={160}
                  level="H"
                  includeMargin={false}
                  title="Your Referral QR Code"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleDownloadQR} className="w-full">
                <Download className="w-4 h-4 mr-2" /> Download QR
              </Button>
            </div>

            {/* Link & Social Section */}
            <div className="flex-1 w-full space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Your Personal Referral Link</h3>
                <p className="text-sm text-gray-500 mb-4">Share this link with friends. When they join and transact, you both earn rewards.</p>
                
                <div className="flex gap-2">
                  <Input readOnly value={shareUrl} className="bg-white text-gray-600 font-mono text-sm" />
                  <Button onClick={handleCopy} variant={copied ? "default" : "secondary"} className="shrink-0">
                    {copied ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700">Quick Share</p>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    variant="outline" 
                    className="bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 border-transparent"
                    onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`, '_blank')}
                  >
                    <MessageCircle className="w-4 h-4 mr-2" /> WhatsApp
                  </Button>
                  <Button 
                    variant="outline"
                    className="bg-[#0088cc]/10 text-[#0088cc] hover:bg-[#0088cc]/20 border-transparent"
                    onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank')}
                  >
                    <Send className="w-4 h-4 mr-2" /> Telegram
                  </Button>
                  {typeof navigator !== 'undefined' && 'share' in navigator && (
                    <Button variant="secondary" onClick={handleNativeShare}>
                      <Share2 className="w-4 h-4 mr-2" /> Share Options
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-gray-500">Pending</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">${w?.pending_balance || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-gray-500">Approved</p>
            <p className="text-2xl font-bold text-green-600 mt-1">${(w?.approved_balance || 0) + (w?.payable_balance || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-gray-500">Settled</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">${w?.paid_or_applied_balance || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stats & Campaigns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <h4 className="font-semibold mb-2">Network</h4>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600">Referred Users</span>
              <span className="font-medium">{summary.referred_user_count || 0}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h4 className="font-semibold mb-2">Active Campaigns</h4>
            {summary.active_campaigns && summary.active_campaigns.length > 0 ? (
              <ul className="space-y-2">
                {summary.active_campaigns.map((c: any) => (
                  <li key={c.id} className="text-sm flex justify-between">
                    <span className="text-gray-700">{c.name}</span>
                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">Active</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">No active campaigns.</p>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
