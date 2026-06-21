import { describe, it, expect } from 'vitest';
import { maskPhone } from '../src/utils/privacy.js';
import { escapeLike } from '../src/utils/sql.js';
import { xlsxDateToYmd } from '../src/utils/xlsx.js';
import { createIncidentSchema, createDeviceSchema, createUserSchema } from '../src/schemas/index.js';

describe('maskPhone (PII)', () => {
  it('masks the middle digits', () => expect(maskPhone('081234567890')).toBe('0812******90'));
  it('null → null', () => expect(maskPhone(null)).toBeNull());
  it('short number masked', () => expect(maskPhone('0812')).toBe('0***'));
});

describe('escapeLike (SQL LIKE)', () => {
  it('escapes %, _ and backslash', () => expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d'));
  it('leaves normal text intact', () => expect(escapeLike('mikrotik')).toBe('mikrotik'));
});

describe('xlsxDateToYmd (timezone-safe)', () => {
  it('UTC-midnight cell → exact day (no shift)', () => expect(xlsxDateToYmd(new Date(Date.UTC(2026, 5, 15)))).toBe('2026-06-15'));
  it('invalid → empty string', () => expect(xlsxDateToYmd('bukan-tanggal')).toBe(''));
});

describe('createIncidentSchema', () => {
  it('rejects empty issue', () => expect(createIncidentSchema.safeParse({ issue: '' }).success).toBe(false));
  it('rejects invalid priority', () => expect(createIncidentSchema.safeParse({ issue: 'x', priority: 'super' }).success).toBe(false));
  it('accepts & coerces deviceId', () => {
    const r = createIncidentSchema.safeParse({ issue: 'mati', deviceId: '5', priority: 'kritis' });
    expect(r.success).toBe(true);
    expect(r.data.deviceId).toBe(5);
  });
});

describe('createDeviceSchema', () => {
  it('rejects IPv4 octet > 255', () => expect(createDeviceSchema.safeParse({ name: 'a', ip: '999.1.1.1', type: 'Switch' }).success).toBe(false));
  it('rejects incomplete IP', () => expect(createDeviceSchema.safeParse({ name: 'a', ip: '10.0.0', type: 'Switch' }).success).toBe(false));
  it('accepts hostname', () => expect(createDeviceSchema.safeParse({ name: 'a', ip: 'sw-core.local', type: 'Switch' }).success).toBe(true));
  it('rejects port out of range', () => expect(createDeviceSchema.safeParse({ name: 'a', ip: '10.0.0.1', type: 'Switch', ssh_port: '99999' }).success).toBe(false));
});

describe('createUserSchema', () => {
  it('rejects bad email & short PIN', () => expect(createUserSchema.safeParse({ name: 'a', username: 'abc', email: 'bad', pin: '12' }).success).toBe(false));
  it('accepts valid user', () => expect(createUserSchema.safeParse({ name: 'a', username: 'abc', email: 'a@b.co', pin: '1234' }).success).toBe(true));
});
