# Health-check contract for client sites

Website Tracker tests contact forms and quote APIs end-to-end **without
sending real emails to the client**. It does that with a test marker; each
client backend needs this one-time patch.

## The marker

Every automated submission contains both of these:

- field `_healthcheck` with value `"1"`
- email `healthcheck@alisamadii.com`

## What the backend must do

1. Run **all** normal validation — the point is to test the real path.
2. If the marker is present, **skip sending the email/notification** (and skip
   writing to any CRM/lead list if you don't want test noise there).
3. Return the exact same success response the real flow returns.

Treat a request as a health check when `_healthcheck === "1"` **or** the email
equals `healthcheck@alisamadii.com` — either alone is enough.

## Examples

Next.js route handler / server action:

```ts
const isHealthcheck =
  body._healthcheck === '1' || body.email === 'healthcheck@alisamadii.com';

// ...run the usual validation first...

if (!isHealthcheck) {
  await sendMail(/* ... */);
}
return NextResponse.json({ ok: true }); // same response either way
```

PHP:

```php
$isHealthcheck = ($_POST['_healthcheck'] ?? '') === '1'
  || ($_POST['email'] ?? '') === 'healthcheck@alisamadii.com';

// ...validate as usual...

if (!$isHealthcheck) {
    mail($to, $subject, $message);
}
echo json_encode(['ok' => true]);
```

## Configuring the check in Website Tracker

On the website's page → **Advanced** → "Contact form check":

```json
{
  "pageUrl": "https://clientsite.com/contact",
  "fields": {
    "#name": "Healthcheck",
    "#email": "{{email}}",
    "#message": "Automated monitoring check"
  },
  "submitSelector": "button[type=submit]",
  "successSelector": ".success-message"
}
```

`{{email}}` is replaced with the marker email. The check fills the fields in a
real browser, injects the hidden `_healthcheck` input into the form, clicks
submit, and expects `successSelector` to appear.

Quote APIs use "Quote API check": the sample body is POSTed with the marker
added, and the JSON response must contain every key in `expectKeys`.
