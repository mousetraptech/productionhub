import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchCueAddresses } from '../index';

const PREFIXES = [
  { prefix: '/avantis' },
  { prefix: '/lights' },
  { prefix: '/obs' },
  { prefix: '/cam1' },
  { prefix: '/td' },
];

describe('matchCueAddresses', () => {
  it('should match addresses to correct driver prefixes', () => {
    const addresses = [
      '/avantis/ch/1/mix/fader',
      '/lights/pb/1/1',
      '/obs/scene/Main',
      '/cam1/preset/recall/1',
      '/td/render/start',
    ];
    const result = matchCueAddresses(addresses, PREFIXES);

    assert.strictEqual(result.matched.length, 5);
    assert.strictEqual(result.orphaned.length, 0);
    assert.strictEqual(result.matched[0].driver, '/avantis');
    assert.strictEqual(result.matched[1].driver, '/lights');
    assert.strictEqual(result.matched[2].driver, '/obs');
    assert.strictEqual(result.matched[3].driver, '/cam1');
    assert.strictEqual(result.matched[4].driver, '/td');
  });

  it('should detect orphaned addresses', () => {
    const addresses = [
      '/avantis/ch/1/mix/fader',
      '/unknown/something',
      '/nope/foo/bar',
    ];
    const result = matchCueAddresses(addresses, PREFIXES);

    assert.strictEqual(result.matched.length, 1);
    assert.strictEqual(result.orphaned.length, 2);
    assert.ok(result.orphaned.includes('/unknown/something'));
    assert.ok(result.orphaned.includes('/nope/foo/bar'));
  });

  it('should match global addresses', () => {
    const addresses = [
      '/fade/stop',
      '/system/check',
    ];
    const result = matchCueAddresses(addresses, PREFIXES);

    assert.strictEqual(result.matched.length, 2);
    assert.strictEqual(result.orphaned.length, 0);
    assert.strictEqual(result.matched[0].driver, '(global)');
    assert.strictEqual(result.matched[1].driver, '(global)');
  });

  it('should be case-insensitive', () => {
    const addresses = [
      '/AVANTIS/CH/1/MIX/FADER',
      '/OBS/Scene/Main',
    ];
    const result = matchCueAddresses(addresses, PREFIXES);

    assert.strictEqual(result.matched.length, 2);
    assert.strictEqual(result.orphaned.length, 0);
  });

  it('should not match partial prefix without slash separator', () => {
    const addresses = [
      '/avantisfoo/bar',
    ];
    const result = matchCueAddresses(addresses, PREFIXES);

    assert.strictEqual(result.matched.length, 0);
    assert.strictEqual(result.orphaned.length, 1);
  });

  it('should match exact prefix with no remainder', () => {
    const addresses = ['/avantis'];
    const result = matchCueAddresses(addresses, PREFIXES);

    assert.strictEqual(result.matched.length, 1);
    assert.strictEqual(result.orphaned.length, 0);
  });

  it('should prefer longest matching prefix', () => {
    const prefixes = [
      { prefix: '/a' },
      { prefix: '/a/b' },
    ];
    const addresses = ['/a/b/c'];
    const result = matchCueAddresses(addresses, prefixes);

    assert.strictEqual(result.matched.length, 1);
    assert.strictEqual(result.matched[0].driver, '/a/b');
  });

  it('should return all orphaned when no prefixes configured', () => {
    const addresses = ['/foo/bar', '/baz/qux'];
    const result = matchCueAddresses(addresses, []);

    // Global addresses are still matched
    assert.strictEqual(result.orphaned.length, 2);
  });

  it('should handle empty addresses array', () => {
    const result = matchCueAddresses([], PREFIXES);

    assert.strictEqual(result.matched.length, 0);
    assert.strictEqual(result.orphaned.length, 0);
  });
});
