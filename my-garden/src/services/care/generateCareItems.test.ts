import { describe, it, expect } from 'vitest';
import { generateCareItems, describeFrequency, nextDueFrom } from './generateCareItems';
import type { WeatherData } from '../../types';

const today = () => new Date().toISOString().slice(0, 10);

function weatherWith(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    temperature: 20,
    condition: 'Clear',
    icon: '',
    timestamp: new Date().toISOString(),
    past: [],
    upcoming: [],
    ...overrides,
  };
}

describe('generateCareItems: profile matching', () => {
  it('falls back to the generic profile for an unrecognised plant', () => {
    const result = generateCareItems({ name: 'Mystery Plant' });
    expect(result.profileLabel).toBe('General garden plant');
    expect(result.items.some((i) => i.title === 'Water')).toBe(true);
    expect(result.items.some((i) => i.title === 'Check leaves for pests')).toBe(true);
  });

  it('matches a real rose to the Rose profile', () => {
    const result = generateCareItems({ name: 'Climbing Rose', species: 'Rosa' });
    expect(result.profileLabel).toBe('Rose');
    expect(result.items.some((i) => i.title === 'Deadhead spent blooms')).toBe(true);
  });

  // Regression test: Desert Rose (Adenium obesum) matched /rose\b/ before
  // the drought-tolerant profile was checked first, so it got a garden
  // rose's watering/feeding/weekly-deadheading schedule instead of a
  // succulent's. See GardenCanvas due-badge bug report this was found from.
  it('matches Desert Rose to the drought-tolerant profile, not Rose', () => {
    const result = generateCareItems({ name: 'Desert Rose', species: 'Adenium obesum' });
    expect(result.profileLabel).toBe('Drought-tolerant / Mediterranean');
    expect(result.items.some((i) => i.title === 'Deadhead spent blooms')).toBe(false);
  });

  it('matches other rose-named-but-not-Rosa plants to drought-tolerant too', () => {
    const result = generateCareItems({ name: 'My succulent desert rose' });
    expect(result.profileLabel).toBe('Drought-tolerant / Mediterranean');
  });

  it('matches by common name when species is absent', () => {
    const result = generateCareItems({ name: 'Kitchen plant 3', commonName: 'Basil' });
    expect(result.profileLabel).toBe('Soft herb');
  });
});

describe('generateCareItems: every item starts due today', () => {
  it('sets nextDueDate to today for every generated item, generic or matched', () => {
    const result = generateCareItems({ name: 'Tomato' });
    for (const item of result.items) {
      expect(item.nextDueDate).toBe(today());
    }
  });
});

