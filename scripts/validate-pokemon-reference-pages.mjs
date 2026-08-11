import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { defaultRepositoryRoot } from './project-registry.mjs';
import { loadReferencePages } from './reference-page-registry.mjs';

export const validatePokemonReferencePages = async ({ root = defaultRepositoryRoot } = {}) => {
  const failures = [];
  const pages = await loadReferencePages({ root });
  const page = pages.find((item) => item.id === 'most-common-pokemon-type');
  if (!page) return { failures: ['most-common-pokemon-type content is missing'] };

  const dataset = JSON.parse(await readFile(path.join(root, page.dataset.publicPath.replace(/^\//, '')), 'utf8'));
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

  const expectedRows = [...anyTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, anyCount]) => [
      type,
      String(anyCount),
      String(primaryCounts.get(type) || 0),
      `${(anyCount / pokemon.length * 100).toFixed(1)}%`
    ]);
  if (JSON.stringify(page.table.rows) !== JSON.stringify(expectedRows)) {
    failures.push('Type-abundance table does not match the canonical Pokémon dataset');
  }

  const facts = new Map(page.facts.map((fact) => [fact.label, fact.value]));
  const mostCommon = expectedRows[0];
  const rarestAny = expectedRows.at(-1);
  const rarestPrimary = [...primaryCounts.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
  const expectedFacts = new Map([
    ['Water in either slot', mostCommon[1]],
    ['Water as primary type', mostCommon[2]],
    ['Rarest in either slot', `${rarestAny[0]} · ${rarestAny[1]}`],
    ['Dual-type species', String(dualTypeCount)]
  ]);
  expectedFacts.forEach((expected, label) => {
    if (facts.get(label) !== expected) failures.push(`${label} fact does not match the canonical dataset`);
  });
  if (mostCommon[0] !== 'Water') failures.push('Water is no longer the most common either-slot type');
  if (rarestPrimary[0] !== 'Flying' || rarestPrimary[1] !== 9) {
    failures.push('Flying primary-type explanation is out of date');
  }
  if (pokemon.length !== 1025 || Number(dataset.speciesCount) !== pokemon.length) {
    failures.push('Reference-page snapshot scope does not match 1,025 canonical species records');
  }
  if (!page.answer.body.includes('154') || !page.answer.body.includes('134')) {
    failures.push('Direct answer does not contain the validated Water counts');
  }
  return { failures, recordCount: pokemon.length, typeCount: expectedRows.length };
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
    console.log(`Pokémon reference-page claims passed for ${result.recordCount} records and ${result.typeCount} types.`);
  }
}
