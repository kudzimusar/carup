import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronLeft, 
  ChevronRight, 
  X, 
  FileText, 
  ImageIcon, 
  CheckCircle,
  Maximize2
} from 'lucide-react';
import type { VehicleEvidence } from '@/types';

interface PremiumEvidenceGalleryProps {
  evidence: VehicleEvidence[];
}

export function PremiumEvidenceGallery({ evidence }: PremiumEvidenceGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Filter based on privacy rules: verified and public_safe
  const publicEvidence = evidence.filter(
    (e) => e.verification_status === 'verified' && e.visibility_level === 'public_safe'
  );

  // Group by evidence_type
  const groupedEvidence = publicEvidence.reduce((acc, curr) => {
    const type = curr.evidence_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(curr);
    return acc;
  }, {} as Record<string, VehicleEvidence[]>);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isLightboxOpen || selectedIndex === null) return;
      if (e.key === 'ArrowRight') {
        setSelectedIndex((prev) => (prev !== null ? (prev + 1) % publicEvidence.length : 0));
      } else if (e.key === 'ArrowLeft') {
        setSelectedIndex((prev) => (prev !== null ? (prev - 1 + publicEvidence.length) % publicEvidence.length : 0));
      } else if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    },
    [isLightboxOpen, selectedIndex, publicEvidence.length]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const openLightbox = (index: number) => {
    setSelectedIndex(index);
    setIsLightboxOpen(true);
  };

  const closeLightbox = () => {
    setIsLightboxOpen(false);
    setSelectedIndex(null);
  };

  const formatLabel = (val?: string) => {
    return (val || 'evidence')
      .split('_')
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  };

  if (publicEvidence.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400" data-testid="evidence-empty-state">
        <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No verified evidence published yet</p>
        <p className="text-xs mt-1">Evidence must be verified and public-safe to appear here.</p>
      </div>
    );
  }

  const selectedItem = selectedIndex !== null ? publicEvidence[selectedIndex] : null;

  return (
    <div className="space-y-8" data-testid="evidence-timeline">
      <div data-testid="premium-evidence-gallery" className="space-y-8">
        {Object.entries(groupedEvidence).map(([type, items]) => (
          <div key={type} className="space-y-4" data-testid={`gallery-group-${type}`}>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            {formatLabel(type)}
            <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-normal">
              {items.length} item{items.length !== 1 ? 's' : ''}
            </Badge>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {items.map((item) => {
              const globalIndex = publicEvidence.findIndex((e) => e.id === item.id);
              // `file_url` is NULL for a withheld private artifact, so it can never be dereferenced here.
              // Golden A's fixture is all-PDF, so `mime_type` short-circuits first and masked this —
              // an accepted JPEG/PNG document in the private bucket would have crashed the page.
              const isWithheld = !item.file_url;
              const isDocument = item.mime_type?.includes('pdf') || item.file_url?.endsWith('.pdf') || item.evidence_type.includes('document');

              return (
                <div 
                  key={item.id} 
                  className="relative group rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer aspect-square"
                  onClick={() => openLightbox(globalIndex)}
                  data-testid="evidence-timeline-item"
                >
                  {isWithheld ? (
                    /* The RECORD is published; the FILE is not. Saying so beats an <img src={null}>,
                       which renders a broken-image glyph and reads as "this evidence is damaged"
                       rather than "CarUp reviewed this and is not publishing the document". */
                    <div
                      className="w-full h-full bg-gray-50 flex flex-col items-center justify-center p-4"
                      data-testid="evidence-file-withheld"
                    >
                      <FileText className="w-10 h-10 text-gray-300 mb-2" />
                      <p className="text-xs text-center text-gray-500 font-medium line-clamp-2">
                        {formatLabel(item.evidence_type)}
                      </p>
                      <p className="mt-1 text-[10px] text-center text-gray-400 leading-tight">
                        Reviewed · file not published
                      </p>
                    </div>
                  ) : isDocument ? (
                    <div className="w-full h-full bg-gray-50 flex flex-col items-center justify-center p-4">
                      <FileText className="w-10 h-10 text-orange-400 mb-2" />
                      <p className="text-xs text-center text-gray-500 font-medium line-clamp-2">
                        {formatLabel(item.evidence_type)}
                      </p>
                    </div>
                  ) : (
                    <img
                      src={item.file_url}
                      alt={formatLabel(item.evidence_type)}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  )}
                  
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="w-6 h-6 text-white" />
                  </div>
                  
                  {/* Badges */}
                  <div className="absolute top-2 left-2 flex gap-1">
                    <Badge className="bg-green-500/90 hover:bg-green-500 text-[10px] text-white border-0 py-0 h-4 px-1.5 shadow-sm">
                      <CheckCircle className="w-2.5 h-2.5 mr-1" />
                      Verified
                    </Badge>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-6 pointer-events-none">
                    <p className="text-[10px] text-white/90">
                      {item.captured_at ? new Date(item.captured_at).toLocaleDateString() : (item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString() : '')}
                    </p>
                    {item.trust_score_impact > 0 && (
                      <p className="text-[10px] font-bold text-green-400">+{item.trust_score_impact} Trust</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </div>

      {/* Lightbox Dialog */}
      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent className="max-w-[95vw] w-full max-h-[95vh] h-full p-0 bg-black border-none flex flex-col sm:flex-row overflow-hidden" data-testid="lightbox-dialog">
          
          {/* Main Content Area (Image/PDF) */}
          <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden group">
            {selectedItem && (
              <>
                {!selectedItem.file_url ? (
                  /* A withheld artifact has nothing to open. Offering "Open PDF in New Tab" on a
                     null href would navigate the user to the current page and look like a fault. */
                  <div
                    className="w-full h-full flex flex-col items-center justify-center bg-gray-900 p-8"
                    data-testid="lightbox-file-withheld"
                  >
                    <FileText className="w-24 h-24 text-gray-600 mb-4" />
                    <p className="text-white text-lg font-medium mb-2">
                      {formatLabel(selectedItem.evidence_type)}
                    </p>
                    <p className="text-gray-400 text-sm text-center max-w-md">
                      CarUp reviewed this document and verified it. The file itself is not published.
                    </p>
                  </div>
                ) : (selectedItem.mime_type?.includes('pdf') || selectedItem.file_url?.endsWith('.pdf') || selectedItem.evidence_type.includes('document')) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 p-8">
                    <FileText className="w-24 h-24 text-gray-500 mb-4" />
                    <p className="text-white text-lg font-medium mb-6">Document Viewer</p>
                    <a 
                      href={selectedItem.file_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-full font-medium transition-colors"
                    >
                      Open PDF in New Tab
                    </a>
                  </div>
                ) : (
                  <img
                    src={selectedItem.file_url}
                    alt={formatLabel(selectedItem.evidence_type)}
                    className="max-w-full max-h-full object-contain cursor-zoom-in"
                    // Optionally wrap with a pan/zoom library, but for Phase 2 basic is fine
                  />
                )}
              </>
            )}

            {/* Navigation Controls */}
            {publicEvidence.length > 1 && (
              <>
                <button
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 z-10"
                  onClick={(e) => { e.stopPropagation(); setSelectedIndex((prev) => (prev !== null ? (prev - 1 + publicEvidence.length) % publicEvidence.length : 0)); }}
                  data-testid="lightbox-prev"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 z-10"
                  onClick={(e) => { e.stopPropagation(); setSelectedIndex((prev) => (prev !== null ? (prev + 1) % publicEvidence.length : 0)); }}
                  data-testid="lightbox-next"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              </>
            )}

            <button
              className="absolute top-4 right-4 sm:hidden w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center z-10"
              onClick={closeLightbox}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Sidebar Info Area */}
          <div className="w-full sm:w-80 bg-zinc-900 border-l border-zinc-800 p-6 flex flex-col shrink-0 z-20">
            <div className="hidden sm:flex justify-end mb-6">
              <button onClick={closeLightbox} className="text-zinc-400 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {selectedItem && (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <Badge className="bg-green-500/20 text-green-400 border border-green-500/30 mb-4 pointer-events-none">
                  <CheckCircle className="w-3 h-3 mr-1.5" /> Verified
                </Badge>
                
                <h2 className="text-xl font-bold text-white mb-2">
                  {formatLabel(selectedItem.evidence_type)}
                </h2>
                
                <div className="space-y-4 mt-6">
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">Date</p>
                    <p className="text-sm text-zinc-200">
                      {selectedItem.captured_at ? new Date(selectedItem.captured_at).toLocaleDateString() : (selectedItem.uploaded_at ? new Date(selectedItem.uploaded_at).toLocaleDateString() : 'Unknown')}
                    </p>
                  </div>
                  
                  {selectedItem.uploader_role && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Source</p>
                      <p className="text-sm text-zinc-200">{formatLabel(selectedItem.uploader_role)}</p>
                    </div>
                  )}

                  {selectedItem.linked_registry_event_id && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Linked Registry Event</p>
                      <p className="text-xs font-mono text-zinc-300 bg-zinc-800 px-2 py-1 rounded inline-block">
                        {selectedItem.linked_registry_event_id}
                      </p>
                    </div>
                  )}

                  {selectedItem.trust_score_impact > 0 && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Trust Impact</p>
                      <p className="text-sm font-bold text-green-400">+{selectedItem.trust_score_impact} Points</p>
                    </div>
                  )}
                  
                  {selectedItem.verification_notes && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Verification Notes</p>
                      <p className="text-sm text-zinc-300 italic">"{selectedItem.verification_notes}"</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Gallery Strip at bottom of sidebar */}
            <div className="mt-6 pt-6 border-t border-zinc-800">
              <p className="text-xs text-zinc-500 mb-3">Gallery ({selectedIndex !== null ? selectedIndex + 1 : 0} of {publicEvidence.length})</p>
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {publicEvidence.map((item, idx) => {
                  const isDoc = item.mime_type?.includes('pdf') || item.file_url?.endsWith('.pdf') || item.evidence_type.includes('document');
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedIndex(idx)}
                      className={`flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 transition-all ${idx === selectedIndex ? 'border-orange-500 opacity-100' : 'border-transparent opacity-50 hover:opacity-100'}`}
                    >
                      {isDoc ? (
                        <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                          <FileText className="w-6 h-6 text-zinc-500" />
                        </div>
                      ) : (
                        <img src={item.file_url} className="w-full h-full object-cover" alt="" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
