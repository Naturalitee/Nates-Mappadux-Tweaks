import { describe, it, expect } from 'vitest';
import { parseOptions } from '../../src/ai/LLMClient.ts';

describe('LLM reply parsing', () => {
  it('splits the default 4-option GM-assistant format into clean chips', () => {
    const resp = `**1. The Green Light (Positive)**
> The lock clicks invitingly. "Give me a Sleight of Hand roll."

**2. The Complication (Yes, but...)**
> You hear footsteps approaching. "Give me a Sleight of Hand roll."

**3. The Hard Stop (Negative)**
> The mechanism is warded. "It will require an Arcana roll."

**4. The GM's Choice**
> A second door stands ajar. "Make a Perception roll."`;
    const opts = parseOptions(resp);
    expect(opts).toHaveLength(4);
    // The chip is the reply the GM SENDS — the quoted body, with the bold
    // category heading ("The Green Light (Positive)") and quote marks stripped.
    expect(opts[0]).toContain('lock clicks invitingly');
    expect(opts[0]).toContain('Sleight of Hand roll');
    expect(opts[0]).not.toContain('The Green Light');
    expect(opts[0]).not.toContain('**');
    expect(opts[0]).not.toContain('>');
    expect(opts[3]).toContain('Perception roll');
  });

  it('handles plain numbered lists', () => {
    const opts = parseOptions('1) Go left\n2) Go right\n3) Wait');
    expect(opts).toHaveLength(3);
    expect(opts[0]).toBe('Go left');
  });

  it('falls back to the whole text when there is no list structure', () => {
    const opts = parseOptions('Just tell them yes.');
    expect(opts).toEqual(['Just tell them yes.']);
  });
});
