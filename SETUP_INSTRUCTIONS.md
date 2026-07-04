# Family Shopping List — Setup Guide (Firebase)

Files: `index.html`, `styles.css`, `app.js`, `config.js`, `firestore.rules`, `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.
(`schema.sql` and `storage.rules` are leftover from earlier versions — ignore/delete them.)

Push all of these to your repo (including the icon files and `manifest.json`) so "Add to Home Screen" picks up the app icon correctly.

This build has no login, no household codes, no Storage — everyone with the app link shares one list, and it runs entirely on the free Spark plan. No credit card, ever.

## 1. Firebase project

Already done — `config.js` has your real project values (`sandy-shoppinglist`).

## 2. Enable Anonymous authentication

The app signs every visitor in invisibly (no screen, no click) using Firebase's Anonymous Auth, just so Firestore's security rules have something to check. To turn it on:

1. Firebase Console → **Authentication** → **Sign-in method**.
2. Click **Anonymous** in the provider list → toggle **Enable** → **Save**.

(You can leave Email/Password and Email link off now — they're no longer used.)

## 3. Firestore rules

1. **Firestore Database** → **Rules** tab.
2. Select all the existing text, delete it, paste in the entire contents of `firestore.rules`, then **Publish**.

This replaces the earlier household-based rules with a much simpler single-collection rule set. If you'd already published the old version, this update is required for the new app to work.

## 4. Deploy

Same as before — Netlify (drag-and-drop at app.netlify.com/drop, or connect your Git repo), or Firebase Hosting via the CLI. Once you have a live URL, add its domain to Firebase Console → Authentication → Settings → Authorized domains (still required, since Anonymous Auth is domain-restricted the same way).

## 5. First-time use

1. Open the URL — no sign-in step. First time on a device, it just asks "What should we call you?" (stored on that device only, no account).
2. You're straight into the shared list. Share the same URL with your other 2 family members — they each get asked their name once too, and everyone sees the same live list.

## How each feature works

- **3 users, no login**: one shared list per deployed link. Firebase Anonymous Auth runs invisibly in the background so Firestore's rules can require "signed in" without ever showing a login screen. Each person's name is just remembered locally on their device (tap "not you?" in the header to change it).
- **Store categories**: Coles, Woolworths, Aldi, IGA, Indian Shop, Meat Shop, Costco — hardcoded in `app.js` (`PRESET_STORES`). Want more stores added? Just ask.
- **Grocery categories**: 16 preset categories (`CATEGORIES` in `app.js`) selectable when adding any item.
- **Pending → Confirm amount → Done**: ticking a pending item moves it to the **Confirm amounts** tab (badge shows how many are waiting). There, you type in what it actually cost and hit Confirm — that's what finalizes it as Done and feeds the Spend dashboard. "Back" on that screen returns it to Pending if you ticked by mistake.
- **Spend dashboard**: stat pills (pending count, awaiting-price count, this month's total, all-time total), a spend-by-store chart, a spend-by-category chart, and a recent-purchases list — all built directly from the amounts you confirm, no receipt scanning needed.
- **WhatsApp nudge**: the WhatsApp tab shows a ready-to-send message listing all pending items grouped by store, auto-updating as your list changes. Tap **Copy message**, then paste it into any WhatsApp chat yourself.

## What changed from the very first version

- Dropped the email magic-link sign-in and household join-codes — too much friction for a 3-person family list.
- Dropped the bill-photo OCR scanning — replaced by simpler, more accurate per-item amount entry when marking something done.
- WhatsApp went from an auto-opening `wa.me` link to a plain copy-paste draft — more reliable, works the same on every device.
- Navigation moved from a bottom nav to top tabs (List / Confirm amounts / Spend / WhatsApp), with a Confirm amounts badge showing how many items are waiting on a price.

## Questions or want changes?

Bring this project back to me any time — more preset stores, editing an item's price after the fact, weekly/yearly spend views, export to CSV, etc.
