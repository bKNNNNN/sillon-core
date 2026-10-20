# sillon-core

Le moteur agronomique de Sillon, en TypeScript. Il ne contient que des calculs : pas de base de données, pas d'interface, pas de coordonnées en dur. Tu lui donnes des cultures, des plantations et de la météo, il te rend des dates et des conseils.

## Ce que fait le moteur

- `dailyGdd(tmin, tmax, tBase)` calcule les degrés-jours de croissance d'une journée, bornés à zéro.
- `forecastHarvest` prévoit la récolte. Il cumule les degrés-jours depuis le semis ou la plantation. Il lit d'abord la météo observée, puis la prévision à 16 jours (date attendue à plus ou moins 2 jours). Au-delà, il prend les années d'archive et donne les percentiles 10, 50 et 90 de la climatologie. Si la culture n'a pas de degrés-jours, il compte simplement les jours jusqu'à maturité.
- `forecastFirstHarvest` donne la date de première récolte à partir de `firstHarvestDays`, compté depuis le semis ou depuis la plantation selon la culture. Une culture peut donner les deux délais : un plant acheté ou repiqué prend le délai depuis la plantation, un semis en place prend le délai depuis le semis. Il renvoie `null` quand la plantation n'a pas la bonne date de départ, par exemple un plant acheté pour un délai compté seulement depuis le semis.
- `whatsNext` liste ce qu'il faut semer sous abri, semer en direct, planter ou ressemer cette semaine. Il suit les fenêtres de semaines de chaque culture, y compris celles qui passent le 31 décembre, et l'intervalle entre deux semis successifs. Une culture peut avoir plusieurs fenêtres pour une même action, par exemple un semis de printemps et un semis d'automne. Une fenêtre peut porter une courte `note` (« sous voile », « ail de printemps »), reprise dans le conseil. Une fenêtre déjà faite reste affichée : `doneOn` liste les dates de semis ou de plantation de son occurrence en cours, et le conseil se termine par « Déjà semé le 18 oct. ». Un semis compte pour la fenêtre de sa méthode (godet pour sous abri, direct pour en place) ; un plant acheté compte pour la plantation, ou pour le semis direct quand la culture n'a pas de fenêtre de plantation (caïeux d'ail, plants de pomme de terre), avec « Déjà planté le 18 oct. ».
- `rotationWarning` prévient quand une planche a porté une culture de la même famille lors d'une saison précédente (une saison est une année civile) : quatre ans pour les solanacées et les brassicacées, trois ans pour les autres familles. Dans une même saison, l'alerte ne part que pour une succession sur le même sol : une autre culture de la même famille, semée plus tôt et déjà terminée avant le nouveau semis (récoltée à cette date ou avant, ou close en `done` ou `failed`), comme une pomme de terre après des tomates récoltées ou un chou d'hiver après un chou d'été récolté. Deux cultures de la même famille qui poussent en même temps (ail et poireau, deux semis d'épinard) ne déclenchent rien, pas plus que deux plantations de la même culture. Une culture courte (première récolte en 45 jours au plus, comme le radis ou l'épinard) ne déclenche pas d'alerte et n'en provoque pas pour la culture suivante. `rotationAdvice` donne le détail (famille, dernière saison, durée retenue) et signale les brassicacées, à qui s'ajoute le conseil sur le pH du sol. Les durées sont dans `ROTATION_RULES`, avec leur source ou la mention d'estimation.
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

## Météo horaire et alertes de gel

- `fetchHourly` lit la météo heure par heure : température, humidité, point de rosée, nébulosité totale et basse, vent moyen et rafales, température du sol à 6 et 18 cm, pluie. Par défaut, 7 jours passés et 7 jours de prévision. Chaque variable vient du premier modèle qui la fournit, dans cet ordre : AROME 1,5 km, AROME 2,5 km (le 1,5 km n'a pas la nébulosité totale), ARPEGE Europe, puis le modèle par défaut d'Open-Meteo (le seul qui donne la température du sol, et le seul au-delà de 4 jours). Chaque heure garde `model`, le modèle de sa température, et `modelOf`, le modèle de chaque variable.
- `assessNights` évalue chaque nuit à partir de ce soir, de 18 h à 9 h. Le niveau suit la revue agronomique : `gel` à 0 °C ou moins, `fort` à 2 °C ou moins, ou à 4 °C ou moins par ciel clair (nébulosité moyenne sous 30 % entre 0 h et 6 h) et vent calme (sous 10 km/h). `faible` jusqu'à 6 °C dans les mêmes conditions, pour les cultures tendres seulement. Les seuils sont dans `FROST_PARAMS` : seul le 0 °C a une source, les marges sont des estimations et le résultat porte `estimate: true`. `frostNights` ne garde que les nuits qui ont un niveau.
- `frostAlerts` croise ces nuits avec les plantations en pleine terre (un semis en godet compte à partir de son repiquage). Une culture `tender` est concernée à tous les niveaux, une culture `semi` à `gel` et `fort`, une culture `hardy` jamais. Le texte nomme les cultures et dit quoi faire : voile, buttage des pommes de terre, arrosage du sol l'après-midi.
- `chillAlerts` prévient d'une nuit froide sans gel pour une culture qui a un `chillC` (le basilic, 5 °C), plantée depuis moins de 30 jours, quand l'alerte de gel ne la couvre pas déjà. Elle prend les heures et les options de `assessNights`, pas une liste de nuits : une nuit froide sans gel n'a pas de niveau, et `frostNights` l'écarte.
- `lastFrostStats` date la dernière gelée de printemps et la première d'automne de chaque année complète d'un historique quotidien, puis donne la médiane et la date après laquelle 9 printemps sur 10 n'ont plus de gelée (et 1 automne sur 10 en a déjà une). Une année sans gelée compte. `calibrateFrostThreshold` relève le seuil par pas de 0,5 °C jusqu'à ce que les jours de gel de mars et de novembre de la maille tombent à 20 % près des normales de Bordeaux-Mérignac (`MERIGNAC_FROST_DAYS`), et garde le seuil le plus proche sinon.

Chaque résultat garde ce qu'il a lu (`inputs`, avec les paramètres) et une phrase en français (`reason`), par exemple : « Gel possible la nuit du jeudi 22 au vendredi 23 octobre (mini prévue 1 °C, ciel clair, vent faible). Couvre d'un voile le jeudi soir : tomate, courgette. » Le conseil nomme le soir où agir : « ce soir », « demain soir », puis « le jeudi soir » au-delà.

Le schéma de culture accepte aussi, tous facultatifs et chacun avec une source ou `estimate: true` : `frostClass` (`tender`, `semi`, `hardy` ; sans lui, `frostSensitive` vaut `tender` ou `hardy`), `chillC`, `rootDepthM` et `depletionP` (FAO-56 tableau 22), `germSoilC` (`min`, `optLow`, `optHigh`, `max`, l'optimum étant facultatif), et `kcStages`, soit en jours par stade (`method: fao56-table11`), soit en fraction des degrés-jours (`method: gdd-fraction`, qui exige `gdd`).

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
