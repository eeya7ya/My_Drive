import LoginForm from "@/components/LoginForm";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  return <LoginForm brand={brand()} />;
}
