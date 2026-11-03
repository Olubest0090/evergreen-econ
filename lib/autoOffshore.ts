import { getSetting, setSetting } from "@/lib/settings";

export type AutoOffshore = { enabled: boolean };

export async function getAutoOffshore(): Promise<AutoOffshore> {
  const v = await getSetting<AutoOffshore>("auto_offshore", { enabled: false });
  return { enabled: !!v?.enabled };
}

export async function setAutoOffshore(enabled: boolean) {
  await setSetting("auto_offshore", { enabled: !!enabled });
  return { enabled: !!enabled };
}
