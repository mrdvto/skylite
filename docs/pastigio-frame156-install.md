# Pastigio FRAME156 → Home HQ: install runbook

For someone who makes business calls only. Claude makes every technical call. You paste the prompts below, answer requirement questions, do the few hands-on steps.

Result: 15.6" frame shows your family dashboard: calendar, chores, shopping, weather. Family edits from phones; ticks work on panel.

Frame steps come from [pastigio-frame156.md](pastigio-frame156.md) (one record per tested unit).

## Have ready

- Frame, wall power, **short USB-A → USB-C data cable** straight into PC (no hub). C-to-C failed on a sister model. A power-only cable shows nothing on the PC, not even `unauthorized`: test the cable with a phone
- Windows PC with Claude desktop app, Code tab
- Password manager. Phone
- Guest / IoT Wi-Fi for frame (not main network)
- Answers to think about now: wall orientation (landscape = easy; portrait renders in a browser but is untested on this panel), who is on the panel, which calendars, store names, city, night hours

Don't join frame to Wi-Fi yet. Don't add photos. Don't set up Frameo beyond what Session 3 asks.

## Only you can do these

Claude can't create accounts, type passwords, or pass CAPTCHAs.

| You | When |
| --- | --- |
| Create Cloudflare + Todoist accounts; sign in to Cloudflare, Todoist, Google | Session 2 |
| Paste tokens into `.dev.vars` file (**never into chat**) and password manager | Session 2 |
| Click consent on Google screens | Session 2 |
| Turn on ADB Access on frame | Session 3 |
| Join Wi-Fi on panel | Session 4 |
| Router: block traffic to frame from other networks, client isolation on | Session 4 |
| Tick things on phone and panel | Session 4 |

## Prompts

Make empty folder `C:\home-frame`, open it in Code tab. One session per block, in order. New session each time. Between sessions you need nothing else: no "prompt for next session?".

**Session 1: PC prep, requirements (no frame, no accounts)**

```text
Clone https://github.com/mrdvto/skylite into this folder, then read docs/pastigio-frame156-install.md and follow "Rules for Claude". This is Session 1.
Do: install what's missing, build homehq.apk, create the private folder, ask me everything in "Grill list" (one question at a time, requirements only, recommend an answer each time, push back on vague answers, keep going until nothing is open), record answers, then write private settings and run the tests in "Built for this install". Commit at the end. Write the handoff.
```

**Session 2: accounts, calendar, deploy**

```text
Read skylite/docs/pastigio-frame156-install.md "Rules for Claude", then skylite/frames/pastigio-frame156/handoff.md. This is Session 2.
Take me through Cloudflare, Todoist and Google. Open each site in the browser and read the real page before telling me where to click; I do sign-ins and account creation, you do the rest. Secrets go in dashboard/.dev.vars, which I fill in myself; never ask me to paste one in chat. Deploy, then prove the live site works on real data in a PC browser. Commit at the end. Write the handoff.
```

**Session 3: the frame (plug in first: USB + wall power)**

```text
Read skylite/docs/pastigio-frame156-install.md "Rules for Claude" and "Frame plan", then skylite/frames/pastigio-frame156/handoff.md. This is Session 3. The frame is plugged in.
I approve all frame writes in the Frame plan for this session, no need to ask per step. Record each undo in changes.jsonl first. Stop and ask me only on a stop condition, or when I must touch the panel. Commit at the end. Write the handoff.
```

**Session 4: Wi-Fi, proof, finish**

```text
Read skylite/docs/pastigio-frame156-install.md "Rules for Claude" and "Finish plan", then skylite/frames/pastigio-frame156/handoff.md. This is Session 4.
I approve the frame writes in the Finish plan. Tell me when to join Wi-Fi. Walk me through the phone and panel checks. Commit at the end and give me a one-page summary of what's running, what it costs, and what to do if it breaks.
```

**Resume (session died, or came back later)**

