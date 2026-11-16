/**
 * RX03-P2-R4 — Gutu AI language and browser-voice capability boundary.
 *
 * What is real today (and what is not):
 *  - Typed requests in any language reach the same deterministic parser; it recognises
 *    language-neutral facts (make, model, prices, towns) and the English vocabulary it was
 *    built from. No translation happens anywhere.
 *  - Voice uses the BROWSER's own speech service (Web Speech API). CarUp runs no speech model
 *    and pays no provider. In Chrome that service sends audio to Google; Safari uses Apple's.
 *  - Voice is offered for English only. chiShona and isiNdebele recognition and understanding
 *    have not been verified on any provider or device, so the UI never offers or claims them —
 *    governed multilingual speech and translation are RX-04 R4-08.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type GutuLanguage = 'en' | 'sn' | 'nd'

export interface GutuLanguageInfo {
  code: GutuLanguage
  /** Name in the language itself (the selector shows these). */
  label: string
  /** BCP-47 tags tried in order for the browser recogniser; empty = voice not offered. */
  speechTags: string[]
  /** Plain statement of what Gutu can do with this language today. */
  capability: string
}

export const GUTU_LANGUAGES: ReadonlyArray<GutuLanguageInfo> = [
  {
    code: 'en',
    label: 'English',
    speechTags: ['en-ZA', 'en-GB', 'en-US'],
    capability: 'Type or speak. Gutu understands makes, models, body styles, fuel, gearbox, colour, budget and town.',
  },
  {
    code: 'sn',
    label: 'chiShona',
    speechTags: [],
    capability: 'Type in chiShona. Gutu recognises car names, prices and towns in any language; it does not yet understand or translate other chiShona words. Voice in chiShona is not available yet.',
  },
  {
    code: 'nd',
    label: 'isiNdebele',
    speechTags: [],
    capability: 'Type in isiNdebele. Gutu recognises car names, prices and towns in any language; it does not yet understand or translate other isiNdebele words. Voice in isiNdebele is not available yet.',
  },
]

export function gutuLanguage(code: GutuLanguage): GutuLanguageInfo {
  return GUTU_LANGUAGES.find(l => l.code === code) ?? GUTU_LANGUAGES[0]
}

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'heard'
  | 'unsupported'
  | 'language-unavailable'
  | 'denied'
  | 'no-speech'
  | 'error'

/** What the person is told for each voice state (never an AI or provider claim). */
export const VOICE_MESSAGES: Record<VoiceState, string> = {
  idle: '',
  listening: 'Listening… speak now, then tap Stop.',
  heard: 'This is what your browser heard. Correct anything that is wrong, then ask Gutu.',
  unsupported: 'Voice input is not supported in this browser. Type your request instead.',
  'language-unavailable': 'Voice is not available in this language yet. Type your request instead.',
  denied: 'Microphone access was refused. Allow it in your browser settings, or type your request instead.',
  'no-speech': 'Gutu did not hear anything. Tap Speak to try again, or type instead.',
  error: 'The browser speech service is unavailable right now. Type your request instead.',
}

type RecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}
type RecognitionCtor = new () => Recognition

export function speechRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/**
 * Browser speech capture with explicit states. The transcript is handed to `onTranscript` for
 * the person to EDIT; nothing is submitted automatically.
 */
export function useGutuVoice(language: GutuLanguage, onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const recRef = useRef<Recognition | null>(null)
  const heardRef = useRef('')
  const tagIndexRef = useRef(0)
  const info = gutuLanguage(language)
  const supported = speechRecognitionCtor() !== null
  const available = supported && info.speechTags.length > 0

  useEffect(() => () => { recRef.current?.abort() }, [])
  useEffect(() => {
    recRef.current?.abort()
    recRef.current = null
    setState('idle')
  }, [language])

  const startWith = useCallback((tagIndex: number) => {
    const Ctor = speechRecognitionCtor()
    if (!Ctor) { setState('unsupported'); return }
    const tag = info.speechTags[tagIndex]
    if (!tag) { setState('language-unavailable'); return }
    const rec = new Ctor()
    rec.lang = tag
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    heardRef.current = ''
    tagIndexRef.current = tagIndex
    let failed = false
    rec.onresult = event => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0]?.transcript ?? ''
      heardRef.current = text.trim()
      if (heardRef.current) onTranscript(heardRef.current)
    }
    rec.onerror = event => {
      failed = true
      const code = event?.error ?? ''
      if (code === 'language-not-supported' && tagIndex + 1 < info.speechTags.length) {
        startWith(tagIndex + 1)
        return
      }
      setState(
        code === 'not-allowed' || code === 'service-not-allowed' ? 'denied'
        : code === 'no-speech' ? 'no-speech'
        : code === 'aborted' ? 'idle'
        : code === 'language-not-supported' ? 'language-unavailable'
        : 'error',
      )
    }
    rec.onend = () => {
      if (recRef.current !== rec) return
      recRef.current = null
      if (failed) return
      setState(heardRef.current ? 'heard' : 'no-speech')
    }
    recRef.current = rec
    setState('listening')
    try { rec.start() } catch { setState('error') }
  }, [info.speechTags, onTranscript])

  const start = useCallback(() => {
    if (!supported) { setState('unsupported'); return }
    if (!available) { setState('language-unavailable'); return }
    startWith(0)
  }, [supported, available, startWith])

  const stop = useCallback(() => { recRef.current?.stop() }, [])

  return { state, supported, available, start, stop, message: VOICE_MESSAGES[state] }
}
