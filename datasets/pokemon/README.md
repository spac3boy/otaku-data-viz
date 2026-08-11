# Pokémon species treemap dataset

This directory is the canonical source for the Pokémon species snapshot used by the Pokédex Type Treemap. The public file in `assets/data/` is generated from this package and must not be edited directly.

## Version 1

- Canonical data: `v1/pokemon-treemap-data.json`
- Metadata and provenance: `v1/metadata.json`
- Machine-readable schema: `v1/schema.json`
- Version history: `CHANGELOG.md`
- Published site copy: `assets/data/pokemon-treemap-data.json`

The v1 file deliberately preserves the visualization's existing schema, including the duplicate `pokemon` and `species` arrays, so the data layer can be adopted without breaking the live application. A future schema version can remove that compatibility duplication through an explicit migration.

## Routine workflow

Validate the canonical snapshot and its published copy:

```bash
npm run data:pokemon:validate
```

Republish the canonical snapshot without calling an external API:

```bash
npm run data:pokemon:publish
npm run build
```

Regenerate from PokéAPI only when the dataset is intentionally reviewed and versioned:

```bash
POKEMON_DATASET_VERSION=1.1.0 \
POKEMON_DATASET_REVIEWED=2026-08-10 \
npm run data:pokemon:generate
npm run data:pokemon:validate
npm run build
```

Before committing a regenerated snapshot, review record-count changes, validation output, modeled-field disclosures, and visible facts on the canonical landing page. Do not treat modeled card-display fields as official competitive move data.

## Citation

Suggested citation:

> Otaku Data Viz, “Pokémon Species Treemap Dataset,” version 1.0.0, generated May 25, 2026, from PokéAPI data and reviewed August 10, 2026.

This is an unofficial fan-made dataset package. Pokémon names and related properties belong to their respective rights holders. Review upstream terms and applicable intellectual-property rights before reuse or redistribution.
