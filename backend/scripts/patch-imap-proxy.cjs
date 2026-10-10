// imapflow 1.7.8 decodes HTTP credentials but sends encoded SOCKS credentials.
// Apply the same existing decoder to SOCKS until the upstream 1.x fix is available.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(path.dirname(require.resolve('imapflow')), 'proxy-connection.js');
let source = fs.readFileSync(file, 'utf8');
for (const key of ['userId', 'password']) {
  const field = key === 'userId' ? 'username' : 'password';
  const before = `connectionOpts.proxy.${key} = proxyUrl.${field};`;
  const after = `connectionOpts.proxy.${key} = decodeUserInfo(proxyUrl.${field});`;
  if (source.includes(after)) continue;
  if (!source.includes(before) || !source.includes('const decodeUserInfo =')) {
    throw new Error('imapflow proxy code changed: review the SOCKS credential compatibility patch');
  }
  source = source.replace(before, after);
}
fs.writeFileSync(file, source);
