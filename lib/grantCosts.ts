/**
 * P&W growth grant cost calculators (wiki City Formulas).
 */
import { getPnwApiKey } from "@/lib/secrets";

export type NationGrowth = {
  id: number;
  nation_name: string;
  leader_name: string;
  num_cities: number;
  domestic_policy: string | null;
  projects: string[];
  cities: { id: number; infrastructure: number; land: number }[];
};

export const PROJECT_COSTS: Record<string, Partial<Record<string, number>>> = {
  "Urban Planning": { coal: 10000, oil: 10000, aluminum: 20000, munitions: 10000, gasoline: 10000, food: 1000000 },
  "Advanced Urban Planning": { coal: 10000, oil: 10000, uranium: 10000, aluminum: 20000, munitions: 10000, gasoline: 10000, food: 1000000 },
  "Metropolitan Planning": { coal: 20000, oil: 20000, uranium: 10000, aluminum: 40000, munitions: 20000, gasoline: 20000, food: 2000000 },
  "Center for Civil Engineering": { money: 3000000, oil: 1000, iron: 1000, bauxite: 1000 },
  "Advanced Engineering Corps": { money: 50000000, uranium: 10000, munitions: 20000, gasoline: 20000 },
  "Government Support Agency": { money: 20000000, aluminum: 10000, food: 200000 },
  "Ironworks": { coal: 500, iron: 500 },
  "Bauxiteworks": { bauxite: 500, aluminum: 500 },
  "Arms Stockpile": { money: 10000000, munitions: 5000, steel: 5000 },
  "Emergency Gasoline Reserve": { money: 10000000, gasoline: 5000, oil: 5000 },
  "Propaganda Bureau": { money: 15000000, aluminum: 5000, munitions: 5000 },
  "Missile Launch Pad": { money: 15000000, aluminum: 10000, gasoline: 10000, munitions: 10000 },
  "Iron Dome": { money: 15000000, aluminum: 5000, steel: 5000, munitions: 5000 },
  "Vital Defense System": { money: 20000000, aluminum: 15000, steel: 15000, munitions: 15000 },
  "Intelligence Agency": { money: 10000000, steel: 10000, aluminum: 10000 },
  "Spy Satellite": { money: 20000000, oil: 10000, uranium: 10000, aluminum: 10000 },
  "Nuclear Research Facility": { money: 75000000, uranium: 5000 },
  "Space Program": { money: 50000000, aluminum: 20000, uranium: 10000 },
  "Moon Landing": { money: 50000000, aluminum: 20000, uranium: 10000 },
  "Pirate Economy": { money: 25000000, steel: 10000, aluminum: 10000 },
  "Recycling Initiative": { money: 10000000, food: 100000 },
  "Telecommunications Satellite": { money: 50000000, aluminum: 10000, uranium: 10000 },
  "Green Technologies": { money: 25000000, food: 100000, uranium: 10000 },
  "Clinical Research Center": { money: 10000000, food: 100000 },
};

function normProject(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, " ");
}

export function findProjectCost(name: string): Partial<Record<string, number>> | null {
  const n = normProject(name);
  for (const [k, v] of Object.entries(PROJECT_COSTS)) {
    if (normProject(k) === n) return { ...v };
  }
  for (const [k, v] of Object.entries(PROJECT_COSTS)) {
    if (normProject(k).includes(n) || n.includes(normProject(k))) return { ...v };
  }
  return null;
}

export function nextCityCostRaw(currentCities: number): number {
  const X = Math.max(1, currentCities);
  return 50000 * Math.pow(X - 1, 3) + 150000 * X + 75000;
}

