import { fmt, LABEL } from "@/lib/resources";
import { pnwResourceIconUrl } from "@/lib/resourceIcons";

/** Amount + official PnW resource icon (small). */
export function ResourceAmount({
  resource,
  amount,
  showSign = false,
}: {
  resource: string;
  amount: number | string;
  showSign?: boolean;
}) {
  const n = Number(amount);
  const sign = showSign ? (n >= 0 ? "+" : "") : "";
  const moneyPrefix = resource === "money" && !showSign ? "$" : "";
  return (
    <span className="inline-flex items-center gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pnwResourceIconUrl(resource)}
        alt={LABEL[resource] || resource}
        title={LABEL[resource] || resource}
        width={16}
        height={16}
        className="inline-block h-4 w-4 shrink-0 object-contain"
        loading="lazy"
      />
      <span>
        {sign}
        {moneyPrefix}
        {fmt(n)}
      </span>
    </span>
  );
}

/** List of resources with icons (warchest / balances). */
export function ResourceAmountList({
  amounts,
}: {
  amounts: Record<string, number | string>;
}) {
  const entries = Object.entries(amounts || {}).filter(
    ([, v]) => Number(v) !== 0
  );
  if (!entries.length) return <span>-</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {entries.map(([k, v]) => (
        <ResourceAmount key={k} resource={k} amount={v} />
      ))}
    </span>
  );
}
