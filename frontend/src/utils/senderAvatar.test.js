import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { senderDomainFromEmail, avatarImageCandidates } from './senderAvatar.js';
import { SENDER_BRANDS, senderBrandForDomain } from './senderBrands.js';

describe('senderDomainFromEmail', () => {
  it('returns a lowercase ASCII domain only', () => {
    assert.equal(senderDomainFromEmail('Alice@Example.COM'), 'example.com');
    assert.equal(senderDomainFromEmail('alice@münich.example'), 'xn--mnich-kva.example');
  });

  it('rejects malformed or unsafe addresses', () => {
    for (const email of [
      '', 'alice', '@example.com', 'alice@', 'a@@example.com',
      'a@localhost', 'a@127.0.0.1', 'a@example.com:443', 'a@example.com/path',
    ]) {
      assert.equal(senderDomainFromEmail(email), null, email);
    }
  });
});

describe('avatarImageCandidates', () => {
  const email = 'alice@example.com';
  const contact = '/api/contacts/photo?email=alice%40example.com';
  const favicon = '/api/sender-favicons/example.com';

  it('orders a known contact photo before the optional favicon', () => {
    assert.deepEqual(avatarImageCandidates({ email, hasContactPhoto: true, senderFavicons: true }), [
      { kind: 'contact', src: contact },
      { kind: 'favicon', src: favicon },
    ]);
  });

  it('skips the contact probe when absence is known', () => {
    assert.deepEqual(avatarImageCandidates({ email, hasContactPhoto: false, senderFavicons: true }), [
      { kind: 'favicon', src: favicon },
    ]);
  });

  it('probes contact first when availability is unknown', () => {
    assert.deepEqual(avatarImageCandidates({ email, hasContactPhoto: undefined, senderFavicons: true }), [
      { kind: 'contact', src: contact },
      { kind: 'favicon', src: favicon },
    ]);
  });

  it('removes only the favicon when disabled or not hydrated', () => {
    assert.deepEqual(avatarImageCandidates({ email, hasContactPhoto: true, senderFavicons: false }), [
      { kind: 'contact', src: contact },
    ]);
    assert.deepEqual(avatarImageCandidates({ email, hasContactPhoto: false, senderFavicons: false }), []);
  });

  it('never puts the local part in a favicon candidate', () => {
    const candidates = avatarImageCandidates({ email, hasContactPhoto: false, senderFavicons: true });
    assert.equal(candidates[0].src.includes('@'), false);
    assert.equal(candidates[0].src.includes('alice'), false);
  });

  it('keeps the contact photo when the domain is unparseable', () => {
    assert.deepEqual(avatarImageCandidates({ email: 'ops@intranet', hasContactPhoto: true, senderFavicons: true }), [
      { kind: 'contact', src: '/api/contacts/photo?email=ops%40intranet' },
    ]);
    assert.deepEqual(avatarImageCandidates({ email: 'admin@192.168.1.5', hasContactPhoto: undefined, senderFavicons: true }), [
      { kind: 'contact', src: '/api/contacts/photo?email=admin%40192.168.1.5' },
    ]);
  });

  it('returns no candidates without a usable email', () => {
    for (const bad of [undefined, null, '', '   ', 42]) {
      assert.deepEqual(avatarImageCandidates({ email: bad, hasContactPhoto: undefined, senderFavicons: true }), [], String(bad));
    }
  });
});


describe('bundled sender brands', () => {
  it('ships an inert SVG for every registered brand and matches only bounded official domains', () => {
    const ids = new Set();
    const domains = new Set();
    for (const brand of SENDER_BRANDS) {
      assert.equal(ids.has(brand.id), false, `duplicate icon ${brand.id}`);
      ids.add(brand.id);
      const svg = readFileSync(new URL(`../../public/sender-brands/v1/${brand.id}.svg`, import.meta.url), 'utf8');
      assert.match(svg, /^<svg[^>]*viewBox="0 0 24 24"/);
      assert.doesNotMatch(svg, /<(?:script|image|foreignObject)|\bon\w+=|href=|url\(/i);
      for (const domain of brand.domains) {
        assert.equal(domains.has(domain), false, `duplicate domain ${domain}`);
        domains.add(domain);
        assert.equal(senderBrandForDomain(domain.toUpperCase()).id, brand.id);
        assert.equal(senderBrandForDomain(`mail.${domain}`).id, brand.id);
        assert.equal(senderBrandForDomain(`fake${domain}`), null);
        assert.equal(senderBrandForDomain(`${domain}.evil.example`), null);
      }
    }
  });
  it('recognizes official domains and bounded subdomains without network opt-ins', () => {
    for (const [email, brand] of [
      ['notice@email.apple.com', 'apple'], ['security@accountprotection.microsoft.com', 'microsoft'],
      ['updates@GOOGLE.COM', 'google'], ['notifications@github.com', 'github'],
    ]) {
      assert.deepEqual(avatarImageCandidates({ email, hasContactPhoto: false }), [
        { kind: 'brand', src: `/sender-brands/v1/${brand}.svg` },
      ]);
    }
  });
  it('does not brand personal mailboxes, tenant domains or lookalikes', () => {
    for (const domain of ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'qq.com', '163.com', 'proton.me', 'protonmail.com', 'tuta.com', 'tutanota.com',
      'user.github.io', 'tenant.onmicrosoft.com', 'notapple.com', 'apple.com.evil.example',
      'microsoft.com.evil.example', 'apple-com.example']) {
      assert.deepEqual(avatarImageCandidates({ email: `apple@${domain}`, hasContactPhoto: false }), [], domain);
    }
  });
  it('keeps contact photos first and the local brand before external lookups', () => {
    const candidates = avatarImageCandidates({ email: 'notice@apple.com', hasContactPhoto: true,
      gravatarAvatars: true, senderFavicons: true });
    assert.deepEqual(candidates.map(candidate => candidate.kind), ['contact', 'brand', 'gravatar', 'favicon']);
    assert.equal(candidates[1].src, '/sender-brands/v1/apple.svg');
  });
});