export function cityGrantCost(
  currentCities: number,
  citiesToBuy: number,
  projects: string[],
  domesticPolicy: string | null
): { money: number; breakdown: string[] } {
  const proj = new Set(projects.map(normProject));
  const breakdown: string[] = [];
  let total = 0;
  let cities = currentCities;
  for (let i = 0; i < citiesToBuy; i++) {
    let cost = nextCityCostRaw(cities);
    let disc = 0;
    if (proj.has(normProject("Urban Planning"))) disc += 50_000_000;
    if (proj.has(normProject("Advanced Urban Planning"))) disc += 100_000_000;
    if (proj.has(normProject("Metropolitan Planning"))) disc += 150_000_000;
    cost = Math.max(0, cost - disc);
    const pol = (domesticPolicy || "").toLowerCase();
    if (pol.includes("manifest")) {
      const rate = proj.has(normProject("Government Support Agency")) ? 0.075 : 0.05;
      cost *= 1 - rate;
      if (i === 0) breakdown.push(`Manifest Destiny -${rate * 100}%`);
    }
    if (i === 0 && disc > 0) breakdown.push(`City planning projects -$${disc.toLocaleString()}`);
    total += cost;
    cities += 1;
  }
  total = Math.round(total * 100) / 100;
  breakdown.push(`${citiesToBuy} city(ies) from ${currentCities} -> ${currentCities + citiesToBuy}`);
  return { money: total, breakdown };
}

function infraUnitCost(infra: number): number {
  return Math.pow(Math.abs(infra - 10), 2.2) / 710 + 300;
}

export function infraCostRange(startInfra: number, endInfra: number): number {
  if (endInfra <= startInfra) return 0;
  let total = 0;
  for (let x = startInfra; x < endInfra; x += 1) {
    const chunk = Math.min(1, endInfra - x);
    total += infraUnitCost(x) * chunk;
  }
  return total;
}

export function infraGrantCost(
  cities: { infrastructure: number }[],
  targetInfra: number,
  projects: string[],
  domesticPolicy: string | null
): { money: number; breakdown: string[] } {
  const proj = new Set(projects.map(normProject));
  let total = 0;
  const breakdown: string[] = [];
  for (const c of cities) {
    const from = Number(c.infrastructure) || 0;
    if (from >= targetInfra) continue;
    total += infraCostRange(from, targetInfra);
  }
  if (proj.has(normProject("Center for Civil Engineering"))) {
    total *= 0.95;
    breakdown.push("Center for Civil Engineering -5%");
  }
  const pol = (domesticPolicy || "").toLowerCase();
  if (pol.includes("urbanization")) {
    total *= 0.95;
    breakdown.push("Urbanization policy -5%");
  }
  total = Math.round(total * 100) / 100;
  breakdown.push(`Infra up to ${targetInfra} on ${cities.length} city(ies)`);
  return { money: total, breakdown };
}

function landUnitCost(land: number): number {
  return 0.002 * Math.pow(land - 20, 2) + 50;
}

export function landCostRange(startLand: number, endLand: number): number {
  if (endLand <= startLand) return 0;
  let total = 0;
  for (let x = startLand; x < endLand; x += 1) {
    const chunk = Math.min(1, endLand - x);
    total += landUnitCost(x) * chunk;
  }
  return total;
}

export function landGrantCost(
  cities: { land: number }[],
  targetLand: number,
  domesticPolicy: string | null
): { money: number; breakdown: string[] } {
  let total = 0;
  for (const c of cities) {
    const from = Number(c.land) || 0;
    if (from >= targetLand) continue;
    total += landCostRange(from, targetLand);
  }
  const pol = (domesticPolicy || "").toLowerCase();
  if (pol.includes("rapid expansion")) total *= 0.95;
  total = Math.round(total * 100) / 100;
  return { money: total, breakdown: [`Land up to ${targetLand} on ${cities.length} city(ies)`] };
}

export function projectGrantCost(
  projectName: string,
  ownedProjects: string[]
): { amounts: Record<string, number>; breakdown: string[]; error?: string } {
  if (ownedProjects.some((p) => normProject(p) === normProject(projectName))) {
    return { amounts: {}, breakdown: [], error: `Already has project: ${projectName}` };
  }
  const cost = findProjectCost(projectName);
  if (!cost) {
    return {
      amounts: {},
      breakdown: [],
      error: `Unknown project cost for "${projectName}". Add to PROJECT_COSTS or use manual amounts.`,
    };
  }
  const amounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(cost)) {
    if (Number(v) > 0) amounts[k] = Number(v);
  }
  return { amounts, breakdown: [`Project: ${projectName}`] };
}


