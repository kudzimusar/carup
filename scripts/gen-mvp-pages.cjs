const fs = require('fs');
const path = require('path');

const templates = {
  // GROUP 1
  'web/src/pages/dashboard/ambassador/referrals.tsx': `export default function AmbassadorDashboard() { return <div>Ambassador Dashboard: Status, Code, QR, Campaigns, Leads, Conversions, Rewards, Tier</div>; }`,
  'web/src/pages/dashboard/receiver/referrals.tsx': `export default function ReceiverDashboard() { return <div>Receiver Page: Payer, Shipment, Status, Handover, Invite</div>; }`,
  'web/src/pages/dashboard/parts-referrals.tsx': `export default function PartsSupplierDashboard() { return <div>Mechanic/Parts Page: Customer, Vehicle, Part, Request Status, Reward</div>; }`,
  'web/src/pages/admin/referrals/assisted-leads.tsx': `export default function AgentDepotPage() { return <div>Agent/Depot Page: Register Assisted Lead, Validate QR, Reference</div>; }`,
  
  // GROUP 2
  'web/src/pages/marketplace/buyer-referral.tsx': `export default function BuyerReferral() { return <div>Buyer Referral Capture: Code, Valid code check, Discount</div>; }`,
  'web/src/pages/dashboard/seller/listing-referral.tsx': `export default function SellerListingReferral() { return <div>Seller Listing Referral: Link, QR, Milestone, Reward status</div>; }`,
  'web/src/pages/public/parts-request.tsx': `export default function PartsRequest() { return <div>Parts Request Form: Vehicle details, Part description, Photo, Referral Code, Quote Status</div>; }`,
  'web/src/pages/admin/vehicle-import.tsx': `export default function VehicleImportMilestones() { return <div>Vehicle Import Milestones: Quote, Deposit, Inspection, Shipment, Customs, Delivery</div>; }`,
  'web/src/pages/public/container-space/[campaignId].tsx': `export default function ContainerBooking() { return <div>Public Container Booking: Dates, Capacity, Waitlist, Share</div>; }`,
  
  // GROUP 3
  'web/src/pages/admin/referrals/rewards.tsx': `export default function RewardOperations() { return <div>Reward Operations: Approve, Hold, Block, Reverse, CSV Payout Export</div>; }`,
  'web/src/pages/admin/trust/fraud.tsx': `export default function FraudChecks() { return <div>Fraud Checks: Duplicate Phone/Email, Excessive Velocity, Self-referral</div>; }`,
  'web/src/pages/dashboard/referrals/preferences.tsx': `export default function ConsentPreferences() { return <div>Consent and Preferences: WhatsApp, Email, Language, Opt-in</div>; }`,
  
  // GROUP 4
  'web/src/pages/admin/referrals/marketing.tsx': `export default function MultilingualDrafts() { return <div>Multilingual Drafts: English, Shona, Ndebele. Needs Human Approval</div>; }`,
  'web/src/pages/admin/referrals/analytics.tsx': `export default function Analytics() { return <div>Analytics: Visits, Leads, Conversions, Cost, CSV Export</div>; }`,
  'mobile/app/(tabs)/receiver.tsx': `import React from 'react'; import { View, Text } from 'react-native'; export default function MobileReceiver() { return <View><Text>Mobile Receiver: Tracking, Handover, Share</Text></View>; }`,
  'mobile/app/(tabs)/ambassador.tsx': `import React from 'react'; import { View, Text } from 'react-native'; export default function MobileAmbassador() { return <View><Text>Mobile Ambassador: Code, QR, Campaigns, Rewards</Text></View>; }`,
};

for (const [filePath, content] of Object.entries(templates)) {
  const fullPath = path.join(__dirname, '..', filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('Created:', filePath);
}
