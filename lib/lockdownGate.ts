import { lockdownBlocks, type LockdownFlags } from "@/lib/securityCore";

/** Map gov actions → lockdown flags */
export function actionLockdownKey(action: string): keyof LockdownFlags | null {
  switch (action) {
    case "save_warchest":
    case "member_status":
    case "adjust_balance":
    case "import_apply":
    case "import_preview":
      return "balance_adjust";
    case "decide": // grant/request decisions
      return "grants";
    case "withdrawal":
      return "withdrawals";
    case "staff_set":
    case "staff_remove":
      return "staff_manage";
    default:
      return null;
  }
}

export async function rejectIfLocked(action: string): Promise<string | null> {
  const key = actionLockdownKey(action);
  if (!key) return null;
  return lockdownBlocks(key);
}
