import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FocusedShell,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@carup/design-system'

const noop = () => {}

export const SignIn = () => (
  <FocusedShell identity={{ displayName: 'Visitor', roleTitle: 'Visitor' }} title="Sign in to CarUp" onExit={noop}>
    <p className="mt-2 text-[13px] text-carup-text-2">Use the email or phone number on your CarUp account.</p>
    <form className="mt-6" onSubmit={(e) => e.preventDefault()}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="signin-identifier">Email or phone</FieldLabel>
          <Input id="signin-identifier" placeholder="tendai@email.co.zw or +263 77 123 4567" autoComplete="email" />
        </Field>
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="signin-password">Password</FieldLabel>
            <Button variant="link" size="sm" type="button" className="h-auto px-0">Forgot password?</Button>
          </div>
          <Input id="signin-password" type="password" placeholder="Enter your password" autoComplete="current-password" />
        </Field>
        <Button type="submit" className="w-full">Sign in</Button>
        <FieldSeparator>New to CarUp?</FieldSeparator>
        <Button variant="outline" type="button" className="w-full">Create an account</Button>
      </FieldGroup>
    </form>
  </FocusedShell>
)

export const RegistrationStep = () => (
  <FocusedShell
    identity={{ displayName: 'Visitor', roleTitle: 'Visitor' }}
    title="Confirm your phone number"
    stepLabel="Step 2 of 3"
    progress={66}
    onBack={noop}
    onExit={noop}
  >
    <p className="mt-4 text-[13px] text-carup-text-2">
      We sent a 6-digit code by WhatsApp to +263 77 123 4567. Enter it to continue creating your CarUp account.
    </p>
    <form className="mt-6" onSubmit={(e) => e.preventDefault()}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="otp">Verification code</FieldLabel>
          <InputOTP id="otp" maxLength={6} value="4821" onChange={noop}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <FieldDescription>Didn't get it? You can request a new code in 0:42.</FieldDescription>
        </Field>
        <Button type="submit" className="w-full">Continue</Button>
      </FieldGroup>
    </form>
  </FocusedShell>
)
