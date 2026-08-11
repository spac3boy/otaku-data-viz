import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { pokemonDataPaths, pokemonRepositoryRoot } from './publish-pokemon-data.mjs';

const jsonFile = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const orderedObject = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => String(a).localeCompare(String(b), 'en', { numeric: true })));

export const validatePokemonDataset = async ({ root = pokemonRepositoryRoot } = {}) => {
  const paths = pokemonDataPaths(root);
  const [canonicalBytes, publishedBytes, data, metadata, schema] = await Promise.all([
    readFile(paths.canonical),
    readFile(paths.published),
    jsonFile(paths.canonical),
    jsonFile(paths.metadata),
    jsonFile(paths.schema)
  ]);
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  check(canonicalBytes.equals(publishedBytes), 'Published Pokémon JSON is not byte-for-byte identical to the canonical snapshot.');
  check(metadata.datasetId === 'pokemon-species-treemap', 'Metadata datasetId is missing or unexpected.');
  check(/^1\.\d+\.\d+$/.test(metadata.version || ''), 'Metadata version must be a semantic v1 version.');
  check(metadata.schemaVersion === data.schemaVersion, 'Metadata and data schema versions differ.');
  check(metadata.generatedAt === data.generatedAt, 'Metadata and data generatedAt values differ.');
  check(metadata.canonicalFile === path.relative(root, paths.canonical), 'Metadata canonicalFile does not identify the canonical snapshot.');
  check(metadata.publishedFile === path.relative(root, paths.published), 'Metadata publishedFile does not identify the site copy.');
  check(/^\d{4}-\d{2}-\d{2}$/.test(metadata.lastReviewed || ''), 'Metadata lastReviewed must be an ISO date.');
  check(Array.isArray(metadata.sources) && metadata.sources.length >= 2, 'Metadata must document primary data and artwork-reference sources.');
  check(Array.isArray(metadata.methodology) && metadata.methodology.length >= 5, 'Metadata methodology is incomplete.');
  check(Array.isArray(metadata.transformations) && metadata.transformations.length >= 4, 'Metadata transformations are incomplete.');
  check(Array.isArray(metadata.modeledFields) && metadata.modeledFields.length >= 3, 'Metadata must disclose modeled presentation fields.');
  check(Array.isArray(metadata.limitations) && metadata.limitations.length >= 5, 'Metadata limitations are incomplete.');
  check(Array.isArray(metadata.verification) && metadata.verification.length >= 4, 'Metadata verification notes are incomplete.');
  const modeledPaths = metadata.modeledFields.flatMap((entry) => entry.fields || []);
  for (const requiredPath of ['pokemon[].attacks[].power', 'pokemon[].attacks[].text', 'pokemon[].attacks[].type']) {
    check(modeledPaths.includes(requiredPath), `Metadata does not disclose modeled field ${requiredPath}.`);
  }

  check(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'Schema must declare JSON Schema 2020-12.');
  check(schema.$id === 'https://raw.githubusercontent.com/spac3boy/otaku-data-viz/main/datasets/pokemon/v1/schema.json', 'Schema $id is missing or unexpected.');
  check(schema.properties?.schemaVersion?.const === data.schemaVersion, 'Schema does not lock the current schemaVersion.');
  for (const field of ['schemaVersion', 'source', 'generatedAt', 'speciesCount', 'pokemon', 'species', 'typeTreemap']) {
    check(schema.required?.includes(field), `Schema does not require top-level field ${field}.`);
  }

  check(data.schemaVersion === 2, 'Canonical data schemaVersion must be 2.');
  check(data.source === 'https://pokeapi.co/', 'Canonical data source URL is unexpected.');
  check(!Number.isNaN(Date.parse(data.generatedAt)), 'Canonical generatedAt is not a valid date-time.');
  check(Number.isInteger(data.speciesCount) && data.speciesCount >= 1000, 'Canonical speciesCount is below full-snapshot expectations.');
  check(data.expectedSpeciesCount === data.speciesCount, 'expectedSpeciesCount and speciesCount differ.');
  check(metadata.recordCount === data.speciesCount, 'Metadata recordCount and canonical speciesCount differ.');
  check(Array.isArray(data.pokemon) && data.pokemon.length === data.speciesCount, 'pokemon array length does not match speciesCount.');
  check(Array.isArray(data.species) && data.species.length === data.speciesCount, 'species array length does not match speciesCount.');

  const ids = new Set();
  const typeCounts = new Map();
  const generationCounts = new Map();
  const familyMembers = new Map();
  const requiredRecordFields = [
    'id', 'dexNumber', 'nationalDexNumber', 'slug', 'name', 'primaryType', 'types',
    'generation', 'stats', 'baseStatsTotal', 'evolutionFamilyId', 'evolutionFamilyName',
    'evolutionStage', 'evolvesTo', 'api'
  ];

  data.pokemon?.forEach((record, index) => {
    const label = `Record ${index + 1}${record?.name ? ` (${record.name})` : ''}`;
    requiredRecordFields.forEach((field) => check(record?.[field] !== undefined && record?.[field] !== null, `${label} is missing ${field}.`));
    check(record.id === record.dexNumber && record.dexNumber === record.nationalDexNumber, `${label} has inconsistent identifiers.`);
    check(!ids.has(record.dexNumber), `${label} duplicates National Pokédex number ${record.dexNumber}.`);
    ids.add(record.dexNumber);
    check(record.dexNumber === index + 1, `${label} is not ordered as the expected contiguous National Pokédex snapshot.`);
    check(Array.isArray(record.types) && record.types.length >= 1 && record.types.length <= 2, `${label} must have one or two types.`);
    check(record.primaryType === record.types?.[0], `${label} primaryType is not the first listed type.`);
    check(record.secondaryType === (record.types?.[1] || null), `${label} secondaryType does not match the second listed type.`);
    check(Number.isInteger(record.generation) && record.generation >= 1 && record.generation <= 9, `${label} has an invalid generation.`);

    const stats = record.stats || {};
    const statTotal = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
      .reduce((sum, field) => sum + Number(stats[field] || 0), 0);
    check(statTotal === record.baseStatsTotal, `${label} baseStatsTotal does not equal its six stats.`);
    check(record.evolutionStage >= 1, `${label} has an invalid evolution stage.`);
    check(Array.isArray(record.evolvesTo), `${label} evolvesTo is not an array.`);
    check(String(record.api?.species || '').startsWith('https://pokeapi.co/api/v2/pokemon-species/'), `${label} lacks a PokéAPI species reference.`);

    record.types?.forEach((type) => typeCounts.set(type, (typeCounts.get(type) || 0) + 1));
    generationCounts.set(String(record.generation), (generationCounts.get(String(record.generation)) || 0) + 1);
    familyMembers.set(record.evolutionFamilyId, (familyMembers.get(record.evolutionFamilyId) || 0) + 1);

    const duplicate = data.species?.[index];
    check(JSON.stringify(record) === JSON.stringify(duplicate), `${label} differs between compatibility pokemon and species arrays.`);
  });

  check(ids.size === data.speciesCount, 'National Pokédex identifiers are not unique.');
  check(metadata.coverage?.nationalDexStart === 1, 'Metadata coverage must begin at National Pokédex number 1.');
  check(metadata.coverage?.nationalDexEnd === data.speciesCount, 'Metadata coverage end does not match speciesCount.');
  check(JSON.stringify(orderedObject(typeCounts)) === JSON.stringify(orderedObject(Object.entries(data.typeCounts || {}))), 'typeCounts do not match species records.');
  check(JSON.stringify(orderedObject(generationCounts)) === JSON.stringify(orderedObject(Object.entries(data.generationCounts || {}))), 'generationCounts do not match species records.');

  const treemapGroups = new Map((data.typeTreemap || []).map((group) => [group.name, group]));
  check(treemapGroups.size === typeCounts.size, 'typeTreemap group count does not match the number of types.');
  for (const [type, count] of typeCounts) {
    const group = treemapGroups.get(type);
    check(group?.value === count, `typeTreemap value for ${type} does not match typeCounts.`);
    check(group?.children?.length === count, `typeTreemap children for ${type} do not match typeCounts.`);
  }
  check(JSON.stringify(data.treemap?.children) === JSON.stringify(data.typeTreemap), 'treemap.children and typeTreemap differ.');

  return {
    failures,
    summary: {
      datasetId: metadata.datasetId,
      version: metadata.version,
      records: data.speciesCount,
      types: typeCounts.size,
      generations: generationCounts.size,
      families: familyMembers.size,
      generatedAt: data.generatedAt,
      lastReviewed: metadata.lastReviewed
    }
  };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await validatePokemonDataset();
  if (result.failures.length) {
    console.error(`Pokémon dataset validation failed (${result.failures.length}):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    const { summary } = result;
    console.log(`Pokémon dataset ${summary.version} passed: ${summary.records} records, ${summary.types} types, ${summary.generations} generations, ${summary.families} evolution families.`);
  }
}
