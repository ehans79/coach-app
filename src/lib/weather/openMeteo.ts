export interface WeatherSnapshot {
  tempC: number;
  humidityPercent: number | null;
  windKph: number | null;
  conditions: string;
  source: "archive" | "forecast";
}

interface OpenMeteoHourlyResponse {
  hourly?: {
    time: string[];
    temperature_2m?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    wind_speed_10m?: (number | null)[];
  };
}

async function fetchHourly(
  baseUrl: string,
  lat: number,
  lng: number,
  dateStr: string
): Promise<OpenMeteoHourlyResponse | null> {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,wind_speed_10m");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function describeConditions(tempC: number, humidityPercent: number | null): string {
  const parts: string[] = [];
  if (tempC >= 28) parts.push("hot");
  else if (tempC >= 22) parts.push("warm");
  else if (tempC <= 5) parts.push("cold");
  if (humidityPercent != null && humidityPercent >= 75) parts.push("humid");
  return parts.length > 0 ? parts.join(" and ") : "mild";
}

/**
 * Historical weather at an activity's start location + time, via Open-Meteo
 * (no API key needed). Tries the reanalysis-based archive API first (full
 * historical coverage, but ~5 day data lag); falls back to the forecast
 * API's recent-past data for activities too recent for the archive to have
 * caught up on yet.
 */
export async function getWeatherAtActivityStart(
  lat: number,
  lng: number,
  startDateUtc: Date
): Promise<WeatherSnapshot | null> {
  const dateStr = startDateUtc.toISOString().slice(0, 10);
  const hourIndex = startDateUtc.getUTCHours();

  let data = await fetchHourly("https://archive-api.open-meteo.com/v1/archive", lat, lng, dateStr);
  let source: "archive" | "forecast" = "archive";

  const hasArchiveData = data?.hourly?.temperature_2m?.some((v) => v != null);
  if (!hasArchiveData) {
    data = await fetchHourly("https://api.open-meteo.com/v1/forecast", lat, lng, dateStr);
    source = "forecast";
  }

  const tempC = data?.hourly?.temperature_2m?.[hourIndex];
  if (tempC == null) return null;

  const humidityPercent = data?.hourly?.relative_humidity_2m?.[hourIndex] ?? null;
  const windKph = data?.hourly?.wind_speed_10m?.[hourIndex] ?? null;

  return {
    tempC,
    humidityPercent,
    windKph,
    conditions: describeConditions(tempC, humidityPercent),
    source,
  };
}
