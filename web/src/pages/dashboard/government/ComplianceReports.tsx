import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Download } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'

export default function ComplianceReports() {
  const { fetchComplianceReports } = useCarUpApi()
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchComplianceReports()
        if (Array.isArray(data)) {
          setReports(data)
        } else if (data && Array.isArray(data.reports)) {
          setReports(data.reports)
        } else {
          setReports([])
        }
      } catch (err) {
        toast.error('Failed to load compliance reports')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fetchComplianceReports])

  const handleDownload = (report: any) => {
    toast.promise(
      new Promise((resolve) => setTimeout(resolve, 2000)),
      {
        loading: `Downloading ${report.title}...`,
        success: `${report.title} downloaded successfully!`,
        error: 'Failed to download report'
      }
    )
  }

  const totalReports = reports.length
  const generatedCount = reports.filter(r => r.status === 'generated').length
  const pendingCount = reports.filter(r => r.status === 'pending').length
  const complianceRate = totalReports ? ((generatedCount / totalReports) * 100).toFixed(1) + '%' : '0%'
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Compliance Reports</h1>
        <p className="text-gray-500">Generate and download regulatory reports</p>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Reports</p><p className="text-2xl font-bold">{loading ? <Skeleton className="h-8 w-12 mt-1" /> : totalReports}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Generated (Mo)</p><p className="text-2xl font-bold text-green-600">{loading ? <Skeleton className="h-8 w-12 mt-1" /> : generatedCount}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Pending</p><p className="text-2xl font-bold text-amber-600">{loading ? <Skeleton className="h-8 w-12 mt-1" /> : pendingCount}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Compliance Rate</p><p className="text-2xl font-bold text-green-600">{loading ? <Skeleton className="h-8 w-16 mt-1" /> : complianceRate}</p></CardContent></Card>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array(4).fill(0).map((_, i) => (
            <Card key={i} className="border-0 card-shadow">
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))
        ) : reports.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed">
            No compliance reports found.
          </div>
        ) : (
          reports.map((report) => (
            <Card key={report.id} className="border-0 card-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium">{report.title}</h3>
                      <Badge className={report.status === 'generated' ? 'bg-green-500' : 'bg-amber-500'}>{report.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>Type: {report.type}</span>
                      <span>Date: {report.date}</span>
                      <span>Size: {report.size || '-'}</span>
                    </div>
                  </div>
                  {report.status === 'generated' && (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => handleDownload(report)}>
                      <Download className="w-4 h-4" /> Download
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}