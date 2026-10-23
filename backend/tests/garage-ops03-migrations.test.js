
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR } from './helpers/pgliteLedgerHarness.js';

const OPS02 = '20261023111516_garage_ops02_customer_vehicle_relationship.sql';
const OPS03 = '20261023140000_garage_ops03_appointments_scheduling_capacity.sql';
const SLOT_START = '2026-10-26T08:00:00.000Z'; // 10:00 Africa/Harare.
const SLOT_END = '2026-10-26T09:00:00.000Z';
let db;
const T = {};
const B = {};
const P = {};
const C = {};

async function rejected(promise) {
  try { await promise; return null; } catch (error) { return error; }
}

async function forceAuditFailure(eventType) {
  const allowed = new Set([
    'GARAGE_BRANCH_SCHEDULING_UPDATED',
    'GARAGE_WORKFORCE_SCHEDULE_UPDATED',
    'GARAGE_WORKFORCE_UNAVAILABILITY_CHANGED',
  ]);
  if (!allowed.has(eventType)) throw new Error('unexpected test audit event');
  await db.exec('DROP TRIGGER IF EXISTS trg_ops03_test_fail_audit ON trust_audit_events');
  await db.exec('DROP FUNCTION IF EXISTS garage_ops03_test_fail_audit()');
  await db.exec(
    "CREATE FUNCTION garage_ops03_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = '" + eventType + "' THEN RAISE EXCEPTION 'OPS03_TEST_AUDIT_FAILURE'; END IF; " +
    "RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops03_test¶»§q«^u…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€‰%9MIP%9Q<…É…•}İ½É­™½É•}ÁÉ½™¥±•Ì€¡Ñ•¹…¹Ñ}¥±ÕÍ•É}¥±ÍÑ…™™}½‘”±•µÁ±½åµ•¹Ñ}±…ÍÍ¥™¥…Ñ¥½¸±•µÁ±½åµ•¹Ñ}ÍÑ…ÑÕÌ±ÍÑ…ÉÑ}‘…Ñ”±É•…Ñ•‘}‰å}ÕÍ•É}¥¤Y1UL€ Ä°µ• µˆœ°5 µœ°•µÁ±½å•”œ°…Ñ¥Ù”œ°œÈÀÈØ´ÄÀ´ÀÄœ°…‘µ¥¸µ„œ¤IQUI9%9¥ˆ°(€€€mP¹…t°(€€¤¤¹É½İÍlÁt¹¥ì(€@¹ˆÄ€ô€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€‰%9MIP%9Q<…É…•}İ½É­™½É•}ÁÉ½™¥±•Ì€¡Ñ•¹…¹Ñ}¥±ÕÍ•É}¥±ÍÑ…™™}½‘”±•µÁ±½åµ•¹Ñ}±…ÍÍ¥™¥…Ñ¥½¸±•µÁ±½åµ•¹Ñ}ÍÑ…ÑÕÌ±ÍÑ…ÉÑ}‘…Ñ”±É•…Ñ•‘}‰å}ÕÍ•É}¥¤Y1UL€ Ä°µ• µŒœ°5 µœ°•µÁ±½å•”œ°…Ñ¥Ù”œ°œÈÀÈØ´ÄÀ´ÀÄœ°…‘µ¥¸µˆœ¤IQUI9%9¥ˆ°(€€€mP¹‰t°(€€¤¤¹É½İÍlÁt¹¥ì(€™½È€¡½¹ÍĞmÑ•¹…¹Ğ°ÁÉ½™¥±”°‰É…¹ °…Ñ½Ét½˜l(€€€mP¹„±@¹„Ä±¹„Ä°…‘µ¥¸µ„t°mP¹„±@¹„Ä±¹„È°…‘µ¥¸µ„t°mP¹„±@¹„È±¹„Ä°…‘µ¥¸µ„t°(€€€mP¹ˆ±@¹ˆÄ±¹ˆÄ°…‘µ¥¸µˆt°(€t¤ì(€€€…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€€%9MIP%9Q<…É…•}İ½É­™½É•}‰É…¹¡}…ÍÍ¥¹µ•¹ÑÌ€¡Ñ•¹…¹Ñ}¥±İ½É­™½É•}ÁÉ½™¥±•}¥±‰É…¹¡}¥±¥Í}ÁÉ¥µ…Éä±…ÍÍ¥¹•‘}‰å}ÕÍ•É}¥¤Y1UL€ Ä°È°Ì°Ğ°Ô¤œ°(€€€€€mÑ•¹…¹Ğ°ÁÉ½™¥±”°‰É…¹ °‰É…¹ €ôôô¹„Äñğ‰É…¹ €ôôô¹ˆÄ°…Ñ½Ét°(€€€€¤ì(€ô((€€¼¼=ALÀÄÉ•ÅÕ¥É•Ì„µ•¡…¹¥ŒÌ…Ñ¥Ù”İ½É­™½É”ÁÉ½™¥±”Ñ¼¡…Ù”„±¥Ù”ÁÉ¥µ…ÉäÍ¥Ñ”¸	Õ¥±Ñ¡”(€€¼¼ÁÉ½™¥±”½…ÍÍ¥¹µ•¹Ğİ¡¥±”Ñ¡”µ•µ‰•È¥ÌÍÑ¥±°…‘µ¥¸°Ñ¡•¸…‘½ÁĞÑ¡”µ•¡…¹¥ŒÉ½±”¸(€…İ…¥Ğ‘ˆ¹ÅÕ•Éä ‰UAQÑ•¹…¹Ñ}ÕÍ•ÉÌMPÉ½±”ôµ•¡…¹¥Œœ]!IÑ•¹…¹Ñ}¥ôÄ9ÕÍ•É}¥%8€ µ• µ„œ°µ• µˆœ¤ˆ°mP¹…t¤ì(€…İ…¥Ğ‘ˆ¹ÅÕ•Éä ‰UAQÑ•¹…¹Ñ}ÕÍ•ÉÌMPÉ½±”ôµ•¡…¹¥Œœ]!IÑ•¹…¹Ñ}¥ôÄ9ÕÍ•É}¥ôµ• µŒœˆ°mP¹‰t¤ì((€¹„Ä€ô€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€‰%9MIP%9Q<Í•ÉÙ¥•}…Í•Ì€¡Ù¥¸±…É…•}Ñ•¹…¹Ñ}¥’ÚîÆ­yÓBÄåTÄÂ’rÀ¢µBæÄ"æÅ4ÄõEõ5D%BÅ4ÄõEôTäEÒÀ¢“°¢76W'BæWVÂ†6öæf–wW&VBç&÷w5³ÒæÖ…ö6öæ7W'&VçEöö–çFÖVçG2Â“°¢76W'BæWVÂ†6öæf–wW&VBç&÷w5³Òæf–Æ&ÆUö6÷VçBÂÂvW‡Æ–6—B'&æ6‚66—G’Æ–Ö—G2÷F†W'v—6RÖVÆ–v–&ÆR7Ffbr“°§Ò“° §FW7B‚wv÷&²66†VGVÆW2&WV—&R6ÖRÔv&vR7F—fRv÷&¶f÷&6RÂ7F—fR6—FRæBÆ—fR'&æ6‚&VÆF–öç6†—rÂ7–æ2‚’Óâ°¢6öç7Bf÷&V–vâÒv—B&V¦V7FVB†F"çVW'’€¢$”å4U%B”åDòv&vU÷v÷&¶f÷&6U÷66†VGVÆW2‡FVæçEö–BÇv÷&¶f÷&6U÷&öf–ÆUö–BÆ'&æ6…ö–BÆF•ööe÷vVV²Ç7F'G5öBÆVæG5öBÆVffV7F—fUög&öÒÆ7&VFVEö'•÷W6W%ö–B’dÅTU2‚CÂC"ÂC2ÃÂsƒ£rÂss£rÂs##bÓÓrÂvFÖ–âÖr’"À¢µBæÅæ#Ä"æÒÀ¢’“°¢76W'BæÖF6‚†f÷&V–vãòæÖW76vRÇÂrrÂõtõ$´dõ$4Uõ44„TETÄUôUD„õ$•E•ô”ådÄ”Bò“° ¢6öç7Bw&öæu6—FRÒv—B&V¦V7FVB†F"çVW'’€¢$”å4U%B”åDòv&vU÷v÷&¶f÷&6U÷66†VGVÆW2‡FVæçEö–BÇv÷&¶f÷&6U÷&öf–ÆUö–BÆ'&æ6…ö–BÆF•ööe÷vVV²Ç7F'G5öBÆVæG5öBÆVffV7F—fUög&öÒÆ7&VFVEö'•÷W6W%ö–B’dÅTU2‚CÂC"ÂC2ÃÂsƒ£rÂss£rÂs##bÓÓrÂvFÖ–âÖr’"À¢µBæÅæ"Ä"æ%ÒÀ¢’“°¢76W'BæÖF6‚‡w&öæu6—FSòæÖW76vRÇÂrrÂõtõ$´dõ$4Uõ44„TETÄUôUD„õ$•E•ô”ådÄ”Bò“°§Ò“°  §FW7B‚v6öæf–wW&F–öâ%27V66W72F‡2w&—FRW†7FÇ’öæR&÷VæFVBGG&–'WF&ÆRVF—BV6‚rÂ7–æ2‚’Óâ°¢76W'BæWVÂ‚†v—BVF—E&÷w2‚tt$tUô%$ä4…õ44„TETÄ”äuõUDDTBr’’æÆVæwF‚Â“°¢6öç7B'&æ6…&W7VÇBÒv—BF"çVW'’€¢u4TÄT5B¢e$ôÒv&vUö÷35÷W6W'Eö'&æ6…÷66†VGVÆ–æu÷6WGF–æw2‚CÂC"ÂC2ÂCBÂCRÂCb’rÀ¢µBæÄ"æÇG'VRÃÃ3ÂvFÖ–âÖuÒÀ¢“°¢76W'BæWVÂ†'&æ6…&W7VÇBç&÷w5³ÒæÖ…ö6öæ7W'&VçEöö–çFÛkºwµçH”“ÓHØ\˜YÙWİÛÜšÙ›Ü˜ÙWİ[˜]˜Z[Xš[]HÒT‘H[˜[ÚYIHS‘ÛÜšÙ›Ü˜ÙWÜ›Ùš[WÚYIˆS‘İ\×Ø]IÈS‘[™×Ø]I	ËˆÕ˜K˜LK\™Ù]İ\\™Ù][™Kˆ
JKœ›İÜÖÌK›ÂˆÛÛœİ]Y]Ûİ[™Y›Ü™HH
]ØZ]]Y]›İÜÊ	ÑĞTQÑWÕÓÔ’Ñ“ÔÑWÕSURSP’SUWĞÒS‘ÑQ	ÊJK›[™İÂ‚ˆ]ØZ]›Ü˜ÙP]Y]˜Z[\™J	ÑĞTQÑWÕÓÔ’Ñ“ÔÑWÕSURSP’SUWĞÒS‘ÑQ	ÊNÂˆÛÛœİ\œ›ÜˆH]ØZ]™Z™XİY
‹œ]Y\Jˆ	ÔÑSPÕ
ˆ”“ÓHØ\˜YÙWÛÜÌ×ØYİÛÜšÙ›Ü˜ÙWİ[˜]˜Z[Xš[]J	K	‹	Ë		K	ŠIËˆÕ˜K˜LK\™Ù]İ\\™Ù][™	ÛX]™IË	ØYZ[‹XI×Kˆ
JNÂˆ]ØZ]ÛX\]Y]˜Z[\™J
NÂˆ\ÜÙ\›X]Ú
\œ›ÜË›Y\ÜØYÙH	ÉËÓÔÌ×ÕTÕĞUQUÑRST‘KÊNÂ‚ˆÛÛœİY\ˆH
]ØZ]‹œ]Y\Jˆ	ÔÑSPÕÛİ[

ŠNš[ˆ”“ÓHØ\˜YÙWİÛÜšÙ›Ü˜ÙWİ[˜]˜Z[Xš[]HÒT‘H[˜[ÚYIHS‘ÛÜšÙ›Ü˜ÙWÜ›Ùš[WÚYIˆS‘İ\×Ø]IÈS‘[™×Ø]I	ËˆÕ˜K˜LK\™Ù]İ\\™Ù][™Kˆ
JKœ›İÜÖÌK›Âˆ\ÜÙ\™\]X[
Y\‹™Y›Ü™JNÂˆ\ÜÙ\™\]X[

]ØZ]]Y]›İÜÊ	ÑĞTQÑWÕÓÔ’Ñ“ÔÑWÕSURSP’SUWĞÒS‘ÑQ	ÊJK›[™İ]Y]Ûİ[™Y›Ü™JNÂŸJNÂ‚\İ
	İ[Y^›Û™KÜ[š[™Èİ\œÈ[™Ûİ™XÚ\Ú[Ûˆ\™H[™›Ü˜ÙYœ›ÛH™XÛÜ™YÚ]H]	Ë\Ş[˜È

HOˆÂˆÛÛœİİ]ÚYHH]ØZ]™Z™XİY
‹œ]Y\Jˆ	ÔÑSPÕ
ˆ”“ÓHØ\˜YÙWÛÜÌ×Ù]˜[X]WÚ[\˜[
	K	‹	Ë	•S
IËˆÕ˜K‹˜LK	ÌŒ‹LLL•NŒŒ‰Ë	ÌŒ‹LLL•ŒŒ‰×Kˆ
JNÂˆ\ÜÙ\›X]Ú
İ]ÚYOË›Y\ÜØYÙH	ÉËÓÕUÒQWÓÔS’S‘×ÒÕT”ËÊNÂˆÛÛœİZ\Ø[YÛ™YH]ØZ]™Z™XİY
‹œ]Y\Jˆ	ÔÑSPÕ
ˆ”“ÓHØ\˜YÙWÛÜÌ×Ù]˜[X]WÚ[\˜[
	K	‹	Ë	•S
IËˆÕ˜K‹˜LK	ÌŒ‹LLL•ŒLŒ‰Ë	ÌŒ­®éÜj×],
  );
  await db.query(
    "SELECT garage_ops03_transition_appointment($1,'cancelled','admin-a','garage',$2)",
    [C.confirmedAfterRelease,T.a],
  );

  const r3 = await requestAppointment(C.a3, 'customer-a', '2026-10-26T10:00:00Z','2026-10-26T11:00:00Z');
  const r4 = await requestAppointment(C.a4, 'customer-b', '2026-10-26T10:00:00Z','2026-10-26T11:00:00Z');
  const a3 = await appointmentId(r3);
  const a4 = await appointmentId(r4);

  const attempts = await Promise.allSettled([
    confirmAppointment(a3,P.a1,'2026-10-26T10:00:00Z','2026-10-26T11:00:00Z'),
    confirmAppointment(a4,P.a1,'2026-10-26T10:00:00Z','2026-10-26T11:00:00Z'),
  ]);
  assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((x) => x.status === 'rejected').length, 1);
  assert.match(
    String(attempts.find((x) => x.status === 'rejected')?.reason?.message || ''),
    /PLANNED_WORKFORCE_UNAVAILABLE/,
  );
  C.mechanicWinner = (await db.query(
    "SELECT id FROM garage_appointments WHERE id IN ($1,$2) AND status='confirmed'", [a3,a4],
  )).rows[0].id;
});

