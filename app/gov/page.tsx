import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import Nav from "@/app/components/Nav";
import GovClient from "./GovClient";

export default async function GovPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!me.staff) redirect("/");
  return (
    <>
      <GovClient />
      <Nav staff />
    </>
  );
}
