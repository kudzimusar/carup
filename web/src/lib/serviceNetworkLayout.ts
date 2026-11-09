/**
 * One content width for the Service Network workflow surfaces.
 *
 * DESIGN.md §4.3 forbids "arbitrary width changes between connected routes". The Service Network
 * surfaces were built page by page and ended up with four different widths across one workflow —
 * Workshop `max-w-5xl`, case `max-w-3xl`, Customers `max-w-3xl`, garage page `max-w-2xl`, owner
 * Service History `max-w-7xl`. A garage operator moving Workshop → job → Customers watched the
 * content column jump three times in one task.
 *
 * `max-w-7xl` (1280px) sits inside the canonical "up to 1440px" band §4.3 gives major authenticated
 * workspace surfaces, and matches what owner Service History already used — so this converges the
 * others onto an existing CarUp width rather than inventing a new one.
 *
 * A FORM is a different case. §4.3 asks for intentional measure, and a 1280px-wide text input is
 * not readable. So forms keep a narrow measure INSIDE the shared page container: the page frame
 * stays constant across routes, and the reading column is deliberate.
 */

/** The page container for a Service Network workspace surface. */
export const SN_PAGE = 'space-y-6 max-w-7xl mx-auto'

/** A reading/form column inside that container, for surfaces that are principally a form. */
export const SN_FORM_COLUMN = 'max-w-2xl'

/** A detail column — wider than a form, still a comfortable measure for reading a job. */
export const SN_DETAIL_COLUMN = 'max-w-3xl'
