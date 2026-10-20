export { type Result, INTERNAL_ERROR, ok, fail, guarded } from './result.js';
export { isValidCivilDate, isTooFarInFuture, addDays } from './dates.js';
export { dailyGdd } from './forecast/gdd.js';
export {
  forecastHarvest,
  type HarvestForecast,
  type HarvestInput,
  type HarvestPlanting,
} from './forecast/harvest.js';
export {
  forecastFirstHarvest,
  type FirstHarvest,
  type FirstHarvestPlanting,
} from './forecast/first-harvest.js';
export { whatsNext, type WeeklyAction, type CalendarPlanting } from './calendar/whats-next.js';
export { rotationWarning, rotationAdvice, ROTATION_RULES, FAMILY_LABELS, type RotationAdvice } from './rotation.js';
export {
  germinationOutlook,
  seedLotOutlook,
  type GerminationOutlook,
  type SeedLotOutlook,
  type SeedLotStatus,
  type SeedLotYear,
} from './seeds/germination.js';
export { validatePlanting } from './plantings/validate.js';
export type { PlantingLike, PlantingInput, PlantingMethod, PlantingStatus } from './plantings/types.js';
export {
  cropSchema,
  windowsOf,
  firstHarvestsOf,
  isCrop,
  type Crop,
  type WeekWindow,
  type WeekWindows,
  type FirstHarvestDays,
  type FirstHarvestDaysList,
  type Sourced,
} from './crops/schema.js';
export { parseCrops, getCrop } from './crops/parse.js';
export {
  fetchForecast,
  fetchArchive,
  WEATHER_UNAVAILABLE,
  type DailyWeather,
  type WeatherLocation,
} from './weather/openmeteo.js';
