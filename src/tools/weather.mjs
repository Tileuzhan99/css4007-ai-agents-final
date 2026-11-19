// get_weather_forecast: daily forecast for a city.
// Data: Open-Meteo (https://open-meteo.com), free, no API key.
// Step 1: geocoding API turns the city name into coordinates.
// Step 2: forecast API returns daily min/max temperature, precipitation and a WMO weather code.
import { getJson, ToolError } from './http.mjs';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// WMO weather interpretation codes used by Open-Meteo.
const WMO = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'depositing rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 56: 'freezing drizzle', 57: 'dense freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
};
export const describeWeatherCode = (code) => WMO[code] ?? `unknown (code ${code})`;

export const weatherTool = {
  name: 'get_weather_forecast',
  description:
    'Get the daily weather forecast (min/max temperature in °C, precipitation in mm, conditions) for a city for the next 1-7 days, starting today. Use it whenever the user asks about weather or what to wear on specific days.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 100, description: 'City name, e.g. "Almaty" or "Tbilisi"' },
      days: { type: 'integer', minimum: 1, maximum: 7, default: 3, description: 'Number of days, 1-7 (default 3)' },
    },
    required: ['city'],
    additionalProperties: false,
  },

  /** @param {{city: string, days: number}} args validated arguments */
  async execute({ city, days }, { fetchImpl, timeoutMs } = {}) {
    const geo = await getJson(`${GEOCODE_URL}?${new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' })}`, {
      fetchImpl,
      timeoutMs,
    });
    const place = geo?.results?.[0];
    if (!place) throw new ToolError(`city not found: "${city}"`, { kind: 'not_found' });

    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
      timezone: 'auto',
      forecast_days: String(days),
    });
    const fc = await getJson(`${FORECAST_URL}?${params}`, { fetchImpl, timeoutMs });
    const d = fc?.daily;
    if (!d || !Array.isArray(d.time)) throw new ToolError('forecast response has no daily data', { kind: 'bad_response' });

    return {
      city: place.name,
      region: place.admin1 ?? null,
      country: place.country ?? null,
      timezone: fc.timezone ?? place.timezone ?? null,
      units: { temperature: '°C', precipitation: 'mm' },
      days: d.time.map((date, i) => ({
        date,
        tempMin: d.temperature_2m_min?.[i] ?? null,
        tempMax: d.temperature_2m_max?.[i] ?? null,
        precipitationMm: d.precipitation_sum?.[i] ?? null,
        description: describeWeatherCode(d.weather_code?.[i]),
      })),
      source: 'open-meteo.com',
    };
  },
};
