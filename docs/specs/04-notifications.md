## 9. Notifications

### 9.1 Channel definition

Each channel is an env var `PW_CHANNEL_<NAME>=<url>`. The channel name is `<NAME>` in lowercase.

| Type | Format | Example |
|---|---|---|
| Telegram | `telegram://<bot_token>@<chat_id>` | `PW_CHANNEL_PHONE=telegram://123:ABC@-1001234` |
| SMTP | `smtp://user:pass@host:port?from=<email>&to=<email>[,<email>]` (`smtps://` for implicit TLS) | `PW_CHANNEL_MAIL=smtps://me:secret@smtp.gmail.com:465?from=me@gmail.com&to=me@gmail.com` |
| Webhook | `webhook+https://host/path[?secret=<secret>]` (`webhook+http://` allowed) | `PW_CHANNEL_N8N=webhook+https://n8n.local/webhook/pw?secret=abc` |

- **REQ-NOT-001 (MUST)** The channel parser validates every `PW_CHANNEL_*` at boot. An invalid channel is a configuration error (REQ-CFG-002).
- **REQ-NOT-002 (MUST)** Rules and `PW_DEFAULT_CHANNELS` that reference a nonexistent channel: in the API, return `422`; at boot, it is a configuration error.
- **REQ-NOT-003 (MUST)** Common interface: `Notifier.send(event): Promise<void>`, throwing on failure.
- **REQ-NOT-004 (MUST)** A failure on one channel does not prevent delivery on the others. Each delivery produces a row in `notifications`.
- **REQ-NOT-005 (MUST)** Each delivery has a 15 s timeout and up to 2 retries with 2 s and 6 s backoff, only for network errors or 5xx.
- **REQ-NOT-006 (MUST)** If **all** channels fail after retries, the rule state does not advance (REQ-ALR-015); if at least one succeeds, it advances normally. Every failure is recorded in `notifications`.

### 9.2 Per channel

- **REQ-NOT-010 (MUST) Telegram:** `sendMessage` with `parse_mode=HTML`, escaping dynamic content. Message with product, store, effective price, cash price if different, reason and link.
- **REQ-NOT-011 (MUST) SMTP:** via nodemailer. Subject `[pricewatch] <product> — R$ X`. Plain-text body and simple HTML.
- **REQ-NOT-012** Reserved (Resend channel deferred; see section 13).
- **REQ-NOT-013 (MUST) Webhook:** `POST` with the JSON event from section 8.3, `Content-Type: application/json`. With `secret`, sends `X-Pricewatch-Signature: sha256=<hex>` (HMAC-SHA256 of the body) and `X-Pricewatch-Timestamp`. A 2xx response = success.

> **Acceptance REQ-NOT-013**
> Given a webhook channel with `secret=abc`, when an alert is sent, then the receiver can recompute `HMAC_SHA256("abc", body)` and obtain the same value as the header.
