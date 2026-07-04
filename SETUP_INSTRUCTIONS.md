# Family Shopping List — Setup Guide (Firebase)

Files: `index.html`, `styles.css`, `app.js`, `config.js`, `firestore.rules`, `storage.rules`.
(`schema.sql` is leftover from an earlier Supabase version — ignore/delete it.)

Total setup time: ~15 minutes, one time only.

## 1. Create your Firebase project (or reuse an existing one)

1. Go to console.firebase.google.com → **Add project** (or open a project you already have).
2. Once created, click the **Web** icon (`</>`) to register a web app. Give it any name.
3. Firebase shows you a `firebaseConfig` object — copy it.

## 2. Connect the app to your project

`config.js` in this folder already has your real project's values filled in — nothing to do here unless you create a different Firebase project later.

## 3. Turn on Email Link (passwordless) sign-in

1. Firebase Console → **Authentication** → **Sign-in method**.
2. Enable **Email/Password** provider, then toggle on **Email link (passwordless sign-in)** underneath it.
3. Under **Authentication → Settings → Authorized domains**, add the domain you'll host on (e.g. `your-app.web.app`, or your Netlify domain — see step 5).

## 4. Create Firestore + Storage

1. **Firestore Database** → **Create database** → start in **production mode** → pick a region.
2. **Storage** → **Get started** → production mode → same region.
3. Paste the contents of `firestore.rules` into **Firestore Database → Rules** → **Publish**.
4. Paste the contents of `storage.rules` into **Storage → Rules** → **Publish**.

(If you prefer the CLI: `npm i -g firebase-tools`, `firebase login`, `firebase init` selecting Firestore + Storage + Hosting, then `firebase deploy`.)

## 5. Put it online

Two easy options:

**A. Firebase Hosting (recommended since you're already on Firebase)**
```
npm i -g firebase-tools
firebase login
firebase init hosting   # point the public directory at this folder
firebase deploy
```
You'll get a URL like `https://sandy-shoppinglist.web.app`.

**B. Netlify Drop (zero install)**
Go to app.netlify.com/drop and drag this whole folder onto the page.

Either way — add that final URL to Firebase's **Authorized domains** list (step 3.3) or email links won't complete sign-in.

## 6. First-time use

1. Open the URL on your phone, enter your email, tap the sign-in link Firebase emails you.
2. Enter your name, choose **Start a new list**, name your household — this generates a 6-character join code shown at the top of the app.
3. Share that code with your other 2 family members. They open the same URL, sign in with their own email, choose **Join my family's list**, and enter the code.
4. All 3 of you now share one live list — ticking an item off updates instantly for everyone (Firestore real-time listeners).

## How each feature works

- **3 users**: each signs in with their own email via a passwordless link; all 3 share one "household" doc via the join code.
- **Store categories**: Coles, Woolworths, Aldi, IGA, Indian Shop, Meat Shop, Costco are hardcoded presets (in `app.js`, `PRESET_STORES`) — no DB round trip needed. Custom stores can be added by writing to the household's `stores` subcollection (no button for it yet — say the word and I'll add one).
- **Grocery categories**: 16 preset categories (`CATEGORIES` in `app.js`), selectable when adding any item.
- **Bill photo → dashboard**: on the Spend tab, pick store/date, upload the photo. OCR (Tesseract.js, runs free in your browser) auto-detects the total; you confirm/edit it, then it saves to Firestore + the image to Firebase Storage. Dashboard shows monthly spend, spend by store, and a 6-month trend.
- **Pending → Done**: tap the circle next to any item to tick it off; it updates instantly for all 3 users via Firestore's real-time `onSnapshot` listeners.
- **WhatsApp nudge**: the green "Nudge via WhatsApp" button builds a message listing all pending items grouped by store, then opens WhatsApp with it pre-filled. Leave the phone field blank to pick any contact inside WhatsApp each time, or enter a number (with country code, e.g. `+61...`) to remember it and send straight to that person. No API keys, no cost — it's just a `wa.me` share link, so you still tap Send yourself inside WhatsApp.

## Known limitations (easy to improve later)

- Receipt OCR reliably extracts the **total** only, not itemized line items — receipt formats vary too much for simple text matching. Swapping in a vision-capable AI call (e.g. Claude) instead of Tesseract would enable per-item categorization if you want that later.
- No in-app button yet to add a custom store (e.g. a specific local shop) — quick to add.
- The WhatsApp button requires the person tapping Send inside WhatsApp — a fully automatic send (no tap) would need a paid WhatsApp Business API account (Meta or Twilio) with business verification and approved templates.

## Questions or want changes?

Bring this project back to me any time — custom store button, automatic WhatsApp Business sending, per-item receipt parsing, budgets/alerts, CSV export, etc.
