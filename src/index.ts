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
  type FrostClass,
  type GermSoilC,
  type KcStages,
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
export {
  fetchHourly,
  nightsOf,
  HOURLY_VARS,
  HOURLY_MODELS,
  type HourlyWeather,
  type HourlyVar,
  type HourlyModel,
  type HourlyOptions,
  type Night,
} from './weather/hourly.js';
export type { Alert, AlertCrop, AlertKind, FrostLevel, Param, ParamSet } from './alerts/types.js';
export {
  assessNights,
  frostNights,
  frostAlerts,
  chillAlerts,
  frostLevel,
  frostClassOf,
  frostConcerns,
  inGroundOn,
  FROST_PARAMS,
  CHILL_PARAMS,
  type FrostNight,
  type FrostNightInputs,
  type FrostAlert,
  type ChillAlert,
  type FrostParams,
  type NightOptions,
} from './alerts/frost.js';
export {
  lastFrostStats,
  calibrateFrostThreshold,
  MERIGNAC_FROST_DAYS,
  LAST_FROST_PARAMS,
  CALIBRATION_PARAMS,
  type DailyMin,
  type FrostYear,
  type LastFrostStats,
  type LastFrostOptions,
  type LastFrostParams,
  type FrostCalibration,
  type CalibrationRow,
  type CalibrationOptions,
} from './alerts/last-frost.js';
export {
  mildewDays,
  mildewPeriods,
  mildewRuns,
  mildewAlerts,
  MILDEW_PARAMS,
  MILDEW_HOSTS,
  type MildewLevel,
  type MildewDay,
  type MildewPeriod,
  type MildewRun,
  type MildewOptions,
  type MildewInputs,
  type MildewAlert,
  type MildewParams,
} from './alerts/mildew.js';
export {
  waterBalance,
  cropStage,
  effectiveRain,
  adjustedDepletion,
  totalAvailableWater,
  readilyAvailableWater,
  SOIL_WATER,
  WATER_PARAMS,
  type SoilType,
  type WaterParams,
  type Stage,
  type StageFrom,
  type CropStage,
  type Progress,
  type Irrigation,
  type WaterStart,
  type WaterBalanceInput,
  type WaterDay,
  type WaterAnchor,
  type WaterBalance,
} from './alerts/water-balance.js';
