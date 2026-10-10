# MailFlow MCP for Codex and other harnesses

The fork serves a stateless **Streamable HTTP MCP endpoint at `/api/mcp`** using the official MCP SDK. Codex, Claude Code and other clients that support HTTP MCP with a bearer token can connect. No separate IMAP credentials or bridge process is required.

## Create an integration token

Open **Settings → Integrations → Apps → AI harness / MCP**. Enter a name, select the mailboxes, choose an expiry, then create the token. Copy it immediately: the server stores only a SHA-256 hash and cannot display the secret again.

Tokens default to **read only**. Check **Allow sending email** when creating a token if the client should be able to send. This exposes the send tool for the selected mailboxes only. Newly added mailboxes are not automatically included. Tokens expire after at most one year and can be revoked immediately from the same screen. The activity list records tool names and outcomes, without mail content or recipients.

## Codex

Add this to `~/.codex/config.toml`, replacing the example origin with your deployment:

```toml
[mcp_servers.mailflow]
url = "https://mail.example.com/api/mcp"
bearer_token_env_var = "MAILFLOW_MCP_TOKEN"
```

Set `MAILFLOW_MCP_TOKEN` in the environment that starts Codex (including the desktop app if used). Keep it out of repositories and chat transcripts. The endpoint uses your existing HTTPS deployment; clients should trust its certificate instead of disabling TLS verification.

Other HTTP MCP clients use the same URL and an `Authorization: Bearer <token>` header. Cookie login, username/password and email account credentials do not authorize this endpoint. GET/DELETE return 405 because there is no persistent session or SSE subscription. Each POST authenticates independently, so revocation also stops already connected clients.

## Tools

| Tool | Behavior |
| --- | --- |
| `list_accounts` | Lists the granted, enabled mailboxes; excludes credentials. |
| `list_folders` | Lists a mailbox's folders and counts. |
| `list_messages` | Lists previews, with paging and an optional unread filter. |
| `search_messages` | Uses MailFlow's existing search, including `from:`, `to:`, `subject:`, `is:unread`, `has:attachment`, date and folder operators. |
| `read_message` | Reads metadata and bounded plain text. Fetches a missing body through MailFlow's mail engine. |
| `send_message` | Available only with explicit sending permission. Sends plain text through the existing SMTP, proxy, signature, Sent-folder and idempotency implementation. |

Listing and reading do not mark emails read. Search uses already synchronized/indexed content. Attachments are listed as metadata; downloading attachments, editing mail, deleting, moving, changing rules and administering MailFlow are not exposed. Read bodies default to 50,000 characters and can be requested up to 200,000; responses indicate truncation. Lists default to 25 messages and are capped at 100.

Sending requires a client-generated UUID `idempotencyKey`. Reuse that UUID when retrying the **same** email after a lost response. Changing recipients or content requires a new UUID. SMTP sends have no MCP undo window; have the user specify or approve the intended recipients and content before sending. Granting a sending token is a capability, not an instruction to send every draft.

Email bodies are untrusted data. The server describes this to the harness and labels body responses; these notices do not replace the harness's own instruction hierarchy and approval controls. Do not let instructions embedded in an email trigger a send or disclose another message.

The API limits requests by IP and user, and sending to 10 attempts per user per minute. Token management retains the browser API's session authentication, CSRF and screen-lock checks. The MCP endpoint independently requires its bearer token and rejects browser origins other than `FRONTEND_URL` or `APP_URL`.

## Optional skill

[`skills/mailflow/SKILL.md`](../skills/mailflow/SKILL.md) supplies a workflow for inbox summaries, searching, preparing replies and explicit sends. Copy that directory into your harness's skill directory, for example `~/.agents/skills/mailflow/` for Codex. It uses the MCP tools above and requires the endpoint configuration; installing a skill alone does not connect a mailbox.

## Existing implementations reviewed

[`trust11/mailflow-mcp`](https://github.com/trust11/mailflow-mcp) is an MIT-licensed, separate stdio adapter explicitly targeting `maathimself/mailflow`. Its public source exposes 54 tools via a username/password cookie session. The reviewed HTTP client does not add MailFlow's current `X-Requested-With` CSRF header, and its tool registry does not offer the scoped, read-only-by-default token model used here. It informed the API/tool coverage review; this fork uses its own implementation and the official SDK.

Other repositories and skills named “mailflow” may refer to Microsoft Graph sorting daemons or unrelated services; verify the target project before installing them.
