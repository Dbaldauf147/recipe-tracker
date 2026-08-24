# Mirroring Prep Day into Outlook without the invite junk

If you want your planned workouts, saunas and cooking to show up in Outlook,
**subscribe Outlook to the Prep Day calendar's feed. Do not put your Outlook
address in the "Invite guest" box.**

This document explains why, and how to switch.

## Why the guest field is the wrong tool for this

`calendarSyncSettings.guestEmail` adds one standing guest to every event the
hourly cron writes (`api/sync-workout-calendar.js`). That is a real Google
Calendar *invitation*: Google emails an `.ics` to the address, and the
recipient's mail client turns it into a calendar item.

That works fine for a person you actually train with. It works badly for your
own Outlook mailbox, for three reasons that compound:

**1. The plan is re-derived every hour, and it churns.** The cron runs at `:30`
every hour (`vercel.json`). `resolveWorkoutPlan` ranks workout types by
staleness, so logging a workout on Tuesday reshuffles Wednesday through
Saturday. Every reshuffle is a diff against the calendar.

**2. A category change is a delete plus a create, not a rename.** Events are
keyed `${date}|${kind}` where `kind` is the workout's *category*
(weights/cardio/yoga). When Thursday flips from weights to cardio, the old key
disappears and a new one appears — so the sync deletes one event and creates
another. The create carries `sendUpdates=all`, which means a fresh invitation
email lands in Outlook every time the plan shifts a day between categories.

**3. Silent deletes orphan the Outlook copy — permanently.** Deletes go out with
`sendUpdates=none`. The code comment there says:

> The guest's copy still disappears; Google removes it from their calendar
> either way.

**That is only true for a guest whose calendar is Google.** Outlook/Exchange has
no shared event object with Google — the Outlook item exists *solely* because of
the invitation email. With `sendUpdates=none` no cancellation is ever sent, so
Outlook never learns the event is gone and the row sits there forever.

And the sweep is aggressive: the sync lists events from 28 days back
(`listStart`) while `desired` is only ever built from today forward, so at every
Eastern midnight *yesterday's* workout, sauna and cooking events are all
deleted. Before deletes were made silent, that was a batch of "Cancelled"
notices every night — which is what the `Canceled:` rows are. After deletes were
made silent, it became a batch of permanent orphans instead. Neither is what you
want.

The short version: an invitation models "a person needs to know about a
meeting." You are using it as a one-way data feed for a plan that rewrites
itself hourly. The mechanism can't win.

## The fix: subscribe Outlook to the calendar instead

An ICS subscription is a *pull*. Outlook re-reads the whole Prep Day calendar on
a schedule and makes its copy match — additions, moves and removals all just
happen. No email, no invitations, no cancellations, no orphans. The hourly churn
becomes completely invisible.

### Step 1 — stop inviting yourself

On the Week Plan page, open the calendar settings panel and **clear the
"✉️ Invite guest" box** (if it holds your Outlook address).

Clearing it does useful cleanup on its own. The next sync sees `prevGuest` on
each event, removes you as an attendee, and — because attendee changes always
notify — Google mails Outlook a proper cancellation for each one. That clears
out the future events.

**Past-day events are not cleaned up this way.** They were already deleted
silently, so no sync will ever touch them again. Delete those rows in Outlook by
hand once; nothing will re-create them.

### Step 2 — get the Prep Day calendar's private feed address

1. Open [Google Calendar settings](https://calendar.google.com/calendar/r/settings).
2. In the left sidebar under **Settings for my calendars**, click **Prep Day**.
   (The Week Plan panel shows the calendar's ID if you need to confirm you have
   the right one.)
3. Scroll to **Integrate calendar** and copy the **Secret address in iCal
   format** — it ends in `.ics`.

Treat that URL as a password: anyone holding it can read the calendar. If it
leaks, hit **Reset** on that same settings page.

### Step 3 — subscribe Outlook to it

**Outlook on the web / Microsoft 365:**

1. Calendar → **Add calendar** → **Subscribe from web**.
2. Paste the secret `.ics` URL, give it a name (e.g. `Prep Day`), pick a colour,
   and **Import**.

**Classic Outlook desktop:** the same subscription is easiest to add in Outlook
on the web — it then syncs down to the desktop client automatically.

Outlook refreshes subscribed calendars on its own schedule (typically every few
hours, and not configurable). That lag is fine here: the plan is for *this* week
and next, so nothing depends on minute-level freshness.

## What the sync does about the churn itself

The subscription above makes the churn invisible to Outlook. Separately, the
cron now works harder to not churn in the first place — which matters for the
Google calendar itself, and for any real person you invite. Four mechanisms, in
`api/sync-workout-calendar.js`:

**No-op runs don't run.** `planDigest` fingerprints everything the diff would
write — every desired event's key, title and times, plus the guest and calendar
id. When it matches what the last run stored on the user doc
(`calendarSyncDigest`), the run skips Google entirely. The plan only actually
moves when you log something, edit the week or change the timings, so most of
the 24 daily runs now touch nothing at all.

Two escape hatches keep that honest: `todayStr` is part of the digest, so a new
day always forces a full pass (that's what sweeps yesterday), and
`RECONCILE_EVERY_MS` (6h) bounds how long an edit made by hand in Google can go
unnoticed before a full reconcile puts it back.

**A category flip is now a patch, not a delete plus a create.** This was the big
one. `planEventReuse` matches a newly-planned workout to a same-day event that
was otherwise headed for deletion, so Thursday going weights → cardio patches
the event in place — keeping its event id, and costing at most one "moved"
notice instead of a cancellation plus a fresh invitation. Adoption only ever
happens between workout categories: a dropped sauna is never quietly recycled
into a lift.

**Today is pinned.** `pinnedDate` freezes today's events. Two things drove this.
`resolveWorkoutPlan` puts today in `autoSlots`, so an unlogged today was
re-picked on every hourly run — a day that reads "Push" at 9am and "Pull" at 2pm.
And worse: the moment you *logged* today's workout, today landed in
`recordedIdxs`, dropped out of `autoSlots`, and so fell out of the desired set
entirely — which deleted the calendar event for the workout you had just
finished. Pinning is identity-only: a pinned event is never retitled, re-keyed
or deleted, but a kind with no event at all is still created, and an existing one
is still re-timed when you change the timing settings.

**Deletes notify only when they're news.** A *future* event coming off the plan
(a day dropping to rest, a sauna or cook day removed) is something a guest can
act on, so that now sends a proper cancellation — which also means a non-Google
guest's copy is actually removed rather than orphaned. Past-day sweeps stay
silent, since mailing someone about a workout that already happened is pure
noise.

## What this does not change

The Prep Day calendar in Google still updates hourly, and the churn described
above still happens there — days still get retitled, re-timed and re-keyed as
you log workouts. That churn is now just invisible, because a subscribed
calendar has no notion of an invitation to send.

If you later invite a *real* person (someone you actually train with), the
remaining churn becomes visible to them — but it is now mostly the churn that
deserves to be: an event genuinely moving, or a day genuinely coming off the
plan. Retitles, re-categorizations and past-day sweeps no longer reach their
inbox at all.

One caveat stands for a guest on Outlook/Exchange rather than Google: past-day
sweeps are still silent, so those copies are still orphaned rather than removed.
That is deliberate — the alternative is mailing them a cancellation every night
for a workout that already happened — and it is the reason your *own* Outlook
should be on the subscription above rather than in the guest field.