```text
Read skylite/docs/pastigio-frame156-install.md "Rules for Claude" and skylite/frames/pastigio-frame156/handoff.md. Tell me in 3 lines where we are, then continue.
```

**Stuck**

```text
Stop. Tell me what you expected, what happened, and what you need from me in one line. Check the page or device before answering.
```

**Later changes** (new chore view, new store, etc.)

```text
Read skylite/frames/pastigio-frame156/handoff.md. I want: <what it should do, in plain words>. Make the technical calls, test, deploy, and prove it on the frame.
```

## Normal, don't worry

- Phone tick → panel: up to 60 s. Panel tick → phone: about 1 s. Calendar change: up to 2 min
- Panel black 8:30 PM–6 AM by default. Tap wakes it
- After a reboot, PC may not see frame until USB replugged. Panel itself is fine
- Frameo looks involved at first: it's the stock app, needed only to switch ADB on, then disabled
- Not every frame matches: at least one reports model `M15R4`, has older firmware and ships WebView 61. You can't tell before Session 3. It adds one decision for you, and maybe a backup: see [WebView under 106](#webview-under-106)
- Google warns "app not verified": it's your own app. Advanced → continue

---

# Rules for Claude

**Owner**
- Owner answers requirement questions only. Technical calls are yours; state them, don't ask. One question at a time
- First line of any reply needing the owner: what they must do, and where. Never leave them waiting on an invisible prompt
- Long job: give time estimate up front
- Commands for owner: name the shell. PowerShell blocks `npx`/`npm`, use `npm.cmd`/`npx.cmd`; `.ps1` via `powershell -ExecutionPolicy Bypass -File`. Run things yourself first; hand over only what truly needs them (`wrangler login`, filling `.dev.vars`)

**Web consoles**
- Never give click paths from memory. Cloudflare and Google menus move; stale steps cost hours. Open built-in browser, read the live page. If Google refuses sign-in there, ask to use Chrome. Don't type credentials

**Records**
- Private folder next to `skylite`, any name, own git repo, never in public fork. Holds `frames/` and `dashboard/`. Start `dashboard/settings.json` from `dashboard/worker/settings.example.json`. Layout: [frame-records.md](frame-records.md)
- Link it in from `skylite` with `cmd`, no admin needed, both git-ignored: `mklink /J frames <full path of private folder>\frames`, then `mklink /J dashboard\private <full path of private folder>\dashboard`. Sessions reach it through these links, so its name is never needed
- Frame folder `frames/pastigio-frame156/`: `checklist.md`, `handoff.md`, `changes.jsonl`, `SETUP.md`
- Handoff: plain file, no skill needed. End of every session, overwrite `frames/pastigio-frame156/handoff.md`. Never OS temp, never repo root. Written for a new session with no memory: where things stand, what is proven and how, what is not done, exact next step, owner decisions made, problems hit and the fix, file and URL names (never secrets)
- Commit at end of each session without asking. Push the private folder only if it has a private remote. Never push to `mrdvto/skylite` or upstream
- Requirements go in `checklist.md` before code. `changes.jsonl` written with `json.dumps`, each line checked

**Secrets**
- Only in `dashboard/.dev.vars` and `.dev.vars.frame` (git-ignored; copy each from its `.example`), password manager, Worker secrets. Read inside scripts, never print. Names only in chat and records
- Nothing personal in public fork: names, calendar ids, Worker URL

**Quality**
- `/code-review` on new code. `/security-review` on Worker or kiosk request handling changes, before deploy
- Test locally first at the panel's real size. Real frame proof = screencap, not assumption

