-- CARUP-MVP-STAB-01 — staging reconciliation queries (READ-ONLY).
-- Target: staging Supabase eoyenigwevnxwwhyhaer ONLY. Never run against Production (vhmnajoeicasaigiophh).
-- Every statement below is a SELECT. Nothing here inserts, updates, deletes, archives or re-queues.
-- Classification uses attributable provenance only (reserved test domains per RFC 2606 / RFC 6761, explicit fixture
-- markers written by the product's own automation rules, and governed quarantine records). Age, repeated wording or
-- volume alone never classifies a row as synthetic.

-- Q1. Account email-domain classes (reserved test domains are undeliverable by definition).
with u as (select id, role, lower(split_part(coalesce(email,''),'@',2)) as dom, created_at from public.users)
select case
         when dom = '' then 'no_email'
         when dom in ('example.com','example.net','example.org') or dom ~ '(\.example|\.test|\.invalid|\.localhost|\.local)$'
           then 'reserved_test_domain'
         else 'public_or_other_domain' end as cls,
       role, count(*) as n, min(created_at)::date as first, max(created_at)::date as last
from u group by 1, 2 order by 1, 2;

-- Q2. Vehicles by publication state, commerce state, explicit automation marker and owner-domain class.
with u as (select id, case when lower(split_part(coalesce(email,''),'@',2)) in ('example.com','example.net','example.org')
                             or lower(split_part(coalesce(email,''),'@',2)) ~ '(\.example|\.test|\.invalid|\.localhost|\.local)$'
                           then 'reserved' when email is null then 'none' else 'public' end as dom from public.users)
select v.publication_status, v.status,
       coalesce(v.seller_description,'') like 'Golden Dynamic Seller%' as golden_fixture,
       coalesce(uo.dom,'no_owner_row') as owner_dom, count(*) as n
from public.vehicles v left join u uo on uo.id = v.owner_id
group by 1, 2, 3, 4 order by 1, 2, 3, 4;

-- Q3. Inquiry ↔ canonical conversation linkage (canonical key: subject_type='marketplace_inquiry', subject_id=inquiry id).
with link as (select subject_id as inquiry_id, count(*) as n_threads, bool_or(metadata ? 'marketplace_inquiry_id') as exact_stamped
              from public.message_threads where subject_type = 'marketplace_inquiry' group by subject_id),
ev as (select payload->>'inquiryId' as inquiry_id, status, quarantine_reason
       from public.domain_events where event_type = 'marketplace.inquiry.created')
select count(*) as inquiries,
       count(*) filter (where link.inquiry_id is not null) as with_conversation,
       count(*) filter (where link.n_threads > 1) as with_duplicate_threads,
       count(*) filter (where link.inquiry_id is not null and not link.exact_stamped) as conversation_legacy_unstamped,
       count(*) filter (where link.inquiry_id is null) as without_conversation,
       count(*) filter (where link.inquiry_id is null and ev.quarantine_reason = 'STALE_HISTORICAL_QUARANTINE') as wo_conv_stale_quarantine,
       count(*) filter (where link.inquiry_id is null and ev.quarantine_reason = 'SUPERSEDED_HISTORICAL_WORK') as wo_conv_superseded_quarantine,
       count(*) filter (where link.inquiry_id is null and ev.inquiry_id is null) as wo_conv_no_event,
       count(*) filter (where link.inquiry_id is null and ev.status is not null and ev.status <> 'quarantined') as wo_conv_other_event_state
from public.marketplace_inquiries i
left join link on link.inquiry_id = i.id::text
left join ev on ev.inquiry_id = i.id::text;

-- Q4. Serena (GFC27-027051) inquiries and their conversations.
with inq as (select id, buyer_id is null as guest, source_channel, created_at from public.marketplace_inquiries
             where listing_id = 'GFC27-027051'),
th as (select subject_id as inquiry_id, id from public.message_threads where subject_type = 'marketplace_inquiry')
select count(*) as inquiries, count(th.id) as conversations,
       count(*) filter (where th.id is null) as inquiries_without_conversation,
       count(*) filter (where guest) as guest_inquiries,
       count(*) filter (where source_channel = 'mobile') as native_inquiries
from inq left join th on th.inquiry_id = inq.id::text;

-- Q5. Garage onboarding consistency (registration intent vs application ledger).
select p.intended_use, p.business_type, p.onboarding_status, count(*) as profiles,
       count(a.id) as with_garage_application
from public.user_registration_profiles p
left join public.garage_applications a on a.applicant_user_id = p.user_id
where p.intended_use = 'professional_services'
group by 1, 2, 3 order by 1, 2, 3;

-- Q6. Container sailings: stored lifecycle vs current booking eligibility.
select status, count(*) as n,
       count(*) filter (where booking_deadline < now()) as deadline_passed,
       count(*) filter (where departure_date < now()) as departed
from public.diaspora_container_shipments group by status order by status;

-- Q7. Reservations created after the sailing's booking deadline, and reservations still awaiting review on departed sailings.
select r.reservation_status, c.status as sailing_status,
       (c.booking_deadline < now()) as deadline_passed, (c.departure_date < now()) as departed,
       count(*) as n, count(*) filter (where r.created_at > c.booking_deadline) as created_after_deadline
from public.diaspora_cargo_reservations r join public.diaspora_container_shipments c on c.id = r.container_id
where r.deleted_at is null group by 1, 2, 3, 4 order by 2, 1, 3, 4;

-- Q8. Latent external sends: notification rows that a future outbound release would attempt.
select channel, status, count(*) as n, min(created_at)::date as first, max(created_at)::date as last
from public.notification_queue
where channel in ('email','whatsapp','telegram','sms','push') and status in ('pending','queued','retry_scheduled','processing')
group by 1, 2 order by 1, 2;

-- Q9. Commerce-status spelling drift on vehicles.
select status, count(*) as n from public.vehicles group by status order by status;
