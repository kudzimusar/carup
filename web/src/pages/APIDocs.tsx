import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Key,
  ShieldAlert,
  Cpu,
  BookOpen,
  Copy,
  Check,
  Search,
  Play,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Code2,
  Globe,
  Sliders,
  Database
} from 'lucide-react'

// Realistic Mock VIN Data for the Interactive Sandbox
interface VehiclePreset {
  vin: string
  label: string
  details: string
  response: any
}

const VEHICLE_PRESETS: Record<string, VehiclePreset> = {
  'NHP10-8201948': {
    vin: 'NHP10-8201948',
    label: 'Toyota Aqua (2018) - Japan Import',
    details: 'Harare Registry • Active ZINARA Tax • Cleared via Beitbridge',
    response: {
      "status": "success",
      "vin": "NHP10-8201948",
      "vehicle": {
        "make": "Toyota",
        "model": "Aqua",
        "year": 2018,
        "color": "Pearl White",
        "chassis_no": "NHP10-8201948",
        "engine_no": "1NZ-FXE-19823",
        "fuel_type": "Hybrid",
        "import_history": {
          "port_of_entry": "Beitbridge Border Post",
          "clearance_date": "2022-04-18",
          "customs_agent": "Chavunduka & Sons Clearing",
          "duty_paid_usd": 2450.00,
          "original_auction_grade": "4.5"
        },
        "registry": {
          "cvr_number": "CVR-902348A",
          "plate_number": "AGE-4920",
          "owner_name": "Tafadzwa Chigumba",
          "owner_type": "Individual",
          "district": "Harare North",
          "date_registered": "2022-05-02"
        },
        "compliance": {
          "zinara_licensed": true,
          "license_expiry": "2026-10-31",
          "radio_license": "Active",
          "roadworthiness_certified": true,
          "outstanding_fines_usd": 0.00
        }
      }
    }
  },
  'SALWR2V482': {
    vin: 'SALWR2V482',
    label: 'Range Rover Sport (2021) - UK Import',
    details: 'Borrowdale Registry • ZINARA Alert • Cleared via Chirundu',
    response: {
      "status": "success",
      "vin": "SALWR2V482",
      "vehicle": {
        "make": "Land Rover",
        "model": "Range Rover Sport D300",
        "year": 2021,
        "color": "Santorini Black",
        "chassis_no": "SALWR2V482",
        "engine_no": "306DT-390238",
        "fuel_type": "Diesel",
        "import_history": {
          "port_of_entry": "Chirundu Border Post",
          "clearance_date": "2024-02-10",
          "customs_agent": "ZimLogistics Ltd",
          "duty_paid_usd": 18200.00,
          "original_auction_grade": "5.0"
        },
        "registry": {
          "cvr_number": "CVR-10928A",
          "plate_number": "WAD-1029",
          "owner_name": "Premium Luxury Rentals",
          "owner_type": "Corporate",
          "district": "Harare Central",
          "date_registered": "2024-02-28"
        },
        "compliance": {
          "zinara_licensed": false,
          "license_expiry": "2026-03-31",
          "radio_license": "Expired",
          "roadworthiness_certified": true,
          "outstanding_fines_usd": 75.00
        }
      }
    }
  },
  'AHTK1239823': {
    vin: 'AHTK1239823',
    label: 'Toyota Hilux GD-6 (2022) - South Africa Import',
    details: 'Bulawayo Registry • Active ZINARA Tax • Fleet Inspected',
    response: {
      "status": "success",
      "vin": "AHTK1239823",
      "vehicle": {
        "make": "Toyota",
        "model": "Hilux 2.8 GD-6 Raider",
        "year": 2022,
        "color": "Chrome Silver",
        "chassis_no": "AHTK1239823",
        "engine_no": "1GD-FTV-89234",
        "fuel_type": "Diesel",
        "import_history": {
          "port_of_entry": "Beitbridge Border Post",
          "clearance_date": "2023-01-15",
          "customs_agent": "Limpopo Clearing Agency",
          "duty_paid_usd": 7800.00,
          "original_auction_grade": "Brand New"
        },
        "registry": {
          "cvr_number": "CVR-40294C",
          "plate_number": "BFE-9832",
          "owner_name": "Matabeleland Mining Corp",
          "owner_type": "Corporate",
          "district": "Bulawayo Central",
          "date_registered": "2023-01-20"
        },
        "compliance": {
          "zinara_licensed": true,
          "license_expiry": "2026-12-31",
          "radio_license": "Active",
          "roadworthiness_certified": true,
          "outstanding_fines_usd": 0.00
        }
      }
    }
  }
}

interface EndpointConfig {
  id: string
  name: string
  method: 'GET' | 'POST'
  url: string
  description: string
  authLevel: string
  rateLimit: string
  queryParams?: Array<{ name: string; type: string; req: boolean; def?: string; desc: string }>
  bodyParams?: Array<{ name: string; type: string; req: boolean; desc: string }>
  codeSnippets: {
    curl: string
    javascript: string
    python: string
    go: string
  }
  responsePayload: string
}

