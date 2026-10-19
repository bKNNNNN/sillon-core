# sillon-core

Le moteur agronomique de Sillon, en TypeScript. Il ne contient que des calculs : pas de base de données, pas d'interface, pas de coordonnées en dur. Tu lui donnes des cultures, des plantations et de la météo, il te rend des dates et des conseils.

## Ce que fait le moteur

- `dailyGdd(tmin, tmax, tBase)` calcule les degrés-jours de croissance d'une journée, bornés à zéro.
- `forecastHarvest` prévoit la récolte. Il cumule les degrés-jours depuis le semis ou la plantation. Il lit d'abord la météo observée, puis la prévision à 16 jours (date attendue à plus ou moins 2 jours). Au-delà, il prend les années d'archive et donne les percentiles 10, 50 et 90 de la climatologie. Si la culture n'a pas de degrés-jours, il compte simplement les jours jusqu'à maturité.
- `forecastFirstHarvest` donne la date de première récolte à partir de `firstHarvestDays`, compté depuis le semis ou depuis la plantation selon la culture. Il renvoie `null` quand la plantation n'a pas la bonne date de départ, par exemple un plant acheté pour un délai compté depuis le semis.
- `whatsNext` liste ce qu'il faut semer sous abri, semer en direct, planter ou ressemer cette semaine. Il suit les fenêtres de semaines de chaque culture, y compris celles qui passent le 31 décembre, et l'intervalle entre deux semis successifs. Une culture peut avoir plusieurs fenêtres pour une même action, par exemple un semis de printemps et un semis d'automne.
- `rotationWarning` prévient quand une planche a porté une culture de la même famille dans les trois dernières années.
- `germinationOutlook` estime si un lot de graines germe encore bien d'après son âge et la durée de vie des graines de l'espèce.
- `validatePlanting`, `isValidCivilDate` et `isTooFarInFuture` refusent les dates impossibles, les dates dans le futur et les repiquages avant semis. Les messages d'erreur sont en français.
- `fetchForecast` et `fetchArchive` interrogent l'API Open-Meteo pour le lieu que tu passes. En cas de panne, ils renvoient `{ ok: false, error: 'Météo indisponible.' }` au lieu de lever une exception.

## Installation

```sh
pnpm add github:bKNNNNN/sillon-core#v0.2.0
```

Depuis pnpm 10, les dépendances git ne lancent leur script de build que si tu l'autorises. Ajoute dans le `pnpm-workspace.yaml` de ton projet :

```yaml
allowBuilds:
  sillon-core: true
```

Node 20 ou plus récent. Le paquet est en ESM et livre ses types.

## Exemple

```ts
declare const yamlText: string // contenu de cultures.yaml
import { fetchForecast, forecastHarvest, parseCrops, whatsNext } from 'sillon-core';

const crops = parseCrops(yamlText); // le contenu d'un fichier de cultures
const tomate = crops.find((c) => c.id === 'tomate')!;

const lieu = { lat: 45.76, lon: 4.84, timezone: 'Europe/Paris' };
const meteo = await fetchForecast(fetch, lieu);
if (!meteo.ok) throw new Error(meteo.error);

const today = '2026-06-10';
const plantation = {
  species: 'tomate',
  method: 'pot' as const,
  status: 'active' as const,
  sownOn: '2026-03-15',
  transplantedOn: '2026-05-10',
};

const recolte = forecastHarvest({
  planting: plantation,
  crop: tomate,
  observed: meteo.value.filter((d) => d.date <= today),
  forecast: meteo.value.filter((d) => d.date > today),
  climatology: {}, // années d'archive, par exemple { 2024: [...], 2025: [...] }
  today,
  weatherStale: false,
});

const aFaire = whatsNext(crops, [plantation], today);
```

Pour lire un fichier YAML depuis le disque, sous Node :

```ts
import { loadCrops } from 'sillon-core/node';

const crops = loadCrops('./cultures.yaml');
```

## Plantations

Les fonctions prennent un type minimal, `PlantingLike` : `species`, `sownOn`, `method`, `status`, `transplantedOn` et `harvestedOn`. Une ligne de ta base de données convient telle quelle si elle a ces champs. Les autres champs sont ignorés.

## Données de cultures

Le moteur ne fournit aucune culture. Il s'utilise avec la base [sillon-cultures](https://github.com/bKNNNNN/sillon-cultures) : fenêtres de semis, degrés-jours, températures de base et durée de vie des graines, avec leurs sources. Cette base est publiée sous licence CC BY-SA 4.0, distincte de celle de ce code. Tu peux aussi écrire ton propre fichier, à condition qu'il respecte le schéma `cropSchema`.

## Développement

```sh
pnpm install
pnpm build
pnpm test
```

## Licence

MIT, voir [LICENSE](./LICENSE).