**Already decided (don't reopen)**
- Separate household: own Cloudflare, Todoist, Google. Real Google account, no frame account
- **No full backup, no WebView swap.** Stock WebView 106 meets the build target (`chrome106`). Price of that: no `/system` or partition writes, ever, in this install. Holds only if the frame has WebView 106 or newer. If not, [WebView under 106](#webview-under-106) is the owner's call
- Todoist: one family account signed in on phones, unless owner wants otherwise. No per-person sharing
- Nothing stored on Cloudflare. Observability off, preview URLs off (both in `wrangler.jsonc`; don't toggle in dashboard)
- Panels default to: Today, Calendar, Chores, Shopping, Weather. Owner may change anything in grilling

## Grill list (Session 1)

Mount orientation (push landscape). Who has a column. Which calendars show, and display name for each. **Full event titles on a kitchen wall OK?** (real account = private events show in full). A calendar for whole family? Chores: whose, shared list? Store tabs. City. Night hours. Who gets browser access (email list). Family on one Todoist login OK?

Ask early, not mid-build: routines and sharing are costly to redo once built.

## Built for this install

All in repo, tests pass on PC. Never run against a real Google account, real Access, or a real frame: proofs below are part of the install. `npm test` and `python kiosk/test-access.py` from `dashboard/`.

**B1 Google token.** `npm run google-token` from `dashboard/`. Replaces OAuth Playground. Needs Desktop client id + secret in `.dev.vars`. Writes `GOOGLE_REFRESH_TOKEN` there, prints no secret. Proof (Session 2): prints exactly the 2 scopes.

**B2 Service token in kiosk.** No email + PIN on panel, no monthly sign-in. New Cloudflare accounts are in strict mode: can't turn off, no session cookie. So kiosk makes every request to the dashboard itself, with token headers. POST bodies travel in `x-hq-body`, set by page. Token goes only to origin saved at the time; never in APK, URL, or page JS. Details: [kiosk README](../dashboard/kiosk/README.md#cloudflare-access-without-a-sign-in).
- `scripts/set-kiosk-access.sh` saves URL + token together. Reads `dashboard/.dev.vars.frame`. Token works only for dashboard page itself, not Wi-Fi sign-in pages or other apps' links
- Proof (Session 3): panel loads with no typing, after reboot too. Proof (Session 4): shopping add with an accent or Chinese character, from panel
- Refused token: panel says so, tries again every 5 min
- If proofs fail after one real try: `set-kiosk-access.sh --clear`, use PIN sign-in, tell owner. Re-sending `--es url` reopens email page after a typo; Back only closes keyboard

**B3 Calendar allow-list.** `calendars` in private settings: `[{ "match": "<id or Google name>", "name": "<shown name>" }]`. Shows only these, ticked or not, in that order; owner's own Google Calendar view unaffected. Primary calendar's id is the email, so give it a `name`. Absent = every ticked calendar. Todoist person labels must match shown name. `familyCalendar` too. Proof (Session 2): `/api/calendar` lists exactly these.

Layout checked in browser on mock at 1920×1080 and 1080×1920: fills screen, nothing cut off. Density and touch still to prove on frame.

## Cloud gotchas (Session 2)

**Order:** Cloudflare → Todoist → Google → deploy → PC browser proof. Frame then gets final URL once; skip bundled first-look.

Cloudflare
- Skip dashboard "Create" screen. Wrangler creates Worker on deploy. Pick workers.dev subdomain
- Passkey or 2FA. Backup codes outside password vault
- Access app on workers.dev host, scope **All traffic**. Login: One-time PIN only, instant auth on. Include = Emails
- Session 1 month: quick setup caps at 7 days, full app settings allow it
- PIN silently not sent to any address outside policy. Owner's address must be in policy before testing. Don't change Cloudflare profile email mid-setup
- Prove: outside email gets no PIN; unsigned request → 302
- Service token: longest duration offered, tell owner the expiry date; alert comes a week before. Policy action **Service Auth** or Access asks for a login. `DASHBOARD_URL`, client id + secret go in `dashboard/.dev.vars.frame`, not `.dev.vars` (that one uploads to Worker). To cut a frame off: **delete** the token; "Revoke existing tokens" alone doesn't stop it
- Separate Allow policy (One-time PIN, Emails) for browsers. Docs don't say how that behaves beside Service Auth in strict mode: prove a browser still signs in. If not, frame keeps working; tell owner browser access is out
- Worker secrets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`
- After every deploy: `npx wrangler deployments list` shows new version. A deploy can fail to land
- `wrangler secret bulk .dev.vars`, check with `secret list`
- `.dev.vars` holds production `ACCESS_AUD`; local npm scripts blank it. Two `wrangler dev` runs collide (port, SQLITE_BUSY)

Todoist
- Projects exactly `Chores`, `Shopping`. Stores = sections of Shopping (add section: bottom of project list view, or ⋯ menu; check live). Person = label matching calendar display name, no label = Anyone
- Token: Settings → Integrations → Developer. Free plan works
- Claude's test tasks get deleted after checks

Google
- Sign in as real account. Project → enable Calendar API → Google Auth Platform: Branding, Audience **External**, Data Access: the 2 scopes
- **Publish to production**, skip verification. Still in Testing = "Access blocked", and tokens die in 7 days
- Client type **Desktop app**. Client id + secret into `.dev.vars`, then `npm run google-token`
- Workspace account: admin may block. Tell owner, ask for a personal account
- Tell owner how to revoke: myaccount.google.com/permissions
- Token can read every calendar on that account. Say so once

Verify on real data: Today, Calendar views, Chores, Shopping, no console errors, `mock: false`.

## Frame plan (Session 3)

Sources: [pastigio-frame156.md](pastigio-frame156.md), [kiosk README](../dashboard/kiosk/README.md). Git Bash mangles `/data/...` in adb args: `MSYS_NO_PATHCONV=1`.

Frame stays offline for this whole session. It may already be online when first read, even if nobody joined it this session: check Wi-Fi in step 3. On the guest network = leave it connected, and step 3 covers the updater. Not guest, or can't tell = `svc wifi disable` at once, tell owner, and note in the handoff that Session 4 must forget that network when joining guest.

1. **Owner on panel:** Frameo Settings → off "transfer from computer" → About → Beta Program → ADB Access on, accept warning. Turn off any sleep schedule. If first-run insists on Wi-Fi, use guest Wi-Fi; Claude then disables `com.muxintu.app.mxota` as soon as step 3 has read model and WebView. Don't tap power off
2. `unauthorized`? In order: accept on-screen warning; ADB Access off/on with USB in; `adb kill-server`, `adb start-server`; other USB port. Use current platform-tools. Stop any other adb (SuperDisplay etc). Nothing listed at all, not even `unauthorized`: cable or port, not the frame; swap cable and test it with a phone. Match on product `FRAME156` or `M15R4`; vendor ID varies
3. Read only, into `SETUP.md`: model, firmware, Android, display, density, WebView, `su -c id`, packages, listening ports, timezone, Launcher3 state, Wi-Fi state. Check model and WebView before any write. If model is `FRAME156` (or `M15R4` once owner has OK'd it, see stop conditions) and the frame is online, the first write is `pm disable-user --user 0 com.muxintu.app.mxota`
4. `svc power stayon true` (frame idles off otherwise)
5. Install `homehq.apk`. Keep the debug keystore: `install -r` needs same key
6. `--ez home true`, then `cmd package set-home-activity com.wesbos.homehq/.Home`. Order matters
7. Density per README. Orientation: landscape default; portrait = `--es orientation user`, lock rotation (natural is landscape here, so `user_rotation` 1 or 3), check touch in 4 corners
8. `scripts/set-kiosk-access.sh`: URL + service token in one step (B2)
9. Nav service if no nav bar. Don't make app device owner
10. **Owner on panel:** two fingers held 1.5 s, an inch apart → Android settings opens, way back works. Must pass before step 11
11. `pm disable-user --user 0` for `com.muxintu.app.mxota` (if not already off) and `net.frameo.frame`. Confirm ADB doesn't need Frameo first (`adb_enabled` = 1)
12. **Wait 30 s, check** `package-restrictions.xml` shows `enabled="3"` before reboot. Immediate reboot undid this on one unit. Same delay for Home alias
13. Reboot. No adb in 150 s: ask owner to replug USB at frame end. Confirm kiosk is Home, both apps off

Undo: `pm enable <pkg>`, `adb uninstall com.wesbos.homehq`, `wm density reset`, `svc power stayon false`, `--ez home false`.

**Stop conditions, ask owner:** not `FRAME156` (`M15R4` on `rk3326`, Android 8.1 and firmware `FrameO.DP105F.*` has matched so far, one unit: tell owner, get an OK once). WebView under 106. Still `unauthorized` after step 2. Anything needing `/system`, Loader mode, a partition write, or key injection. (If so, offer pre-userdata backup first: about 10 min, method in record. Run `svc power stayon true` before it starts, because step 4 hasn't happened yet and the frame idles off. Then owner decides.)

### WebView under 106

Firmware `v2025052119` shipped WebView 61; the dashboard build target is `chrome106`. The Session 3 prompt doesn't approve what follows. Tell owner the options, get a clear yes to the one chosen.

- **Exchange the frame.** Lowest risk, if returnable. A replacement may be the same firmware
- **Build the dashboard for the older WebView.** No risky write to the frame. Never tried: it may not work or may look wrong, and then one of the other two is still open
- **Replace WebView in `/system`.** Done once on `M15R4`; steps, traps and undo in the [record](pastigio-frame156.md#fifth-unit-m15r4-firmware-v2025052119-webview-61-2026-11-09). Reverses "no `/system` writes" for this frame only. Verified pre-userdata backup first. Restore needs Loader mode, untested

Claude's notes, not owner options:
- Older build: set the JS `target` in `dashboard/vite.config.js` to `chrome61`, for this install only (CSS is already `chrome61`). It rewrites syntax only: missing browser functions stay missing (see [building-for-the-frame.md](building-for-the-frame.md)), and flex `gap`, which needs Chrome 84, isn't converted. Prove it on the panel before calling it done
- `/system` swap: target LineageOS WebView **106.0.5249.126**, the build target. 138 is the newest Android 8.1 can run, not needed here
- A normal `adb install -r` of a new WebView is expected to fail: vendor-signed

## Finish plan (Session 4)

1. **Owner:** two-finger hold → Wi-Fi settings → join guest Wi-Fi
2. Check clock, timezone. Wrong time on panel: check dashboard demo mode before blaming frame. Dashboard loads, no typing. TLS error on workers.dev = old CA store: see [building-for-the-frame.md](building-for-the-frame.md)
3. **Network ADB check,** on frame over USB and from PC: ports 5555 and 9815. Another frame shipped unauthenticated root on 9815, seen only after Wi-Fi. Open = close it without `/system` (`setprop`, restart adbd), recheck after reboot. Won't stick = stop condition; router isolation becomes mandatory
4. **Owner:** router rules. Frame needs out: DNS, HTTPS, NTP only
5. Prove with owner, both directions: chore tick, untick, shopping tick, add, Put back. Panel add must include an accent or Chinese character (B2 proof). Recurring chore: phone tick can take 60 s
6. Prove a redeploy reloads panel unaided once idle (about 1 min)
7. Reboot: back to dashboard, data live, ADB state unchanged
8. Unplug USB. Leave `stayon` on. Summary for owner: URLs, accounts, how to revoke Google, service token expiry date and how to delete it, what "Offline since" and "Sign in needed" mean, resume prompt

Parked unless owner asks: OS upgrade, WebView upgrade, photos, Home Assistant, backlight off at night (page goes black, backlight stays on; `setDim` bridge unbuilt).
