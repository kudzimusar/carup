import { useRef, useState } from 'react'
import { MapPin, Mic, Paperclip, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCommunicationProductApi } from '@/hooks/useCommunicationProductApi'

type Props = {
  threadId: string
  caption: string
  disabled?: boolean
  onSent: () => void | Promise<void>
  onStatus: (message: string | null) => void
}

export function CommunicationMultimodalComposer({ threadId, caption, disabled, onSent, onStatus }: Props) {
  const { uploadMedia, sendLocation } = useCommunicationProductApi()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)

  async function upload(file: File, capture?: string) {
    setBusy(true)
    onStatus('Uploading securely…')
    try {
      await uploadMedia(threadId, file, caption.trim(), capture || null)
      onStatus('Media sent through the canonical CarUp conversation.')
      await onSent()
    } catch (err) {
      onStatus(err instanceof Error ? err.message : 'Secure media upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function chooseFile(file: File | null) {
    if (!file) return
    await upload(file, 'file')
  }

  async function shareLocation() {
    if (!navigator.geolocation) {
      onStatus('Location sharing is not available in this browser.')
      return
    }
    setBusy(true)
    onStatus('Getting your location…')
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await sendLocation(threadId, position.coords.latitude, position.coords.longitude, 'Shared location')
          onStatus('Location sent through CarUp.')
          await onSent()
        } catch (err) {
          onStatus(err instanceof Error ? err.message : 'Could not send location')
        } finally {
          setBusy(false)
        }
      },
      (error) => {
        setBusy(false)
        onStatus(error.message || 'Location permission was not granted.')
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    )
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onStatus('Voice recording is not supported in this browser. You can attach an audio file instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const preferred = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const type = (recorder.mimeType || 'audio/webm').split(';')[0]
        const blob = new Blob(chunksRef.current, { type })
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        setRecording(false)
        if (!blob.size) {
          onStatus('Voice recording was empty.')
          return
        }
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type })
        await upload(file, 'voice_note')
      }
      recorder.start(500)
      setRecording(true)
      onStatus('Recording voice note…')
    } catch (err) {
      onStatus(err instanceof Error ? err.message : 'Microphone permission was not granted.')
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/*,audio/*,video/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx"
        onChange={(event) => void chooseFile(event.target.files?.[0] || null)}
      />
      <Button type="button" size="sm" variant="outline" disabled={disabled || busy || recording} onClick={() => fileRef.current?.click()}>
        <Paperclip className="mr-1 h-4 w-4" /> Attach
      </Button>
      <Button
        type="button"
        size="sm"
        variant={recording ? 'destructive' : 'outline'}
        disabled={disabled || busy}
        onClick={() => recording ? stopRecording() : void startRecording()}
      >
        {recording ? <Square className="mr-1 h-4 w-4" /> : <Mic className="mr-1 h-4 w-4" />}
        {recording ? 'Stop' : 'Voice'}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={disabled || busy || recording} onClick={() => void shareLocation()}>
        <MapPin className="mr-1 h-4 w-4" /> Location
      </Button>
      {busy && <span className="text-xs text-gray-500">Working…</span>}
    </div>
  )
}
