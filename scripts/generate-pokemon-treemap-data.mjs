#!/usr/bin/env node
/**
 * Generate docs/assets/data/pokemon-treemap-data.json from PokéAPI.
 *
 * Usage from repo root:
 *   node scripts/generate-pokemon-treemap-data.mjs
 *
 * Optional:
 *   POKEAPI_LIMIT=1025 POKEAPI_CONCURRENCY=12 node scripts/generate-pokemon-treemap-data.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const API_ROOT = 'https://pokeapi.co/api/v2';
const LIMIT = Number(process.env.POKEAPI_LIMIT || 1025);
const OUT_PATH = path.resolve('docs/assets/data/pokemon-treemap-data.json');
const CONCURRENCY = Number(process.env.POKEAPI_CONCURRENCY || 12);

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText}: ${url}`);
  }
  return res.json();
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${items.length}`);
    }
  });
  await Promise.all(workers);
  return results;
}

function idFromUrl(url) {
  const match = String(url).match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

function normalizeName(name = '') {
  return String(name)
    .replaceAll('-', ' ')
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function slugify(text = '') {
  return normalizeName(text).toLowerCase().split(' ').join('-');
}

function englishName(species) {
  return species.names?.find(n => n.language?.name === 'en')?.name || normalizeName(species.name);
}

function japaneseName(species) {
  return species.names?.find(n => ['ja-Hrkt', 'ja'].includes(n.language?.name))?.name || '';
}

function generationNumber(species) {
  const raw = species.generation?.name || '';
  const roman = raw.replace('generation-', '').toLowerCase();
  const map = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
  return map[roman] || null;
}

function pickFlavor(species) {
  const entry = [...(species.flavor_text_entries || [])]
    .reverse()
    .find(e => e.language?.name === 'en');
  return entry ? entry.flavor_text.replace(/[\n\f\r]+/g, ' ') : '';
}

function pickGenus(species) {
  return species.genera?.find(g => g.language?.name === 'en')?.genus || '';
}

function statMapFromPokemon(pokemon) {
  const map = {};
  for (const entry of pokemon?.stats || []) {
    map[entry.stat.name] = entry.base_stat;
  }

  return {
    hp: map.hp || 0,
    attack: map.attack || 0,
    defense: map.defense || 0,
    specialAttack: map['special-attack'] || 0,
    specialDefense: map['special-defense'] || 0,
    speed: map.speed || 0
  };
}

function totalBaseStats(stats) {
  return stats.hp + stats.attack + stats.defense + stats.specialAttack + stats.specialDefense + stats.speed;
}

function spriteUrlFromPokemon(pokemon) {
  return (
    pokemon?.sprites?.other?.['official-artwork']?.front_default ||
    pokemon?.sprites?.other?.home?.front_default ||
    pokemon?.sprites?.front_default ||
    ''
  );
}

function flattenEvolutionChain(chainNode, stage = 1, parent = null, rows = []) {
  if (!chainNode?.species) return rows;

  const name = normalizeName(chainNode.species.name);
  const evolvesTo = Array.isArray(chainNode.evolves_to) ? chainNode.evolves_to : [];

  rows.push({
    slug: chainNode.species.name,
    name,
    stage,
    evolvesFrom: parent,
    evolvesTo: evolvesTo.map(child => normalizeName(child.species.name))
  });

  for (const child of evolvesTo) {
    flattenEvolutionChain(child, stage + 1, name, rows);
  }

  return rows;
}

function compactFamilyName(chainRows) {
  if (!chainRows.length) return 'Unknown Family';

  const roots = chainRows.filter(row => !row.evolvesFrom);
  const root = roots[0] || chainRows[0];

  if (chainRows.length <= 4) {
    return chainRows
      .sort((a, b) => a.stage - b.stage || a.name.localeCompare(b.name))
      .map(row => row.name)
      .join(' → ');
  }

  return `${root.name} Evolution Family`;
}

const evolutionChainCache = new Map();

async function getEvolutionInfo(species) {
  const chainUrl = species.evolution_chain?.url;
  if (!chainUrl) {
    const name = englishName(species);
    return {
      familyId: `${slugify(name)}-family`,
      familyName: `${name} Family`,
      stage: 1,
      evolvesFrom: null,
      evolvesTo: []
    };
  }

  if (!evolutionChainCache.has(chainUrl)) {
    evolutionChainCache.set(chainUrl, fetchJson(chainUrl));
  }

  const chain = await evolutionChainCache.get(chainUrl);
  const chainRows = flattenEvolutionChain(chain.chain);
  const chainId = idFromUrl(chainUrl);
  const current = chainRows.find(row => row.slug === species.name) || chainRows.find(row => row.name === englishName(species));

  return {
    familyId: chainId ? `evolution-chain-${chainId}` : `${slugify(compactFamilyName(chainRows))}-family`,
    familyName: compactFamilyName(chainRows),
    stage: current?.stage || 1,
    evolvesFrom: current?.evolvesFrom || null,
    evolvesTo: current?.evolvesTo || []
  };
}

const speciesList = await fetchJson(`${API_ROOT}/pokemon-species?limit=${LIMIT}`);

const rows = await mapLimit(speciesList.results, CONCURRENCY, async speciesRef => {
  const species = await fetchJson(speciesRef.url);
  const defaultVariety = species.varieties?.find(variety => variety.is_default) || species.varieties?.[0];
  const pokemonUrl = defaultVariety?.pokemon?.url;
  const pokemon = pokemonUrl ? await fetchJson(pokemonUrl) : null;
  const evolution = await getEvolutionInfo(species);

  const types = pokemon?.types
    ?.sort((a, b) => a.slot - b.slot)
    ?.map(entry => normalizeName(entry.type.name)) || [];

  const stats = statMapFromPokemon(pokemon);
  const baseStatsTotal = totalBaseStats(stats);
  const abilities = (pokemon?.abilities || []).map(entry => normalizeName(entry.ability.name));

  const attacks = (pokemon?.moves || []).slice(0, 4).map((entry, index) => ({
    name: normalizeName(entry.move.name),
    type: types[0] || 'Move',
    power: index === 0 ? Math.max(10, Math.round(baseStatsTotal / 8)) : Math.max(0, Math.round(baseStatsTotal / (10 + index * 2))),
    text: index === 0 ? 'A signature-style move drawn from this Pokémon’s known move list.' : 'A card-style attack option based on a known move.'
  }));

  const id = species.id ?? idFromUrl(speciesRef.url);

  return {
    id,
    dexNumber: id,
    nationalDexNumber: id,
    slug: species.name,
    name: englishName(species),
    japaneseName: japaneseName(species),
    primaryType: types[0] || 'Unknown',
    secondaryType: types[1] || null,
    types,
    generation: generationNumber(species),
    generationName: species.generation?.name || null,
    color: species.color?.name || null,
    shape: species.shape?.name || null,
    habitat: species.habitat?.name || null,
    growthRate: species.growth_rate?.name || null,
    captureRate: species.capture_rate ?? null,
    baseHappiness: species.base_happiness ?? null,
    isBaby: Boolean(species.is_baby),
    isLegendary: Boolean(species.is_legendary),
    isMythical: Boolean(species.is_mythical),
    genus: pickGenus(species),
    description: pickFlavor(species),
    flavorText: pickFlavor(species),
    abilities,
    attacks,
    stats,
    baseStatsTotal,
    spriteUrl: spriteUrlFromPokemon(pokemon),
    officialArtworkUrl: spriteUrlFromPokemon(pokemon),
    evolutionFamilyId: evolution.familyId,
    evolutionFamilyName: evolution.familyName,
    evolutionStage: evolution.stage,
    evolvesFrom: evolution.evolvesFrom,
    evolvesTo: evolution.evolvesTo,
    api: {
      pokemon: pokemonUrl || null,
      species: speciesRef.url,
      evolutionChain: species.evolution_chain?.url || null
    }
  };
});

rows.sort((a, b) => a.dexNumber - b.dexNumber);

const typeCounts = rows.reduce((acc, row) => {
  for (const type of row.types) acc[type] = (acc[type] || 0) + 1;
  return acc;
}, {});

const generationCounts = rows.reduce((acc, row) => {
  const key = row.generation || 'unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const typeTreemap = Object.entries(typeCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([type, count]) => ({
    name: type,
    value: count,
    children: rows
      .filter(row => row.types.includes(type))
      .map(row => ({
        id: row.id,
        name: row.name,
        japaneseName: row.japaneseName,
        value: row.baseStatsTotal || 1,
        primaryType: row.primaryType,
        secondaryType: row.secondaryType,
        types: row.types,
        generation: row.generation,
        generationName: row.generationName,
        spriteUrl: row.spriteUrl,
        evolutionFamilyId: row.evolutionFamilyId,
        evolutionFamilyName: row.evolutionFamilyName,
        evolutionStage: row.evolutionStage
      }))
  }));

const payload = {
  schemaVersion: 2,
  source: 'https://pokeapi.co/',
  generatedAt: new Date().toISOString(),
  expectedSpeciesCount: LIMIT,
  speciesCount: rows.length,
  typeCounts,
  generationCounts,
  pokemon: rows,
  species: rows,
  treemap: {
    name: 'Pokémon',
    children: typeTreemap
  },
  typeTreemap
};

if (payload.speciesCount < 1000) {
  throw new Error(`Refusing to write undersized dataset: ${payload.speciesCount} species`);
}

const missingSprites = rows.filter(row => !row.spriteUrl).length;
const missingFamilies = rows.filter(row => !row.evolutionFamilyId || !row.evolutionFamilyName).length;
const zeroStats = rows.filter(row => !row.baseStatsTotal || row.baseStatsTotal <= 1).length;

if (missingFamilies) throw new Error(`Refusing to write dataset with ${missingFamilies} missing evolution families.`);
if (zeroStats > 20) throw new Error(`Refusing to write dataset with ${zeroStats} missing/zero stat rows.`);

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(OUT_PATH, `${JSON.stringify(payload)}\n`, 'utf8');

console.log(`Wrote ${OUT_PATH} with ${payload.speciesCount} species.`);
console.log(`Missing sprites: ${missingSprites}`);
console.log(`Evolution chains fetched: ${evolutionChainCache.size}`);
