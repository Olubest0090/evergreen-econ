import { notFound } from "next/navigation";
import { isOwnerSession } from "@/lib/ownerSecurity";
import SecurityClient from "./SecurityClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OwnerSecurityPage() {
  // 404 conceals the route. Staff permissions do not grant access.
  if (!(await isOwnerSession())) notFound();
  return <SecurityClient />;
}
