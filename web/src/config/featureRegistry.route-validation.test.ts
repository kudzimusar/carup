import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { FEATURE_REGISTRY, ROLE_METADATA } from './featureRegistry'
import type { UserRole } from '@shared/types'

describe('Feature Registry Route Validation & Dead Link CI Gate', () => {
  // 1. Parse declared routes from App.tsx
  const appPath = path.resolve(__dirname, '../App.tsx')
  const appContent = fs.readFileSync(appPath, 'utf-8')
  
  // Regex to match <Route path="X" ... />
  const routeRegex = /<Route\s+[^>]*path=["']([^"']+)["']/g
  const declaredRoutes: string[] = []
  let match
  while ((match = routeRegex.exec(appContent)) !== null) {
    declaredRoutes.push(match[1])
  }

  it('verifies that all active registry features have declared routes in App.tsx', () => {
    const activeFeatures = FEATURE_REGISTRY.filter(f => !f.isPlanned && !f.isHidden)
    const missing = activeFeatures.filter(f => !declaredRoutes.includes(f.route))
    
    expect(missing.map(f => `${f.id}: ${f.route}`)).toEqual([])
  })

  it('verifies there are no duplicate active route registrations', () => {
    const activeFeatures = FEATURE_REGISTRY.filter(f => !f.isPlanned && !f.isHidden)
    const routeToIds = new Map<string, string[]>()
    
    for (const f of activeFeatures) {
      const list = routeToIds.get(f.route) || []
      list.push(f.id)
      routeToIds.set(f.route, list)
    }

    const duplicates = Array.from(routeToIds.entries()).filter(([_, ids]) => ids.length > 1)
    expect(duplicates).toEqual([])
  })

  it('verifies that every dashboard role has a registered dashboard route', () => {
    const activeRoutes = FEATURE_REGISTRY.filter(f => !f.isPlanned && !f.isHidden).map(f => f.route)
    const roles = Object.keys(ROLE_METADATA) as UserRole[]
    
    const missingRoles = roles.filter(role => {
      const dbRoute = ROLE_METADATA[role].dashboardRoute
      return !activeRoutes.includes(dbRoute)
    })

    expect(missingRoles).toEqual([])
  })

  it('verifies that every public nav/footer item has an active route in App.tsx', () => {
    const navFooterItems = FEATURE_REGISTRY.filter(
      f => !f.isPlanned && !f.isHidden && (f.placements.includes('header') || f.placements.includes('footer'))
    )

    const invalid = navFooterItems.filter(f => !declaredRoutes.includes(f.route))
    expect(invalid.map(f => `${f.id}: ${f.route}`)).toEqual([])
  })

  // 2. Dead-link checks on UI components
  const componentsToCheck = [
    { name: 'Navbar.tsx', filePath: path.resolve(__dirname, '../components/layout/Navbar.tsx') },
    { name: 'Footer.tsx', filePath: path.resolve(__dirname, '../components/layout/Footer.tsx') },
    { name: 'DashboardLayout.tsx', filePath: path.resolve(__dirname, '../components/layout/DashboardLayout.tsx') },
  ]

  componentsToCheck.forEach(({ name, filePath }) => {
    it(`checks ${name} for dead links`, () => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }
      
      const content = fs.readFileSync(filePath, 'utf-8')
      // Extract links of form: to="..." or href="..."
      const linkRegex = /\b(?:to|href)=["']([^"']+)["']/g
      const links: string[] = []
      let linkMatch
      while ((linkMatch = linkRegex.exec(content)) !== null) {
        links.push(linkMatch[1])
      }

      const invalidLinks = links.filter(link => {
        // Exclude external, anchor/hash, home, or dynamic variables
        if (
          link.startsWith('http://') ||
          link.startsWith('https://') ||
          link.startsWith('mailto:') ||
          link.startsWith('tel:') ||
          link.startsWith('#') ||
          link === '/'
        ) {
          return false
        }

        // Verify if route is registered and active or planned in the registry
        // Or if it matches a parameterized pattern in App.tsx/Registry
        const matchesRegistry = FEATURE_REGISTRY.some(f => {
          const patternSegments = f.route.split('?')[0].split('/').filter(Boolean)
          const pathSegments = link.split('?')[0].split('/').filter(Boolean)
          if (patternSegments.length !== pathSegments.length) return false
          return patternSegments.every((segment, i) => segment.startsWith(':') || segment === pathSegments[i])
        })

        const matchesAppRoute = declaredRoutes.some(route => {
          const patternSegments = route.split('?')[0].split('/').filter(Boolean)
          const pathSegments = link.split('?')[0].split('/').filter(Boolean)
          if (patternSegments.length !== pathSegments.length) return false
          return patternSegments.every((segment, i) => segment.startsWith(':') || segment === pathSegments[i])
        })

        return !matchesRegistry && !matchesAppRoute
      })

      expect(invalidLinks).toEqual([])
    })
  })
})
