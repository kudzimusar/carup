import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Upload, X, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { TimelineEvent, VehicleEvidence } from '@/types'

const uploadRoleMatrix: Record<string, string[]> = {
  import_photo: ['government', 'admin', 'dealer'],
  auction_photo: ['dealer', 'admin'],
  customs_photo: ['government', 'admin', 'dealer'],
  inspection_photo: ['government', 'admin', 'dealer'],
  odometer_photo: ['owner', 'dealer', 'admin', 'mechanic'],
  damage_photo: ['owner', 'dealer', 'admin', 'mechanic', 'insurance'],
  repair_photo: ['mechanic', 'owner', 'dealer', 'admin'],
  dealer_listing_photo: ['dealer', 'admin'],
  owner_handover_photo: ['owner', 'dealer', 'admin'],
  registration_document: ['owner', 'dealer', 'admin', 'government'],
  insurance_document: ['owner', 'dealer', 'admin', 'government', 'insurance'],
  police_clearance_document: ['government', 'admin'],
  ownership_transfer_document: ['owner', 'dealer', 'admin', 'government']
}

const evidenceTypeLabels: Record<string, string> = {
  import_photo: 'Import Photo',
  auction_photo: 'Auction Photo',
  customs_photo: 'Customs Photo',
  inspection_photo: 'Inspection Photo',
  odometer_photo: 'Odometer Photo',
  damage_photo: 'Damage Photo',
  repair_photo: 'Repair Photo',
  dealer_listing_photo: 'Dealer Listing Photo',
  owner_handover_photo: 'Owner Handover Photo',
  registration_document: 'Registration Document (PDF/Image)',
  insurance_document: 'Insurance Document (PDF/Image)',
  police_clearance_document: 'Police Clearance Document',
  ownership_transfer_document: 'Ownership Transfer Document'
}

interface EvidenceUploadModalProps {
  isOpen: boolean
  onClose: () => void
  vin: string
  timelineEvents: TimelineEvent[]
  onSuccess: (evidence: VehicleEvidence) => void
}

export default function EvidenceUploadModal({
  isOpen,
  onClose,
  vin,
  timelineEvents,
  onSuccess
}: EvidenceUploadModalProps) {
  const { uploadEvidence, user } = useCarUpApi()
  const [loading, setLoading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Form states
  const [evidenceType, setEvidenceType] = useState<string>('')
  const [visibilityLevel, setVisibilityLevel] = useState<string>('public_safe')
  const [linkedEventId, setLinkedEventId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [capturedAt, setCapturedAt] = useState('')

  // File states
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filter allowed evidence types based on user role
  const userRole = user?.role || 'owner'
  const allowedEvidenceTypes = Object.keys(uploadRoleMatrix).filter((type) => {
    if (userRole === 'admin') return true
    return uploadRoleMatrix[type]?.includes(userRole)
  })

  const handleReset = () => {
    setEvidenceType('')
    setVisibilityLevel('public_safe')
    setLinkedEventId('')
    setNotes('')
    setCapturedAt('')
    setSelectedFile(null)
    setFileBase64(null)
    setUploadError(null)
  }

  const processFile = (file: File) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedMimeTypes.includes(file.type)) {
      setUploadError('Invalid file type. Supported types: JPEG, PNG, WEBP, PDF.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File is too large. Maximum allowed size is 10MB.')
      return
    }

    setSelectedFile(file)
    setUploadError(null)

    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setFileBase64(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true)
    } else if (e.type === 'dragleave') {
      setIsDragActive(false)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0])
    }
  }

  const handleTriggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setFileBase64(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!evidenceType) {
      setUploadError('Please select an evidence type.')
      return
    }
    if (!fileBase64) {
      setUploadError('Please select or drop a file to upload.')
      return
    }

    setLoading(true)
    setUploadError(null)

    try {
      const payload: any = {
        evidence_type: evidenceType,
        file: fileBase64,
        visibility_level: visibilityLevel,
        verification_notes: notes || undefined,
        captured_at: capturedAt ? new Date(capturedAt).toISOString() : undefined
      }

      if (linkedEventId) {
        payload.linked_registry_event_id = linkedEventId
      }

      const response = await uploadEvidence(vin, payload)
      onSuccess(response)
      handleReset()
      onClose()
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload evidence.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { handleReset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg card-shadow border-0 bg-white/95 backdrop-blur-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">Upload Vehicle Evidence</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Submit photographic or document proof for VIN: <span className="font-semibold text-orange-600">{vin}</span>. All uploads undergo verification before appearing on the public passport.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {uploadError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Evidence Type */}
          <div className="space-y-2">
            <Label htmlFor="evidence-type" className="font-medium text-gray-700">Evidence Category *</Label>
            <select
              id="evidence-type"
              className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value)}
              required
            >
              <option value="">-- Select Category --</option>
              {allowedEvidenceTypes.map((type) => (
                <option key={type} value={type}>
                  {evidenceTypeLabels[type] || type}
                </option>
              ))}
            </select>
          </div>

          {/* Drag & Drop File Upload */}
          <div className="space-y-2">
            <Label className="font-medium text-gray-700">File Attachment *</Label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
            />

            {!selectedFile ? (
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={handleTriggerFileSelect}
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all duration-200 ${
                  isDragActive
                    ? 'border-orange-500 bg-orange-50/50'
                    : 'border-gray-300 hover:border-orange-400 hover:bg-gray-50/50'
                }`}
              >
                <Upload className="w-10 h-10 text-gray-400 mb-2" />
                <p className="text-sm font-semibold text-gray-700">Drag & drop your file here, or click to browse</p>
                <p className="text-xs text-gray-500 mt-1">Supports JPEG, PNG, WEBP, and PDF up to 10MB</p>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-3 overflow-hidden">
                  {selectedFile.type === 'application/pdf' ? (
                    <FileText className="w-8 h-8 text-red-500 shrink-0" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-orange-500 shrink-0" />
                  )}
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-gray-800 truncate">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-gray-200 rounded-full"
                  onClick={handleRemoveFile}
                >
                  <X className="w-4 h-4 text-gray-500" />
                </Button>
              </div>
            )}
          </div>

          {/* Optional Linked Timeline Event */}
          {timelineEvents.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="linked-event" className="font-medium text-gray-700">Link to Timeline Event (Optional)</Label>
              <select
                id="linked-event"
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                value={linkedEventId}
                onChange={(e) => setLinkedEventId(e.target.value)}
              >
                <option value="">-- No Link --</option>
                {timelineEvents.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {new Date(evt.timestamp).toLocaleDateString()} - {evt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Visibility Request */}
          <div className="space-y-2">
            <Label htmlFor="visibility" className="font-medium text-gray-700">Requested Visibility *</Label>
            <select
              id="visibility"
              className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              value={visibilityLevel}
              onChange={(e) => setVisibilityLevel(e.target.value)}
              required
            >
              <option value="public_safe">Public (Visible to future buyers after verification)</option>
              <option value="restricted">Restricted (Visible to Dealers/Admin only)</option>
              <option value="private">Private (Only you can see this evidence)</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Note: Document categories default to Restricted or Private. Photos default to Public.
            </p>
          </div>

          {/* Capture Date */}
          <div className="space-y-2">
            <Label htmlFor="captured-at" className="font-medium text-gray-700">Date/Time Taken (Optional)</Label>
            <input
              id="captured-at"
              type="datetime-local"
              className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
            />
          </div>

          {/* Notes/Description */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="font-medium text-gray-700">Description / Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add details, context, or notes regarding this upload..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { handleReset(); onClose(); }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
              disabled={loading}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Evidence
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
