import Drive from "@/components/Drive";

export const dynamic = "force-dynamic";

export default function Page() {
  // The canvas exposes these two as design props; same defaults here.
  return <Drive defaultTheme="light" defaultView="grid" />;
}
