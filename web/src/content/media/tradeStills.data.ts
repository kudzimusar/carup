/**
 * RX-06 — original editorial stills for Trade (Higgsfield, GPT Image 2.6), generated 2026-11-21 under the
 * Owner's in-chat authorization "Stills, up to 10 credits" (10 × 0.75 = 7.5 credits; no video).
 *
 * Every still is an ILLUSTRATION: unbadged vehicles, no readable text/plates/documents, no identifiable faces,
 * shown with a disclosure, and NEVER placed as a vehicle, document, shipment or customs record. Masters and
 * hashes: ~/carup-launch-evidence/rx06/media/. `review` stays 'owner-review' until the Owner approves the
 * exact image; production builds show only 'approved' stills (see tradeStills.ts).
 */
export type StillReview = 'approved' | 'owner-review'
export interface TradeStillAsset {
  key: string; alt: string; placement: string; review: StillReview
  disclosure: string
  width: number; height: number
  sources: { src: string; width: number; sha256: string; bytes: number }[]
  provenance: { generator: string; model: string; jobId: string; createdAt: string; prompt: string; credits: number; authorization: string }
  rights: { owner: string; licence: string; restrictions: string }
}

const DISCLOSURE = 'AI-generated illustration · not a vehicle, document or shipment record'
const RIGHTS = {
  owner: 'CarUp (Owner)',
  licence: 'Higgsfield-generated output under the account’s plan terms at generation time (starter plan)',
  restrictions: 'Editorial brand media only; never presented as inventory, evidence or a record; unbadged vehicles, no marks',
}
const AUTH = 'Owner chat decision 2026-11-21: "Stills, up to 10 credits" (CARUP-RX06-TRADE-UI-LR01)'

