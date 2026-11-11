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
    // Full number with comma grouping — no "k"/"m" shorthand, which read as
    // ambiguous (e.g. "$46915.56m" looked like it might just be $46,915.56).
    const label = `$${rounded.toLocaleString()}`;
    return { total: rounded, label };
  } catch (e) {
    console.error("marketWorth:", e);
    return null;
  }
}
