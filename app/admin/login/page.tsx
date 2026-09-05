import LoginForm from "@/components/LoginForm";
import { DEFAULT_BRAND } from "@/lib/brand";
import { canOpenDrive } from "@/lib/auth";
import { resolveDriveSlug } from "@/lib/drives";

export const dynamic = "force-dynamic";

/**
 * One admin signs in to every drive. The form wears the brand of the drive it
 * was opened from (`?next=/advec`) and returns there afterwards.
 *
 * The drive is read from the first segment of `next` rather than from a table
 * of paths, since drives are rows now. A drive the caller cannot already open
 * is deliberately not named here — otherwise a guessed `?next=/something` would
 * turn the sign-in page into a way of asking whether a private drive exists.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const first = target.split("/").filter(Boolean)[0];
  const hit = first ? await resolveDriveSlug(decodeURIComponent(first)) : null;
  const brand = hit && (await canOpenDrive(hit.brand)) ? hit.brand : DEFAULT_BRAND;

  return <LoginForm brand={brand} next={target} />;
}
