# Otaku Data Viz

Otaku Data Viz is a fan-made interactive data visualization archive for anime, manga, games, and pop-culture systems. The site is designed as a manga-inspired landing page that links out to individual interactive projects, each with its own visual language, data model, and UI personality.

Live site target:

- Primary domain: `https://otakudataviz.com`
- GitHub Pages fallback: `https://spac3boy.github.io/otaku-data-viz/`
- Repository: `https://github.com/spac3boy/otaku-data-viz`
- Product strategy and reference-authority scorecard: [`STRATEGY.md`](STRATEGY.md)
- Measurement framework and baseline: [`MEASUREMENT.md`](MEASUREMENT.md)
- Canonical Pokémon dataset pilot: [`datasets/pokemon/README.md`](datasets/pokemon/README.md)

> This is an unofficial fan project. It is not affiliated with any anime, manga, game, publisher, studio, platform, or rights holder. Franchise names and referenced properties belong to their respective owners.

## Project purpose

The goal of Otaku Data Viz is to turn fan-interest topics into useful, highly visual, interactive data stories. The focus is on subjects that have strong search potential, fandom depth, and enough structured information to support maps, timelines, networks, comparison tools, and visual essays.

Current positioning:

- Anime, manga, and gaming data visualization
- Interactive lore maps and relationship networks
- Manga and anime history timelines
- Franchise catalogs, evolution charts, and comparison tools
- SEO-friendly standalone pages that can grow into a searchable archive
- Original UI and data storytelling, avoiding direct reuse of copyrighted panels or character art wherever possible

## Project URL policy

Each visualization has two intentionally different public surfaces:

| Project | Canonical landing page | Interactive app page |
| --- | --- | --- |
| Dragon Ball Sociogram | `/projects/dragon-ball-sociogram.html` | `/dragonball-character-sociogram/` |
| Manga and Anime Timeline | `/projects/manga-anime-timeline.html` | `/manga-timeline.html` |
| Pokedex Type Treemap | `/projects/pokedex-type-treemap.html` | `/pokemon_territory_map.html` |
| Nintendo Game Universe Map | `/projects/nintendo-game-universe-map.html` | `/nintendo-game-universe-map.html` |
| Gundam Universe Map | `/projects/gundam-universe-map.html` | `/gundam-universe-map.html` |

The `/projects/` URL is the canonical SEO and sharing URL and is the only project URL included in the sitemap. The interactive URL remains available for direct use and iframe previews, but its canonical and Open Graph URL point to the matching landing page. Interactive-page JSON-LD describes the app at its real app URL and connects it to the landing page with `mainEntityOfPage`.

Project identity and discovery metadata live in `config/project-registry.json`. This versioned registry is the source of truth for canonical and interactive paths, SEO and social metadata, structured application data, dataset associations, review dates, related-project relationships, and project sitemap entries. Run `npm run metadata:generate` after an intentional registry change; `npm run metadata:check`, `npm run check:build`, and `npm run verify` detect drift between the registry, sitemap, HTML metadata, JSON-LD, dataset manifests, related links, and the published `/docs` build.

Landing-page JSON-LD is generated between `project-structured-data` markers. The reusable graph includes the site and publisher, canonical page, interactive application, primary image, three-level breadcrumb trail, and the page's existing FAQ content. Edit FAQ questions and answers in the landing page, edit shared metadata in the registry, then run the metadata generator rather than hand-maintaining the rest of the graph.

Do not redirect an interactive app URL to its landing page. Add a redirect only when an old URL is confirmed to be obsolete and is not used by a preview iframe, an interactive button, or a direct app experience. Analytics and dashboard reporting normalize landing, interactive, and external-embed traffic to the canonical landing path. Pages loaded with `preview=1` do not send pageviews or custom events, and the dashboard excludes historical preview URLs so embedded cards do not inflate portfolio traffic.

## Canonical build workflow

The repository root is the canonical source for the website. The `docs/` directory is generated output for GitHub Pages and should not be edited directly.

```bash
npm run build
npm run check:build
npm run verify
```

`npm run build` copies only the controlled pages, assets, data, and deployment configuration declared in `scripts/build-site.mjs`. It refuses to proceed if `docs/` contains an unmanaged file, preventing accidental publication or silent deletion. `npm run check:build` is read-only and fails whenever the published tree drifts from the canonical source.

When the analytics updater refreshes `data/weekly-performance.json`, run the build afterward to publish the new snapshot. Future site changes should be made in the root source and propagated to `docs/` only through this build.

## Current site structure

```text
otaku-data-viz/
  index.html
  manga-timeline.html
  dragonball-character-sociogram/
    index.html
  README.md