test('failed reschedule is atomic and writes no false rescheduled event', async () => {
  const before = (await db.query(
    'SELECT status,branch_id,starts_at,ends_at,planned_workforce_profile_id FROM garage_appointments WHERE id=$1',
    [C.mechanicWinner],
  )).rows[0];
  const eventsBefore = (await db.query(
    "SELECT count(*)::int n FROM garage_appointment_events WHERE appointment_id=$1 AND¶»§q«^u…•}…ÁÁ½¥¹Ñµ•¹Ñ}•Ù•¹ÑÌ]!I¥ôÄœ±m•Ù•¹Ğ¹¥‘t¤¤¤ü¹µ•ÍÍ…”ñğ€œœ°€½AA9}=91d¼¤ì((€½¹ÍĞ…Õ‘¥ÑI½İÌ€ô€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€‰M1P•Ù•¹Ñ}ÑåÁ”±ÁÉ•Ù¥½ÕÍ}Ù…±Õ”±¹•İ}Ù…±Õ”I=4ÑÉÕÍÑ}…Õ‘¥Ñ}•Ù•¹ÑÌ]!I•Ù•¹Ñ}ÑåÁ”1%-€I}AA=%9Q59Q|”œˆ°(€€¤¤¹É½İÌì(€…ÍÍ•ÉĞ¹½¬¡…Õ‘¥ÑI½İÌ¹±•¹Ñ €ø€À¤ì(€…ÍÍ•ÉĞ¹•ÅÕ…°¡)M=8¹ÍÑÉ¥¹¥™ä¡…Õ‘¥ÑI½İÌ¤¹¥¹±Õ‘•Ì É•ÅÕ•ÍÑ}ÍÕµµ…Éäœ¤°™…±Í”¤ì)ô¤ì()Ñ•ÍĞ ½¹™¥Éµ•Í¡•‘Õ±¥¹œÁÉ•Í•ÉÙ•ÌM•ÉÙ¥”…Í”°İ½É¬µ½É‘•È…ÍÍ¥¹µ•¹Ğ…¹Ù•¡¥±”…ÕÑ¡½É¥Ñäœ°…Íå¹Œ€ ¤€ôøì(€½¹ÍĞÍ•ÉÙ¥•…Í•Ì€ô€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€M1P¥±ÍÑ…ÑÕÌ±Ù¥¸±É•ÅÕ•ÍÑ•É}ÕÍ•É}¥I=4Í•ÉÙ¥•}…Í•Ì]!I¥%8€ Ä°È¤=IH	d¥œ°(€€€m¹„Ä±¹„Ét°(€€¤¤¹É½İÌì(€…ÍÍ•ÉĞ¹½¬¡Í•ÉÙ¥•…Í•Ì¹•Ù•Éä ¡à¤€ôøà¹ÍÑ…ÑÕÌ€ôôô€…•ÁÑ•œ¤¤ì(€…ÍÍ•ÉĞ¹•ÅÕ…° (€€€€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä ‰M1P½İ¹•É}¥I=4Ù•¡¥±•Ì]!IÙ¥¸ô=ALÀÍY%8ÀÀÀÀÀÀÀÀÄœˆ¤¤¹É½İÍlÁt¹½İ¹•É}¥°(€€€€ÕÍÑ½µ•Èµ„œ°(€€¤ì(€½¹ÍĞİ½É­ÍÍ¥¹µ•¹ÑÌ€ô€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä M1P½Õ¹Ğ ¨¤èé¥¹Ğ¸I=4İ½É­}½É‘•É}…ÍÍ¥¹µ•¹ÑÌœ¤¤¹É½İÍlÁt¹¸ì(€…ÍÍ•ÉĞ¹•ÅÕ…°¡İ½É­ÍÍ¥¹µ•¹ÑÌ°€À°€…ÁÁ½¥¹Ñµ•¹ĞÁ±…¹¹¥¹œ¹•Ù•Èµ…¹Õ™…ÑÕÉ•Ì•á•ÕÑ¥½¸…ÍÍ¥¹µ•¹Ğœ¤ì)ô¤ì()Ñ•ÍĞ ™ÕÑÕÉ”½¹™¥Éµ•…ÁÁ½¥¹Ñµ•¹ÑÌ‰±½¬Í¥±•¹Ğ=ALÀÄÍ¥Ñ”½İ½É­™½É”‘•…Ñ¥Ù…Ñ¥½¸œ°…Íå¹Œ€ ¤€ôøì(€½¹ÍĞ½Á•¹…Í”€ô€¡…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€‰%9MIP%9Q<Í•ÉÙ¥•}…Í•Ì€¡Ù¥¸±…É…•}Ñ•¹…¹Ñ}¥±‰É…¹¡}¥±É•ÅÕ•ÍÑ•É}ÕÍ•É}¥±ÍÑ…ÑÕÌ¤Y1UL€ =ALÀÍY%8ÀÀÀÀÀÀÀÀÄœ°Ä°È°ÕÍÑ½µ•Èµ„œ°…•ÁÑ•œ¤IQUI9%9¥ˆ°(€€€mP¹„±¹„Åt°(€€¤¤¹É½İÍlÁt¹¥ì(€½¹ÍĞÉ•ÅÕ•ÍĞ€ô…İ…¥ĞÉ•ÅÕ•ÍÑÁÁ½¥¹Ñµ•¹Ğ¡½Á•¹…Í”°ÕÍÑ½µ•Èµ„œ°œÈÀÈØ´ÄÀ´ÈÙPÄĞèÀÀèÀÁhœ°œÈÀÈØ´ÄÀ´ÈÙPÄÔèÀÀêÚîÆ­y