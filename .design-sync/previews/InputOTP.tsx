import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot, Label } from '@carup/design-system'

const noop = () => {}

export const Default = () => (
  <div className="grid gap-2">
    <Label htmlFor="otp-filled">Verification code</Label>
    <InputOTP id="otp-filled" maxLength={6} value="482193" onChange={noop}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  </div>
)

export const WithHelperText = () => (
  <div className="grid gap-2">
    <Label htmlFor="otp-whatsapp">Enter the code we sent on WhatsApp</Label>
    <InputOTP id="otp-whatsapp" maxLength={6} value="48" onChange={noop}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
    <p className="text-sm text-muted-foreground">Sent to +263 77 *** 4567. The code expires in 10 minutes.</p>
  </div>
)

export const FourDigitPin = () => (
  <div className="grid gap-2">
    <Label htmlFor="otp-handover">Handover PIN</Label>
    <InputOTP id="otp-handover" maxLength={4} value="" onChange={noop}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
        <InputOTPSlot index={3} />
      </InputOTPGroup>
    </InputOTP>
    <p className="text-sm text-muted-foreground">The buyer reads this PIN to you when collecting the vehicle.</p>
  </div>
)

export const Disabled = () => (
  <div className="grid gap-2">
    <Label htmlFor="otp-locked">Verification code</Label>
    <InputOTP id="otp-locked" maxLength={6} value="" onChange={noop} disabled>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
    <p className="text-sm text-muted-foreground">Too many attempts. Request a new code in 5 minutes.</p>
  </div>
)
