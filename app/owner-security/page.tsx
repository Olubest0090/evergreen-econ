import { notFound } from "next/navigation";
import { isOwnerSession } from "@/lib/ownerSecurity";
import SecurityClient from "./SecurityClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OwnerSecurityPage() {
  if (!(await isOwnerSession())) notFound();
  return <SecurityClient />;
}
