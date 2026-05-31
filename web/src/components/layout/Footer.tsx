import { Link } from 'react-router-dom'
import { Car, Mail, Phone, MapPin, Facebook, Twitter, Instagram, Linkedin } from 'lucide-react'

const footerLinks = {
  Product: [
    { label: 'Marketplace', href: '/marketplace' },
    { label: 'Vehicle Search', href: '/search' },
    { label: 'Dealer Directory', href: '/dealers' },
    { label: 'Garage Directory', href: '/garages' },
    { label: 'Insurance', href: '/insurance' },
    { label: 'Pricing', href: '/pricing' },
  ],
  Company: [
    { label: 'About CarUp', href: '/about' },
    { label: 'Contact Us', href: '/contact' },
    { label: 'Careers', href: '/careers' },
    { label: 'Press Kit', href: '/press' },
    { label: 'Blog', href: '/blog' },
  ],
  Resources: [
    { label: 'Help Center', href: '/help' },
    { label: 'Trust & Safety', href: '/trust' },
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'API Documentation', href: '/api-docs' },
  ],
  Stakeholders: [
    { label: 'Car Owners', href: '/dashboard' },
    { label: 'Dealers', href: '/dealer' },
    { label: 'Mechanics', href: '/mechanic' },
    { label: 'Insurance', href: '/insurance-dash' },
    { label: 'Government', href: '/government' },
  ],
}

export default function Footer() {
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
              Zimbabwe's trusted automotive intelligence platform. Every vehicle deserves a digital identity.
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