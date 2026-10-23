
import { supabase as defaultClient } from '../../db/supabase.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_WORKSPACE_ROLES,
  requireGarageTenant,
} from '../serviceNetwork/serviceAuthority.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';

const TERMINAL = new Set(['declined', 'cancelled', 'fulfilled', 'no_show']);
const GARAGE_STATUS_TARGETS = new Set(['declined', 'cancelled', 'fulfilled', 'no_show']);
const REASON_CODES = new Set(['leave', 'training', 'unavailable', 'other']);

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
function workspaceTenant(actor) { return requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES); }
function adminTenant(actor) { return requireGarageTenant(actor, GARAGE_ADMIN_ROLES); }
function tenantRole(actor) { return actor?.activeTenant?.role || null; }

function requiredString(value, label, max = 200) {
  const clean = String(value ?? '').trim();
  if (!clean) throw new ValidationError(label + ' is required');
  if (clean.length > max) throw new ValidationError(label + ' must be at most ' + max + ' characters');
  return clean;
}
function integer(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(label + ' must be an integer between ' +¶»§q«^t€€€€€É•…Í½¸è€M¡•‘Õ±¥¹œ¹½Ð½¹™¥ÕÉ•œ°(€€€€€‰É…¹ èì¥è‰É…¹ ¹¥°¹…µ”è‰É…¹ ¹¹…µ”°Ñ¥µ•é½¹”è‰É…¹ ¹Ñ¥µ•é½¹”ô°(€€€€€‘…Ñ”è±½…±…Ñ”°(€€€€€‘ÕÉ…Ñ¥½¹}µ¥¹ÕÑ•Ìè‘ÕÉ…Ñ¥½¹5¥¹ÕÑ•Ì°(€€€€€Í±½ÑÌèmt°(€€€ôì(€ô(€¥˜€ …Í•ÑÑ¥¹Ì¹Í¡•‘Õ±¥¹}•¹…‰±•¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¹™¥ÕÉ•èÑÉÕ”°(€€€€€•¹…‰±•è™…±Í”°(€€€€€É•…Í½¸è€M¡•‘Õ±¥¹œ¥Ì‘¥Í…‰±•™½ÈÑ¡¥ÌÍ¥Ñ”œ°(€€€€€‰É…¹ èì¥è‰É…¹ ¹¥°¹…µ”è‰É…¹ ¹¹…µ”°Ñ¥µ•é½¹”è‰É…¹ ¹Ñ¥µ•é½¹”ô°(€€€€€‘…Ñ”è±½…±…Ñ”°(€€€€€‘ÕÉ…Ñ¥½¹}µ¥¹ÕÑ•Ìè‘ÕÉ…Ñ¥½¹5¥¹ÕÑ•Ì°(€€€€€Í±½Ñ}¥¹Ñ•ÉÙ…±}µ¥¹ÕÑ•ÌèÍ•ÑÑ¥¹Ì¹Í±½Ñ}¥¹Ñ•ÉÙ…±}µ¥¹ÕÑ•Ì°(€€€€€…Á…¥ÑäèÍ•ÑÑ¥¹Ì¹µ…á}½¹ÕÉÉ•¹Ñ}…ÁÁ½¥¹Ñµ•¹ÑÌ°(€€€€€Í±½ÑÌèmt°(€€€ôì(€ô((€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ …É…•}½ÁÌÀÍ}±¥ÍÑ}…Ù…¥±…‰¥±¥Ñäœ°ì(€€€Á}Ñ•¹…¹Ñ}¥èÍ•ÉÙ¥•…Í”¹…É…•}Ñ•¹…¹Ñ}¥°(€€€Á}Í•ÉÙ¥•}…Í•}¥èÍ•ÉÙ¥•…Í”¹¥°(€€€Á}‰É…¹¡}¥è‰É…¹ ¹¥°(€€€Á}±½…±}‘…Ñ”è±½…±…Ñ”°(€€€Á}‘ÕÉ…Ñ¥½¹}µ¥¹ÕÑ•Ìè‘ÕÉ…Ñ¥½¹5¥¹ÕÑ•Ì°(€ô¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½ÜÉÁ…¥±ÕÉ”¡•ÉÉ½È°€½Õ±¹½Ð…±Õ±…Ñ”…ÁÁ½¥¹Ñµ•¹Ð…Ù…¥±…‰¥±¥Ñäœ¤ì((€½¹ÍÐÍ±½ÑÌ€ô€¡‘…Ñ„ñðmt¤¹µ…À ¡É½Ü¤€ôø€¡ì(€€€ÍÑ…ÉÑÍ}…ÐèÉ½Ü¹ÍÑ…ÉÑÍ}…Ð°(€€€•¹‘Í}…ÐèÉ½Ü¹•¹‘Í}…Ð°(€€€…ÁÁ½¥¹Ñµ•¹Ñ}Ñ¥µ•é½¹”èÉ½Ü¹…ÁÁ½¥¹Ñµ•¹Ñ}Ñ¥µ•é½¹”°(€€€‰É…¹¡}…Á…¥Ñäè9Õµ‰•È¡É½Ü¹‰É…¹¡}…Á…¥Ñä¤°(€€€‰½½­•‘}½Õ¹Ðè9Õµ‰•È¡É½Ü¹‰½½­•‘}½Õ¹Ð¤°(€€€…Ù…¥±…‰±•}½Õ¹Ðè9Õµ‰•È¡É½Ü¹…Ù…¥±…‰±•}½Õ¹Ð¤°(€€€‰½½­…‰±”è9Õµ‰•È¡É½Ü¹…Ù…¥±…‰±•}½Õ¹Ð¤€ø€À°(€ô¤¤ì((€É•ÑÕÉ¸ì(€€€½¹™¥ÕÉ•èÑÉÕ”°(€€€•¹…‰±•èÑÉÕ”°(€€€‰É…¹ èì¥è‰É…¹ ¹¥°¹…µ”è‰É…¹ ¹¹…µ”°Ñ¥µ•é½¹”è‰É…¹ ¹Ñ¥µ•é½¹”ô°(€€€‘…Ñ”è²ÚîÆ­yÓ“°¢–b†W'&÷"’F‡&÷ræWrFF&6TW'&÷"‚t6÷VÆBæ÷BÆöBö–çFÖVçG3¢r²W'&÷"æÖW76vR“°¢&WGW&â²ö–çFÖVçG3¢†FFÇÂµÒ’æÖ†ö–çFÖVçEf–Wr’ÂF÷FÃ¢†FFÇÂµÒ’æÆVæwF‚Ó°§Ð ¦W‡÷'B7–æ2gVæ7F–öâ6æ6VÅ&WVW7FW$ö–çFÖVçB€¢6Æ–VçBÒFVfVÇD6Æ–VçBÂ7F÷"Ò·ÒÂ66T–BÂö–çFÖVçD–BÀ¢’°¢6öç7B6W'f–6T66RÒv—B&WVW7FW$66R†6Æ–VçBÂ7F÷"Â66T–B“°¢6öç7B²FF¢ö–çFÖVçBÂW'&÷#¢&VDW'&÷"ÒÒv—B6Æ–VçBæg&öÒ‚vv&vUöö–çFÖVçG2r¢ç6VÆV7B‚v–BÂ6W'f–6Uö66Uö–Br’æW‚v–BrÂ7G&–ær†ö–çFÖVçD–B’’æW‚w6W'f–6Uö66Uö–BrÂ6W'f–6T66Ræ–B’æÖ–&U6–ævÆR‚“°¢–b‡&VDW'&÷"’F‡&÷ræWrFF&6TW'&÷"‚t6÷VÆBæ÷BÆöBö–çFÖVçC¢r²&VDW'&÷"æÖW76vR“°¢–b‚ö–çFÖVçB’F‡&÷ræWræ÷Df÷VæDW'&÷"‚tö–çFÖVçBæ÷Bf÷VæBr“° ¢6öç7B²FFÂW'&÷"ÒÒv—B6Æ–VçBç'2‚vv&vUö÷35÷G&ç6—F–öåöö–çFÖVçBrÂ°¢öö–çFÖVçEö–C¢ö–çFÖVçBæ–BÀ¢÷F&vWE÷7FGW3¢v6æ6VÆÆVBrÀ¢ö7F÷%÷W6W%ö–C¢7F÷$–B†7F÷"’À¢ö7F÷%÷66÷S¢w&WVW7FW"rÀ¢÷FVæçEö–C¢çVÆÂÀ¢Ò“°¢–b†W'&÷"’F‡&÷r'4f–ÇW&R†W'&÷"Ât6÷VÆBæ÷B6æ6VÂö–çFÖVçBr“°¢&WGW&â²ö–çFÖVçC¢ö–çFÖVçEf–Wr„'&’æ—4'&’†FF’òFF³Ò¢FF’Ó°§Ð ¦W‡÷'B7–æ2gVæ7F–öâvWDv&vU66†VGVÆR†6Æ–VçBÒFVfVÇD6Æ–VçBÂ7F÷"Ò·ÒÂVW'’Ò·Ò’°¢6öç7BFVæçD–BÒv÷&·76UFVæçB†7F÷"“°¢ÆWB'V–ÆFW"Ò6Æ–VçBæg&öÒ‚vv&vUöö–çFÖVçG2r’ç6VÆV7B‚r¢r’æW‚wFVæçEö–BrÂFVæçD–B“° ¢6öç7B7FGW2Ò7G&–ær‡VW'’ç7FGW2ÇÂrr’çG&–Ò‚“°¢–b‡7FGW2’'V–ÆFW"Ò'V–ÆFW"æW‚w7FGW2rÂ7FGW2“°¢6öç7B'&æ6„–BÒ7KkºwµçYKšYˆ\Ù\—ÚYˆ›Ùš[K\Ù\—ÚYˆÝY™—ØÛÙNˆ›Ùš[KœÝY™—ØÛÙKˆ\Ü^WÛ˜[YNˆ˜[YPžRY™Ù]
›Ùš[K\Ù\—ÚY
H[ˆHˆ[ˆNÂˆJNÂ‚ˆ][œØÚY[YØ\Ù\ÈH×NÂˆYˆ
›ÛHOOH	ØYZ[‰ÊHÂˆÛÛœÝÛÜ[Ø\ÙT™XY]™P\Ú[Y[™XYHH]ØZ]›ÛZ\ÙK˜[
ÂˆÛY[™œ›ÛJ	ÜÙ\šXÙWØØ\Ù\ÉÊBˆœÙ[XÝ
	ÚYš[‹Ý]\ËÙ\šXÙWØØ]YÛÜžKœ˜[˜ÚÚY™\]Y\Ý\—Ý\Ù\—ÚY™\]Y\ÝYØ]	ÊBˆ™\J	ÙØ\˜YÙWÝ[˜[ÚY	Ë[˜[Y
Kš[Š	ÜÝ]\ÉËÉÜ™\]Y\ÝY	Ë	ØXØÙ\Y	×JK›[Z]
Œ
KˆÛY[™œ›ÛJ	ÙØ\˜YÙWØ\Ú[Y[ÉÊBˆœÙ[XÝ
	ÜÙ\šXÙWØØ\ÙWÚY	ÊK™\J	Ý[˜[ÚY	Ë[˜[Y
Kš[Š	ÜÝ]\ÉËÉÜ™\]Y\ÝY	Ë	ØÛÛ™š\›YY	×JK›[Z]
L
KˆJNÂˆYˆ
Ü[Ø\ÙT™XY™\œ›ÜŠH›ÝÈ™]È]X˜\ÙQ\œ›ÜŠ	ÐÛÝ[›ÝØY[œØÚY[YÙ\šXÙHØ\Ù\Îˆ	È
ÈÜ[Ø\ÙT™XY™\œ›Ü‹›Y\ÜØYÙJNÂˆYˆ
]™P\Ú[Y[™XY™\œ›ÜŠH›ÝÈ™]È]X˜\ÙQ\œ›ÜŠ	ÐÛÝ[›Ý™\šYžH]™H\Ú[Y[ÛÝ™\˜YÙNˆ	È
È]™P\Ú[Y[™XY™\œ›Ü‹›Y\ÜØYÙJNÂˆÛÛœÝXÝ]™PØ\ÙRYÈH™]ÈÙ]

]™P\Ú[Y[™XY™]H×JK›X\

JHOˆKœÙ\šXÙWØØ\ÙWÚY
JNÂˆ[œØÚY[YØ\Ù\ÈH
Ü[Ø\ÙT™XY™]H×JK™š[\Š
Ù\šXÙPØ\ÙJHOˆXXÝ]™PØ\ÙRYËš\ÊÙ\šXÙPØ\ÙKšY
JNÂˆB‚ˆ™]\›ˆÂˆ\Ú[Y[ÎˆØÚY[Kˆ[œØÚY[YØØ\Ù\Îˆ[œØÚY[YØ\Ù\ËˆÝ[ˆØÚY[K›[™ÝˆØÛÜNˆ›ÛHOOH	ÛYXÚ[šXÉÈÈ	Ü[›™YÙ›Ü—ÛYIÈˆ	ÙØ\˜YÙIËˆNÂŸB‚™^Ü\Þ[˜È[˜Ý[ÛˆÙ]Ø\˜YÙTØÚY[[™ÐÛÛ™šYÝ\˜][ÛŠÛY[HY˜][ÛY[XÝÜˆHßJHÂˆÛÛœÝ[˜[YHYZ[•[˜[
XÝÜŠNÂˆÛÛœÝÜÚ]\Ô™XYÙ][™í®éÜj×profile = await workforceForUser(client, tenantId, userId);
  const branch = await activeBranch(client, tenantId, body.branch_id);
  const day = integer(body.day_of_week, 'day_of_week', { min: 0, max: 6 });
  const startsAt = clock(body.starts_at, 'starts_at');
  const endsAt = clock(body.ends_at, 'ends_at');
  if (startsAt >= endsAt) throw new ValidationError('ends_at must be after starts_at');
  const effectiveFrom = dateValue(body.effective_from, 'effective_from');
  const effectiveUntil = body.effective_until ? dateValue(body.effective_until, 'effective_until') : null;
  if (effectiveUntil && effectiveUntil < effectiveFrom) throw new ValidationError('effective_until cannot be before effective_from');

  const { data: live, error: liveError } = await client.from('garage_workforce_branch_assignments')
    .select('branch_id').eq('tenant_id', tenantId).eq('workforce_profile_id', profile.id)
    .eq('branch_id', branch.id).is('ended_at', null).maybeSingle();
  if (liveError) throw new DatabaseError('Could not verify workforce site assignment: ' + liveError.message);
  if (!live) throw new ValidationError('The workforce member needs a live assignment to this site');

  const { data, error } = await client.rpc('garage_ops03_add_workforce_schedule', {
    p_tenant_id: tenantId,
    p_workforce_profile_id: profile.id,
    p_branch_id: branch.id,
    p_day_of_week: day,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_effective_from: effectiveFrom,
    p_effective_until: ef¶»§q«^