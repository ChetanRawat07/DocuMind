import { describe, expect, it } from 'vitest';
import { passwordStrength } from '../auth/password-policy';

describe('passwordStrength', () => {
  it('scores length, mixed case and digits or symbols', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('abcdefgh1')).toBe(2);
    expect(passwordStrength('Abcdefgh1')).toBe(3);
    expect(passwordStrength('Abcdefgh1234')).toBe(4);
  });
});
