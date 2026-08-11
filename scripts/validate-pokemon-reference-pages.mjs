import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { defaultRepositoryRoot } from './project-registry.mjs';
import { loadReferencePages } from './reference-page-registry.mjs';

export const validatePokemonReferencePages = async ({ root = defaultRepositoryRoot } = {}) => {
  const failures = [];
  const pages = await loadReferencePages({ root });
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const mostCommonPage = pageById.get('most-common-pokemon-type');
  const rarestPage = pageById.get('rarest-pokemon-type');
  if (!mostCommonPage) failures.push('most-common-pokemon-type content is missing');
  if (!rarestPage) failures.push('rarest-pokemon-type content is missing');
  if (failures.length) return { failures, pageCount: pages.length };

  const dataset = JSON.parse(await readFile(
    path.join(root, mostCommonPage.dataset.publicPath.replace(/^\//, '')),
    'utf8'
  ));
  const pokemon = dataset.pokemon || dataset.species || [];
  const primaryCounts = new Map();
  const anyTypeCounts = new Map();
  let dualTypeCount = 0;

  pokemon.forEach((entry) => {
    primaryCounts.set(entry.primaryType, (primaryCounts.get(entry.primaryType) || 0) + 1);
    const types = new Set(entry.types || []);
    types.forEach((type) => anyTypeCounts.set(type, (anyTypeCounts.get(type) || 0) + 1));
    if (types.size > 1) dualTypeCount += 1;
  });

  const rowsByEitherSlot = [...anyTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, anyCount]) => [
      type,
      String(anyCount),
      String(primaryCounts.get(type) || 0),
      `${(anyCount / pokemon.length * 100).toFixed(1)}%`
    ]);
  const rowsByRarity = [...rowsByEitherSlot]
    .sort((a, b) => Number(a[1]) - Number(b[1]) || a[0].localeCompare(b[0]));
  if (JSON.stringify(mostCommonPage.table.rows) !== JSON.stringify(rowsByEitherSlot)) {
    failures.push('Most-common type table does not match the canonical Pokémon dataset');
  }
  if (JSON.stringify(rarestPage.table.rows) !== JSON.stringify(rowsByRarity)) {
    failures.push('Rarest-type table does not match the canonical Pokémon dataset');
  }

  const mostCommonFacts = new Map(mostCommonPage.facts.map((fact) => [fact.label, fact.value]));
  const rarestFacts = new Map(rarestPage.facts.map((fact) => [fact.label, fact.value]));
  const mostCommon = rowsByEitherSlot[0];
  const rarestAny = rowsByRarity[0];
  const nextRarestAny = rowsByRarity[1];
  const rarestPrimary = [...primaryCounts.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
  const expectedMostCommonFacts = new Map([
    ['Water in either slot', mostCommon[1]],
    ['Water as primary type', mostCommon[2]],
    ['Rarest in either slot', `${rarestAny[0]} · ${rarestAny[1]}`],
    ['Dual-type species', String(dualTypeCount)]
  ]);
  expectedMostCommonFacts.forEach((expected, label) => {
    if (mostCommonFacts.get(label) !== expected) {
      failures.push(`Most-common page: ${label} fact does not match the canonical dataset`);
    }
  });
  const expectedRarestFacts = new Map([
    ['Ice in either slot', rarestAny[1]],
    ['Flying as primary type', String(rarestPrimary[1])],
    ['Next-rarest any-slot type', `${nextRarestAny[0]} · ${nextRarestAny[1]}`],
    ['Ice as primary type', String(primaryCounts.get('Ice'))]
  ]);
  expectedRarestFacts.forEach((expected, label) => {
    if (rarestFacts.get(label) !== expected) {
      failures.push(`Rarest page: ${label} fact does not match the canonical dataset`);
    }
  });
  if (mostCommon[0] !== 'Water') failures.push('Water is no longer the most common either-slot type');
  if (rarestAny[0] !== 'Ice' || Number(rarestAny[1]) !== 48) {
    failures.push('Ice either-slot rarity explanation is out of date');
  }
  if (rarestPrimary[0] !== 'Flying' || rarestPrimary[1] !== 9) {
    failures.push('Flying primary-type explanation is out of date');
  }
  if (pokemon.length !== 1025 || Number(dataset.speciesCount) !== pokemon.length) {
    failures.push('Reference-page snapshot scope does not match 1,025 canonical species records');
  }
  if (!mostCommonPage.answer.body.includes('154') || !mostCommonPage.answer.body.includes('134')) {
    failures.push('Most-common direct answer does not contain the validated Water counts');
  }
  if (!rarestPage.answer.body.includes('48') || !rarestPage.answer.body.includes('nine')) {
    failures.push('Rarest direct answer does not contain the validated Ice and Flying counts');
  }
  return { failures, pageCount: pages.length, recordCount: pokemon.length, typeCount: rowsByEitherSlot.length };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const result = await validatePokemonReferencePages();
  if (result.failures.length) {
    console.error(`Pokémon reference-page validation failed (${result.failures.length}):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`Pokémon reference-page claims passed for ${result.pageCount} pages, ${result.recordCount} records, and ${result.typeCount} types.`);
  }
}
