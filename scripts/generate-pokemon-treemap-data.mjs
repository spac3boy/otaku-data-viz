#!/usr/bin/env node
/**
 * Generate docs/assets/data/pokemon-treemap-data.json from PokéAPI.
 *
 * Usage from repo root:
 *   node scripts/generate-pokemon-treemap-data.mjs
 *
 * Optional:
 *   POKEAPI_LIMIT=1025 node scripts/generate-pokemon-treemap-data.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const API_ROOT = 'https://pokeapi.co/api/v2';
const LIMIT = Number(process.env.POKEAPI_LIMIT || 1025);
const OUT_PATH = path.resolve('docs/assets/data/pokemon-treemap-data.json');
const CONCURRENCY = Number(process.env.POKEAPI_CONCURRENCY || 16);

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise(r => setTimeout(r, 500 * attempt));
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

function englishName(species) {
  return species.names?.find(n => n.language?.name === 'en')?.name || species.name;
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
  const entry = species.flavor_text_entries?.find(e => e.language?.name === 'en');
  return entry ? entry.flavor_text.replace(/[\n\f\r]+/g, ' ') : '';
}

const speciesList = await fetchJson(`${API_ROOT}/pokemon-species?limit=${LIMIT}`);
const pokemonList = await fetchJson(`${API_ROOT}/pokemon?limit=${LIMIT}`);
const pokemonByName = new Map(pokemonList.results.map(p => [p.name, p]));

const rows = await mapLimit(speciesList.results, CONCURRENCY, async speciesRef => {
  const species = await fetchJson(speciesRef.url);
  const pokemonRef = pokemonByName.get(species.name);
  const pokemon = pokemonRef ? await fetchJson(pokemonRef.url) : null;
  const types = pokemon?.types
    ?.sort((a, b) => a.slot - b.slot)
    ?.map(t => t.type.name) || [];

  return {
    id: species.id ?? idFromUrl(speciesRef.url),
    nationalDexNumber: species.id ?? idFromUrl(speciesRef.url),
    slug: species.name,
    name: englishName(species),
    japaneseName: japaneseName(species),
    primaryType: types[0] || 'unknown',
    secondaryType: types[1] || null,
    types,
    generation: species.generation?.name || null,
    generationNumber: generationNumber(species),
    color: species.color?.name || null,
    shape: species.shape?.name || null,
    habitat: species.habitat?.name || null,
    growthRate: species.growth_rate?.name || null,
    captureRate: species.capture_rate ?? null,
    baseHappiness: species.base_happiness ?? null,
    isBaby: Boolean(species.is_baby),
    isLegendary: Boolean(species.is_legendary),
    isMythical: Boolean(species.is_mythical),
    flavorText: pickFlavor(species),
    api: {
      pokemon: pokemonRef?.url || null,
      species: speciesRef.url
    }
  };
});

rows.sort((a, b) => a.nationalDexNumber - b.nationalDexNumber);

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
        value: 1,
        primaryType: row.primaryType,
        secondaryType: row.secondaryType,
        types: row.types,
        generation: row.generation,
        generationNumber: row.generationNumber
      }))
  }));

const payload = {
  schemaVersion: 1,
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

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(OUT_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
console.log(`Wrote ${OUT_PATH} with ${payload.speciesCount} species.`);
