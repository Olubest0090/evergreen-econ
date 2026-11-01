import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { db } from "@/lib/supabase";
import Nav from "@/app/components/Nav";
import BankClient from "./BankClient";

export default async function BankPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  const { data } = await db().from("econ_balances").select("resource, balance").eq("member_id", me.id);
  const balances: Record<string, number> = {};
  for (const b of data ?? []) balances[b.resource] = Number(b.balance);
  return (
    <>
      <BankClient balances={balances} staff={me.staff} />
      <Nav staff={me.staff} />
    </>
  );
}
