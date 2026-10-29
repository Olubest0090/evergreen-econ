import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import Nav from "@/app/components/Nav";
import RequestsClient from "./RequestsClient";

export default async function RequestsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  return (
    <>
      <RequestsClient />
      <Nav staff={me.staff} />
    </>
  );
}
