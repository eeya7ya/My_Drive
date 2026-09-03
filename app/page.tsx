import { redirect } from "next/navigation";
import Drive from "@/components/Drive";
import { driveFor } from "@/lib/brand";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The main drive, at "/". Private: the sign-in card stands in front of it. */
export default async function Page() {
  const brand = driveFor("main");
  if (brand.private && !(await isAdmin())) redirect("/admin/login?next=%2F");
  // The canvas exposes these two as design props; same defaults here.
  return <Drive defaultTheme="light" defaultView="grid" brand={brand} />;
}
