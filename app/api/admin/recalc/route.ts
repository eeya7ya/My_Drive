import { requireAdmin } from "@/lib/auth";
import { recalcCounters, pruneStaleReservations } from "@/lib/store";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Rebuild the storage total and per-file revision counts from the underlying
 * rows, and drop abandoned reservations.
 *
 * Those counters are maintained on write so that reading the drive never has
 * to aggregate over file_versions. That trade buys cheap page loads at the cost
 * of drift if a write half-fails — this is the repair, and it is the only place
 * that scans the whole table.
 */
export async function POST() {
  try {
    await requireAdmin();
    await pruneStaleReservations();
    const result = await recalcCounters();
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
