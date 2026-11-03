import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import Nav from "@/app/components/Nav";
import SendClient from "./SendClient";

export default async function GovSendPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!me.staff) redirect("/");
  return (
    <>
      <SendClient />
      <Nav staff />
    </>
  );
}
