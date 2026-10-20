# sillon-core

Le moteur agronomique de Sillon, en TypeScript. Il ne contient que des calculs : pas de base de données, pas d'interface, pas de coordonnées en dur. Tu lui donnes des cultures, des plantations et de la météo, il te rend des dates et des conseils.

## Ce que fait le moteur

- `dailyGdd(tmin, tmax, tBase)` calcule les degrés-jours de croissance d'une journée, bornés à zéro.
- `forecastHarvest` prévoit la récolte. Il cumule les degrés-jours depuis le semis ou la plantation. Il lit d'abord la météo observée, puis la prévision à 16 jours (date attendue à plus ou moins 2 jours). Au-delà, il prend les années d'archive et donne les percentiles 10, 50 et 90 de la climatologie. Si la culture n'a pas de degrés-jours, il compte simplement les jours jusqu'à maturité.
- `forecastFirstHarvest` donne la date de première récolte à partir de `firstHarvestDays`, compté depuis le semis ou depuis la plantation selon la culture. Une culture peut donner les deux délais : un plant acheté ou repiqué prend le délai depuis la plantation, un semis en place prend le délai depuis le semis. Il renvoie `null` quand la plantation n'a pas la bonne date de départ, par exemple un plant acheté pour un délai compté seulement depuis le semis.
- `whatsNext` liste ce qu'il faut semer sous abri, semer en direct, planter ou ressemer cette semaine. Il suit les fenêtres de semaines de chaque culture, y compris celles qui passent le 31 décembre, et l'intervalle entre deux semis successifs. Une culture peut avoir plusieurs fenêtres pour une même action, par exemple un semis de printemps et un semis d'automne. Une fenêtre peut porter une courte `note` (« sous voile », « ail de printemps »), reprise dans le conseil. Une fenêtre déjà faite reste affichée : `doneOn` liste les dates de semis ou de plantation de son occurrence en cours, et le conseil se termine par « Déjà semé le 18 oct. ». Un semis compte pour la fenêtre de sa méthode (godet pour sous abri, direct pour en place) ; un plant acheté compte pour la plantation, ou pour le semis direct quand la culture n'a pas de fenêtre de plantation (caïeux d'ail, plants de pomme de terre), avec « Déjà planté le 18 oct. ».
- `rotationWarning` prévient quand une planche a porté une culture de la même famille lors d'une saison précédente (une saison est une année civile) : quatre ans pour les solanacées et les brassicacées, trois ans pour les autres familles. Dans une même saison, ressemer la même culture ne déclenche rien ; une autre culture de la même famille semée plus tôt dans l'année déclenche l'alerte (chou d'hiver après chou d'été). Une culture courte (première récolte en 45 jours au plus, comme le radis ou l'épinard) ne déclenche pas d'alerte et n'en provoque pas pour la culture suivante. `rotationAdvice` donne le détail (famille, dernière saison, durée retenue) et signale les brassicacées, à qui s'ajoute le conseil sur le pH du sol. Les durées sont dans `ROTATION_RULES`, avec leur source ou la mention d'estimation.
- `seedLotOutlook` estime si un lot de graines germe encore bien d'après son âge et la durée de vie des graines de l'espèce. Il distingue un lot sans année (`no-year`) d'une espèce sans durée de vie connue (`no-lifespan`), donne l'année `goodUntil` (« Bonne jusqu'en 2030 ») et signale `lastSafeSeason` l'année où le lot atteint sa durée de vie (« Dernière saison sûre »). Une année de récolte postérieure à l'année en cours est traitée comme inconnue. `germinationOutlook` reste disponible sous sa forme courte.
- `validatePlanting`, `isValidCivilDate` et `isTooFarInFuture` refusent les dates impossibles, les dates dans le futur et les repiquages avant semis. Les messages d'erreur sont en français.
- `fetchForecast` et `fetchArchive` interrogent l'API Open-Meteo pour le lieu que tu passes. En cas de panne, ils renvoient `{ ok: false, error: 'Météo indisponible.' }` au lieu de lever une exception.

## Installation

```sh
pnpm add github:bKNNNNN/sillon-core#v0.3.1
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

## Anciens identifiants

Une culture peut déclarer `aliases`, la liste de ses anciens identifiants. `getCrop`, `whatsNext` et `rotationWarning` les reconnaissent : une plantation enregistrée sous `chou` reste rattachée à `chou-ete` après la séparation du chou en deux cultures. `parseCrops` refuse un alias qui est aussi l'identifiant d'une culture, ou qui sert à deux cultures.

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
