# Forms

A **Form** sends what visitors type to you. It checks the fields first, catches spam, shows a message, and fires
events you can react to with event lists or with code. The visitor stays on the page.

gpsb builds static sites, so it doesn't store submissions itself. A form sends them to a **form service**
(Formspree, Netlify Forms, Basin, Getform), which emails them to you and keeps a list. It can also send them to an
address of your own, or open the visitor's email app.

## Making a contact form

1. Create an object for the form and add **Form** (Add Component ▸ Web ▸ Form).
2. Inside it, add the fields: **Input Field** (name, email, message with Line Type = multi), **Toggle** (a checkbox),
   **Dropdown**. Give each one a **Name** in the Inspector; that's the field's name in what's sent.
3. Add a **Button** inside the form with **Type = submit**.
4. Add a **Text** object for messages, and drop it on the Form's **Message** field.
5. Choose where it goes (below), then try it in Play mode.

## Where it goes: Provider

| Provider | Set up |
|---|---|
| **formspree** | Create a form at formspree.io and paste its id (the part after `/f/`) into **Form Id**. |
| **netlify** | For sites hosted on Netlify. Put a name in **Form Id** (default `contact`); Netlify finds the form when you deploy. |
| **basin**, **getform** | Create a form there and paste its id into **Form Id**. |
| **url** | Your own endpoint: **Action** is the address, **Method** post or get. It receives the fields as form data and should answer with a 2xx status (a JSON body is passed to your events). It must allow cross-origin requests (CORS) if it's on another domain. |
| **mailto** | Opens the visitor's email app with the fields filled in. **Form Id** is your address. Nothing is sent by the site itself. |

**Send = page** (url only) is the classic behaviour: the browser loads the endpoint's response as a new page, and
there are no messages or success/error events.

## Checking the fields

With **Validate** on (the default), a form won't send until its fields are valid. A field that isn't valid gets the
class `gpsb-invalid` and `aria-invalid="true"`, the browser points at the first one, and the Message Text shows
**Invalid Message**.

| Field | Settings |
|---|---|
| Input Field | **Required**; **Content Type** email, url, number, tel (checked for that format); **Character Limit** (maximum), **Min Length**; **Pattern** (a regular expression the whole value must match, e.g. `[0-9]{5}` for a postcode); **Autocomplete** (a hint for the browser's autofill: `name`, `email`, `tel`…). |
| Toggle | **Required**: must be ticked (accepting terms). |
| both | **Error Message**: your own text instead of the browser's (e.g. "Please enter your email address"). |

To style invalid fields, add a **Style** component to the form object and use its **Rules** (`&` is the form):

```css
& .gpsb-invalid input, & .gpsb-invalid textarea { border: 2px solid #e5534b; }
&[data-state="success"] button { background: #2e7d32; }
```

## Spam protection

- **Honeypot** (on by default): a hidden field that people never see but bots fill in. A submission with it filled
  in looks successful to the bot and is never sent. The field uses the name each service checks too (`_gotcha`,
  `bot-field`).
- **Captcha**: add an object with a **Captcha** component inside the form, and set **Service** (Cloudflare Turnstile or
  hCaptcha) and your **Site Key**. The form won't send until it's solved. The answer is sent with the fields
  (`cf-turnstile-response` / `h-captcha-response`). Your endpoint, or the form service, must check it with your
  secret key; a site key alone doesn't stop anyone who skips the page.

## Messages and states

The Form's **Sending**, **Success**, **Error** and **Invalid** messages appear in the **Message** Text, and the form
element gets `data-state="sending|success|error|invalid"` for styling. While sending, the submit buttons are
disabled. **Reset On Success** clears the fields after a successful send.

## Events

| Event list | DOM event | When | Detail |
|---|---|---|---|
| On Submit | `gpsb:submit` | The fields are valid, just before sending. **Cancelable.** | `data` (the fields, by name), `form`, `provider`, `handle(fn)` |
| On Success | `gpsb:success` | It was sent. | `data`, `response` (the parsed answer), `status` |
| On Error | `gpsb:error` | Sending failed. | `data`, `error` (a message), `status`, `response` |
| On Invalid | `gpsb:invalid` | Some fields aren't valid. | `fields`: `[{ name, message, element, node }]` |

**Without code**, use the event lists like any other: On Success → show a "Thank you" panel (Node.SetActive `true`),
play an animation, or navigate to a thank-you page.

**With code**, listen to the DOM events. They bubble, so you can listen on the form or anywhere above it:

```js
// in a behaviour on the form object (engine API)
start() {
  const form = this.getComponent('Form');
  form.onSuccess.addListener(({ response }) => console.log('sent', response));
  form.onError.addListener(({ error, status }) => console.warn(error, status));
  this.webObject.on('gpsb:invalid', e => e.detail.fields.forEach(f => console.log(f.name, f.message)));
}
```

Change what's sent, or send it yourself, in `gpsb:submit`:

```js
this.webObject.on('gpsb:submit', e => {
  e.detail.data.page = location.pathname;          // add a field
  e.detail.handle(async data => {                   // send it your way: the form still shows Sending / Success / Error
    const r = await fetch('https://api.example.com/leads', { method: 'POST', body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); // a throw = error
    return r.json();                                // = detail.response in gpsb:success
  });
});
```

Calling `e.preventDefault()` in `gpsb:submit` stops the form completely (no sending, no messages): your code takes
over.

In TypeScript, the events are typed: `form.addEventListener('gpsb:submit', e => e.detail.data)` knows `detail`.

### Calls

**Form.submit** and **Form.reset** appear in event lists (and `GPSB.invoke(id, 'Form.submit')`,
`webObject.call('Form.submit')` in code), so a button outside the form, or an animation event, can send it.

## Good to know

- Fields keep their values in the page data: `this.getComponent('InputField').text` reads what was typed.
- File inputs aren't supported yet.
- A form with Provider = url and no Action sends nothing: handle On Submit / `gpsb:submit` yourself.
- Forms only send on the published site and in Play mode.
