import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Ticket } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import ReferralEventLog from '@/components/referral/ReferralEventLog'
import ReferralRealList from '@/components/referral/ReferralRealList'
import type {
  ReferralCodeType,
  ReferralCouponDiscountType,
  ReferralCode,
  ReferralCoupon,
} from '@/types/referral'

/**
 * Admin Codes & Coupons (/admin/referrals/codes). Creates referral codes and
 * coupons, validates codes, applies/redeems coupons, and generates share assets.
 * There is no GET-list endpoint for codes/coupons yet — recent activity is shown
 * from the real event log (ReferralEventLog), never fabricated rows.
 */

const CODE_TYPES: ReferralCodeType[] = ['MEMBER', 'CAMPAIGN', 'COUPON', 'GROUP', 'AGENT']
const DISCOUNT_TYPES: ReferralCouponDiscountType[] = ['FIXED', 'PERCENT', 'SERVICE_CREDIT']

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export default function ReferralCodes() {
  const {
    createReferralCode,
    validateReferralCode,
    createReferralCoupon,
    applyReferralCoupon,
    redeemReferralCoupon,
    createReferralShareAssets,
    listReferralCodes,
    listReferralCoupons,
  } = useCarUpApi()

  const loadCodes = useCallback(async () => {
    const res = await listReferralCodes({ limit: 50 })
    return { items: res.codes ?? [], pagination: res.pagination }
  }, [listReferralCodes])
  const loadCoupons = useCallback(async () => {
    const res = await listReferralCoupons({ limit: 50 })
    return { items: res.coupons ?? [], pagination: res.pagination }
  }, [listReferralCoupons])

  // Create code
  const [codeType, setCodeType] = useState<ReferralCodeType>('MEMBER')
  const [codeValue, setCodeValue] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [codeMsg, setCodeMsg] = useState<string | null>(null)

  // Validate code
  const [validateCode, setValidateCode] = useState('')
  const [validateMsg, setValidateMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Coupon
  const [couponCode, setCouponCode] = useState('')
  const [discountType, setDiscountType] = useState<ReferralCouponDiscountType>('FIXED')
  const [discountValue, setDiscountValue] = useState('')
  const [couponMsg, setCouponMsg] = useState<string | null>(null)

  // Apply / redeem
  const [applyCode, setApplyCode] = useState('')
  const [applyAmount, setApplyAmount] = useState('')
  const [applyMsg, setApplyMsg] = useState<string | null>(null)
  const [redeemUserId, setRedeemUserId] = useState('')
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null)

  // Share assets
  const [shareCode, setShareCode] = useState('')
  const [sharePayload, setSharePayload] = useState<Record<string, unknown> | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)

  const onCreateCode = useCallback(async () => {
    try {
      const res = await createReferralCode({
        code_type: codeType,
        ...(codeValue.trim() ? { code: codeValue.trim() } : {}),
        ...(campaignId.trim() ? { campaign_id: campaignId.trim() } : {}),
      })
      setCodeMsg(`Code created: ${res.code?.code ?? '(generated)'}`)
      setCodeValue('')
    } catch (err) {
      setCodeMsg(err instanceof Error ? err.message : 'Could not create code.')
    }
  }, [codeType, codeValue, campaignId, createReferralCode])

  const onValidate = useCallback(async () => {
    if (!validateCode.trim()) {
      setValidateMsg({ ok: false, text: 'Enter a code.' })
      return
    }
    try {
      const res = await validateReferralCode({ code: validateCode.trim() })
      setValidateMsg(res.valid ? { ok: true, text: 'Code is valid.' } : { ok: false, text: res.reason ? str(res.reason) : 'Code is not valid.' })
    } catch (err) {
      setValidateMsg({ ok: false, text: err instanceof Error ? err.message : 'Validation failed.' })
    }
  }, [validateCode, validateReferralCode])

  const onCreateCoupon = useCallback(async () => {
    try {
      const res = await createReferralCoupon({
        discount_type: discountType,
        ...(discountValue.trim() ? { discount_value: Number(discountValue) } : {}),
        ...(couponCode.trim() ? { code: couponCode.trim() } : {}),
      })
      setCouponMsg(`Coupon created: ${res.coupon?.code ?? '(generated)'}`)
      setCouponCode('')
      setDiscountValue('')
    } catch (err) {
      setCouponMsg(err instanceof Error ? err.message : 'Could not create coupon.')
    }
  }, [discountType, discountValue, couponCode, createReferralCoupon])

  const onApply = useCallback(async () => {
    if (!applyCode.trim()) {
      setApplyMsg('Enter a coupon code.')
      return
    }
    try {
      const res = await applyReferralCoupon({ code: applyCode.trim(), order_amount: Number(applyAmount || 0) })
      setApplyMsg(res.applied ? `Applied. Discount: ${str(res.discount_amount)}` : `Not applied: ${str(res.reason)}`)
    } catch (err) {
      setApplyMsg(err instanceof Error ? err.message : 'Apply failed.')
    }
  }, [applyCode, applyAmount, applyReferralCoupon])

  const onRedeem = useCallback(async () => {
    if (!applyCode.trim() || !redeemUserId.trim()) {
      setRedeemMsg('Coupon code and redeemer user id are required.')
      return
    }
    try {
      const res = await redeemReferralCoupon({ code: applyCode.trim(), redeemer_user_id: redeemUserId.trim(), order_amount: Number(applyAmount || 0) })
      setRedeemMsg(res.redeemed ? 'Coupon redeemed.' : `Not redeemed: ${str(res.reason)}`)
    } catch (err) {
      setRedeemMsg(err instanceof Error ? err.message : 'Redeem failed.')
    }
  }, [applyCode, applyAmount, redeemUserId, redeemReferralCoupon])

  const onShare = useCallback(async () => {
    if (!shareCode.trim()) {
      setShareMsg('Enter a code to generate share assets.')
      setSharePayload(null)
      return
    }
    setShareMsg(null)
    try {
      const res = await createReferralShareAssets({ code: shareCode.trim() })
      const payload = (res.shareAsset?.payload ?? res.shareAsset ?? {}) as Record<string, unknown>
      setSharePayload(payload)
    } catch (err) {
      setSharePayload(null)
      setShareMsg(err instanceof Error ? err.message : 'Could not generate share assets.')
    }
  }, [shareCode, createReferralShareAssets])

  const barcodeSvg = sharePayload && typeof sharePayload.barcode_svg === 'string' ? sharePayload.barcode_svg : null

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <Ticket className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Codes &amp; Coupons</h1>
          <p className="text-gray-500">Create codes/coupons, validate, apply, redeem, and generate share assets</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Create code */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Create Referral Code</h2>
            <select value={codeType} onChange={(e) => setCodeType(e.target.value as ReferralCodeType)} className="w-full border border-gray-200 rounded-md h-9 px-3 text-sm">
              {CODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input placeholder="Custom code (optional — auto-generated if blank)" value={codeValue} onChange={(e) => setCodeValue(e.target.value)} />
            <Input placeholder="Campaign id (optional)" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onCreateCode}>Create Code</Button>
            {codeMsg && <p className="text-sm text-gray-600">{codeMsg}</p>}
          </CardContent>
        </Card>

        {/* Validate */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Validate Code</h2>
            <Input placeholder="Code to validate" value={validateCode} onChange={(e) => setValidateCode(e.target.value)} />
            <Button variant="outline" onClick={onValidate}>Validate</Button>
            {validateMsg && <p className={`text-sm ${validateMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{validateMsg.text}</p>}
          </CardContent>
        </Card>

        {/* Create coupon */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Create Coupon</h2>
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as ReferralCouponDiscountType)} className="w-full border border-gray-200 rounded-md h-9 px-3 text-sm">
              {DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input type="number" placeholder="Discount value" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            <Input placeholder="Custom coupon code (optional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onCreateCoupon}>Create Coupon</Button>
            {couponMsg && <p className="text-sm text-gray-600">{couponMsg}</p>}
          </CardContent>
        </Card>

        {/* Apply / redeem */}
        <Card className="border-0 card-shadow">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Apply / Redeem Coupon</h2>
            <Input placeholder="Coupon code" value={applyCode} onChange={(e) => setApplyCode(e.target.value)} />
            <Input type="number" placeholder="Order amount" value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={onApply}>Apply</Button>
            </div>
            {applyMsg && <p className="text-sm text-gray-600">{applyMsg}</p>}
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <Input placeholder="Redeemer user id" value={redeemUserId} onChange={(e) => setRedeemUserId(e.target.value)} />
              <Button variant="outline" onClick={onRedeem}>Redeem for user</Button>
              {redeemMsg && <p className="text-sm text-gray-600">{redeemMsg}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Share assets */}
      <Card className="border-0 card-shadow">
        <CardContent className="p-6 space-y-3">
          <h2 className="font-semibold">Generate Share Assets</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="Code to generate assets for" value={shareCode} onChange={(e) => setShareCode(e.target.value)} className="sm:max-w-xs" />
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={onShare}>Generate</Button>
          </div>
          {shareMsg && <p className="text-sm text-gray-600">{shareMsg}</p>}
          {sharePayload && (
            <div className="space-y-2 text-sm">
              {(['short_referral_url', 'whatsapp_share_url', 'telegram_start_url', 'social_campaign_url'] as const).map((key) =>
                typeof sharePayload[key] === 'string' ? (
                  <div key={key} className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0">{key}</Badge>
                    <a href={str(sharePayload[key])} target="_blank" rel="noreferrer" className="text-orange-600 underline truncate">{str(sharePayload[key])}</a>
                  </div>
                ) : null
              )}
              {typeof sharePayload.qr_payload === 'string' && (
                <div>
                  <Badge variant="outline" className="text-[10px]">qr_payload</Badge>
                  <pre className="mt-1 bg-gray-50 rounded p-2 text-xs overflow-auto">{str(sharePayload.qr_payload)}</pre>
                  <p className="text-[11px] text-gray-400">QR content shown as text (no QR image library added yet).</p>
                </div>
              )}
              {barcodeSvg && (
                <div>
                  <Badge variant="outline" className="text-[10px]">barcode</Badge>
                  <img alt="barcode" src={`data:image/svg+xml;utf8,${encodeURIComponent(barcodeSvg)}`} className="mt-1 max-w-xs border border-gray-100 rounded bg-white p-2" />
                </div>
              )}
              {typeof sharePayload.poster_text === 'string' && (
                <div>
                  <Badge variant="outline" className="text-[10px]">poster_text</Badge>
                  <pre className="mt-1 bg-gray-50 rounded p-2 text-xs whitespace-pre-wrap">{str(sharePayload.poster_text)}</pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ReferralRealList
        title="Referral Codes"
        load={loadCodes}
        emptyText="No referral codes yet — create one above."
        renderRow={(c: ReferralCode) => (
          <div key={c.id} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
            <span className="font-mono">{c.code}</span>
            <span className="text-gray-500">{[c.code_type, c.status].filter(Boolean).join(' · ')}</span>
            <span className="text-gray-400">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
          </div>
        )}
      />
      <ReferralRealList
        title="Coupons"
        load={loadCoupons}
        emptyText="No coupons yet — create one above."
        renderRow={(c: ReferralCoupon) => (
          <div key={c.id} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
            <span className="font-mono">{c.code}</span>
            <span className="text-gray-500">{[c.discount_type, c.discount_value].filter((v) => v !== undefined && v !== null).join(' · ')}</span>
            <span className="text-gray-400">{c.status}</span>
          </div>
        )}
      />
      <ReferralEventLog title="Audit activity (event log)" />
    </div>
  )
}
