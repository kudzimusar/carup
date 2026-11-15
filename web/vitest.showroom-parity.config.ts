/**
 * RX03 parity run: the accepted pages' render-based truth tests, executed against the showroom
 * compositions. Each test file imports its subject as './VehicleDetail' or './Marketplace'; this
 * config resolves exactly those specifiers to the showroom modules, so the same assertions (TI-13
 * outage vs empty, TI-27 read outcomes, FR-9 heading outline, media, seller statement, Trust)
 * must hold for both compositions. Run: npx vitest run --config vitest.showroom-parity.config.ts
 */
import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config'

export default mergeConfig(base, defineConfig({
  resolve: {
    alias: [
      { find: /^\.\/VehicleDetail$/, replacement: path.resolve(__dirname, 'src/pages/showroom/ShowroomVehicleDetail.tsx') },
      { find: /^\.\/Marketplace$/, replacement: path.resolve(__dirname, 'src/pages/showroom/ShowroomMarketplace.tsx') },
    ],
  },
  test: {
    include: [
      'src/pages/Marketplace.loadError.test.tsx',
      'src/pages/VehicleDetail.headingOutline.test.tsx',
      'src/pages/VehicleDetail.sellerStatement.test.tsx',
      'src/pages/VehicleDetail.ti27.test.tsx',
      'src/pages/VehicleDetail.media.test.tsx',
      'src/pages/VehicleDetail.trust.test.tsx',
    ],
  },
}))
