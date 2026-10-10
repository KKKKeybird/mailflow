# Sender brand icons

Bundled icons are served locally. No third-party logo lookup is required.

66 brand icons cover common technology, shopping, social, entertainment and productivity senders, including Apple, Microsoft, GitHub, Steam, Bilibili, Taobao, Xiaomi, Huawei, Samsung, Cloudflare and JetBrains. The registry is `src/utils/senderBrands.js`.

All icons except Microsoft are from [Simple Icons](https://github.com/simple-icons/simple-icons/tree/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons), a public library of over 3,400 brand icons, distributed under [CC0](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/LICENSE.md). SVGs contain only their viewBox and path data, with brand colors from that revision's `data/simple-icons.json`. Microsoft's four-square mark is drawn locally. Assets live in `v1/` because nginx caches SVGs as immutable; use a new path version if an existing mark changes.

Names and marks belong to their respective owners. Domain mappings in src/utils/senderBrands.js select icons for recognition; they do not authenticate a sender. Consumer mailbox domains such as gmail.com, outlook.com, hotmail.com and icloud.com are excluded, as are tenant-hosting domains such as github.io.

Avatar priority: contact photo, bundled brand icon, optional Gravatar, optional sender website favicon, sender initials. Keep domain matches exact or bounded by a dot; never use the From display name to infer a brand.

## Email client references

- [Spark's Android avatar announcement](https://sparkmailapp.com/blog/android-avatars) describes contact photos and company logos in the inbox, with an appearance toggle. Its public description does not specify the logo lookup backend. MailFlow uses the same recognizable list presentation, with locally bundled logos and its existing mobile-avatar visibility setting.
- [Mailspring's public ContactProfilePhoto implementation](https://github.com/Foundry376/Mailspring/blob/master/app/src/components/contact-profile-photo.tsx) layers a Gravatar image over a colored initial. MailFlow keeps Gravatar optional and its initials fallback.
- [BIMI's implementation guide](https://bimigroup.org/implementation-guide/) requires aligned email authentication and an enforcing DMARC policy, with certificates supported by mailbox providers. This registry is for visual recognition and does not claim BIMI verification.
