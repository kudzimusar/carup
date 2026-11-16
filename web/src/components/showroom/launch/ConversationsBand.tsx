/**
 * RX03 Addendum 05 — Communication and confidence, with WhatsApp where it is genuinely available.
 *
 * Real WhatsApp journeys today (audit A3): (1) every listing's Share sheet opens WhatsApp with the
 * listing link and nothing private; (2) a buyer can choose WhatsApp as the reply channel on a CarUp
 * enquiry — the conversation stays attributed to the CarUp record (transactional consent only). Direct
 * seller WhatsApp numbers are not published, so this band never offers "chat to the seller".
 * The WhatsApp glyph is Simple Icons (CC0) via react-icons; it marks genuine WhatsApp actions only.
 */
import { Link } from 'react-router-dom'
import { BookOpen, Headphones, Share2 } from 'lucide-react'
import { SiWhatsapp } from 'react-icons/si'
import { AskCarUpMark } from './AskCarUpMark'

export function WhatsAppGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return <SiWhatsapp className={className} color="#25D366" aria-hidden="true" data-testid="whatsapp-glyph" />
}

export function ConversationsBand() {
  return (
    <section id="talk-to-carup" className="scroll-mt-20 bg-white py-14 sm:py-20" data-testid="home-communications" aria-labelledby="talk-title">
      <div className="section-padding mx-auto max-w-[1440px]">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Talk to people</p>
            <h2 id="talk-title" className="mt-2 max-w-md text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#09122A]">
              Talk the way you already do.
            </h2>
            <p className="mt-3 max-w-md text-[15px] leading-7 text-slate-600">
              Share cars on WhatsApp and get replies there — while the conversation stays on the vehicle’s CarUp record, so nothing gets lost.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="#ask-carup" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#09122A] pl-1.5 pr-4 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2">
                <AskCarUpMark size={30} /> Ask CarUp
              </a>
              <Link to="/help" className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[#09122A] ring-1 ring-slate-300 transition hover:ring-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]">
                <BookOpen className="h-4 w-4" aria-hidden="true" /> Help centre
              </Link>
              <Link to="/contact" className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[#09122A] ring-1 ring-slate-300 transition hover:ring-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]">
                <Headphones className="h-4 w-4" aria-hidden="true" /> Contact CarUp
              </Link>
            </div>
          </div>

          <ol className="grid gap-4 sm:grid-cols-2">
            <li className="relative overflow-hidden rounded-[1.75rem] bg-[#ECFDF3] p-6 sm:p-7" data-testid="whatsapp-share-story">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#075E54]">
                <WhatsAppGlyph className="h-6 w-6" /> Share on WhatsApp
              </div>
              <p className="mt-4 text-lg font-semibold tracking-[-0.01em] text-[#09122A]">Send a car to family before you decide.</p>
              <p className="mt-2 text-[14px] leading-6 text-slate-700">
                Every listing has <span className="inline-flex items-center gap-1 font-semibold"><Share2 className="h-3.5 w-3.5" aria-hidden="true" />Share</span> → WhatsApp. The message carries the listing link — nothing private about you or the seller.
              </p>
              <Link to="/marketplace" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#075E54] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]">Find a car to share</Link>
            </li>
            <li className="relative overflow-hidden rounded-[1.75rem] bg-[#09122A] p-6 text-white sm:p-7" data-testid="whatsapp-reply-story">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#9AF3BC]">
                <WhatsAppGlyph className="h-6 w-6" /> Replies on WhatsApp
              </div>
              <p className="mt-4 text-lg font-semibold tracking-[-0.01em]">Ask through CarUp. Get the answer where you are.</p>
              <p className="mt-2 text-[14px] leading-6 text-white/75">
                Choose WhatsApp when you send an enquiry. The seller answers through CarUp, the reply reaches your WhatsApp, and the thread stays on the vehicle’s record.
              </p>
              <Link to="/marketplace" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#FFB27A] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]">Ask about a car</Link>
            </li>
          </ol>
        </div>
        <p className="mt-6 text-[11px] leading-5 text-slate-500">WhatsApp is a trademark of its owner. CarUp is not affiliated with or endorsed by Meta or WhatsApp.</p>
      </div>
    </section>
  )
}
