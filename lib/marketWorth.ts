import { fetchLatestMarketPrices } from "@/lib/pnw";
import { RESOURCES } from "@/lib/resources";

/** Approx market value of amounts using P&W daily average prices (money = $1). */
export async function marketWorth(
  amounts: Record<string, number>
): Promise<{ total: number; label: string } | null> {
  try {
    const { prices } = await fetchLatestMarketPrices();
    let total = 0;
    for (const r of RESOURCES) {
      const qty = Number(amounts[r] ?? 0);
      if (!qty) continue;
      const px = r === "money" ? 1 : Number(prices[r] ?? 0);
      if (Number.isFinite(px) && px >= 0) total += qty * px;
    }
    if (!Number.isFinite(total) || total <= 0) return null;
    const rounded = Math.round(total);
    const label =
      rounded >= 1_000_000
        ? `$${(rounded / 1_000_000).toFixed(2)}m`
        : rounded >= 1_000
          ? `$${(rounded / 1_000).toFixed(1)}k`
          : `$${rounded.toLocaleString()}`;
    return { total: rounded, label };
  } catch (e) {
    console.error("marketWorth:", e);
    return null;
  }
}
