import { Link } from 'react-router-dom'
import { Car, Mail, Phone, MapPin, Facebook, Twitter, Instagram, Linkedin } from 'lucide-react'
import { resolveFeatureIcon } from '@/config/featureIcons'
import {
  getFooterNavigation,
  getFooterSocial,
  type SocialLink,
} from '@/config/navigationManifest'
import { useFeatureEffectiveStates } from '@/context/FeatureGovernanceContext'

const SOCIAL_ICON = {
  facebook: Facebook,
  twitter: Twitter,
  instagram: Instagram,
  linkedin: Linkedin,
} as const

function SocialButton({ social }: { social: SocialLink }) {
  const Icon = SOCIAL_ICON[social.platform]
  const base = 'w-9 h-9 rounded-full flex items-center justify-center transition-colors'
  // Active + real URL → safe external link. Planned/unconfigured → accessible,
  // disabled control (NEVER href="#") so screen readers announce its state.
  if (social.state === 'active' && social.url) {
    return (
      <a
        href={social.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`CarUp on ${social.label}`}
        className={`${base} bg-gray-800 hover:bg-orange-500`}
        data-testid={`footer-social-${social.platform}`}
      >
        <Icon className="w-4 h-4" />
      </a>
    )
  }
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-label={`CarUp on ${social.label} — coming soon`}
      title="Coming soon"
      data-testid={`footer-social-${social.platform}`}
      data-planned="true"
      className={`${base} bg-gray-800/60 text-gray-500 cursor-not-allowed`}
    >
      <Icon className="w-4 h-4" />
    </span>
  )
}

export default function Footer() {
  const effectiveStates = useFeatureEffectiveStates()
  const ctx = { environment: import.meta.env.MODE, effectiveStates }
  const columns: Array<{ title: string; items: ReturnType<typeof getFooterNavigation> }> = [
    { title: 'Product', items: getFooterNavigation('product', ctx) },
    { title: 'Company', items: getFooterNavigation('company', ctx) },
    { title: 'Resources', items: getFooterNavigation('resources', ctx) },
    { title: 'Stakeholders', items: getFooterNavigation('stakeholders', ctx) },
  ]
  const legal = getFooterNavigation('legal', ctx)
  const social = getFooterSocial()

  return (
    <footer className="bg-[hsl(222,47%,8%)] text-gray-300">
      <div className="section-padding mx-auto max-w-[1440px] py-16">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4" aria-label="CarUp home">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                <Car className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">
                Car<span className="text-orange-500">Up</span>
              </span>
            </Link>
            <p className="text-sm text-gray-400 mb-4 max-w-xs">
              Zimbabwe's verified automotive marketplace for buying, verifying, and selling cars with clearer trust signals.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-orange-500" />
                <span>+263 242 700 000</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-orange-500" />
                <span>info@carup.co.zw</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-orange-500" />
                <span>Harare, Zimbabwe</span>
              </div>
            </div>
          </div>

          {/* Governed columns */}
          {columns.map(({ title, items }) => (
            <nav key={title} aria-label={`Footer ${title}`}>
              <h3 className="font-semibold text-white mb-4 text-sm">{title}</h3>
              <ul className="space-y-2.5">
                {items.map(item => {
                  const Icon = item.icon ? resolveFeatureIcon(item.icon) : null
                  return (
                    <li key={item.id}>
                      <Link
                        to={item.href}
                        data-testid={`footer-link-${item.id}`}
                        className="text-sm text-gray-400 hover:text-orange-400 focus-visible:text-orange-400 transition-colors inline-flex items-center gap-1.5"
                      >
                        {Icon && <Icon className="w-3.5 h-3.5" />}
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
          ))}
        </div>

        {/* Bottom bar: copyright · legal · social */}
        <div className="mt-12 pt-8 border-t border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-3 text-sm text-gray-500">
            <p>© 2026 CarUp Zimbabwe. All rights reserved.</p>
            {legal.length > 0 && (
              <ul className="flex items-center gap-3" aria-label="Footer Legal">
                {legal.map(item => (
                  <li key={item.id}>
                    <Link
                      to={item.href}
                      data-testid={`footer-link-${item.id}`}
                      className="hover:text-orange-400 focus-visible:text-orange-400 transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-4" aria-label="CarUp social media">
            {social.map(s => <SocialButton key={s.id} social={s} />)}
          </div>
        </div>
      </div>
    </footer>
  )
}
