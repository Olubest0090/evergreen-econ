import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import Nav from "@/app/components/Nav";
import GovClient from "./GovClient";
import { isOwnerSession } from "@/lib/ownerSecurity";

export default async function GovPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!me.staff) redirect("/");
  const owner = await isOwnerSession();
  return (
    <>
      <GovClient owner={owner} />
      <Nav staff />
    </>
  );
}
