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

export async function fetchNationGrowth(nationId: number): Promise<NationGrowth> {
  const data = await gql<{
    nations: {
      data: {
        id: string;
        nation_name: string;
        leader_name: string;
        num_cities: number;
        domestic_policy?: string | null;
        projects?: { name?: string }[] | null;
        cities?: { id: string; infrastructure?: number; land?: number }[] | null;
      }[];
    };
  }>(
    `query($id:[Int]){
      nations(id:$id, first:1){
        data {
          id nation_name leader_name num_cities domestic_policy
          projects { name }
          cities { id infrastructure land }
        }
      }
    }`,
    { id: [nationId] }
  );
  const n = data.nations?.data?.[0];
  if (!n) throw new Error(`Nation #${nationId} not found`);
  const projects: string[] = [];
  for (const p of n.projects || []) {
    if (p?.name) projects.push(p.name);
  }
  return {
    id: Number(n.id),
    nation_name: n.nation_name,
    leader_name: n.leader_name,
    num_cities: Number(n.num_cities) || 0,
    domestic_policy: n.domestic_policy ?? null,
    projects,
    cities: (n.cities || []).map((c) => ({
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

export async function quoteGrowthGrant(input: {
  nationId: number;
  grantType: "city" | "infra" | "land" | "project";
  cityCount?: number;
  targetInfra?: number;
  targetLand?: number;
  projectName?: string;
}): Promise<GrowthQuote> {
  try {
    const n = await fetchNationGrowth(input.nationId);
    const label = `${n.leader_name} (#${n.id})`;
    if (input.grantType === "city") {
      const count = Math.max(1, Math.min(20, Number(input.cityCount) || 1));
      const { money, breakdown } = cityGrantCost(n.num_cities, count, n.projects, n.domestic_policy);
      return {
        ok: true,
        grantType: "city",
        nationId: n.id,
        label,
        amounts: { money },
        breakdown,
        meta: { fromCities: n.num_cities, cityCount: count, policy: n.domestic_policy, projects: n.projects },
      };
    }
    if (input.grantType === "infra") {
      const target = Number(input.targetInfra);
      if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "Enter target infra level" };
      const { money, breakdown } = infraGrantCost(n.cities, target, n.projects, n.domestic_policy);
      return {
        ok: true,
        grantType: "infra",
        nationId: n.id,
        label,
        amounts: { money },
        breakdown,
        meta: { targetInfra: target, cities: n.cities.length },
      };
    }
    if (input.grantType === "land") {
      const target = Number(input.targetLand);
      if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "Enter target land level" };
      const { money, breakdown } = landGrantCost(n.cities, target, n.domestic_policy);
      return {
        ok: true,
        grantType: "land",
        nationId: n.id,
        label,
        amounts: { money },
        breakdown,
        meta: { targetLand: target, cities: n.cities.length },
      };
    }
    const pname = String(input.projectName || "").trim();
    if (!pname) return { ok: false, error: "Enter project name" };
    const pc = projectGrantCost(pname, n.projects);
    if (pc.error) return { ok: false, error: pc.error };
    return {
      ok: true,
      grantType: "project",
      nationId: n.id,
      label,
      amounts: pc.amounts,
      breakdown: pc.breakdown,
      meta: { projectName: pname },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Quote failed" };
  }
}
