import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const dashboard=readFileSync(path.resolve(here,'DealerDashboard.tsx'),'utf8')
const operatingDetails=readFileSync(path.resolve(here,'../../DealerOperatingDetails.tsx'),'utf8')

describe('dealer profile-image navigation',()=>{
  it('keeps a prominent dashboard action available after images already exist',()=>{
    expect(dashboard).toContain("['Edit profile images','/dealers/operating-details#dealer-profile-images',ImagePlus]")
  })

  it('targets and focuses the independently reviewed image upload section',()=>{
    expect(operatingDetails).toContain('id="dealer-profile-images"')
    expect(operatingDetails).toContain("window.location.hash!=='#dealer-profile-images'")
    expect(operatingDetails).toContain("scrollIntoView({block:'start'})")
  })
})