const ENDPOINTS: EndpointConfig[] = [
  {
    id: 'get-vehicle',
    name: 'Retrieve Vehicle Intelligence',
    method: 'GET',
    url: '/v1/vehicles/:vin',
    description: 'Retrieves full registry details, customs import logs, certified CarUp inspection history, and real-time ZINARA tax and tollgate violation logs for a specific vehicle using its 17-digit Chassis Number or VIN.',
    authLevel: 'Secret API Key (cu_live_...)',
    rateLimit: '150 req/min',
    queryParams: [
      { name: 'include_compliance', type: 'boolean', req: false, def: 'false', desc: 'When true, fetches live ZINARA license validation disc records and outstanding municipal fine metrics.' },
      { name: 'currency', type: 'string', req: false, def: 'USD', desc: 'Preferred financial output representation. Allowed formats: USD, ZiG, ZAR, BWP.' }
    ],
    codeSnippets: {
      curl: `curl -X GET "https://api.carup.co.zw/v1/vehicles/NHP10-8201948?include_compliance=true" \\
  -H "Authorization: Bearer cu_live_7e8a9f4c3b2a1a"`
      ,
      javascript: `const response = await fetch('https://api.carup.co.zw/v1/vehicles/NHP10-8201948?include_compliance=true', {
  headers: {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a',
    'Accept': 'application/json'
  }
});

const data = await response.json();
console.log(data.vehicle.registry.owner_name);`
      ,
      python: `import requests

headers = {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a',
    'Accept': 'application/json'
}

response = requests.get(
    'https://api.carup.co.zw/v1/vehicles/NHP10-8201948?include_compliance=true',
    headers=headers
)

vehicle_data = response.json()
print(vehicle_data['vehicle']['registry']['owner_name'])`
      ,
      go: `package main

import (
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "https://api.carup.co.zw/v1/vehicles/NHP10-8201948?include_compliance=true"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Add("Authorization", "Bearer cu_live_7e8a9f4c3b2a1a")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(string(body))
}`
    },
    responsePayload: JSON.stringify(VEHICLE_PRESETS['NHP10-8201948'].response, null, 2)
  },
  {
    id: 'get-valuation',
    name: 'AI Market Valuation Engine',
    method: 'GET',
    url: '/v1/vehicles/valuations',
    description: 'Leverages machine learning models trained on Beitbridge custom clearing sheets, local dealership indexes, and historical market volatility (USD vs ZiG exchanges) to generate an immediate valuation matrix.',
    authLevel: 'Secret API Key (cu_live_...)',
    rateLimit: '100 req/min',
    queryParams: [
      { name: 'make', type: 'string', req: true, desc: 'Vehicle manufacturer brand (e.g. Toyota, Mazda, Land Rover).' },
      { name: 'model', type: 'string', req: true, desc: 'Vehicle variant designation (e.g. Aqua, Axela, Fit, Defender).' },
      { name: 'year', type: 'integer', req: true, desc: 'Four-digit manufacture catalog calendar year (e.g. 2018).' },
      { name: 'mileage', type: 'integer', req: true, desc: 'Total cumulative distance recorded in kilometers.' },
      { name: 'condition', type: 'string', req: false, def: 'Good', desc: 'Physical condition rating: Excellent, Good, Fair, Poor.' }
    ],
    codeSnippets: {
      curl: `curl -X GET "https://api.carup.co.zw/v1/vehicles/valuations?make=Toyota&model=Aqua&year=2018&mileage=85000" \\
  -H "Authorization: Bearer cu_live_7e8a9f4c3b2a1a"`
      ,
      javascript: `const params = new URLSearchParams({
  make: 'Toyota',
  model: 'Aqua',
  year: '2018',
  mileage: '85000',
  condition: 'Good'
});

const response = await fetch(\`https://api.carup.co.zw/v1/vehicles/valuations?\${params}\`, {
  headers: {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a'
  }
});

const data = await response.json();
console.log(\`Estimated Value: \${data.valuation.fair_market_value_usd} USD\`);`
      ,
      python: `import requests

params = {
    'make': 'Toyota',
    'model': 'Aqua',
    'year': 2018,
    'mileage': 85000,
    'condition': 'Good'
}

headers = {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a'
}

response = requests.get(
    'https://api.carup.co.zw/v1/vehicles/valuations',
    params=params,
    headers=headers
)

valuation = response.json()
print(f"Fair Market Value: {valuation['valuation']['fair_market_value_usd']} USD")`
      ,
      go: `package main

import (
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "https://api.carup.co.zw/v1/vehicles/valuations?make=Toyota&model=Aqua&year=2018&mileage=85000&condition=Good"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Add("Authorization", "Bearer cu_live_7e8a9f4c3b2a1a")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(string(body))
}`
    },
    responsePayload: `{
  "status": "success",
  "query": {
    "make": "Toyota",
    "model": "Aqua",
    "year": 2018,
    "mileage": 85000,
    "condition": "Good"
  },
  "valuation": {
    "fair_market_value_usd": 8400.00,
    "fair_market_value_zig": 113400.00,
    "fair_market_value_zar": 158760.00,
    "confidence_score": 0.94,
    "market_demand": "High",
    "depreciation_rate_annual": 0.08,
    "valuation_timestamp": "2026-05-26T17:09:16Z",
    "harare_average_price_usd": 8600.00,
    "bulawayo_average_price_usd": 8200.00
  }
}`
  },
  {
    id: 'get-dealers',
    name: 'Query Premium Dealers',
    method: 'GET',
    url: '/v1/dealers',
    description: 'Retrieves a filtered, paginated catalog directory listing of premium verified automotive dealerships integrated into the CarUp ecosystem. Returns physical address locations and aggregate statistics.',
    authLevel: 'Secret API Key or Public Client Key',
    rateLimit: '200 req/min',
    queryParams: [
      { name: 'city', type: 'string', req: false, def: 'Harare', desc: 'Filter dealers by physical city node. Supported values: Harare, Bulawayo, Mutare, Gweru, Masvingo.' },
      { name: 'verified_only', type: 'boolean', req: false, def: 'true', desc: 'Return only verified elite tier dealership partners with physical premises and proven registry track records.' },
      { name: 'limit', type: 'integer', req: false, def: '20', desc: 'Maximum number of dealers to return in a single page limit query.' }
    ],
    codeSnippets: {
      curl: `curl -X GET "https://api.carup.co.zw/v1/dealers?city=Harare&verified_only=true&limit=1" \\
  -H "Authorization: Bearer cu_live_7e8a9f4c3b2a1a"`
      ,
      javascript: `const response = await fetch('https://api.carup.co.zw/v1/dealers?city=Harare&verified_only=true&limit=1', {
  headers: {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a'
  }
});

const dealers = await response.json();
console.log(dealers.results[0].name);`
      ,
      python: `import requests

headers = {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a'
}

response = requests.get(
    'https://api.carup.co.zw/v1/dealers?city=Harare&verified_only=true&limit=1',
    headers=headers
)

dealers = response.json()
print(dealers['results'][0]['name'])`
      ,
      go: `package main

import (
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "https://api.carup.co.zw/v1/dealers?city=Harare&verified_only=true&limit=1"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Add("Authorization", "Bearer cu_live_7e8a9f4c3b2a1a")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(string(body))
}`
    },
    responsePayload: `{
  "status": "success",
  "total": 12,
  "results": [
    {
      "id": "dlr_9013",
      "name": "Harare Premium Imports",
      "address": "14 Enterprise Road, Borrowdale, Harare",
      "city": "Harare",
      "phone": "+263 772 456 789",
      "email": "sales@hararepremium.co.zw",
      "is_verified": true,
      "trusted_badge": "Platinum Partner",
      "current_inventory_count": 48,
      "rating": 4.9,
      "operating_hours": "Mon-Fri 08:00 - 17:00, Sat 08:00 - 13:00"
    }
  ]
}`
  },
  {
    id: 'post-inspection',
    name: 'Submit Mobile Inspection Log',
    method: 'POST',
    url: '/v1/inspections',
    description: 'Pushes a formal 150-point diagnostics and physical condition audit report performed by an accredited mobile mechanic. Submitting this log updates the CarUp global vehicle ledger, allowing banks and insurers to instantly audit vehicle health.',
    authLevel: 'Write Authorization Token (cu_write_...)',
    rateLimit: '50 req/min',
    bodyParams: [
      { name: 'vin', type: 'string', req: true, desc: 'The 17-character VIN/Chassis identifier of the inspected vehicle.' },
      { name: 'inspector_id', type: 'string', req: true, desc: 'Authenticated unique agent code of the inspector (e.g. insp_byo_8920).' },
      { name: 'location', type: 'string', req: true, desc: 'The city node where the physical inspection check took place (e.g. Bulawayo).' },
      { name: 'overall_grade', type: 'string', req: true, desc: 'Final evaluated inspection grade (A+, A, B, C, D, F).' },
      { name: 'checks', type: 'object', req: true, desc: 'JSON object detailing statuses for engine, suspension, electronics, tires, and body.' }
    ],
    codeSnippets: {
      curl: `curl -X POST "https://api.carup.co.zw/v1/inspections" \\
  -H "Authorization: Bearer cu_live_7e8a9f4c3b2a1a" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vin": "NHP10-8201948",
    "inspector_id": "insp_byo_8920",
    "location": "Bulawayo",
    "overall_grade": "A",
    "checks": {
      "engine": "Excellent",
      "suspension": "Good",
      "electronics": "Good",
      "tires": "Fair",
      "body_integrity": "Excellent"
    }
  }'`
      ,
      javascript: `const payload = {
  vin: 'NHP10-8201948',
  inspector_id: 'insp_byo_8920',
  location: 'Bulawayo',
  overall_grade: 'A',
  checks: {
    engine: 'Excellent',
    suspension: 'Good',
    electronics: 'Good',
    tires: 'Fair',
    body_integrity: 'Excellent'
  }
};

const response = await fetch('https://api.carup.co.zw/v1/inspections', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

const result = await response.json();
console.log(\`Inspection Registered: \${result.inspection_id}\`);`
      ,
      python: `import requests

payload = {
    "vin": "NHP10-8201948",
    "inspector_id": "insp_byo_8920",
    "location": "Bulawayo",
    "overall_grade": "A",
    "checks": {
        "engine": "Excellent",
        "suspension": "Good",
        "electronics": "Good",
        "tires": "Fair",
        "body_integrity": "Excellent"
    }
}

headers = {
    'Authorization': 'Bearer cu_live_7e8a9f4c3b2a1a',
    'Content-Type': 'application/json'
}

response = requests.post(
    'https://api.carup.co.zw/v1/inspections',
    json=payload,
    headers=headers
)

result = response.json()
print(f"Inspection Saved. Certificate ID: {result['inspection_id']}")`
      ,
      go: `package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "https://api.carup.co.zw/v1/inspections"
	jsonData := []byte(\`{
		"vin": "NHP10-8201948",
		"inspector_id": "insp_byo_8920",
		"location": "Bulawayo",
		"overall_grade": "A",
		"checks": {
			"engine": "Excellent",
			"suspension": "Good",
			"electronics": "Good",
			"tires": "Fair",
			"body_integrity": "Excellent"
		}
	}\`)

	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	req.Header.Add("Authorization", "Bearer cu_live_7e8a9f4c3b2a1a")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(string(body))
}`
    },
    responsePayload: `{
  "status": "success",
  "inspection_id": "CU-INSP-902348",
  "vin": "NHP10-8201948",
  "grade": "A",
  "verified_timestamp": "2026-05-26T17:09:16Z",
  "report_url": "https://carup.co.zw/reports/CU-INSP-902348.pdf",
  "active_alerts": [],
  "next_scheduled_inspection": "2027-05-26T00:00:00Z"
}`
  }
]

