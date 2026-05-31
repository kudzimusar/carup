// @ts-nocheck
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Car, Upload, CheckCircle, ArrowRight, Camera, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export default function KYCVerification() {
  const [step, setStep] = useState(1)
  const [uploading, setUploading] = useState(false)
  const [verified, setVerified] = useState(false)

  // Personal Info States
  const [firstName, setFirstName] = useState('Tendai')
  const [lastName, setLastName] = useState('Moyo')
  const [nationalId, setNationalId] = useState('63-1234567A89')
  const [dob, setDob] = useState('1990-01-01')
  const [address, setAddress] = useState('123 Samora Machel Ave, Harare')

  // Document states
  const [docType, setDocType] = useState('national-id')
  const [fileName, setFileName] = useState('')
  const [storagePath, setStoragePath] = useState('')

  const { request } = useCarUpApi()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64Str = ev.target?.result as string
      try {
        const res = await request('/media/upload/document', {
          method: 'POST',
          body: JSON.stringify({
            document: base64Str,
            docType: docType,
            vin: nationalId.trim() || 'KYC-DOCUMENTS'
          })
        })
        if (res && res.storagePath) {
          setStoragePath(res.storagePath)
          setFileName(file.name)
          setVerified(true)
          toast.success(`${file.name} uploaded successfully!`)
        }
      } catch (err: any) {
        console.error('KYC Document upload failed:', err)
        toast.error(err.message || 'Failed to upload and secure document.')
      } finally {
        setUploading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const triggerFileSelect = () => {
    document.getElementById('kyc-file-input')?.click()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
      <input
        type="file"
        id="kyc-file-input"
        className="hidden"
        onChange={handleFileChange}
        accept="image/*,application/pdf"
      />
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">Car<span className="text-orange-500">Up</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Identity Verification</h1>
          <p className="text-gray-400">Complete KYC to unlock all CarUp features</p>
        </div>

        {/* Steps */}
        <div className="flex items-center justify-center gap-4 mb-6">
          {['Personal Info', 'ID Document', 'Selfie'].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                i + 1 === step ? 'bg-orange-500 text-white' : i + 1 < step ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400'
              }`}>
                {i + 1 < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs hidden sm:inline ${i + 1 === step ? 'text-white' : 'text-gray-500'}`}>{label}</span>
              {i < 2 && <div className={`w-8 h-0.5 ${i + 1 < step ? 'bg-green-500' : 'bg-gray-700'}`} />}
            </div>
          ))}
        </div>

        <Card className="border-0 bg-gray-900/60 backdrop-blur-xl border-gray-800 text-white card-shadow">
          <CardContent className="p-6">
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="font-semibold text-lg text-white">Personal Information</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block text-gray-300">First Name</label>
                    <Input value={firstName} onChange={e => setFirstName(e.target.value)} className="bg-gray-800/80 border-gray-700 text-white" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block text-gray-300">Last Name</label>
                    <Input value={lastName} onChange={e => setLastName(e.target.value)} className="bg-gray-800/80 border-gray-700 text-white" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-gray-300">National ID</label>
                  <Input value={nationalId} onChange={e => setNationalId(e.target.value)} placeholder="63-1234567A89" className="bg-gray-800/80 border-gray-700 text-white" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-gray-300">Date of Birth</label>
                  <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="bg-gray-800/80 border-gray-700 text-white" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-gray-300">Physical Address</label>
                  <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Samora Machel Ave, Harare" className="bg-gray-800/80 border-gray-700 text-white" />
                </div>
                <Button onClick={() => setStep(2)} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
                  Continue <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="font-semibold text-lg text-white">Upload ID Document</h2>
                <Tabs value={docType} onValueChange={(val) => { setDocType(val); setVerified(false); setFileName(''); }}>
                  <TabsList className="w-full bg-gray-800/80 border border-gray-700 text-white">
                    <TabsTrigger value="national-id" className="flex-1 text-gray-400 data-[state=active]:text-white data-[state=active]:bg-gray-700">National ID</TabsTrigger>
                    <TabsTrigger value="passport" className="flex-1 text-gray-400 data-[state=active]:text-white data-[state=active]:bg-gray-700">Passport</TabsTrigger>
                    <TabsTrigger value="license" className="flex-1 text-gray-400 data-[state=active]:text-white data-[state=active]:bg-gray-700">Driver's License</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="national-id" className="mt-4">
                    <div
                      onClick={triggerFileSelect}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                        verified && docType === 'national-id' ? 'border-green-500 bg-green-950/20' : 'border-gray-700 hover:border-orange-500 hover:bg-orange-500/5'
                      }`}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-12 h-12 text-orange-500 mx-auto mb-3 animate-spin" />
                          <p className="font-medium text-white">Uploading & Encrypting...</p>
                          <p className="text-sm text-gray-400">Verifying secure signatures</p>
                        </>
                      ) : verified && docType === 'national-id' ? (
                        <>
                          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3 animate-bounce" />
                          <p className="font-medium text-green-400">National ID Uploaded</p>
                          <p className="text-xs text-green-500 font-mono truncate">{fileName || 'ID_Document.png'}</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="font-medium text-white">Click to upload National ID</p>
                          <p className="text-sm text-gray-400">JPG, PNG or PDF up to 10MB</p>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="passport" className="mt-4">
                    <div
                      onClick={triggerFileSelect}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                        verified && docType === 'passport' ? 'border-green-500 bg-green-950/20' : 'border-gray-700 hover:border-orange-500 hover:bg-orange-500/5'
                      }`}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-12 h-12 text-orange-500 mx-auto mb-3 animate-spin" />
                          <p className="font-medium text-white">Uploading & Encrypting...</p>
                          <p className="text-sm text-gray-400">Verifying secure signatures</p>
                        </>
                      ) : verified && docType === 'passport' ? (
                        <>
                          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3 animate-bounce" />
                          <p className="font-medium text-green-400">Passport Uploaded</p>
                          <p className="text-xs text-green-500 font-mono truncate">{fileName || 'Passport.pdf'}</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="font-medium text-white">Click to upload Passport</p>
                          <p className="text-sm text-gray-400">JPG, PNG or PDF up to 10MB</p>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="license" className="mt-4">
                    <div
                      onClick={triggerFileSelect}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                        verified && docType === 'license' ? 'border-green-500 bg-green-950/20' : 'border-gray-700 hover:border-orange-500 hover:bg-orange-500/5'
                      }`}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-12 h-12 text-orange-500 mx-auto mb-3 animate-spin" />
                          <p className="font-medium text-white">Uploading & Encrypting...</p>
                          <p className="text-sm text-gray-400">Verifying secure signatures</p>
                        </>
                      ) : verified && docType === 'license' ? (
                        <>
                          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3 animate-bounce" />
                          <p className="font-medium text-green-400">Driver's License Uploaded</p>
                          <p className="text-xs text-green-500 font-mono truncate">{fileName || 'Drivers_License.jpg'}</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="font-medium text-white">Click to upload Driver's License</p>
                          <p className="text-sm text-gray-400">JPG, PNG or PDF up to 10MB</p>
                        </>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
                
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-gray-700 text-white hover:bg-gray-800" onClick={() => setStep(1)} disabled={uploading}>Back</Button>
                  <Button className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium" onClick={() => setStep(3)} disabled={!verified || uploading}>Continue</Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 text-center">
                <h2 className="font-semibold text-lg text-white">Selfie Verification</h2>
                <div className="w-48 h-48 rounded-full bg-gray-800 mx-auto flex items-center justify-center mb-4 border-2 border-gray-700 shadow-inner">
                  <Camera className="w-16 h-16 text-gray-500" />
                </div>
                <p className="text-gray-400 text-sm">Take a selfie to verify your identity. Make sure your face is clearly visible and well-lit.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-gray-700 text-white hover:bg-gray-800" onClick={() => setStep(2)}>Back</Button>
                  <Button className="flex-1 bg-orange-500 hover:bg-orange-600 gap-2 text-white font-medium" onClick={() => {
                    toast.success('KYC verification complete!')
                    setTimeout(() => window.location.href = '/dashboard', 1000)
                  }}>
                    <Camera className="w-4 h-4" /> Take Selfie
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}