/** RX03-P2-R4 — Gutu voice capability boundary: explicit states, editable transcript, no auto-submit. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { GUTU_LANGUAGES, useGutuVoice } from './gutuVoice'

type Handler = ((e: unknown) => void) | null
class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''; interimResults = false; continuous = false; maxAlternatives = 1
  onresult: Handler = null; onerror: Handler = null; onend: (() => void) | null = null
  start = vi.fn(); stop = vi.fn(() => this.onend?.()); abort = vi.fn()
  constructor() { FakeRecognition.last = this }
}
afterEach(() => { delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition; FakeRecognition.last = null })

describe('useGutuVoice', () => {
  it('only English offers voice; chiShona and isiNdebele are typed-only and say so', () => {
    expect(GUTU_LANGUAGES.map(l => [l.code, l.speechTags.length > 0])).toEqual([['en', true], ['sn', false], ['nd', false]])
    for (const l of GUTU_LANGUAGES.filter(x => x.code !== 'en')) expect(l.capability).toMatch(/not available yet/)
  })
  it('an unsupported browser is told to type instead', () => {
    const { result } = renderHook(() => useGutuVoice('en', () => {}))
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.state).toBe('unsupported')
    expect(result.current.message).toMatch(/Type your request instead/)
  })
  it('hands the heard words to the editor and never submits; Stop ends in "heard"', () => {
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
    const heard: string[] = []
    const { result } = renderHook(() => useGutuVoice('en', t => heard.push(t)))
    act(() => result.current.start())
    expect(result.current.state).toBe('listening')
    expect(FakeRecognition.last!.lang).toBe('en-ZA')
    act(() => FakeRecognition.last!.onresult!({ results: [[{ transcript: 'a white Toyota' }]] }))
    act(() => result.current.stop())
    expect(heard.at(-1)).toBe('a white Toyota')
    expect(result.current.state).toBe('heard')
  })
  it('permission refusal and silence are distinct, explained states', () => {
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
    const { result } = renderHook(() => useGutuVoice('en', () => {}))
    act(() => result.current.start())
    act(() => { FakeRecognition.last!.onerror!({ error: 'not-allowed' }); FakeRecognition.last!.onend!() })
    expect(result.current.state).toBe('denied')
    act(() => result.current.start())
    act(() => FakeRecognition.last!.onend!())
    expect(result.current.state).toBe('no-speech')
  })
  it('an unsupported regional tag falls back to the next English tag', () => {
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
    const { result } = renderHook(() => useGutuVoice('en', () => {}))
    act(() => result.current.start())
    act(() => FakeRecognition.last!.onerror!({ error: 'language-not-supported' }))
    expect(FakeRecognition.last!.lang).toBe('en-GB')
    expect(result.current.state).toBe('listening')
  })
  it('chiShona never starts the recogniser', () => {
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
    const { result } = renderHook(() => useGutuVoice('sn', () => {}))
    act(() => result.current.start())
    expect(FakeRecognition.last).toBeNull()
    expect(result.current.state).toBe('language-unavailable')
  })
})
