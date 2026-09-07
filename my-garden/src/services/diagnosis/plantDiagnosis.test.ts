import { describe, it, expect } from 'vitest';
import { parseDiagnosis } from './plantDiagnosis';

describe('parseDiagnosis', () => {
  it('returns null for unparseable text', () => {
    expect(parseDiagnosis('not json at all')).toBeNull();
  });

  it('reports no-plant-detected when the model says plantVisible is false', () => {
    const result = parseDiagnosis('{"plantVisible": false, "overallHealth": "healthy", "findings": []}');
    expect(result?.status).toBe('no-plant-detected');
    expect(result?.findings).toHaveLength(0);
  });

  it('parses a healthy plant with no findings', () => {
    const result = parseDiagnosis('{"plantVisible": true, "overallHealth": "healthy", "findings": []}');
    expect(result).toEqual({ status: 'ok', findings: [], overallHealth: 'healthy' });
  });

  it('parses findings and normalizes an unknown category to "other"', () => {
    const raw = JSON.stringify({
      plantVisible: true,
      overallHealth: 'unhealthy',
      findings: [
        {
          category: 'pest',
          label: 'Aphids',
          confidence: 'high',
          observation: 'Small green insects clustered under new growth.',
          remedy: 'Spray off with water, then apply insecticidal soap — safe around pets once dry.',
        },
        {
          category: 'some-unrecognized-category',
          label: 'Odd spots',
          confidence: 'low',
          observation: 'A few dark spots on older leaves.',
          remedy: 'Remove affected leaves and monitor.',
        },
      ],
    });
    const result = parseDiagnosis(raw);
    expect(result?.status).toBe('ok');
    expect(result?.overallHealth).toBe('unhealthy');
    expect(result?.findings).toHaveLength(2);
    expect(result?.findings[0].category).toBe('pest');
    expect(result?.findings[1].category).toBe('other');
  });

  it('drops findings missing required text fields rather than crashing', () => {
    const raw = JSON.stringify({
      plantVisible: true,
      findings: [
        { category: 'pest', label: 'Aphids' }, // missing observation/remedy
        {
          category: 'underwatering',
          label: 'Wilting',
          confidence: 'medium',
          observation: 'Leaves are drooping and edges are crispy.',
          remedy: 'Water thoroughly and check soil moisture before the next watering.',
        },
      ],
    });
    const result = parseDiagnosis(raw);
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0].label).toBe('Wilting');
  });

  it('defaults overallHealth to "stressed" when findings exist but the model omitted it', () => {
    const raw = JSON.stringify({
      plantVisible: true,
      findings: [
        {
          category: 'not-enough-sun',
          label: 'Leggy growth',
          confidence: 'medium',
          observation: 'Stems are stretched and pale, reaching toward the window.',
          remedy: 'Move to a brighter spot or rotate regularly for even light.',
        },
      ],
    });
    const result = parseDiagnosis(raw);
    expect(result?.overallHealth).toBe('stressed');
  });

  it('extracts JSON even when wrapped in prose or a code fence', () => {
    const raw = 'Here you go:\n```json\n{"plantVisible": true, "overallHealth": "healthy", "findings": []}\n```';
    const result = parseDiagnosis(raw);
    expect(result?.status).toBe('ok');
  });
});
