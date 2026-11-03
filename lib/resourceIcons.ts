/** Politics & War resource icon URLs (same files the game uses). */
export function pnwResourceIconUrl(resource: string): string {
  const r = resource.toLowerCase();
  // Food uses the steak icon in-game UI helpers; resources path for the rest
  if (r === "food") {
    return "https://politicsandwar.com/img/resources/food.png";
  }
  if (r === "money") {
    return "https://politicsandwar.com/img/resources/money.png";
  }
  return `https://politicsandwar.com/img/resources/${r}.png`;
}