async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = await getPnwApiKey();
  if (!key) throw new Error("PNW_API_KEY not set");
  const res = await fetch(
    `https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`P&W API ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

const PROJECT_GQL_FIELDS: { field: string; name: string }[] = [
  { field: "city_planning", name: "Urban Planning" },
  { field: "adv_city_planning", name: "Advanced Urban Planning" },
  { field: "urban_planning", name: "Urban Planning" },
  { field: "advanced_urban_planning", name: "Advanced Urban Planning" },
  { field: "metropolitan_planning", name: "Metropolitan Planning" },
  { field: "cfce", name: "Center for Civil Engineering" },
  { field: "center_for_civil_engineering", name: "Center for Civil Engineering" },
  { field: "adv_engineering_corps", name: "Advanced Engineering Corps" },
  { field: "advanced_engineering_corps", name: "Advanced Engineering Corps" },
  { field: "ironw", name: "Ironworks" },
  { field: "iron_works", name: "Ironworks" },
  { field: "bauxitew", name: "Bauxiteworks" },
  { field: "bauxite_works", name: "Bauxiteworks" },
  { field: "armss", name: "Arms Stockpile" },
  { field: "arms_stockpile", name: "Arms Stockpile" },
  { field: "egr", name: "Emergency Gasoline Reserve" },
  { field: "emergency_gasoline_reserve", name: "Emergency Gasoline Reserve" },
  { field: "mlp", name: "Missile Launch Pad" },
  { field: "missile_launch_pad", name: "Missile Launch Pad" },
  { field: "irond", name: "Iron Dome" },
  { field: "iron_dome", name: "Iron Dome" },
  { field: "cia", name: "Intelligence Agency" },
  { field: "intelligence_agency", name: "Intelligence Agency" },
  { field: "space_program", name: "Space Program" },
  { field: "spy_satellite", name: "Spy Satellite" },
  { field: "moon_landing", name: "Moon Landing" },
  { field: "green_tech", name: "Green Technologies" },
  { field: "green_technologies", name: "Green Technologies" },
  { field: "recycling_initiative", name: "Recycling Initiative" },
  { field: "pirate_economy", name: "Pirate Economy" },
  { field: "clinical_research_center", name: "Clinical Research Center" },
  { field: "government_support_agency", name: "Government Support Agency" },
  { field: "arable_land_agency", name: "Arable Land Agency" },
  { field: "activity_center", name: "Activity Center" },
  { field: "telecommunications_satellite", name: "Telecommunications Satellite" },
  { field: "propaganda_bureau", name: "Propaganda Bureau" },
  { field: "vital_defense_system", name: "Vital Defense System" },
  { field: "nuclear_research_facility", name: "Nuclear Research Facility" },
];

function collectProjects(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { field, name } of PROJECT_GQL_FIELDS) {
    if (row[field] === true || row[field] === 1 || row[field] === "1") {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(name);
      }
    }
  }
  return out;
}

async function fetchNationRow(nationId: number, includeProjects: boolean): Promise<Record<string, unknown>> {
  const projFields = includeProjects ? [...new Set(PROJECT_GQL_FIELDS.map((p) => p.field))] : [];
  const projSel = projFields.length ? "\n          " + projFields.join("\n          ") : "";
  const data = await gql<{ nations: { data: Record<string, unknown>[] } }>(
    `query($id:[Int]){
      nations(id:$id, first:1){
        data {
          id nation_name leader_name num_cities domestic_policy
          ${projSel}
          cities { id infrastructure land }
        }
      }
    }`,
    { id: [nationId] }
  );
  const n = data.nations?.data?.[0];
  if (!n) throw new Error(`Nation #${nationId} not found`);
  return n;
}

export async function fetchNationGrowth(nationId: number): Promise<NationGrowth> {
  let row: Record<string, unknown>;
  try {
    row = await fetchNationRow(nationId, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/Cannot query field|Unknown type|Unknown field|must not have a sub selection/i.test(msg)) {
      row = await fetchNationRow(nationId, false);
    } else {
      throw e;
    }
  }
  const citiesRaw = (row.cities as { id: string; infrastructure?: number; land?: number }[]) || [];
  return {
    id: Number(row.id),
    nation_name: String(row.nation_name || ""),
    leader_name: String(row.leader_name || ""),
    num_cities: Number(row.num_cities) || 0,
    domestic_policy: row.domestic_policy != null ? String(row.domestic_policy) : null,
    projects: collectProjects(row),
    cities: citiesRaw.map((c) => ({
      id: Number(c.id),
      infrastructure: Number(c.infrastructure) || 0,
      land: Number(c.land) || 0,
    })),
  };
}

