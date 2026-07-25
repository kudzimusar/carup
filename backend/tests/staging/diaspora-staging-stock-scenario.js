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

test('staging: two independent stock reservations cannot over-reserve', { skip: skipReason, timeout: TEST_TIMEOUT_MS }, async () => {
  const control = await connectClient(`${RUN_PREFIX}_stock_control`);
  const itemId = randomUUID();
  let actorId;

  try {
    await runWithVerifiedCleanup(async () => {
      actorId = await seedActor(control, 'stock');
      await control.query(
        `INSERT INTO public.diaspora_stock_items
           (id, sku, part_name, quantity_on_hand, quantity_reserved, created_by, updated_by)
         VALUES ($1, $2, $3, 10, 0, $4, $4)`,
        [itemId, `${RUN_PREFIX}_stock_sku`, `${RUN_PREFIX} stock part`, actorId],
      );

      const text = `SELECT public.diaspora_append_stock_movement_atomic(
        $1, $2, NULL, true, 'RESERVE', 7, $3
      ) AS result`;
      const outcomes = await runConcurrentQueries(
        { text, values: [itemId, actorId, `${RUN_PREFIX}_stock_a`] },
        { text, values: [itemId, actorId, `${RUN_PREFIX}_stock_b`] },
      );

      assertExactlyOneWinner(outcomes, /DIASPORA_STOCK\/INSUFFICIENT_AVAILABLE/);

      const finalState = await control.query(
        `SELECT quantity_on_hand::float8 AS on_hand,
                quantity_reserved::float8 AS reserved,
                (quantity_on_hand - quantity_reserved)::float8 AS available
           FROM public.diaspora_stock_items
          WHERE id = $1`,
        [itemId],
      );
      assert.deepEqual(finalState.rows[0], { on_hand: 10, reserved: 7, available: 3 });

      const proof = await control.query(
        `SELECT
           (SELECT count(*)::int FROM public.diaspora_stock_ledger WHERE stock_item_id = $1) AS ledger_rows,
           (SELECT count(*)::int FROM public.diaspora_import_audit_log
             WHERE resource_type = 'diaspora_stock_item' AND resource_id = $1::text AND action = 'STOCK_RESERVE') AS audit_rows`,
        [itemId],
      );
      assert.deepEqual(proof.rows[0], { ledger_rows: 1, audit_rows: 1 });
    }, async () => {
      await control.query(`DELETE FROM public.diaspora_stock_ledger WHERE stock_item_id = $1`, [itemId]);
      await control.query(`DELETE FROM public.diaspora_import_audit_log WHERE resource_id = $1::text`, [itemId]);
      await control.query(`DELETE FROM public.diaspora_stock_items WHERE id = $1`, [itemId]);
      if (actorId) await control.query(`DELETE FROM public.users WHERE id = $1`, [actorId]);

      const leftovers = await control.query(
        `SELECT
           (SELECT count(*)::int FROM public.diaspora_stock_ledger WHERE stock_item_id = $1) AS ledger_rows,
           (SELECT count(*)::int FROM public.diaspora_import_audit_log WHERE resource_id = $1::text) AS audit_rows,
           (SELECT count(*)::int FROM public.diaspora_stock_items WHERE id = $1) AS item_rows,
           (SELECT count(*)::int FROM public.users WHERE id = $2) AS actor_rows`,
        [itemId, actorId || 'not-created'],
      );
      assert.deepEqual(leftovers.rows[0], { ledger_rows: 0, audit_rows: 0, item_rows: 0, actor_rows: 0 });
    });
  } finally {
    await control.end();
  }
});
