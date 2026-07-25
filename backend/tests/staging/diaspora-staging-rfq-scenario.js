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

test('staging: concurrent RFQ acceptance has one winner', { skip: skipReason, timeout: TEST_TIMEOUT_MS }, async () => {
  const db = await connectClient(`${RUN_PREFIX}_rfq_control`);
  const orderId = randomUUID();
  const quoteIds = [randomUUID(), randomUUID()];
  let actorId;

  try {
    await runWithVerifiedCleanup(async () => {
      actorId = await seedActor(db, 'rfq');
      await db.query(
        `INSERT INTO public.diaspora_import_orders
           (id,buyer_id,order_type,origin_country,destination_country,status,metadata,created_by,updated_by)
         VALUES ($1,$2,'parts','Japan','Zimbabwe','QUOTE_ISSUED','{}'::jsonb,$2,$2)`,
        [orderId, actorId],
      );
      await db.query(
        `INSERT INTO public.diaspora_import_quotes
           (id,import_order_id,seller_id,quote_amount,quote_currency,status,created_by,updated_by)
         VALUES ($1,$3,$4,1000,'USD','ISSUED',$4,$4),
                ($2,$3,$4,1100,'USD','ISSUED',$4,$4)`,
        [quoteIds[0], quoteIds[1], orderId, actorId],
      );

      const text = `SELECT public.diaspora_accept_quote_atomic($1,$2,$3,NULL,true) AS result`;
      const outcomes = await runConcurrentQueries(
        { text, values: [orderId, quoteIds[0], actorId] },
        { text, values: [orderId, quoteIds[1], actorId] },
      );
      assertExactlyOneWinner(outcomes, /DIASPORA_QUOTE\/ALREADY_ACCEPTED_DIFFERENT/);

      const quotes = await db.query(
        `SELECT id,status FROM public.diaspora_import_quotes
          WHERE id = ANY($1::uuid[])`,
        [quoteIds],
      );
      assert.deepEqual(quotes.rows.map((row) => row.status).sort(), ['ACCEPTED', 'REJECTED']);
      const acceptedId = quotes.rows.find((row) => row.status === 'ACCEPTED').id;

      const order = await db.query(
        `SELECT status, metadata #>> '{rfq,acceptedQuoteId}' AS accepted_quote_id
           FROM public.diaspora_import_orders WHERE id=$1`,
        [orderId],
      );
      assert.deepEqual(order.rows[0], { status: 'SELLER_ASSIGNED', accepted_quote_id: acceptedId });

      const audit = await db.query(
        `SELECT count(*)::int AS rows FROM public.diaspora_import_audit_log
          WHERE import_order_id=$1 AND action='RFQ_QUOTE_ACCEPTED'`,
        [orderId],
      );
      assert.equal(audit.rows[0].rows, 1);
    }, async () => {
      await db.query(`DELETE FROM public.diaspora_import_audit_log WHERE import_order_id=$1`, [orderId]);
      await db.query(`DELETE FROM public.diaspora_import_quotes WHERE id = ANY($1::uuid[])`, [quoteIds]);
      await db.query(`DELETE FROM public.diaspora_import_orders WHERE id=$1`, [orderId]);
      if (actorId) await db.query(`DELETE FROM public.users WHERE id=$1`, [actorId]);

      const left = await db.query(
        `SELECT
          (SELECT count(*)::int FROM public.diaspora_import_audit_log WHERE import_order_id=$1) AS audits,
          (SELECT count(*)::int FROM public.diaspora_import_quotes WHERE id = ANY($2::uuid[])) AS quotes,
          (SELECT count(*)::int FROM public.diaspora_import_orders WHERE id=$1) AS orders,
          (SELECT count(*)::int FROM public.users WHERE id=$3) AS actors`,
        [orderId, quoteIds, actorId || 'not-created'],
      );
      assert.deepEqual(left.rows[0], { audits: 0, quotes: 0, orders: 0, actors: 0 });
    });
  } finally {
    await db.end();
  }
});