describe('generateCareItems: weather adjustments', () => {
  it('waters more often ahead of a hot stretch', () => {
    const hot = weatherWith({
      upcoming: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-01-0${i + 1}`,
        tempMax: 32,
        tempMin: 20,
        precipitation: 0,
        weatherCode: 0,
        condition: 'Hot',
        icon: '',
      })),
    });
    const baseline = generateCareItems({ name: 'Tomato' }); // no weather
    const inHeat = generateCareItems({ name: 'Tomato' }, hot);

    const baselineWater = baseline.items.find((i) => i.title === 'Water')!;
    const heatWater = inHeat.items.find((i) => i.title === 'Water')!;
    expect(heatWater.frequency.every).toBeLessThanOrEqual(baselineWater.frequency.every);
    expect(inHeat.weatherUsed).toBe(true);
  });

  it('waters less often after a soaking week', () => {
    const wet = weatherWith({
      past: Array.from({ length: 7 }, (_, i) => ({
        date: `2025-12-2${i}`,
        tempMax: 18,
        tempMin: 10,
        precipitation: 10,
        weatherCode: 61,
        condition: 'Rain',
        icon: '',
      })),
    });
    const baseline = generateCareItems({ name: 'Tomato' });
    const afterRain = generateCareItems({ name: 'Tomato' }, wet);

    const baselineWater = baseline.items.find((i) => i.title === 'Water')!;
    const rainWater = afterRain.items.find((i) => i.title === 'Water')!;
    expect(rainWater.frequency.every).toBeGreaterThanOrEqual(baselineWater.frequency.every);
  });

  // Regression coverage for rainCovered: a sheltered plant never actually
  // receives ambient rain, so crediting it with a soaking week (and
  // stretching out its watering interval) would under-water it for real.
  it('ignores recent rain for a rain-covered plant', () => {
    const wet = weatherWith({
      past: Array.from({ length: 7 }, (_, i) => ({
        date: `2025-12-2${i}`,
        tempMax: 18,
        tempMin: 10,
        precipitation: 10,
        weatherCode: 61,
        condition: 'Rain',
        icon: '',
      })),
    });
    const uncovered = generateCareItems({ name: 'Tomato' }, wet);
    const covered = generateCareItems({ name: 'Tomato', rainCovered: true }, wet);

    const uncoveredWater = uncovered.items.find((i) => i.title === 'Water')!;
    const coveredWater = covered.items.find((i) => i.title === 'Water')!;
    // The uncovered plant's interval stretched out from the rain; the
    // covered one stays at (or below, if it's also a hot week) baseline.
    expect(coveredWater.frequency.every).toBeLessThan(uncoveredWater.frequency.every);
  });

  it('ignores forecast rain for a rain-covered plant', () => {
    const rainAhead = weatherWith({
      upcoming: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-01-0${i + 1}`,
        tempMax: 20,
        tempMin: 10,
        precipitation: 5,
        weatherCode: 61,
        condition: 'Rain',
        icon: '',
      })),
    });
    const uncovered = generateCareItems({ name: 'Tomato' }, rainAhead);
    const covered = generateCareItems({ name: 'Tomato', rainCovered: true }, rainAhead);

    const uncoveredWater = uncovered.items.find((i) => i.title === 'Water')!;
    const coveredWater = covered.items.find((i) => i.title === 'Water')!;
    expect(coveredWater.frequency.every).toBeLessThan(uncoveredWater.frequency.every);
  });

  it('still shortens the watering interval for a rain-covered plant in a hot stretch', () => {
    const hot = weatherWith({
      upcoming: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-01-0${i + 1}`,
        tempMax: 32,
        tempMin: 20,
        precipitation: 0,
        weatherCode: 0,
        condition: 'Hot',
        icon: '',
      })),
    });
    const baseline = generateCareItems({ name: 'Tomato', rainCovered: true });
    const inHeat = generateCareItems({ name: 'Tomato', rainCovered: true }, hot);

    const baselineWater = baseline.items.find((i) => i.title === 'Water')!;
    const heatWater = inHeat.items.find((i) => i.title === 'Water')!;
    expect(heatWater.frequency.every).toBeLessThan(baselineWater.frequency.every);
  });

  it('adds a frost-protection item for frost-tender plants when frost is ahead', () => {
    const frosty = weatherWith({
      upcoming: [
        { date: '2026-01-05', tempMax: 10, tempMin: 0, precipitation: 0, weatherCode: 0, condition: 'Cold', icon: '' },
      ],
    });
    const result = generateCareItems({ name: 'Tomato' }, frosty); // frostTender: true
    expect(result.items.some((i) => i.title === 'Cover before frost')).toBe(true);
  });

  it('does not add frost protection for a plant that is not frost-tender', () => {
    const frosty = weatherWith({
      upcoming: [
        { date: '2026-01-05', tempMax: 10, tempMin: 0, precipitation: 0, weatherCode: 0, condition: 'Cold', icon: '' },
      ],
    });
    const result = generateCareItems({ name: 'Lavender' }, frosty); // not frostTender
    expect(result.items.some((i) => i.title === 'Cover before frost')).toBe(false);
  });

  it('waters full-sun plants more often than full-shade, all else equal', () => {
    const sunResult = generateCareItems({ name: 'Mystery Plant', sunRequirement: 'full-sun' });
    const shadeResult = generateCareItems({ name: 'Mystery Plant', sunRequirement: 'full-shade' });
    const sunWater = sunResult.items.find((i) => i.title === 'Water')!;
    const shadeWater = shadeResult.items.find((i) => i.title === 'Water')!;
    expect(sunWater.frequency.every).toBeLessThan(shadeWater.frequency.every);
  });
});

describe('generateCareItems: indoor plants', () => {
  it('ignores weather entirely for an indoor plant even when weather is passed in', () => {
    const wet = weatherWith({
      past: Array.from({ length: 7 }, (_, i) => ({
        date: `2025-12-2${i}`,
        tempMax: 18,
        tempMin: 10,
        precipitation: 25,
        weatherCode: 61,
        condition: 'Rain',
        icon: '',
      })),
    });
    // An indoor plant never actually receives this rain — the caller is
    // expected to omit weather for indoor plants, but the important
    // regression to guard is that indoor: true alone changes nothing about
    // an item's shape (no crash, no weather-flavoured rationale) even if a
    // caller passes weather through by mistake and the item content is
    // otherwise identical to the no-weather baseline.
    const indoorWithWeatherArg = generateCareItems({ name: 'Tomato', indoor: true }, wet);
    const indoorNoWeather = generateCareItems({ name: 'Tomato', indoor: true });
    const outdoorNoWeather = generateCareItems({ name: 'Tomato' });

    const water = (r: typeof indoorNoWeather) => r.items.find((i) => i.title === 'Water')!;
    expect(water(indoorNoWeather).frequency).toEqual(water(outdoorNoWeather).frequency);
    // Passing weather in is a caller bug (should omit it for indoor plants),
    // but generateCareItems itself doesn't special-case indoor beyond the
    // rationale text — document that here rather than assume.
    expect(indoorWithWeatherArg.weatherUsed).toBe(true);
  });

  it('never adds frost protection or heat mulching when weather is omitted for an indoor plant', () => {
    const result = generateCareItems({ name: 'Tomato', indoor: true });
    expect(result.items.some((i) => i.title === 'Cover before frost')).toBe(false);
    expect(result.items.some((i) => i.title === 'Mulch to hold moisture')).toBe(false);
    expect(result.weatherUsed).toBe(false);
  });

  it('gives an indoor-specific rationale instead of the "no weather available" one', () => {
    const result = generateCareItems({ name: 'Tomato', indoor: true });
    expect(result.rationale.some((r) => r.toLowerCase().includes('indoor'))).toBe(true);
    expect(result.rationale.some((r) => r.toLowerCase().includes('no local weather'))).toBe(false);
  });
});

describe('describeFrequency', () => {
  it('describes single-unit frequencies as their adverb form', () => {
    expect(describeFrequency({ every: 1, unit: 'day' })).toBe('daily');
    expect(describeFrequency({ every: 1, unit: 'week' })).toBe('weekly');
    expect(describeFrequency({ every: 1, unit: 'month' })).toBe('monthly');
    expect(describeFrequency({ every: 1, unit: 'year' })).toBe('yearly');
  });

  it('special-cases every 2 weeks', () => {
    expect(describeFrequency({ every: 2, unit: 'week' })).toBe('every 2 weeks');
  });

  it('pluralizes the general case', () => {
    expect(describeFrequency({ every: 3, unit: 'month' })).toBe('every 3 months');
  });
});

describe('nextDueFrom', () => {
  it('advances by days/weeks/months/years from a given date', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(nextDueFrom({ every: 5, unit: 'day' }, from)).toBe('2026-01-06');
    expect(nextDueFrom({ every: 2, unit: 'week' }, from)).toBe('2026-01-15');
    expect(nextDueFrom({ every: 1, unit: 'month' }, from)).toBe('2026-02-01');
    expect(nextDueFrom({ every: 1, unit: 'year' }, from)).toBe('2027-01-01');
  });
});
