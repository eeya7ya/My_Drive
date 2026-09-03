import LoginForm from "@/components/LoginForm";
import { driveForPath } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * One admin signs in to every drive. The form wears the brand of the drive
 * it was opened from (`?next=/advec`) and returns there afterwards.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <LoginForm brand={driveForPath(target)} next={target} />;
}
