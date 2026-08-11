import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const pokemonRepositoryRoot = path.resolve(scriptDirectory, '..');
export const pokemonDataPaths = (root = pokemonRepositoryRoot) => ({
  canonical: path.join(root, 'datasets/pokemon/v1/pokemon-treemap-data.json'),
  metadata: path.join(root, 'datasets/pokemon/v1/metadata.json'),
  schema: path.join(root, 'datasets/pokemon/v1/schema.json'),
  published: path.join(root, 'assets/data/pokemon-treemap-data.json')
});

export const publishPokemonData = async ({ root = pokemonRepositoryRoot } = {}) => {
  const paths = pokemonDataPaths(root);
  await mkdir(path.dirname(paths.published), { recursive: true });
  await copyFile(paths.canonical, paths.published);

  const [canonical, published] = await Promise.all([
    readFile(paths.canonical),
    readFile(paths.published)
  ]);
  if (!canonical.equals(published)) {
    throw new Error('Published Pokémon data differs from the canonical snapshot after copy.');
  }

  return { bytes: canonical.length, paths };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await publishPokemonData();
  console.log(`Published canonical Pokémon data (${result.bytes.toLocaleString('en-US')} bytes).`);
}
