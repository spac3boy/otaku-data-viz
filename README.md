# Otaku Data Viz

Otaku Data Viz is a fan-made interactive data visualization archive for anime, manga, games, and pop-culture systems. The site is designed as a manga-inspired landing page that links out to individual interactive projects, each with its own visual language, data model, and UI personality.

Live site target:

- Primary domain: `https://otakudataviz.com`
- GitHub Pages fallback: `https://spac3boy.github.io/otaku-data-viz/`
- Repository: `https://github.com/spac3boy/otaku-data-viz`

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

Do not redirect an interactive app URL to its landing page. Add a redirect only when an old URL is confirmed to be obsolete and is not used by a preview iframe, an interactive button, or a direct app experience. Analytics and dashboard reporting normalize both surfaces to the canonical landing path while retaining the `landing`, `interactive`, and `preview` surface labels.

## Current site structure

```text
otaku-data-viz/
  index.html
  manga-timeline.html
  dragonball-character-sociogram/
    index.html
  README.md
