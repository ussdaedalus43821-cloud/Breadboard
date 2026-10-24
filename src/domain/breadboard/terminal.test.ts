import { describe, expect, it } from 'vitest';
import { hole, parseTerminal, pin, rail, terminalKey } from './terminal';

describe('TerminalRef keys', () => {
  it('formats the three kinds canonically', () => {
    expect(terminalKey(hole('e', 15))).toBe('hole:e15');
    expect(terminalKey(rail('top+', 3))).toBe('rail:top+:3');
    expect(terminalKey(pin('U1', '14'))).toBe('pin:U1:14');
  });

  it('parses exactly what it formats', () => {
    for (const key of ['hole:a1', 'hole:j63', 'rail:bottom-:50', 'pin:SW1:com', 'pin:D1:anode']) {
      expect(terminalKey(parseTerminal(key))).toBe(key);
    }
  });

  it.each([
    'e15',
    'hole:k1',
    'hole:a0',
    'hole:a01',
    'rail:top:1',
    'rail:top+:0',
    'pin:1U:1',
    'pin:U1:',
    'pin:U1:a:b',
    ' hole:a1',
  ])('rejects %j', (key) => {
    expect(() => parseTerminal(key)).toThrow(/not a TerminalRef key/);
  });

  it('refuses to format malformed refs', () => {
    expect(() => terminalKey(hole('e', 0))).toThrow();
    expect(() => terminalKey(hole('e', 1.5))).toThrow();
    expect(() => terminalKey(pin('U 1', '1'))).toThrow();
  });
});
