# Family Shopping List — Setup Guide (Firebase)

Files: `index.html`, `styles.css`, `app.js`, `config.js`, `firestore.rules`, `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, and the **`icons/` folder** (contains `icons/tabler-icons.min.css` and `icons/fonts/tabler-icons.woff2`).
(`schema.sql` and `storage.rules` are leftover from earlier versions — ignore/delete them.)

Push all of these to your repo (including the icon files, `manifest.json`, and the whole `icons/` folder) so "Add to Home Screen" picks up the app icon correctly and the in-app icons (tick marks, tabs, buttons) actually render.

**Important (new):** the app's UI icons used to load from a third-party CDN (jsdelivr). That CDN turned out to be unreliable/blocked on at least one real device, which made every icon-only button (like the export/clear icons on the Spend tab) invisible with nothing to indicate they were even there. The icon font is now self-hosted in the `icons/` folder shipped with the app, so it no longer depends on any external CDN at all — make sure `icons/` (both the `.css` file and the `fonts/tabler-icons.woff2` file inside it) gets pushed to your repo along with everything else, or the icons will be missing again.

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

**Update (new — needed for the monthly budget feature):** `firestore.rules` now also allows a small `meta` collection (it stores the one shared monthly budget number so all 3 of you see the same value). If you've already published rules before, re-paste and re-publish `firestore.rules` once more — otherwise setting a budget will fail with a permissions error.

**Update again (new — needed for recurring items):** `firestore.rules` now also allows a `recurringItems` collection ("Milk every Sunday" etc.). Re-paste and re-publish `firestore.rules` one more time if you'd already published an earlier version — otherwise adding a recurring item will fail with a permissions error.

**Update again (new — needed for shopping list templates):** `firestore.rules` now also allows a `templates` collection (saved lists like "BBQ list"). Re-paste and re-publish `firestore.rules` once more if you'd already published an earlier version — otherwise saving a template will fail with a permissions error.

## 4. Deploy

Same as before — Netlify (drag-and-drop at app.netlify.com/drop, or connect your Git repo), or Firebase Hosting via the CLI. Once you have a live URL, add its domain to Firebase Console → Authentication → Settings → Authorized domains (still required, since Anonymous Auth is domain-restricted the same way).

## 5. First-time use

1. Open the URL — no sign-in step. First time on a device, it just asks "What should we call you?" (stored on that device only, no account).
2. You're straight into the shared list. Share the same URL with your other 2 family members — they each get asked their name once too, and everyone sees the same live list.

## How each feature works

- **3 users, no login**: one shared list per deployed link. Firebase Anonymous Auth runs invisibly in the background so Firestore's rules can require "signed in" without ever showing a login screen. Each person's name is just remembered locally on their device (tap "not you?" in the header to change it).
- **Store categories**: Coles, Woolworths, Aldi, IGA, Indian Shop, Meat Shop, Costco — hardcoded in `app.js` (`PRESET_STORES`). Want more stores added? Just ask.
- **Grocery categories**: 16 preset categories (`CATEGORIES` in `app.js`) selectable when adding any item.
- **Pending → Done, inline**: ticking a pending item expands it right there in the List tab to ask for the amount and who bought it (remembers past names in a dropdown, defaulting to you) — hit the checkmark and it's Done, no separate tab needed. "Cancel" backs out without saving. Done items still show a pencil to correct the amount/purchaser afterward.
- **Inventory tab**: a searchable catalog of ~120 common household items (grocery staples plus school/toddler essentials for an 11- and 3-year-old), grouped by category, each with a one-tap **Add** button — shows "In list" instead if it's already on your pending list.
- **Spend dashboard**: stat pills (pending count, bought-this-month count, this month's total, all-time total), a monthly budget bar, a 6-month spend trend line, a spend-by-store chart, a spend-by-category chart, and a recent-purchases list (now showing who bought each item).
- **Monthly budget**: tap the pencil on the Budget card in the Spend tab to set a shared monthly $ target — everyone sees the same bar, which turns amber near 80% and red once you go over.
- **Quick-add chips**: items you've bought at least twice show up as tap-to-re-add chips above the add-item form (skipped for anything already pending), remembering the category and store you used last time.
- **Item name autocomplete**: typing an item name you've added before will suggest it and auto-fill its usual category and store.
- **Recurring items**: add "Milk, every Sunday" once in the List tab's Recurring card, and from then on it's auto-added as a pending item once that weekday arrives each week — checked whenever anyone opens the app (there's no server-side clock on the free plan, so it triggers on next app-open on/after the day, not at an exact time). Tap the × on a chip to stop a recurring item.
- **Today's shopper**: a banner at the top of the List tab anyone can tap "I've got it" / "Take over" on to flag who's doing the shop. It doesn't auto-clear at midnight (no server clock), so it just shows the date it was last set.
- **Per-user avatars**: everyone's name gets a consistent colored circle + initial (derived from the name itself, no accounts needed) — shown in the header, the shopper banner, purchased-by/added-by, recent purchases, and the WhatsApp chat header.
- **Monthly spend summary**: once a new calendar month starts, the Spend tab shows a dismissible banner with last month's total, item count, and top stores, with a **Copy** button to paste into WhatsApp or email. Important: there's no way to make this *auto-send itself* to your family without a paid backend or WhatsApp's paid Business API — this gets it auto-drafted and ready, but someone still needs to open the Spend tab and tap Copy + paste once a month.
- **Inventory learns your habits**: any item name added 3+ times that isn't already in the built-in catalog automatically shows up in the Inventory tab too (tagged "Yours"), grouped by category — no setup needed.
- **CSV export**: the download icon next to "Recently bought" exports your full purchase history (name, category, store, amount, purchased by, date) as a CSV file you can open in Excel/Sheets.
- **Clear spend history**: the trash icon next to "Recently bought" permanently deletes every recorded purchase (handy for starting fresh each year) — export a CSV first if you want a copy, since this can't be undone.
- **Offline indicator**: a banner appears at the top of the screen if your connection drops, since the app doesn't cache data for offline use by design (avoids stale-data conflicts with the live shared list). It disappears automatically once you're back online.
- **List sort options**: a dropdown above the list lets you switch between Category (default, groups by aisle), Name (A-Z), Recently added, and Price (done items, highest first).
- **Item notes**: tap the notes icon on any item to add a short optional note (e.g. "get the discount brand" or "check use-by date") that shows under the item name.
- **Favoriting/pinning**: tap the star on any item (List tab) or catalog entry (Inventory tab) to pin it to the top of its category group.
- **Search purchase history**: a search box in the Spend tab searches your *entire* purchase history (not just the last 15), so you can answer things like "when did we last buy printer ink and how much was it."
- **Weekly spend digest**: same idea as the monthly summary, but a tighter week-by-week check-in banner — auto-surfaced each week once there's something to report, with its own Copy button.
- **Per-store budget caps**: in addition to the overall monthly budget, set a $ cap for individual stores (e.g. the Indian Shop) from the Budget card, so you can catch one store blowing out even if the total looks fine.
- **Shopping list templates**: save your current pending list as a named template (e.g. "BBQ list" or "Diwali list") from the List tab, then load it back in one tap next time instead of re-adding everything. Delete templates you no longer need.
- **WhatsApp nudge**: pick a scenario — Standard, Urgent, Weekly big shop, or Quick trip — and the drafted message's tone and wording adjusts to match. The message preview is now a colorful, grouped-by-store chat bubble (not just plain text) so it's easy to scan before copying. Tap **Copy message**, then paste it into any WhatsApp chat yourself.

## What changed from the very first version

- Dropped the email magic-link sign-in and household join-codes — too much friction for a 3-person family list.
- Dropped the bill-photo OCR scanning — replaced by simpler, more accurate per-item amount entry when marking something done.
- WhatsApp went from an auto-opening `wa.me` link to a plain copy-paste draft, then to a warmer auto-drafted nudge message with item/store counts and chat-bubble styling.
- Removed the separate Confirm-amounts tab — confirming an item's price and who bought it now happens inline in the List tab the moment you tick it.
- Navigation is now List / Inventory / Spend / WhatsApp top tabs.
- Added dark mode, empty-state illustrations, category grouping in the list, a loading skeleton, quick-add chips, name autocomplete, a spend trend chart, a shared monthly budget, an Inventory catalog, and a friendlier illustrated first-run screen.
- Added recurring items, a "today's shopper" banner, per-user colored avatars, an auto-drafted monthly spend summary, a self-learning Inventory catalog, and CSV export.

## Questions or want changes?

Bring this project back to me any time — more preset stores, weekly/yearly spend views, or anything else.
