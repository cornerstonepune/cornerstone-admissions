# Glossary — Cornerstone Admissions

The words for getting a family from first enquiry to admission at Cornerstone. Use them exactly in code, tickets and UI.

## People

**Parent**:
The adult who enquires, identified by one phone number.
_Avoid_: customer, contact (in the UI), prospect

**Child**:
The child a lead is about: name, date of birth, grade, campus.
_Avoid_: student (they aren't one yet), kid

**Member**:
A person who can sign in to admissions, with a role in the account (owner, admin, agent, viewer).
_Avoid_: user (in the UI), agent (in the UI), account member

**Staff**:
School staff (kakas, didis) who only log walk-ins with quick-add.

## Leads

**Lead**:
One family's admissions journey for one child, from enquiry until Admitted, Lost or Dormant. One open lead per phone number. A lead is **open** until it is Admitted or exits.
_Avoid_: deal (in the UI), enquiry (that's a stage), prospect, opportunity

**Enquiry**:
The first stage: the parent has made contact and nothing is booked yet.
_Avoid_: lead (the lead is the whole journey)

**Stage**:
Where an open lead is: Enquiry, Visit booked, Visited, Deciding, Applied, Admitted.
_Avoid_: status, column, step

**Admitted**:
The last stage, reached when the fee is paid.
_Avoid_: won, enrolled

**Exit**:
How a lead closes without being admitted: Lost or Dormant.

**Lost**:
An exit the parent chose (said no, chose another school); always has a lost reason.
_Avoid_: rejected, dead

**Dormant**:
An exit for a parent who went quiet; gets one last message at day 75 and closes at day 90.
_Avoid_: cold, inactive

**Lost reason**:
Why a lead was lost, picked from a list kept in Settings.

**Stage history**:
The record of every stage a lead entered, and when.

**Days in stage**:
Days since the lead entered its current stage, counted from stage history.

**Source**:
Where an enquiry came from (WhatsApp, website, walk-in, referral call, or a named QR or link such as gate or Instagram).
_Avoid_: channel, origin

## Campuses and visits

**Campus**:
Neev or Gurukul. The child's date of birth decides which, by the cut-off in Settings.
_Avoid_: school, branch, centre

**Visit**:
A family's booked campus visit, made through Cal.com. A lead keeps every visit it has had (rescheduled, cancelled, no-show); its current visit is the latest one not cancelled or rescheduled.
_Avoid_: tour, appointment, meeting

**No-show**:
A visit the family booked and didn't come to.

## Daily work

**Today list**:
Lakshmi ma'am's day on one screen: who to call, who is visiting, who is stuck or untouched.
_Avoid_: dashboard, task list

**Call task**:
A call someone must make for a lead, created by a follow-up rule or a parent's reply; holds the call log once made.
_Avoid_: reminder, to-do

**Untouched**:
A lead with no action within the hours set in Settings; shown red. ("To be picked up" is this alert, not a stage.)
_Avoid_: to be picked up (as a stage), unassigned

**Stuck**:
A lead longer in its stage than the days set for that stage in Settings.
_Avoid_: stale, overdue

**Quick-add**:
The three-field form staff use to log a walk-in or call.

## Automation

**Welcome flow**:
The WhatsApp menu a parent gets on first contact: book a visit, call me back, send info.
_Avoid_: bot, chatbot (in the UI)

**Follow-up rule**:
A Settings row: in this stage, this many days after entering it, do this (send a template, create a call task, move to Dormant).
_Avoid_: automation (in the UI), sequence, drip

**Follow-up**:
One action a follow-up rule takes for one lead. Any reply from the parent pauses the lead's follow-ups.

**Template**:
A WhatsApp message approved by Meta, needed to message a parent more than 24 hours after their last message.
_Avoid_: canned message (that's a quick reply)

## Screen colours (wireframes, ADR 0014)

**Kind colours**:
Each kind of thing has one colour tag everywhere: a lead uses the `child` colour, a visit or campus the `period` colour, a call the `note` colour.
_Avoid_: inventing a new colour per screen