export default function APIDocs() {
  // Navigation & Filtering state
  const [activeEndpointId, setActiveEndpointId] = useState(ENDPOINTS[0].id)
  const [searchQuery, setSearchQuery] = useState('')

  // Sandbox Sandbox simulator state
  const [sandboxVin, setSandboxVin] = useState('NHP10-8201948')
  const [sandboxLoading, setSandboxLoading] = useState(false)
  const [sandboxResponse, setSandboxResponse] = useState<any>(VEHICLE_PRESETS['NHP10-8201948'].response)

  // Language Tabs state
  const [selectedLanguage, setSelectedLanguage] = useState<'curl' | 'javascript' | 'python' | 'go'>('curl')
  const [terminalView, setTerminalView] = useState<'request' | 'response'>('request')

  // API Key Generator state
  const [appName, setAppName] = useState('')
  const [appEnv, setAppEnv] = useState<'sandbox' | 'live'>('sandbox')
  const [appScopes, setAppScopes] = useState<string[]>(['vehicles:read'])
  const [generatedKey, setGeneratedKey] = useState('')
  const [keyGenerating, setKeyGenerating] = useState(false)

  // Feedback states
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedTerminal, setCopiedTerminal] = useState(false)

  // Filter endpoints
  const filteredEndpoints = ENDPOINTS.filter(ep =>
    ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ep.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ep.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const activeEndpoint = ENDPOINTS.find(ep => ep.id === activeEndpointId) || ENDPOINTS[0]

  // Trigger test request simulation
  const handleTestRequest = () => {
    setSandboxLoading(true)
    setTerminalView('response')
    setTimeout(() => {
      setSandboxResponse(VEHICLE_PRESETS[sandboxVin]?.response || { error: 'Not Found' })
      setSandboxLoading(false)
    }, 850)
  }

  // Handle preset VIN change
  const handlePresetVinChange = (vin: string) => {
    setSandboxVin(vin)
    setSandboxResponse(VEHICLE_PRESETS[vin].response)
  }

  // Copy API key to clipboard
  const handleCopyKey = () => {
    navigator.clipboard.writeText(generatedKey)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  // Copy Active Code to clipboard
  const handleCopyTerminal = () => {
    const textToCopy = terminalView === 'request'
      ? activeEndpoint.codeSnippets[selectedLanguage]
      : (activeEndpointId === 'get-vehicle' && terminalView === 'response'
        ? JSON.stringify(sandboxResponse, null, 2)
        : activeEndpoint.responsePayload)

    navigator.clipboard.writeText(textToCopy)
    setCopiedTerminal(true)
    setTimeout(() => setCopiedTerminal(false), 2000)
  }

  // Handle Mock API Key Generation
  const handleGenerateKey = (e: React.FormEvent) => {
    e.preventDefault()
    if (!appName.trim()) return

    setKeyGenerating(true)
    setTimeout(() => {
      const prefix = appEnv === 'live' ? 'cu_live_sec_' : 'cu_test_pk_'
      const randomPart = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('')
      setGeneratedKey(`${prefix}${randomPart}`)
      setKeyGenerating(false)
    }, 900)
  }

  // Simulated code highlighters
  const highlightJSON = (jsonStr: string) => {
    return jsonStr.split('\n').map((line, idx) => {
      const colonIdx = line.indexOf(':')
      if (colonIdx !== -1) {
        const keyPart = line.substring(0, colonIdx)
        const valPart = line.substring(colonIdx)

        const keyMatch = keyPart.match(/^(\s*)(".*?")(.*)$/)
        let renderedKey = keyPart
        if (keyMatch) {
          const [_, spaces, key, rest] = keyMatch
          renderedKey = `${spaces}<span class="text-amber-500 font-semibold">${key}</span>${rest}`
        }

        let renderedVal = valPart
        const valTrimmed = valPart.substring(1).trim()

        if (valTrimmed.startsWith('"')) {
          const comma = valTrimmed.endsWith(',') ? ',' : ''
          const strVal = valTrimmed.endsWith(',') ? valTrimmed.slice(0, -1) : valTrimmed
          renderedVal = `: <span class="text-emerald-400 font-medium">${strVal}</span><span class="text-slate-400">${comma}</span>`
        } else if (valTrimmed.startsWith('[') || valTrimmed.startsWith('{')) {
          renderedVal = valPart
        } else if (valTrimmed === 'true,' || valTrimmed === 'true' || valTrimmed === 'false,' || valTrimmed === 'false') {
          const comma = valTrimmed.endsWith(',') ? ',' : ''
          const boolVal = valTrimmed.endsWith(',') ? valTrimmed.slice(0, -1) : valTrimmed
          renderedVal = `: <span class="text-purple-400 font-bold">${boolVal}</span><span class="text-slate-400">${comma}</span>`
        } else if (!isNaN(parseFloat(valTrimmed))) {
          const comma = valTrimmed.endsWith(',') ? ',' : ''
          const numVal = valTrimmed.endsWith(',') ? valTrimmed.slice(0, -1) : valTrimmed
          renderedVal = `: <span class="text-sky-400 font-medium">${numVal}</span><span class="text-slate-400">${comma}</span>`
        }

        return (
          <div key={idx} className="font-mono text-[12px] leading-relaxed text-slate-300" dangerouslySetInnerHTML={{ __html: renderedKey + renderedVal }} />
        )
      } else {
        let lineHtml = line
        if (line.trim() === '{' || line.trim() === '}' || line.trim() === '[' || line.trim() === ']' || line.trim() === '},' || line.trim() === '],') {
          lineHtml = `<span class="text-slate-500">${line}</span>`
        }
        return (
          <div key={idx} className="font-mono text-[12px] leading-relaxed text-slate-300" dangerouslySetInnerHTML={{ __html: lineHtml }} />
        )
      }
    })
  }

  const highlightCode = (code: string, lang: string) => {
    if (lang === 'json') return highlightJSON(code)

    return code.split('\n').map((line, idx) => {
      let lineHtml = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")

      if (lang === 'curl') {
        lineHtml = lineHtml
          .replace(/^(curl)/g, '<span class="text-sky-400 font-bold">$1</span>')
          .replace(/(-X [A-Z]+)/g, '<span class="text-amber-500 font-semibold">$1</span>')
          .replace(/(-H "[^"]+")/g, '<span class="text-purple-400">$1</span>')
          .replace(/(-d '[^']+')/g, '<span class="text-cyan-400">$1</span>')
          .replace(/("https:\/\/[^"]+")/g, '<span class="text-emerald-400 font-medium">$1</span>')
      } else if (lang === 'javascript') {
        lineHtml = lineHtml
          .replace(/\b(const|let|var|await|async|import|from|return)\b/g, '<span class="text-indigo-400 font-bold">$1</span>')
          .replace(/\b(fetch|console|log|json|stringify)\b/g, '<span class="text-sky-400 font-medium">$1</span>')
          .replace(/('[^']*')/g, '<span class="text-emerald-400">$1</span>')
          .replace(/(`[^`]*`)/g, '<span class="text-emerald-400 font-medium">$1</span>')
          .replace(/(\/\/.*)$/g, '<span class="text-slate-500 font-normal">$1</span>')
      } else if (lang === 'python') {
        lineHtml = lineHtml
          .replace(/\b(import|from|def|print|return|as|f)\b/g, '<span class="text-indigo-400 font-bold">$1</span>')
          .replace(/('[^']*')/g, '<span class="text-emerald-400">$1</span>')
          .replace(/("[^"]*")/g, '<span class="text-emerald-400">$1</span>')
          .replace(/(\s*#.*)$/g, '<span class="text-slate-500 font-normal">$1</span>')
      } else if (lang === 'go') {
        lineHtml = lineHtml
          .replace(/\b(package|import|func|main|defer|nil|err)\b/g, '<span class="text-indigo-400 font-bold">$1</span>')
          .replace(/("[^"]*")/g, '<span class="text-emerald-400">$1</span>')
          .replace(/(\/\/.*)$/g, '<span class="text-slate-500 font-normal">$1</span>')
      }

      return (
        <div key={idx} className="font-mono text-[12px] leading-relaxed text-slate-300" dangerouslySetInnerHTML={{ __html: lineHtml }} />
      )
    })
  }

  const toggleScope = (scope: string) => {
    if (appScopes.includes(scope)) {
      setAppScopes(appScopes.filter(s => s !== scope))
    } else {
      setAppScopes([...appScopes, scope])
    }
  }

  return (
    <div className="min-h-screen bg-[hsl(222,47%,6%)] text-slate-100 flex flex-col font-sans">
      {/* Decorative ambient gradients */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-orange-500/10 to-transparent pointer-events-none blur-[120px]" />
      <div className="absolute top-[800px] right-0 w-[400px] h-[400px] bg-blue-500/5 pointer-events-none blur-[150px]" />

      {/* Hero Header Area */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md relative overflow-hidden">
        <div className="max-w-[1440px] mx-auto section-padding py-12 relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-semibold mb-4">
              <Sparkles className="w-3 h-3" />
              CarUp Automotive Intelligence API v1.4
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-4">
              CarUp <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-500 to-amber-500">Developer Portal</span>
            </h1>
            <p className="text-slate-300 text-base md:text-lg leading-relaxed">
              Integrate premium, real-time Zimbabwe automotive records, AI market valuations (USD & ZiG), and certified 150-point mobile inspection diagnostics directly into your banking CRM, insurance underwriting system, or automotive portal.
            </p>
            <div className="flex flex-wrap gap-4 mt-6">
              <a href="#quickstart">
                <Button className="bg-orange-500 hover:bg-orange-600 text-white font-medium shadow-lg hover:shadow-orange-500/20 transition-all gap-2">
                  <Key className="w-4 h-4" />
                  Obtain API Key
                </Button>
              </a>
              <a href="#endpoints">
                <Button variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white gap-2">
                  <Code2 className="w-4 h-4" />
                  Explore Endpoints
                </Button>
              </a>
            </div>
          </div>

          <div className="lg:w-96 shrink-0 bg-slate-950/80 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden group shadow-2xl">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl group-hover:bg-orange-500/10 transition-all duration-500" />
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              API Server Health Node
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs pb-3 border-b border-slate-900">
                <span className="text-slate-400">Harare Edge Node</span>
                <span className="font-semibold text-emerald-400">99.98% Uptime</span>
              </div>
              <div className="flex justify-between items-center text-xs pb-3 border-b border-slate-900">
                <span className="text-slate-400">Avg Latency (CVR lookup)</span>
                <span className="font-semibold text-sky-400 font-mono">118ms</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">ZINARA Live Sync Status</span>
                <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                  Connected
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-[1440px] mx-auto section-padding py-12 flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        {/* Sticky Left Sidebar Navigation */}
        <aside className="lg:col-span-3 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto pr-4 space-y-8 scrollbar-thin">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <Input
              type="text"
              placeholder="Search API reference..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 placeholder-slate-500 focus-visible:ring-orange-500/50"
            />
          </div>

          {/* Quickstart Category */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-orange-500" />
              Getting Started
            </h4>
            <ul className="space-y-2 text-sm font-medium">
              <li>
                <a
                  href="#quickstart"
                  className="block px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-900/50 transition-all"
                >
                  Quickstart Guide
                </a>
              </li>
              <li>
                <a
                  href="#authorization"
                  className="block px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-900/50 transition-all"
                >
                  Authorization headers
                </a>
              </li>
              <li>
                <a
                  href="#api-key-gen"
                  className="block px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-900/50 transition-all border border-orange-500/20 bg-orange-500/5"
                >
                  API Key Generator
                </a>
              </li>
            </ul>
          </div>

          {/* API Endpoints Category */}
          <div id="endpoints">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-500" />
              Vehicle Intel endpoints
            </h4>
            <ul className="space-y-1.5">
              {filteredEndpoints.map(ep => (
                <li key={ep.id}>
                  <button
                    onClick={() => {
                      setActiveEndpointId(ep.id)
                      const target = document.getElementById(ep.id)
                      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-all flex items-start gap-2 ${
                      activeEndpointId === ep.id
                        ? 'bg-slate-900 text-orange-400 border border-slate-800'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                    }`}
                  >
                    <Badge className={`px-1.5 py-0 text-[9px] shrink-0 font-bold ${
                      ep.method === 'GET'
                        ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {ep.method}
                    </Badge>
                    <span className="truncate">{ep.name}</span>
                  </button>
                </li>
              ))}
              {filteredEndpoints.length === 0 && (
                <li className="text-slate-500 text-xs px-3 py-2">
                  No matching endpoints found.
                </li>
              )}
            </ul>
          </div>

          {/* Webhooks & Errors */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
              Resources
            </h4>
            <ul className="space-y-2 text-sm font-medium">
              <li>
                <a
                  href="#errors"
                  className="block px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-900/50 transition-all"
                >
                  Error Response Matrix
                </a>
              </li>
              <li>
                <a
                  href="#rate-limits"
                  className="block px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-900/50 transition-all"
                >
                  Rate Limits & Fair Use
                </a>
              </li>
            </ul>
          </div>
        </aside>

        {/* Core Multi-Column Content Area */}
        <main className="lg:col-span-9 space-y-16">
          
          {/* Quickstart Section */}
          <section id="quickstart" className="scroll-mt-24 space-y-6">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-orange-500" />
                Quickstart Integration Guide
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Begin syncing local vehicle intelligence in under 5 minutes.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <Card className="bg-slate-950/40 border-slate-800 hover:border-slate-700 transition-all">
                <CardHeader className="pb-2">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center font-bold text-orange-500 mb-2">
                    1
                  </div>
                  <CardTitle className="text-white text-base">Generate Keys</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400 leading-relaxed">
                  Log into your certified CarUp dealer or stakeholder portal and select the developer drawer to spawn active Secret Keys.
                </CardContent>
              </Card>

              <Card className="bg-slate-950/40 border-slate-800 hover:border-slate-700 transition-all">
                <CardHeader className="pb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center font-bold text-amber-500 mb-2">
                    2
                  </div>
                  <CardTitle className="text-white text-base">Authenticate</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400 leading-relaxed">
                  Pass your generated key inside the <code className="text-orange-400 px-1 py-0.5 rounded bg-slate-900 font-mono">Authorization: Bearer cu_live_...</code> HTTP header block of each query request.
                </CardContent>
              </Card>

              <Card className="bg-slate-950/40 border-slate-800 hover:border-slate-700 transition-all">
                <CardHeader className="pb-2">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center font-bold text-yellow-500 mb-2">
                    3
                  </div>
                  <CardTitle className="text-white text-base">Sync Records</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400 leading-relaxed">
                  Query CVR, ZINARA, custom duties logs, or push inspector logs to instantly trigger banking credit assessments or insurance payouts.
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Authorization Headers */}
          <section id="authorization" className="scroll-mt-24 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Key className="w-4.5 h-4.5 text-orange-500" />
              Authorization Headers
            </h3>
            <div className="p-5 rounded-lg bg-slate-950/40 border border-slate-800 space-y-4">
              <p className="text-slate-300 text-sm leading-relaxed">
                CarUp APIs use token-based bearer authentication. Authenticate your API requests by including your secret API key in the headers. Never expose keys in client-side code, mobile applications, or frontend HTML browsers.
              </p>
              <div className="font-mono text-xs p-4 rounded-md bg-slate-950 border border-slate-900 space-y-1.5">
                <div className="text-slate-400"># Pass this header with every request:</div>
                <div className="text-slate-200">
                  <span className="text-purple-400">Authorization:</span> Bearer <span className="text-emerald-400">cu_live_sec_7a8b9c0d1e2f3a4b...</span>
                </div>
                <div className="text-slate-200">
                  <span className="text-purple-400">Content-Type:</span> <span className="text-emerald-400">application/json</span>
                </div>
              </div>
            </div>
          </section>

          {/* Interactive API Key Generator Panel */}
          <section id="api-key-gen" className="scroll-mt-24">
            <Card className="bg-gradient-to-br from-slate-950/80 to-[hsl(222,47%,9%)] border-slate-800/80 overflow-hidden relative shadow-2xl">
              <div className="absolute top-0 right-0 w-48 h-48 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-white text-xl flex items-center gap-2">
                      <Sliders className="w-5 h-5 text-orange-500" />
                      Live API Key Generator Simulator
                    </CardTitle>
                    <CardDescription className="text-slate-400 text-xs">
                      Spawn sandbox tokens instantly to mock requests within your application's test environment.
                    </CardDescription>
                  </div>
                  <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    Developer Portal Utility
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <form onSubmit={handleGenerateKey} className="grid md:grid-cols-2 gap-6 items-end">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Application Name
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. Croco Motors CRM Sync"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      required
                      className="bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-600 focus-visible:ring-orange-500/50 focus-visible:border-orange-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Environment Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAppEnv('sandbox')}
                        className={`py-2 px-3 rounded-md text-xs font-semibold border transition-all ${
                          appEnv === 'sandbox'
                            ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Sandbox (Testing)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAppEnv('live')}
                        className={`py-2 px-3 rounded-md text-xs font-semibold border transition-all ${
                          appEnv === 'live'
                            ? 'bg-amber-500/10 border-amber-500 text-amber-400'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Live (Production)
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Token Scopes (Permissions)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'vehicles:read', label: 'Read CVR & ZINARA logs' },
                        { id: 'inspections:write', label: 'Push diagnostics audits' },
                        { id: 'valuations:read', label: 'Read AI valuation engine' }
                      ].map(scope => (
                        <button
                          key={scope.id}
                          type="button"
                          onClick={() => toggleScope(scope.id)}
                          className={`py-2 px-3 rounded-md text-xs text-left border transition-all flex items-center justify-between ${
                            appScopes.includes(scope.id)
                              ? 'bg-slate-900 border-slate-700 text-slate-200'
                              : 'bg-slate-900/30 border-slate-900 text-slate-600'
                          }`}
                        >
                          <span>{scope.label}</span>
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all text-[8px] font-bold ${
                            appScopes.includes(scope.id)
                              ? 'bg-orange-500 border-orange-600 text-white'
                              : 'border-slate-800'
                          }`}>
                            ✓
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2 mt-2">
                    <Button
                      type="submit"
                      disabled={keyGenerating || !appName.trim()}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-5"
                    >
                      {keyGenerating ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                          Registering App & Initiating Ledger Record...
                        </>
                      ) : (
                        'Generate Authenticated API Key'
                      )}
                    </Button>
                  </div>
                </form>

                {generatedKey && (
                  <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20 space-y-2 animate-fade-in-up">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">
                        Generated Sandbox Authorization Token
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        Active Scope Count: {appScopes.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-950 border border-slate-900 rounded px-4 py-3 font-mono text-sm text-slate-200 select-all overflow-x-auto whitespace-nowrap">
                        {generatedKey}
                      </div>
                      <Button
                        onClick={handleCopyKey}
                        className="bg-slate-900 border border-slate-800 text-slate-300 hover:text-white shrink-0 py-6"
                      >
                        {copiedKey ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      ⚠️ Keep this key secure. Authorization policies prevent resetting key once generated.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Endpoints Reference Split Section */}
          <section className="space-y-20">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-orange-500" />
                API Endpoints Reference Explorer
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Review complete inputs, query parameters, body payloads, and mock responses.
              </p>
            </div>

            {/* Split layout endpoints */}
            <div className="space-y-24">
              {ENDPOINTS.map((endpoint) => (
                <div
                  key={endpoint.id}
                  id={endpoint.id}
                  className="scroll-mt-24 grid grid-cols-1 xl:grid-cols-12 gap-8 border-b border-slate-900 pb-16 last:border-0 last:pb-0"
                >
                  
                  {/* Left Column: API Endpoint details & param tables */}
                  <div className="xl:col-span-7 space-y-6">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={`px-2 py-0.5 font-extrabold text-xs tracking-wide rounded ${
                          endpoint.method === 'GET'
                            ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {endpoint.method}
                        </Badge>
                        <code className="text-white font-mono text-sm font-semibold bg-slate-900 px-2 py-1 rounded">
                          {endpoint.url}
                        </code>
                      </div>

                      <h3 className="text-xl font-bold text-white">
                        {endpoint.name}
                      </h3>

                      <p className="text-slate-300 text-sm leading-relaxed">
                        {endpoint.description}
                      </p>
                    </div>

                    {/* Metadata boxes */}
                    <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-slate-950/40 border border-slate-900 text-xs">
                      <div>
                        <span className="text-slate-500 block uppercase tracking-wider font-bold mb-1">Auth Requirement</span>
                        <span className="text-slate-300 font-medium flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                          {endpoint.authLevel}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block uppercase tracking-wider font-bold mb-1">Rate Limit Allocation</span>
                        <span className="text-slate-300 font-medium flex items-center gap-1.5">
                          <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          {endpoint.rateLimit}
                        </span>
                      </div>
                    </div>

                    {/* Parameters Tables */}
                    {endpoint.queryParams && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          Query Parameters
                        </h4>
                        <div className="border border-slate-900 rounded-lg overflow-hidden">
                          <Table className="border-collapse">
                            <TableHeader className="bg-slate-950/80 border-slate-900">
                              <TableRow className="hover:bg-transparent border-slate-900">
                                <TableHead className="text-xs text-slate-400 font-bold w-1/4">Field</TableHead>
                                <TableHead className="text-xs text-slate-400 font-bold w-1/5">Type</TableHead>
                                <TableHead className="text-xs text-slate-400 font-bold">Details & Context</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody className="bg-slate-950/20">
                              {endpoint.queryParams.map((param) => (
                                <TableRow key={param.name} className="hover:bg-slate-900/10 border-slate-900">
                                  <TableCell className="font-mono text-xs font-bold text-slate-200">
                                    {param.name}
                                    {param.req && (
                                      <span className="text-orange-500 ml-1" title="Required">*</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-[11px] text-slate-400">
                                    {param.type}
                                  </TableCell>
                                  <TableCell className="text-xs text-slate-300 leading-relaxed py-3">
                                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                      {param.req ? (
                                        <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 text-[9px] px-1 py-0 font-bold">
                                          Required
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-slate-800 text-slate-400 text-[9px] px-1 py-0 font-bold">
                                          Optional
                                        </Badge>
                                      )}
                                      {param.def && (
                                        <span className="text-[10px] text-slate-500 font-mono">
                                          Default: {param.def}
                                        </span>
                                      )}
                                    </div>
                                    {param.desc}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {endpoint.bodyParams && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          Request Body Attributes
                        </h4>
                        <div className="border border-slate-900 rounded-lg overflow-hidden">
                          <Table className="border-collapse">
                            <TableHeader className="bg-slate-950/80 border-slate-900">
                              <TableRow className="hover:bg-transparent border-slate-900">
                                <TableHead className="text-xs text-slate-400 font-bold w-1/4">Field</TableHead>
                                <TableHead className="text-xs text-slate-400 font-bold w-1/5">Type</TableHead>
                                <TableHead className="text-xs text-slate-400 font-bold">Description</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody className="bg-slate-950/20">
                              {endpoint.bodyParams.map((param) => (
                                <TableRow key={param.name} className="hover:bg-slate-900/10 border-slate-900">
                                  <TableCell className="font-mono text-xs font-bold text-slate-200">
                                    {param.name}
                                    {param.req && (
                                      <span className="text-orange-500 ml-1" title="Required">*</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-[11px] text-slate-400">
                                    {param.type}
                                  </TableCell>
                                  <TableCell className="text-xs text-slate-300 leading-relaxed py-3">
                                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                      {param.req ? (
                                        <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 text-[9px] px-1 py-0 font-bold">
                                          Required
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-slate-800 text-slate-400 text-[9px] px-1 py-0 font-bold">
                                          Optional
                                        </Badge>
                                      )}
                                    </div>
                                    {param.desc}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {/* Endpoint Specific Live Sandbox Simulator (Only for Vehicle Lookup Endpoint) */}
                    {endpoint.id === 'get-vehicle' && (
                      <div className="p-5 rounded-lg border border-slate-800/80 bg-gradient-to-br from-slate-950/40 to-slate-900/20 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                            Live Sandbox Simulator
                          </h4>
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                            Harare Registry DB
                          </span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4 items-end">
                          <div className="space-y-1.5">
                            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                              Select Test Vehicle
                            </label>
                            <select
                              value={sandboxVin}
                              onChange={(e) => handlePresetVinChange(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
                            >
                              {Object.values(VEHICLE_PRESETS).map(preset => (
                                <option key={preset.vin} value={preset.vin}>
                                  {preset.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Button
                            onClick={handleTestRequest}
                            disabled={sandboxLoading}
                            className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-2 w-full flex items-center justify-center gap-2"
                          >
                            {sandboxLoading ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Syncing ZINARA Nodes...
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                Test API Request
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span>Simulating Live CVR & Tollgate violation validation logs using mock certificates.</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Code Console Component */}
                  <div className="xl:col-span-5 xl:sticky xl:top-24 xl:self-start">
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative">
                      {/* Terminal header */}
                      <div className="bg-slate-900 border-b border-slate-950 px-4 py-3 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
                            <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block" />
                            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                          </div>
                          <span className="text-slate-400 font-mono text-[11px] ml-2">bash terminal</span>
                        </div>
                        <button
                          onClick={handleCopyTerminal}
                          className="p-1 px-2 text-[10px] font-bold text-slate-400 hover:text-white rounded border border-slate-800 hover:border-slate-700 bg-slate-950/50 flex items-center gap-1.5 transition-all"
                        >
                          {copiedTerminal ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>

                      {/* Language selection tabs */}
                      <div className="bg-slate-950 border-b border-slate-900 px-4 flex justify-between items-center text-xs">
                        <div className="flex">
                          {(['curl', 'javascript', 'python', 'go'] as const).map(lang => (
                            <button
                              key={lang}
                              onClick={() => {
                                setSelectedLanguage(lang)
                                setTerminalView('request')
                              }}
                              className={`py-3 px-3.5 border-b-2 font-mono text-[11px] font-bold uppercase transition-all ${
                                selectedLanguage === lang && terminalView === 'request'
                                  ? 'border-orange-500 text-orange-400 bg-slate-900/20'
                                  : 'border-transparent text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              {lang}
                            </button>
                          ))}
                        </div>
                        <div className="flex h-full items-center pl-2 border-l border-slate-900/80">
                          <button
                            onClick={() => setTerminalView('response')}
                            className={`py-3 px-3 border-b-2 font-mono text-[11px] font-bold transition-all ${
                              terminalView === 'response'
                                ? 'border-amber-500 text-amber-400 bg-slate-900/20'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            Response (200 OK)
                          </button>
                        </div>
                      </div>

                      {/* Console Code View */}
                      <div className="p-4 bg-slate-950/80 max-h-[380px] overflow-auto scrollbar-thin select-text">
                        {sandboxLoading && terminalView === 'response' ? (
                          <div className="h-48 flex flex-col items-center justify-center text-slate-500 space-y-2">
                            <RefreshCw className="w-6 h-6 animate-spin text-orange-500" />
                            <span className="text-xs font-mono">GET /v1/vehicles/{sandboxVin}...</span>
                            <span className="text-[10px] text-slate-600">Querying ZINARA Central Registries Node</span>
                          </div>
                        ) : (
                          <div className="font-mono text-left whitespace-pre">
                            {terminalView === 'request' ? (
                              highlightCode(endpoint.codeSnippets[selectedLanguage], selectedLanguage)
                            ) : (
                              highlightCode(
                                endpoint.id === 'get-vehicle'
                                  ? JSON.stringify(sandboxResponse, null, 2)
                                  : endpoint.responsePayload,
                                'json'
                              )
                            )}
                          </div>
                        )}
                      </div>

                      {/* Diagnostic Status Footer */}
                      <div className="bg-slate-900/60 border-t border-slate-900/80 px-4 py-2 flex items-center justify-between text-[10px] font-mono text-slate-500">
                        <span>HTTP/1.1 200 OK</span>
                        <span>Size: ~1.2KB</span>
                        <span>DNS: Harare-Edge-01</span>
                      </div>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          </section>

          {/* Rate Limits & Error response code matrix */}
          <section className="grid md:grid-cols-2 gap-8 border-t border-slate-800 pt-16">
            
            {/* Rate Limits Card */}
            <div id="rate-limits" className="scroll-mt-24 space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Sliders className="w-4.5 h-4.5 text-orange-500" />
                Rate Limits & fair Use
              </h3>
              <div className="p-5 rounded-lg bg-slate-950/40 border border-slate-900 space-y-4 text-sm leading-relaxed text-slate-300">
                <p>
                  To secure the availability of ZINARA database nodes and avoid overloading infrastructure, CarUp enforces dynamic tier limits. Requests exceeding these bounds yield a <code className="text-red-400 font-mono bg-slate-900 px-1 py-0.5 rounded">429 Too Many Requests</code> response.
                </p>
                <Table className="border-slate-900">
                  <TableHeader>
                    <TableRow className="border-slate-900 hover:bg-transparent">
                      <TableHead className="text-xs font-bold text-slate-400">Sandbox Tier</TableHead>
                      <TableHead className="text-xs font-bold text-slate-400">Production Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="border-slate-900 hover:bg-transparent">
                      <TableCell className="text-slate-300 text-xs">
                        60 requests/min
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">
                        500 requests/min
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="text-xs text-slate-500">
                  💡 Contact the CarUp enterprise desk to negotiate high-throughput allocations for enterprise-wide batch vehicle screening audits.
                </p>
              </div>
            </div>

            {/* Error Response Codes Card */}
            <div id="errors" className="scroll-mt-24 space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-4.5 h-4.5 text-red-400" />
                Error Code Matrix
              </h3>
              <div className="p-5 rounded-lg bg-slate-950/40 border border-slate-900 space-y-4">
                <p className="text-slate-300 text-sm leading-relaxed">
                  CarUp employs standard HTTP response status protocol rules. In case of errors, the payload schema structure returns an error model object detailing the exception:
                </p>
                <div className="border border-slate-900 rounded overflow-hidden">
                  <Table className="border-collapse">
                    <TableHeader className="bg-slate-950/80 border-slate-900">
                      <TableRow className="hover:bg-transparent border-slate-900">
                        <TableHead className="text-xs text-slate-400 font-bold">Status</TableHead>
                        <TableHead className="text-xs text-slate-400 font-bold">Definition</TableHead>
                        <TableHead className="text-xs text-slate-400 font-bold">Typical Cause</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="bg-slate-950/20">
                      {[
                        { code: '400', name: 'Bad Request', desc: 'Missing required make, model, or invalid 17-char VIN query format.' },
                        { code: '401', name: 'Unauthorized', desc: 'Invalid, expired, or non-existent Secret bearer token passed.' },
                        { code: '404', name: 'Not Found', desc: 'The requested VIN query has no matches in CVR or ZINARA.' },
                        { code: '429', name: 'Rate Limit', desc: 'Your token exceeds its allocated requests minute burst rate.' }
                      ].map(err => (
                        <TableRow key={err.code} className="hover:bg-slate-900/10 border-slate-900">
                          <TableCell className="font-mono text-xs font-bold text-red-400">{err.code}</TableCell>
                          <TableCell className="text-xs text-slate-200 font-semibold">{err.name}</TableCell>
                          <TableCell className="text-xs text-slate-400 leading-normal py-2">{err.desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

          </section>

          {/* Support CTA Callout */}
          <section className="p-8 rounded-2xl bg-gradient-to-br from-orange-500/15 via-orange-500/5 to-transparent border border-orange-500/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-xl">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Code2 className="w-5 h-5 text-orange-500" />
                Need Custom Integrations?
              </h3>
              <p className="text-slate-300 text-sm mt-1 leading-relaxed">
                Our Harare-based engineering team works directly with Zimbabwean financial institutions, insurers, and high-volume dealers to design customized webhooks, private cloud deployments, and custom compliance systems.
              </p>
            </div>
            <Button
              asChild
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold py-6 px-6 shadow-xl hover:shadow-orange-500/20 transition-all shrink-0"
            >
              <Link to="/contact">Contact Developer Relations</Link>
            </Button>
          </section>

        </main>
      </div>
    </div>
  )
}
