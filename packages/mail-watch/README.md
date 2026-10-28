# @magpie-community/hooks-mail-watch

Email alerts from [magpie](https://usemagpie.ai)'s gateway: a provider error the user should know about, a subscription quota close to or past its line — sent as plain mail through your own SMTP account, with your own words in it.

Install it from magpie's **Plugins › Discover**, or with `magpie plugin add @magpie-community/hooks-mail-watch`. It has no page and no tab; it watches from beside the gateway.

## What it watches

Two signals, both from files magpie already keeps, read after an exchange finishes:

- **Provider errors** — a model call that ended in a 4xx/5xx (`usage.jsonl`'s own row for the call: status, the vendor's error type and words, provider, model, agent). A try the gateway handed on to another provider is skipped: the request was answered on a later try, so it was no failure of the request.
- **Quota windows** — a subscription account's allowance windows (`quotas.json`), each one a percentage used: exhausted at 100%, or over the low line you set.

## Options

Set them in magpie's plugin options for this package. All of it is yours: the mailbox, the words, and what to watch.

```jsonc
{
  "smtp": {
    "host": "smtp.example.com",   // required for any mail to go
    "port": 465,                  // default: 465 when secure, else 587
    "secure": true,               // TLS from the first byte (the 465 shape); false = plain relay
    "user": "me@example.com",     // omit on a plain relay that wants no sign-in
    "pass": "the app password",
    "from": "magpie@example.com"  // default: user
  },
  "to": ["me@example.com"],       // recipients; a comma string works too
  "watch": {
    "errors": true,               // provider call failures
    "quotaExhausted": true,       // a window at 100%
    "quotaLow": false,            // a window over quotaLowPct (but under 100)
    "quotaLowPct": 90,
    "providers": []               // empty: every provider; else only these
  },
  "cooldownMinutes": { "error": 10, "quota": 240 },  // one mail per key per window
  "template": {
    "subject": "[magpie] {{kind}} · {{provider}}{{window}}",
    "body": "What: {{kind}}\nProvider: {{provider}}{{account}}\n{{modelLine}}{{windowLine}}When: {{time}}\n\n{{detail}}"
  }
}
```

A note on `secure`: `true` is TLS from the first byte — the usual submission port (465), which every major mailhost offers. `false` is a plain relay on your own network (a localhost or LAN mailhost that wants no sign-in); a user/password on a plain wire is refused, because AUTH PLAIN is the password in base64 and a plaintext port would broadcast it. STARTTLS (an upgrade offered on a plain port, port 587's habit) is not supported: the runtime's TLS upgrade dies mid-session on some platforms, so rather than a send that breaks at random, use your mailhost's 465 port instead. TLS is verified against your system's certificate store; `smtp.insecure: true` turns that off for a mailhost with a self-signed certificate you know.

The cooldown keys are `provider` + error type (or status), and `provider` + account + window: one mail per key per window of minutes, so a vendor's bad hour is one mail, not four hundred. The cooldown marks the send before it is attempted — a broken SMTP server collects no backlog; the next matching event tries again after the window.

## Template variables

| Variable | Fills with |
| --- | --- |
| `{{kind}}` | `error`, `quota exhausted`, `quota low` |
| `{{provider}}`, `{{account}}` | where the call went / whose subscription |
| `{{model}}`, `{{agent}}` | the model asked, the agent that asked |
| `{{status}}`, `{{errType}}`, `{{endpoint}}` | HTTP status, the vendor's error type, the path called |
| `{{window}}`, `{{used}}`, `{{resetsAt}}` | the quota window's name, % used, when it resets |
| `{{time}}` | ISO time the alert was made |
| `{{modelLine}}`, `{{windowLine}}` | ready-made lines, empty when they'd say nothing |
| `{{detail}}` | the whole story: status + error, or window + % + reset |

A `{{name}}` the event doesn't carry becomes empty; braces that aren't a variable (`{{not a var}}`) are left alone. The subject is UTF-8 encoded for the header (RFC 2047), so any language works.

## How it runs

The package is one of magpie's asynchronous gateway hooks (`magpie.hooks`): magpie's Bun host calls `onResponse` once an exchange with a model is over — successfully or not. The hook waits a moment (1.5 s, so a burst of parallel calls is one scan), reads magpie's own log and quota files, and mails what is new through a queue that sends one mail at a time. It never awaits any of this — the bounded hook returns at once, and a broken send must not touch the request or magpie's log. Nothing is imported from npm; the SMTP client is hand-rolled over Bun's own socket API (implicit TLS or a plain relay, full reply-code validation).

State (how far the log was read, what was sent when) sits in `mail-watch-state.json` beside magpie's own config files, written atomically. Its first run starts from the log as it is — a fresh install does not replay every past failure.

## Privacy

What a call's error said stays between you and your own mailbox: the mail carries the provider, model, agent, status and the vendor's own error words, cut to 400 characters, and nothing else — no conversation content, no prompt text. The hook reads only magpie's own files and your SMTP server; it sends to no third party.

## Test

```sh
bun test packages/mail-watch
```