export const TRADE_STILLS: Record<string, TradeStillAsset> = {
  portDawn: {
    key: 'portDawn', alt: "Export port at dawn: lanes of unbadged cars on a quay, cranes against an orange sky", placement: 'entry', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-port-dawn-800.jpg', width: 800, sha256: '64e6185ea4f6721a2fa4bd5d47c4ee748c9ecb052c6a72f27da446c8138ce090', bytes: 82444 },
      { src: '/media/trade/trade-port-dawn-1344.jpg', width: 1344, sha256: '3bb6359c5583637e9324d947801cbeb7ef1b7279e736f952713fb7aa34de6ae0', bytes: 235872 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: 'c02a3333-ebff-455e-ac55-9602088379ac', createdAt: '2026-11-21T06:49:54Z', prompt: "A Japanese vehicle export port at dawn: neat lanes of generic unbadged hatchbacks and compact SUVs parked on the quay, gantry cranes silhouetted against a pale orange sky, calm water.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  containerLift: {
    key: 'containerLift', alt: "A container with an unbadged pickup inside being lifted at dusk", placement: 'phase:loading', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-container-lift-800.jpg', width: 800, sha256: 'b8eba3ece730245701fc100abcc837f3e9cccb4f7b25ccd2dfde6298f94746c2', bytes: 79596 },
      { src: '/media/trade/trade-container-lift-1344.jpg', width: 1344, sha256: '9a8d365b0c48fc05633a4327b9e089e6ca7305686b6ec37dc4bdff1e8d5ceb2a', bytes: 221019 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '1ae64771-9e86-4712-aa55-599f5a2bf274', createdAt: '2026-11-21T06:49:54Z', prompt: "A shipping container being lifted by a quay crane at dusk, container doors open, one generic unbadged pickup truck secured inside on wheel chocks, warm orange work light on the quay.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  seaCrossing: {
    key: 'seaCrossing', alt: "A container ship crossing open ocean at golden hour", placement: 'phase:sea', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-sea-crossing-800.jpg', width: 800, sha256: 'd3779cd5505ccd5050e9cc841a3692b955b206e7c5e69d71f64e5e9ea28e5cb0', bytes: 76720 },
      { src: '/media/trade/trade-sea-crossing-1344.jpg', width: 1344, sha256: '6872fbaef08256007c78680f0c96c74434b4e200ae0e160f0860c49b5fd1c3e5', bytes: 254765 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '136244e7-b424-4ad2-bc39-9323c946e5f7', createdAt: '2026-11-21T06:50:25Z', prompt: "A container ship crossing open ocean at golden hour, seen from a low aerial angle, long white wake, a single warm light on the bridge, plain hull with no visible name, logos or markings.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  borderGate: {
    key: 'borderGate', alt: "A car-carrier truck waiting at a border barrier at dusk, an officer in silhouette", placement: 'phase:customs', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-border-gate-800.jpg', width: 800, sha256: '2a9ba52171c5fde28bf9594f5732f4c6dc4cea37b011e4e8d94eb9fa0e3b5bb3', bytes: 66128 },
      { src: '/media/trade/trade-border-gate-1344.jpg', width: 1344, sha256: '53a64dc607b60723dd9d165b52e36b0e613b2f49477b0261515a245bc0b8f9f1', bytes: 209249 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: 'fc2c4afa-3fd6-4216-954d-6f7a0c813df8', createdAt: '2026-11-21T06:50:24Z', prompt: "A road border-post gate at dusk in southern Africa: a car-carrier truck loaded with generic unbadged cars waiting at a lowered barrier under sodium lights, the silhouette of an officer holding papers far out of focus.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  documentsDesk: {
    key: 'documentsDesk', alt: "A closed blank folder, a car key, a pen and tea on a dark desk", placement: 'phase:documents', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-documents-desk-800.jpg', width: 800, sha256: '87142b9dedc789723c88dce038580f43413040ce101cf49ac9aa546ce81ec040', bytes: 63613 },
      { src: '/media/trade/trade-documents-desk-1344.jpg', width: 1344, sha256: '545b2d1a527e6b619cb5291863ef3d7607bf71001a5b64062f4d6fcda8dbee8d', bytes: 248327 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: 'c72e5036-97f6-48c1-b321-2f38dddf62bc', createdAt: '2026-11-21T06:49:54Z', prompt: "Top-down still life on a dark wooden desk: a closed plain grey folder, a single car key on a ring, a pen and a cup of tea, soft window light from the left.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  roadworthyBay: {
    key: 'roadworthyBay', alt: "A sedan on a workshop lift, gloved hands with an inspection lamp", placement: 'phase:ready', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-roadworthy-bay-800.jpg', width: 800, sha256: '6dbb59b32ea9d087c36ca1afa5087f653f4842d1ab52e71355d340da29b3fd0c', bytes: 67564 },
      { src: '/media/trade/trade-roadworthy-bay-1344.jpg', width: 1344, sha256: '349f7050aca19ac8c35e207e1ea5a9d5d040e69c6c587eaf05e325643d19e5ec', bytes: 178879 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '5c504911-d8d8-4c01-814d-c9827def04bf', createdAt: '2026-11-21T06:50:25Z', prompt: "A clean vehicle workshop bay in the evening: a generic unbadged sedan raised on a two-post lift, a technician\u2019s gloved hands holding an inspection lamp under the car.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  handoverHarare: {
    key: 'handoverHarare', alt: "Two hands passing a car key under a jacaranda tree in Harare", placement: 'phase:handover', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-handover-harare-800.jpg', width: 800, sha256: '03f5809e90e3694ba2242bbf16c5eb32eb7bf8d286415a35f1329b5becfa28e0', bytes: 95327 },
      { src: '/media/trade/trade-handover-harare-1344.jpg', width: 1344, sha256: 'b8bd7ad2507a5e9a4b877f8fc3f3942908438e11b48905d96cd3db87fd20d839', bytes: 244527 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '30eb113f-4cf1-4532-9f6c-5d80c63babaf', createdAt: '2026-11-21T06:50:48Z', prompt: "Close shot of two hands passing a car key beside a generic unbadged SUV parked under a purple jacaranda tree in full bloom on a quiet suburban street in Harare, late-afternoon light. Faces out of frame.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  auctionYard: {
    key: 'auctionYard', alt: "Rows of unbadged compact cars in a misty auction yard at sunrise", placement: 'phase:request', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-auction-yard-800.jpg', width: 800, sha256: '4073a81292bec00e19c1bd08199d9b90d9e662562b8f1d2287a8e4231c3abe18', bytes: 62410 },
      { src: '/media/trade/trade-auction-yard-1344.jpg', width: 1344, sha256: 'dd7bad2a15fd51fd70740328d3424029949079ca76f5f3ca829c301a9e7fcdcc', bytes: 201182 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '8c941495-73f3-4350-8378-646ce28d4c45', createdAt: '2026-11-21T06:50:48Z', prompt: "An orderly used-car auction yard in Japan at early morning: long rows of generic unbadged compact cars and hatchbacks, light mist, a warm orange sunrise glow.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  containerYard: {
    key: 'containerYard', alt: "A container yard at blue hour, one open container with two cars inside", placement: 'tool:containers', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-container-yard-800.jpg', width: 800, sha256: '40f92633a33e0672ce3884c34e7e3941cce9dbcc978058bbffd036b7f2db3f87', bytes: 55754 },
      { src: '/media/trade/trade-container-yard-1344.jpg', width: 1344, sha256: 'ce69d227ec6745e8450ed3ed1dc4c2bdcabc18b0d8a308524513a2632f51b3b7', bytes: 171187 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '4d06026b-1176-40d7-8373-aee4587b450f', createdAt: '2026-11-21T06:50:48Z', prompt: "A shipping container yard at blue hour: stacks of plain unmarked containers, one container with its doors open showing two generic unbadged cars loaded nose to tail inside, a single orange floodlight.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
  dealerForecourt: {
    key: 'dealerForecourt', alt: "Five unbadged cars under a dealer canopy at dusk", placement: 'tool:stock', review: 'owner-review', disclosure: DISCLOSURE,
    width: 1344, height: 752,
    sources: [
      { src: '/media/trade/trade-dealer-forecourt-800.jpg', width: 800, sha256: 'ef4ce777a5493b5824abf076041eaee8a67fa266ccff9dff6e4e50f3c762d385', bytes: 80058 },
      { src: '/media/trade/trade-dealer-forecourt-1344.jpg', width: 1344, sha256: '3b0fe79a6806a5763c32f978120b45204b4293633327ccb0f94f466ab61c9001', bytes: 250419 },
    ],
    provenance: { generator: 'Higgsfield', model: 'gpt_image_2_6', jobId: '414f440e-bad6-4f7f-8560-e2a2c5de1b9e', createdAt: '2026-11-21T06:49:54Z', prompt: "A small premium car dealer forecourt at dusk in southern Africa: five generic unbadged vehicles angled under a simple modern canopy with warm downlights, empty clean forecourt.", credits: 0.75, authorization: AUTH },
    rights: RIGHTS,
  },
}
