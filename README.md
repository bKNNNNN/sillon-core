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
- `homographyFromQuad`, `invertHomography`, `polygonArea` et `polygonPerimeter` redressent une photo du jardin et mesurent les planches (voir « Géométrie du plan »).
- `generateLayout` trace des planches, des carrés ou des buttes sur un terrain nu, avec les allées, la surface cultivée et le nombre de plants par culture (voir « Plan d'un terrain nu »).
- `solveCropPlan` propose jusqu'à trois répartitions des cultures sur les planches, en tenant compte de la rotation, du compagnonnage et des familles, avec le détail du score (voir « Premier plan de cultures »).
- `fetchForecast` et `fetchArchive` interrogent l'API Open-Meteo pour le lieu que tu passes. En cas de panne, ils renvoient `{ ok: false, error: 'Météo indisponible.' }` au lieu de lever une exception.

## Installation

```sh
pnpm add github:bKNNNNN/sillon-core#v0.6.0
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

## Mildiou et arrosage

- `mildewDays` découpe les heures en journées (de minuit à minuit, réglable par `dayStartHour`) et compte pour chacune la température minimale et les heures à 90 % d'humidité ou plus. Une journée doit être complète pour compter.
- `mildewPeriods` cherche les périodes de mildiou de la veille jusqu'à 4 jours devant, en lisant aussi les 2 jours observés. Une période demande deux jours de suite à 10 °C de minimum au moins. Avec 6 heures humides par jour, c'est un critère de Hutton, niveau `moyen`. Avec 11 heures les deux jours, c'est une période de Smith, niveau `eleve`. `mildewRuns` regroupe les périodes en épisodes. Après 3 jours secs, une nouvelle période ouvre un nouvel épisode.
- `mildewAlerts` donne une alerte par épisode, d'avril à octobre, quand une tomate ou une pomme de terre est en pleine terre. Le conseil reste préventif : arroser au pied le matin, retirer les feuilles du bas, surveiller les taches brunes. Au niveau `eleve`, il ajoute de sortir les feuilles tachées du jardin. Passe `lastAlertedOn`, le dernier jour de l'alerte déjà envoyée, pour savoir si l'épisode est le même (`inputs.repeat`) : c'est le cas quand ce jour tombe dans l'épisode, ou à moins de trois jours secs avant ou après. Toutes ces alertes portent `estimate: true`, car la limite de journée et le regroupement sont des estimations.
- `waterBalance` tient le bilan d'eau du sol d'une plantation, jour par jour, selon la méthode FAO-56 à coefficient cultural unique. La pluie sous 0,2 ET0 ne compte pas. Les arrosages notés se retranchent. L'ETc vaut ET0 × Kc, et le Kc suit les stades de `kcStages`, ou par défaut des parts estimées des degrés-jours. Les racines poussent de 0,15 m à `rootDepthM`. La réserve utile vaut 1000 × (capacité au champ - point de flétrissement) × profondeur, et la réserve facile vaut p × réserve utile, avec p ajusté selon l'ETc du jour. L'eau en trop part en drainage. Le bilan attend un état connu : celui que tu donnes (`start`), sinon la fin d'une journée de pluie de 20 mm entre novembre et mai, ou d'une pluie qui remplit toute la réserve. `start` ne compte que si la météo le rejoint, du jour qui précède la première journée météo jusqu'à la dernière ; plus tôt ou plus tard, les jours entre les deux sont inconnus et le bilan attend une pluie qui remplit le sol. Une culture en `gdd-fraction` sans `gdd` rend « pas de donnée » (`gdd` manquant) plutôt qu'un stade figé. Les trois sols du formulaire sont dans `SOIL_WATER` : sable pur 0,06, sable 0,08, sable amendé 0,10.
- `waterAdvice` donne le conseil du matin pour une planche. La culture la plus en manque mène. Quand le manque atteint la réserve facile, la dose remplit le sol, en mm et en litres pour la planche. Si la pluie prévue d'ici demain couvre la moitié du manque, le conseil dit d'attendre. À partir de 0,7 fois la réserve facile, il annonce un arrosage d'ici 1 à 2 jours. Sur une planche de tomates ou de pommes de terre, un risque de mildiou ajoute « au pied, le matin ». `waterAlerts` ne garde que les planches à arroser. Exemple : « Planche 2 (tomate) : consommé 23 mm sur 21 mm de réserve facile depuis la pluie du 12 juillet (ET0 5 mm/j × Kc 1,15). Arrose 23 L/m², soit 92 L pour la planche. »

Les seuils sont dans `MILDEW_PARAMS` et `WATER_PARAMS`, chacun avec sa source ou `estimate: true`. Une culture sans `kc`, `rootDepthM` ou `depletionP` n'a pas de bilan : le conseil dit « pas de donnée d'arrosage » au lieu de deviner.

## Sol, chaleur, limaces et vent

Ces quatre règles lisent les mêmes heures que le gel (`fetchHourly`, 7 jours passés et 7 jours de prévision). Chaque seuil est un paramètre nommé (`SOIL_TEMP_PARAMS`, `HEAT_PARAMS`, `SLUG_PARAMS`, `WIND_PARAMS`) avec son unité, sa source ou `estimate: true`, et chaque alerte recopie ses paramètres dans `inputs.params`. Toutes portent `estimate: true`.

- `soilSowingAlerts` répond « maintenant ou pas encore » pour chaque culture dont la fenêtre de semis direct est ouverte cette semaine et qui a un `germSoilC`. Elle prend la moyenne de la température du sol à 6 cm sur les 3 prochains jours (aujourd'hui compris) : `trop-froid` sous `min`, `possible` entre `min` et l'optimum ou au-dessus, `ideal` dans l'optimum, `trop-chaud` si une heure dépasse `max`. Sans optimum (le chou), jamais `ideal`. La pomme de terre lit le sol à 18 cm : 8 °C par défaut (estimation), 10 °C pour `ideal`, et le texte cite aussi le seuil de 6 °C trois jours de suite. La température du sol est modélisée pour un sol générique : c'est une estimation.
- `heatAlerts` prévient d'une canicule (35 °C ou plus, dès qu'une culture est en terre), de la chute des fleurs de tomate après 3 nuits de suite à 24 °C ou plus (tomates en terre depuis au moins 30 jours) et de la montée en graines des salades et épinards après 3 jours de suite à 27 °C ou plus. Une alerte par série, datée du jour où la série atteint sa longueur ; une série commencée avant aujourd'hui et qui dure encore compte. `assessHeatDays` donne le détail jour par jour, jours de chaleur (30 °C) compris.
- `slugAlerts` prévient d'une sortie de limaces une nuit humide (2 mm de pluie dans les 48 h avant 18 h, ou 6 heures à 90 % d'humidité ou plus dans la nuit) et douce (moyenne de 5 à 20 °C) quand de jeunes plants (moins de 21 jours en terre) d'une culture de `SLUG_CROPS` sont en terre. Une alerte tous les 3 jours au plus ; `lastAlertOn` reporte la dernière alerte envoyée.
- `windAlerts` prévient des rafales de 58 km/h ou plus, d'avril à octobre, quand une culture tuteurée (`WIND_CROPS` : tomate, haricot) est en terre ou qu'un voile est posé (`fleece: true`). Pas d'alerte « le vent assèche le sol » : l'ET0 compte déjà le vent.

Exemples de textes : « Haricot : sol à 9 °C en surface, trop froid pour semer (15,6 °C minimum). Attends quelques jours. », « Sortie de limaces probable la nuit du mardi 20 au mercredi 21 octobre (sol humide, nuit douce). Fais un tour à la tombée de la nuit autour des jeunes plants : salade, haricot. »

## Géométrie du plan

Ces fonctions redressent une photo du jardin. Elles ne connaissent ni la photo ni l'unité : un point est `{ x, y }`, en pixels sur la photo ou en centimètres au sol. Chaque fonction renvoie un `Result` avec un message en français plutôt que de lever une exception.

- `homographyFromQuad(from, to)` calcule l'homographie qui envoie les quatre coins `from` sur les quatre coins `to` (transformation linéaire directe, système 8 × 8). En général, `from` est la liste des coins touchés sur la photo et `to` les mêmes coins au sol. Les deux quadrilatères doivent être convexes et pris dans le même ordre du tour ; le sens peut changer, puisque la photo a l'axe y vers le bas. Trois coins alignés, un coin répété ou un ordre qui croise les côtés renvoient « Les quatre coins doivent former un quadrilatère convexe, pris dans l’ordre du tour. » Les coordonnées sont recentrées et remises à l'échelle avant le calcul (normalisation de Hartley), si bien que des pixels et des centimètres donnent la même précision.
- `invertHomography(h)` donne la transformation inverse, du sol vers la photo, pour poser un plan sur la photo.
- `projectPoint(h, point)` et `projectPolygon(h, points)` appliquent l'homographie. Un point sur la ligne d'horizon de la photo, ou au-delà (le ciel), n'a pas d'image au sol : « Point à l’horizon, hors du sol. » Un contour qui franchit l'horizon est refusé de la même façon. L'inverse garde le même sens : un point du sol situé derrière l'appareil n'a pas d'image sur la photo.
- `polygonArea`, `signedPolygonArea` et `polygonPerimeter` mesurent un contour simple, convexe ou non (formule du lacet). L'aire signée est positive dans le sens trigonométrique, axe y vers le haut. Un contour qui répète son premier point à la fin est accepté. Un contour de moins de trois coins, plat ou qui se croise est refusé.

L'homographie est une matrice 3 × 3 en ligne, `h33` ramené à 1 quand il n'est pas nul. Un test de propriétés photographie des rectangles au hasard (inclinaison, cap, roulis, hauteur et focale tirés au sort) puis les redresse : coins, aire et périmètre retombent à 0,1 % près.

Les dimensions ne valent que si l'échelle est connue : sans longueur mesurée au sol, le plan ne donne que des proportions.

## Plan d'un terrain nu

`generateLayout` trace des planches sur un terrain vide. Tu lui donnes le contour du terrain en centimètres (axe y vers le haut, convexe ou non, 200 coins au plus), une disposition et la largeur des allées. Il rend les planches, leur contour et des chiffres. Le calcul est déterministe : la même entrée donne toujours les mêmes planches.

```ts
const plan = generateLayout({
  area: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }],
  style: 'rows', // 'rows' (planches), 'squares' (carrés) ou 'mounds' (buttes rondes)
  aisles: { aisleCm: 40 }, // bordure et allée transversale prennent la même largeur par défaut
  orientation: { northDeg: 90 }, // le nord vers le haut du plan
  crops, // les cultures de sillon-cultures, lues par parseCrops
});
// plan.value.beds : Planche 1 (en haut) et Planche 2, 520 × 120 cm chacune
// plan.value.stats : 12,48 m² cultivés sur 24 m², conseil d'exposition, plants par culture
```

- Planches : des bandes parallèles à l'axe, centrées dans le terrain. Une bande s'arrête là où le contour se resserre et garde la bordure partout ; un morceau plus court que `bedMinLengthCm` est abandonné. Avec `bedMaxLengthCm`, une planche trop longue est coupée en parts égales par une allée transversale.
- Carrés : une grille centrée sur le terrain ; un carré n'est gardé que s'il tient avec sa bordure.
- Buttes : des buttes rondes en rangs décalés, à `moundCm + aisleCm` les unes des autres dans toutes les directions. Une butte est dessinée par un polygone de 32 côtés, et son aire est celle de ce polygone.
- L'axe des planches suit le plus long côté du terrain, sauf si tu donnes `bedAxisDeg` (en degrés, sens trigonométrique depuis l'axe x). Les planches sont numérotées dans l'ordre de lecture : du haut du plan vers le bas, chaque rang de gauche à droite.
- Les tailles par défaut sont dans `LAYOUT_PARAMS` : planche de 120 cm de large, 100 cm de long au moins, carré de 120 cm, butte de 100 cm. Ce sont des estimations ; `plan.params` dit pour chaque valeur si elle vient de la saisie ou d'une estimation.
- `stats` donne la surface totale, la surface cultivée, la surface d'allées (tout ce qui n'est pas planche) et la part cultivée. Pour chaque culture, `bedCapacity` compte les plants qui tiennent dans chaque planche avec son `spacingCm` : des rangs espacés de `betweenRows` (un rang au moins), des plants espacés de `inRow`, par cordes sur une butte. Une culture sans écartement rend `null` : pas de donnée, pas de chiffre inventé.
- `exposureNote` dit où mettre les cultures hautes. Planches nord-sud : au bout nord. Planches est-ouest : sur la planche la plus au nord. Ces deux cas suivent l'Oregon State University Extension (`EXPOSURE_SOURCE`). Les planches en biais, les carrés et les buttes étendent la même règle et sont marqués comme estimation. Sans nord, la note le demande.

Refus, avec un message en français : allée nulle, négative ou de plus de 10 m, dimension invalide, angle non fini, contour invalide (mêmes messages que `polygonArea`), terrain de plus de 10 km, contour de plus de 200 coins, terrain trop petit pour une seule planche, plus de 500 planches.

## Premier plan de cultures

`solveCropPlan` répartit les cultures que tu veux sur les planches libres et rend jusqu'à trois options, la meilleure d'abord, chacune avec le détail de son score en français. Il ne trace rien : il dit quelle culture va sur quelle planche. Le calcul est déterministe.

```ts
const voisines = neighbouringBeds(plan.value.beds, 41); // planches à une allée l'une de l'autre
const options = solveCropPlan({
  beds: [
    { id: 'c1', label: 'Carré 1', history: [{ species: 'tomate', sownOn: '2026-03-20' }] },
    { id: 'c2', label: 'Carré 2' },
  ],
  wishes: [{ cropId: 'tomate' }, { cropId: 'haricot', beds: 1 }], // la plus voulue d'abord
  crops, // les cultures de sillon-cultures, lues par parseCrops
  sownOn: '2027-04-01', // date de semis prévue, lue pour la rotation
  neighbours: [['c1', 'c2']], // ou voisines.value
});
// options.value.options[0].assignments : la tomate sur Carré 2, le haricot sur Carré 1
// options.value.options[0].score.items : une phrase par point gagné ou perdu
```

- Rotation : la règle de `rotationAdvice`, sur l'historique de chaque planche. Une culture qui revient trop tôt coûte des points, mais elle est quand même placée si aucune planche ne convient : la rotation est un conseil, pas une interdiction. Les cultures courtes (radis) ne comptent pas.
- Compagnonnage : les listes `goodCompanions` et `badCompanions` des cultures, entre cultures d'une même planche et entre planches voisines (`neighbours`). Une mauvaise association l'emporte sur une bonne. Ces listes sont du savoir de jardinier, sans source : un conseil, jamais une alerte.
- Familles : avec `cropsPerBed` au-dessus de 1, chaque famille de plus sur une planche coûte un point, parce que la rotation devient plus dure à suivre. Chaque planche reçoit une culture avant qu'une planche n'en reçoive deux.
- Méthode : un placement glouton dans trois ordres (le tien, les cultures les plus difficiles à caser d'abord, celles qui ont le plus de compagnons d'abord), puis des échanges deux à deux tant qu'un échange améliore le score. Les options identiques sont fusionnées. Le modèle de langage de l'app peut expliquer et classer ces options ; il ne produit jamais de placement.
- Les poids sont dans `CROP_PLAN_WEIGHTS` (rotation -10, bon voisin +1, mauvais voisin -2, famille en plus -1, emplacement manquant -5), tous marqués comme estimation et recopiés dans `params`.
- Une culture hors catalogue est placée sans rotation ni compagnonnage ; `withoutData` la liste avec la phrase « pas de donnée » à montrer.
- `scoreCropPlan` recalcule le score d'un plan modifié à la main, avec les mêmes règles.
- `neighbouringBeds(beds, écartMax)` trouve les planches dont les contours sont à moins de `écartMax` cm (la largeur d'allée, plus un peu pour l'arrondi).

Refus, avec un message en français : aucune planche, planche sans identifiant ou en double, aucune culture, culture sans nom ou demandée deux fois, nombre de planches non entier ou nul, date invalide (plan, souhait ou historique), `cropsPerBed` hors de 1 à 4, `maxOptions` hors de 1 à 3, voisine inconnue ou planche voisine d'elle-même, plan trop grand (plus de 500 planches, 100 cultures, 500 emplacements demandés, 500 lignes d'historique par planche ou 5 000 paires de voisines).

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
