import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  RUN_PREFIX,
  TEST_TIMEOUT_MS,
  assertExactlyOneWinner,
  connectClient,
  runConcurrentQueries,
  runWithVerifiedCleanup,
  seedActor,
  skipReason,
} from './diaspora-staging-test-utils.js';

test('staging: concurrent container approvals cannot overfill capacity', { skip: skipReason, timeout: TEST_TIMEOUT_MS }, async () => {
  const db = await connectClient(`${RUN_PREFIX}_capacity_control`);
  const orderId = randomUUID();
  const containerId = randomUUID();
  const reservationIds = [randomUUID(), randomUUID()];
  let actorId;

  try {
    await runWithVerifiedCleanup(async () => {
      actorId = await seedActor(db, 'capacity');
      await db.query(
        `INSERT INTO public.diaspora_import_orders
           (id,buyer_id,order_type,origin_country,destination_country,created_by,updated_by)
         VALUES ($1,$2,'parts','Japan','Zimbabwe',$2,$2)`,
        [orderId, actorId],
      );
      await db.query(
        `INSERT INTO public.diaspora_container_shipments
           (id,origin_country,origin_city,destination_country,destination_city,
            departure_date,booking_deadline,container_type,total_capacity_volume,
            used_capacity_volume,available_capacity_volume,status,created_by,updated_by)
         VALUES ($1,'Japan','Yokohama','Zimbabwe','Harare',
                 now()+interval '30 days',now()+interval '7 days','40FT',10,0,10,
                 'BOOKING_OPEN',$2,$2)`,
        [containerId, actorId],
      );
      await db.query(
        `INSERT INTO public.diaspora_cargo_reservations
           (id,container_id,import_order_id,buyer_id,cargo_type,estimated_volume,
            reservation_status,created_by,updated_by)
         VALUES ($1,$3,$4,$5,'parts',6,'REQUESTED',$5,$5),
                ($2,$3,$4,$5,'parts',6,'REQUESTED',$5,$5)`,
        [reservationIds[0], reservationIds[1], containerId, orderId, actorId],
      );

      const text = `SELECT public.diaspora_approve_cargo_reservation_atomic($1,$2,true,NULL,NULL) AS result`;
      const outcomes = await runConcurrentQueries(
        { text, values: [reservationIds[0], actorId] },
        { text, values: [reservationIds[1], actorId] },
      );
      assertExactlyOneWinner(outcomes, /DIASPORA_CONTAINER\/OVERFILL/);

      const reservations = await db.query(
        `SELECT id,reservation_status FROM public.diaspora_cargo_reservations
          WHERE id = ANY($1::uuid[])`,
        [reservationIds],
      );
      assert.deepEqual(
        reservations.rows.map((row) => row.reservation_status).sort(),
        ['APPROVED', 'REQUESTED'],
      );

      const container = await db.query(
        `SELECT total_capacity_volume::float8 AS total,
                used_capacity_volume::float8 AS used,
                available_capacity_volume::float8 AS available
           FROM public.diaspora_container_shipments WHERE id=$1`,
        [containerId],
      );
      assert.deepEqual(container.rows[0], { total: 10, used: 6, available: 4 });

      const approved = await db.query(
        `SELECT count(*)::int AS rows,
                COALESCE(sum(estimated_volume),0)::float8 AS volume
           FROM public.diaspora_cargo_reservations
          WHERE container_id=$1 AND reservation_status='APPROVED'`,
        [containerId],
      );
      assert.deepEqual(approved.rows[0], { rows: 1, volume: 6 });

      const audit = await db.query(
        `SELECT count(*)::int AS rows FROM public.diaspora_import_audit_log
          WHERE import_order_id=$1 AND action='CARGO_RESERVATION_APPROVED'`,
        [orderId],
      );
      assert.equal(audit.rows[0].rows, 1);
    }, async () => {
      await db.query(`DELETE FROM public.diaspora_import_audit_log WHERE import_order_id=$1`, [orderId]);
      await db.query(`DELETE FROM public.diaspora_cargo_reservations WHERE id = ANY($1::uuid[])`, [reservationIds]);
      await db.query(`DELETE FROM public.diaspora_container_shipments WHERE id=$1`, [containerId]);
      await db.query(`DELETE FROM public.diaspora_import_orders WHERE id=$1`, [orderId]);
      if (actorId) await db.query(`DELETE FROM public.users WHERE id=$1`, [actorId]);

      const left = await db.query(
        `SELECT
          (SELECT count(*)::int FROM public.diaspora_import_audit_log WHERE import_order_id=$1) AS audits,
          (SELECT count(*)::int FROM public.diaspora_cargo_reservations WHERE id = ANY($2::uuid[])) AS reservations,
          (SELECT count(*)::int FROM public.diaspora_container_shipments WHERE id=$3) AS containers,
          (SELECT count(*)::int FROM public.diaspora_import_orders WHERE id=$1) AS orders,
          (SELECT count(*)::int FROM public.users WHERE id=$4) AS actors`,
        [orderId, reservationIds, containerId, actorId || 'not-created'],
      );
      assert.deepEqual(left.rows[0], { audits: 0, reservations: 0, containers: 0, orders: 0, actors: 0 });
    });
  } finally {
    await db.end();
  }
});