export type GrowthQuote =
  | {
      ok: true;
      grantType: "city" | "infra" | "land" | "project";
      nationId: number;
      label: string;
      amounts: Record<string, number>;
      breakdown: string[];
      meta: Record<string, unknown>;
    }
  | { ok: false; error: string };

export const PROJECT_LIST = Object.keys(PROJECT_COSTS).sort();

export async function quoteGrowthGrant(input: {
  nationId: number;
  grantType: "city" | "infra" | "land" | "project";
  cityCount?: number;
  cityTo?: number;
  cityIds?: number[];
  targetInfra?: number;
  targetLand?: number;
  projectName?: string;
}): Promise<GrowthQuote> {
  try {
    const n = await fetchNationGrowth(input.nationId);
    const label = `${n.leader_name} (#${n.id})`;
    if (input.grantType === "city") {
      let count = Math.max(1, Math.min(20, Number(input.cityCount) || 1));
      const cityTo = Number(input.cityTo);
      if (Number.isFinite(cityTo) && cityTo > n.num_cities) {
        count = Math.min(20, Math.max(1, cityTo - n.num_cities));
      } else if (Number.isFinite(cityTo) && cityTo <= n.num_cities) {
        return { ok: false, error: `Nation already has ${n.num_cities} cities (target ${cityTo})` };
      }
      const { money, breakdown } = cityGrantCost(n.num_cities, count, n.projects, n.domestic_policy);
      breakdown.unshift(`Grant cities c${n.num_cities + 1}-c${n.num_cities + count} (now ${n.num_cities})`);
      return {
        ok: true, grantType: "city", nationId: n.id, label, amounts: { money }, breakdown,
        meta: { fromCities: n.num_cities, cityCount: count, cityFrom: n.num_cities + 1, cityTo: n.num_cities + count, policy: n.domestic_policy, projects: n.projects },
      };
    }
    const selectedCities =
      input.cityIds && input.cityIds.length
        ? n.cities.filter((c) => input.cityIds!.includes(c.id))
        : n.cities;
    if (!selectedCities.length) return { ok: false, error: "No cities selected (or nation has no cities)" };
    if (input.grantType === "infra") {
      const target = Number(input.targetInfra);
      if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "Enter target infra level" };
      const { money, breakdown } = infraGrantCost(selectedCities, target, n.projects, n.domestic_policy);
      breakdown.unshift(`Cities: ${selectedCities.map((c) => "#" + c.id + " (" + c.infrastructure + " infra)").join(", ")}`);
      return {
        ok: true, grantType: "infra", nationId: n.id, label, amounts: { money }, breakdown,
        meta: { targetInfra: target, cityIds: selectedCities.map((c) => c.id), cities: selectedCities.length },
      };
    }
    if (input.grantType === "land") {
      const target = Number(input.targetLand);
      if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "Enter target land level" };
      const { money, breakdown } = landGrantCost(selectedCities, target, n.domestic_policy);
      breakdown.unshift(`Cities: ${selectedCities.map((c) => "#" + c.id + " (" + c.land + " land)").join(", ")}`);
      return {
        ok: true, grantType: "land", nationId: n.id, label, amounts: { money }, breakdown,
        meta: { targetLand: target, cityIds: selectedCities.map((c) => c.id), cities: selectedCities.length },
      };
    }
    const pname = String(input.projectName || "").trim();
    if (!pname) return { ok: false, error: "Choose a project" };
    const pc = projectGrantCost(pname, n.projects);
    if (pc.error) return { ok: false, error: pc.error };
    return {
      ok: true, grantType: "project", nationId: n.id, label, amounts: pc.amounts, breakdown: pc.breakdown,
      meta: { projectName: pname, ownedProjects: n.projects },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Quote failed" };
  }
}
