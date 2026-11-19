"use client";

import { useState } from "react";

const FALLBACK = "https://politicsandwar.com/img/default.jpg";

export default function NationFlag({
  src,
  nationId,
  size = 36,
  className = "",
}: {
  src?: string | null;
  nationId?: number;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = broken || !src ? FALLBACK : src;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={nationId ? `Nation #${nationId}` : "Nation flag"}
      width={size}
      height={size}
      className={`shrink-0 rounded-md object-cover bg-black/30 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
