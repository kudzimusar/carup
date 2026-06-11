import { Link } from 'react-router-dom'
import { Car, Mail, Phone, MapPin, Facebook, Twitter, Instagram, Linkedin } from 'lucide-react'
import { getPublicFooterItems, getAllRoles, getRoleMetadata, getDashboardRoute } from '@/config/featureRegistry'

export default function Footer() {
  const getStakeholderLabel = (title: string) => {
    if (title === 'Car Owner') return 'Car Owners'
    if (title === 'Dealer') return 'Dealers'
    if (title === 'Mechanic') return 'Mechanics'
    if (title === 'Insurance') return 'Insurance'
    if (title === 'Government') return 'Government'
    if (title === 'Banker') return 'Bankers'
    return `${title}s`
  }

  const footerLinks = {
    Product: getPublicFooterItems('Product').map(item => ({ label: item.label, href: item.route })),
    Company: getPublicFooterItems('Company').map(item => ({ label: item.label, href: item.route })),
    Resources: getPublicFooterItems('Resources').map(item => ({ label: item.label, href: item.route })),
    Stakeholders: getAllRoles()
      .filter(role => role !== 'admin')
      .map(role => {
        const metadata = getRoleMetadata(role)
        return {
          label: getStakeholderLabel(metadata.title),
          href: getDashboardRoute(role)
        }
      })
  }
  return (
    <footer className="bg-[hsl(222,47%,8%)] text-gray-300">
      <div className="section-padding mx-auto max-w-[1440px] py-16">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
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

          {/* Links */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="font-semibold text-white mb-4 text-sm">{title}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.href}
                      className="text-sm text-gray-400 hover:text-orange-400 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-gray-500">
            © 2026 CarUp Zimbabwe. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            {[Facebook, Twitter, Instagram, Linkedin].map((Icon, i) => (
              <a
                key={i}
                href="#"
                className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center hover:bg-orange-500 transition-colors"
              >
                <Icon className="w-4 h-4" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
