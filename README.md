For the low-time warning sound: Chess.com plays that sound through its own audio pipeline, which an extension can only hook into unreliably (the hook breaks whenever they change their bundler). How should I make it adjustable?

Vomnibar

known limitations at the moment: chess board flip is not detected

let's migrate to <button onClick={} onMouseDown>   </button>
https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.tabs-manager
# Bell Bearer

It's hard to keep up with newly published videos from all of your youtube's subscribed channels. A better way to organize is to tag channels of similar focus. So, you can occasionaly visit a dedicated dashboard to consume different area of your interests at your own pace. YouTube lacks all the good features a poweruser can benefit from, I have a roadmap to streamline YouTube experience for the power users.


## Features

- **Checkpoint Creation**: Hold Ctrl+B to create checkpoints while watching YouTube videos
- **Reader**: YouTube's own player beside the video's transcript — highlight a passage to keep it, and write a note against it
- **Visual Feedback**: Snappy notifications for bookmark duration
- **Bookmark Management**: Clean interface to view and manage all bookmarks
- **Quick Navigation**: Jump to the bookmarked timestamp with a single click
- **Playback Control**: One speed ladder, stepped by the keyboard or by the popup, held against sites that reset it
- **Persistent Storage**: Persist Bookmarks across browser sessions
- **Import/Export**: One file with every setting and all saved data, from the dashboard header
- **Topics overlay**: A frosted sheet over YouTube — topic rail, thumbnail grid, time range and sort
- **X pouch**: People and posts filed into two independent sets of topics, from x.com and managed on the dashboard
- **Skim**: A launcher over any page — find within it, reach a tab, your history or a browser action, and label every link for the keyboard
- **Skins**: Default, Riso Paint, Medieval and Art Deco, each with its own day and night
- **Activity**: Opt-in, on-device record of where your screen time goes
- **Daily time limit**: A budget, or a window of hours, on any site you name — counted while you are actually looking at it, snoozable ten minutes at a time
- **Rosters**: Who you follow on Twitter and the subreddits you have joined, out to a text file and back in again, slowly
- **Chess.com and Lichess**: Games, time management and time at the board; a clock warning and moves read aloud while you play
- **Watch party**: A YouTube video or a Netflix episode in sync with other people, each on their own account — through a server, your own relay, browser-to-browser codes or public trackers — with a chat beside the player
- **LeetCode**: Each problem timed on LeetCode's own stopwatch, submissions recorded from its own traffic, an FSRS-5 review schedule graded in one click, your notes and code templates on the page, and a mock-interview mode that hides the hints
- **TypeRacer**: Every race logged from the keystrokes themselves — the letter pairs you stall on, the characters you reach for wrongly, and what correcting them costs you in words per minute — plus a typing caret and a synthesised key sound
- **Reward System**: Track watch credits to spend them on popcorn for later

Export and Import sit in the dashboard header, beside the theme button, and
"clear all" above the saved videos. The popup header is Dashboard alone, so the
row never has to shrink or scroll.

**Settings › Appearance › Popup size** picks how much room the popup asks for:
*Wide* puts the video list and its checkpoints side by side, *Compact* shows one
column and drills in when you pick a video.

The pouch sheet opens from **Pouch**, third in YouTube's left drawer under Home
and Shorts, or from the pouch button beside Subscribe. The drawer row wears the
extension's icon and takes its metrics and type from YouTube's own rules, so it
lines up with Home and Shorts to the pixel. Only the full drawer gets the row —
the collapsed icon rail is a different renderer and is left alone.

The sheet opens on what it already has and fills in behind you: feeds are pulled
down in the background while you browse YouTube, cached to disk so a restart
starts warm, and fetched a few at a time so a pouch with hundreds of channels
draws its first row immediately instead of waiting for its slowest feed.

Down the rail, **All** covers the channels you have filed. The **Subscriptions**
switch under it widens that to every channel the account follows, read once from
your own subscriptions page and cached. Videos you have already watched drop out
of **All** — opening one from the sheet counts, and so does a minute of playback
on YouTube itself. Inside a topic nothing is hidden: a topic is a shelf you go
back to, and a hole in it reads as something having gone missing.

### Playlists

YouTube will tell you when a channel uploads. It will not tell you when
something is added to a playlist, which for a course, a label's releases or a
friend's mix is the only event that matters. **Follow** in a playlist header —
on the playlist page, or on the queue panel while watching from one — puts that
playlist's new entries in a strip at the foot of the pouch sheet. What the
playlist already holds when you follow it is not reported as new.

## Keyboard shortcuts

Shortcuts work on any site with a video, not just YouTube, and are ignored
while you are typing in a field.

| Keys | Action |
| --- | --- |
| Hold `Ctrl + B` | Create a checkpoint over the passage you held it for |
| `Ctrl + Shift + S` | Mark a segment start; press again to mark its end |
| `Ctrl + Alt + R` | Open or close the reader on a YouTube video |
| `←` / `→` | Shorts: skip back / forward within the short — off until **Settings › YouTube** turns it on, and only ever on a Shorts page |
| `Alt + 1…9` | Skip forward that many seconds |
| `Shift + 1…9` | Skip back that many seconds |
| `Ctrl + Shift + 1…9` | Temporary 3x boost for that many seconds |
| `>` | Next speed step |
| `<` | Previous speed step |
| `+` | Back to 1x |
| `Ctrl + Shift + L` | Copy the page as a Markdown link (rebindable at `chrome://extensions/shortcuts`) |
| `Shift + F` | Skim: find within this page |
| `Shift + H` | Skim: search your browsing history |
| `Shift + A` | Skim: search the actions it can run |
| `Shift + L` | Label every link and button in view |
| `Shift + P` | Open the pouch — the sheet on YouTube, the panel on x.com, the sheet on leetcode.com — or the chat panel on chatgpt.com and claude.ai |
| `Ctrl + Alt + J` / `K` | ChatGPT and Claude: jump to the next / previous prompt |
| `Ctrl + Alt + P` | ChatGPT and Claude: pin the message you are reading, or unpin it |
| `Ctrl + Alt + I` | ChatGPT and Claude: insert a prompt template, or save what is in the box as one |
| `Ctrl + Alt + Q` | ChatGPT and Claude: queue what is in the prompt box behind the answer being written |
| `Ctrl + Alt + T` | LeetCode: offer a code template at the cursor, or save the selection as one |
| `Ctrl + Alt + M` | LeetCode: start or end a mock interview on this problem |
| `Ctrl + Alt + C` | TypeRacer: cycle the typing caret — bar, block, underline, outline, or the site's own |

Speed steps through one fixed ladder — 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
2.25, 2.5, 3, 3.5, 4, 5 — and the popup's buttons step the same ladder, so the
two controls always agree. When a site resets the rate (a new video, an ad
break) the speed you picked is re-applied; when *you* change it through the
site's own speed menu, that becomes the new setting instead. Turn the re-apply
off with **Keep my playback speed** in Settings.

The two LeetCode shortcuts and the TypeRacer one are `Ctrl + Alt` rather than a
bare letter, and they have key handling of their own rather than going through
the table above. All three are meant to work with the caret inside a field — the
LeetCode editor, the TypeRacer input box — which is the one place the "ignored
while you are typing" rule is built to cover. On TypeRacer that is not a corner
case but the whole of it: every bare letter there is a letter you meant to type.

`Shift + P` is off until **Settings › General › Pouch shortcut** turns it on,
for the same reason Skim and the link hints are: a bare-Shift letter is a large
claim to make on somebody's keyboard without telling them first. It does nothing
anywhere but YouTube, x.com, leetcode.com, chatgpt.com and claude.ai, so on every
other site the key stays a plain capital P. On the two chat sites that includes the prompt
box: with the caret in it, `Shift + P` types a P, and the panel is the button in
the chat's header.

The five chat keys are `Ctrl + Alt` for the LeetCode keys' reason, and more
so: a chat site's prompt box has the focus nearly all the time. `Keybindings.conflicts`
is checked across every site at once, so C, M, R and T were already taken; and
`Ctrl + Alt + arrows` rotate the screen on a lot of Windows laptops. On Windows
`AltGr` is `Ctrl + Alt` as far as a keystroke can tell, and it is how half of
Europe types — `AltGr + Q` is `@` on a German keyboard — so a keystroke that
produced a symbol, or that the browser says had AltGraph down, is left to the page.

## The reader

Checkpoints used to be recorded blind: hold `Ctrl + B`, let go, and whatever the
transcript said was stapled to the span — with no way to read the transcript
while you worked, see the checkpoints you already had, or write a note. The
reader is the missing half. Open it from the popup's **Open the reader** button
or with `Ctrl + Alt + R` on any video; `Esc` or the × puts the page back.

**It is YouTube's own player, moved rather than copied.** `#movie_player` is
lifted into the reader and put back where it came from on close, so the video
keeps playing from where it was — at the speed, quality, volume and captions it
had, picture-in-picture included — and can be any size you like, because it is
the same element. Nothing on YouTube's page is removed or rebuilt. Two of
YouTube's habits are answered rather than fought: it sizes its control bar off a
window resize, so the reader sends one when the player moves; and it fullscreens
its own container rather than the player, so for the length of a fullscreen the
player goes home and comes back after.

**Highlight a passage to keep it.** Select transcript text and let go: that is a
checkpoint, saved on the spot with an **Undo** in the corner — the Undo is what
makes saving without asking safe. It keeps exactly what you selected, half a
sentence if that is what you took, and spans the lines it touched. Highlighting
the same passage twice is one checkpoint. Turn **Highlighting saves a
checkpoint** off in Settings and the same selection offers a **Save** button
instead.

**The checkpoints are anchored by time.** A checkpoint's start and end already
say which lines it covers, so they are shaded on the transcript by time rather
than by any position in the page — and stay on the right lines when you switch
caption language, where the lines are cut differently. Overlapping checkpoints
shade deeper rather than fighting.

**Notes.** Under the transcript is the video's checkpoints in time order: the
time (click to play from it), what was said, and a note you can type straight
into — written once you stop typing, not once a keystroke, and never lost by
closing the reader mid-word. It is the first place in the extension that edits a
checkpoint's note at all; the dashboard shows it. Deleting one has an Undo too,
and **Copy** puts the lot on the clipboard as a timestamped Markdown list.

**Four layouts**, switched from the reader's own header and remembered:

| Layout | Shape |
| --- | --- |
| Split | Video beside the transcript, notes docked under it. The default. |
| Stacked | Video centred on top, transcript and notes in one column below. |
| Theatre | Video fills the reader; the transcript is a drawer from the right that slides out on hover and hides itself after. |
| Focus | Transcript first, set for reading, with the video pinned in the corner — at 30% of the width by default, deliberately bigger than a thumbnail. |

Drag the divider — or the grip on the corner player in Focus — to size the
video, and each layout remembers its own size, as a percentage so a window
resized in between can never push it off the screen. The transcript follows the
video, and leaves you alone for a few seconds whenever you scroll it yourself;
click any line to play from it. Its text size, line spacing and line length are
in Settings, beside whether the reader covers YouTube's header or starts under
it so search stays in reach.

## Skim

Off until **Settings › General** turns it on, because it claims three
bare-Shift letters on every site.

One window, 600px wide and centred, over whatever page you are on. The key you
open it with decides which source it opens on — `Shift + F` the page itself,
`Shift + H` your history, `Shift + A` the actions it can run — and every other
source is still listed underneath, because a word typed to find a tab often
turns out to be on the page. Tab moves to the next source. The list shows four
rows at a time and scrolls for the rest. A window narrower than 600px is the
only thing that changes its width, and then it keeps a gutter either side.

Arrowing through page matches scrolls each one to rest just below the window,
close enough to read in the same glance as the query that found it. Browser
find parks a match wherever the scroll happens to land; this reserves the strip
the window covers and places the match under it. A match inside a collapsed
`<details>` opens it first, one inside a scrolling panel scrolls that panel
first, and a match in a sticky header cannot be scrolled to at all — so there
the window steps aside to the opposite edge instead. At the very top or bottom
of a page, where there is no scroll left to spend, the window moves rather than
the page.

Nothing in the page is rewritten to highlight a match. Matches are painted with
the CSS Custom Highlight API, which draws over ranges without touching the DOM,
so no listener the page installed is ever replaced. Where the browser does not
have it, the search and the scrolling still work and only the paint is missing.

**Link hints** are the other half, switched on separately. `Shift + L` labels
every link, button, field and card in view; type a label and it fires. A link
opens in a tab immediately beside this one, so the page you were reading stays
put; anything else is clicked or focused where it stands. A label that cannot
match what has been typed so far disappears, and the character already typed
stays on the ones that survived. Scrolling ends hint mode, and so does Escape —
the labels are placed from where things were, and a label pointing at the wrong
thing is worse than no label.

Both wear the skin that is on and follow the host page's own light or dark.

## Skins

**Settings › Appearance** picks one of four, and it applies to the popup, the
dashboard and the UI injected into YouTube. Day and night are separate from the
skin — the moon button switches within whichever skin you picked.

| Skin | |
| --- | --- |
| Default | The house red, sampled from the icon |
| Riso Paint | Three spot inks on newsprint |
| Medieval | Parchment, iron-gall ink, rubricated red |
| Art Deco | Ivory and gilt, everything letter-spaced |

On the page itself the skin sets the palette and the type, but light/dark keeps
following YouTube's own setting, so a sheet over a dark YouTube is never a
white slab.

The display faces ship with the extension, in `fonts/`: the same Cardo, Grenze,
UnifrakturMaguntia, Josefin Sans, Poiret One and Space Grotesk subsets the
design export was served, unpacked out of it so a skin looks here as it does
there. All are SIL OFL. Only the latin and latin-ext cuts are kept, and
anything outside them falls back to the stack named in `skins.css`. The same
faces reach the injected UI, which is why `skin-fonts.css` is a content-script
stylesheet and `fonts/*.woff2` is in `web_accessible_resources`.

## The X pouch

x.com gets a pouch of its own, and it is two pouches rather than one: **people**
and **posts** keep entirely separate topic lists. A "CUDA" under People and a
"CUDA" under Posts are different topics with different contents, and renaming or
deleting one leaves the other alone. Someone whose posts you want to keep and
someone you want to remember are two different reasons to file, and one list
serving both ends up serving neither.

An item belongs to exactly one topic. Filing something already filed moves it,
silently — a person is keyed by their handle and a post by its status id, so the
same account met on a post and again on their profile is one person, and the
same post met in the timeline and again in a thread is one post.

**Pouch** sits in X's left navigation under Home, wearing the extension's own
artwork exactly as the row in YouTube's drawer does, with the outline pouch mark
stacked underneath it so a picture that cannot be loaded uncovers a glyph in
`currentColor` rather than leaving a hole.

It takes its type and its icon size off X's own rows, which is how X's dark
themes and its display-size setting reach it without anything from us — and off
*two* of them, not one. X draws the row you are on heavier than the rest, and
the row this used to measure was Home, which is the row you are on nearly
always: so the Pouch row wore the selected weight permanently and read as a tab
that would not let go. It now rests in the body weight like every other row in
the column, and goes bold, a little larger and into the accent while the panel
is open. Where the word starts is measured too, so the label lines up with the
words above and below it rather than sitting a couple of pixels left of them.

It opens a panel over that column and nothing else: the timeline stays readable
behind it, because the point of the panel is remembering who somebody is
*while* you are reading, not a place to go and sit. Click anywhere outside it
to dismiss it. Two levels, People or Posts at the top, a topic's contents one
click in.

On a post, the pouch button stands where X's bookmark was — the same gesture,
filed somewhere you can organise — and where it *would* be on the rows X leaves
a bookmark off, which is immediately after Like rather than out past Share. Its
place used to depend on whether that row happened to have a bookmark in it, so
it moved between a post opened on its own page and the same post in the
timeline. Adding a cell to that row also lifts the fixed width cap X puts on it,
but only where the post is wider than the cap: otherwise the marks stay bunched
into the left half with empty page beside them.

On a profile the button sits beside Follow, wearing
the same ring as the More button next to it, at whatever size and in whatever
grey X is currently drawing those. Neither is labelled: both sit in rows of bare
glyphs, and a word there would read as something X had added. Both open a small
picker of that side's topics, with the current one dotted; filing a post can
make a topic on the spot, because filing a post is the moment you find out you
need one.

Both buttons are **off until you ask for them**, under **Settings › X**, and so
is taking X's own bookmark out of the row:

| Setting | What it adds |
| --- | --- |
| Remove Twitter's bookmark button from posts | Hides X's bookmark. Hidden, not deleted — nothing already bookmarked on X is touched, and turning it back off puts the button back |
| Add to pouch from a profile | The ring beside Follow, for filing people |
| Add to pouch from a post | The button in the action row, for filing posts |

They are separate switches because either half is a reasonable thing to want
without the other, and because all three are the extension reaching into a page
somebody else designed — which is not a default to assume for anyone. The pouch
itself is always there: the row in X's navigation, the panel it opens, and the
People and Posts tabs on the dashboard.

Everything else is the dashboard, under **Twitter › People** and
**Twitter › Posts**: making a topic, renaming it, dragging it into a different
place in the order, deleting it and everything in it, writing the
three-to-five-word note under someone's name, and taking a saved post back out.
Those are decisions you make looking at the whole pouch, not while reading a
post.

A saved post opens from either side. In the panel the whole card is the target;
in the dashboard the handle and the body are one link. That was not true for a
while, and a pouch of posts you cannot get back to is a pouch with no point:
posts filed before the URL was recorded have theirs rebuilt from the status id,
so the old ones open too.

The dashboard calls the site **Twitter** throughout, not **X**. The site renamed
itself; nobody who uses it did, and a single letter sitting in a row of proper
nouns reads as a rendering fault rather than as a name. The internal id stays
`twitter`, which is what it always was.

### Avatars, and why nothing is ever fetched

A person's picture is stored as the `pbs.twimg.com` URL that was on the page at
the moment you filed them — about eighty bytes — and never as image data. The
panel and the dashboard put that URL in an `<img src>` and let the browser fetch
and cache it, which costs nothing and is not rate-limited.

What is deliberately *not* done is asking X for it. X's own endpoints are
rate-limited per fifteen minutes against your signed-in session, so a panel that
refetched fifty profiles every time it opened would spend your own budget and
eventually 429 your real browsing. Nothing here ever makes a request to X.

The consequence is that a stored URL goes stale the day somebody changes their
picture, since nothing goes back to check. So every row carries the person's
initials underneath the image, and a picture that fails to load simply uncovers
them.

### Hiding promoted posts

**Settings › X › Hide promoted posts and Premium upsells** is off until asked
for. Promoted posts are found by the tracking wrapper X puts around a paid
placement rather than by the word "Promoted", so it needs no word list and works
whatever language the site is in; the upsells are X's own Premium nags, which are
not third-party ads but are not posts either.

Nothing is deleted. Hidden entries keep their box in the page, because X's
timeline is virtualised and measures its own rows — a node removed out from under
that bookkeeping makes the scroll position jump. Turning the setting off puts
everything back on the page that is already open, without a reload.

## LeetCode

Practising problems is a loop, and the part that is hard to keep by hand is the
bookkeeping: how long that one actually took, how many goes it needed, and when
it is worth doing again. LeetCode gets a surface for that loop.

**The clock is LeetCode's own.** Opening a problem starts the stopwatch already
in its toolbar rather than drawing a second one — two clocks on one screen that
disagree by a few seconds is worse than either. The elapsed time is then read
back off that display, as the sum of segments rather than the latest reading, so
resetting it loses nothing and pausing costs nothing. If the widget cannot be
found or read at all, the fallback banks wall-clock gaps, and only those spent
with the tab on screen and the window focused — never by counting ticks, which a
throttled background tab would under-report tenfold.

**Whether a submission passed is read off LeetCode's own network calls**, not off
the result banner, whose markup changes every few weeks and which is gone again
a moment later. That has one consequence worth stating plainly: **pressing Run is
not a submission.** Run and Submit end up polling the same endpoint with the same
response shape, and the two are only distinguishable at the moment the job is
created — so the ids minted by Submit are tracked and the ids minted by Run are
thrown away. Finding out your code does not compile is not an attempt.

**Grading is a question, asked once, on an accept.** Four buttons — Again, Hard,
Good, Easy — with one already marked from the clock and the failed submissions
against a per-difficulty budget (Easy 15m, Medium 30m, Hard 45m). Three failures
is Again however fast they came; a single failure caps the answer at Hard however
quick the accepted one was. Each button says what it would cost, because "Hard"
and "Good" mean nothing until you can see that one brings the problem back on
Thursday and the other in three weeks. **Dismissing leaves it ungraded** rather
than quietly taking the suggestion: a schedule written on your behalf is a wrong
date you never agreed to and would have to go and find to fix. Ungraded problems
sit under Solved and can be graded later from the dashboard.

The schedule is [FSRS-5](https://github.com/open-spaced-repetition/fsrs4anki),
with its published weights. Target retention is the chance of remembering a
problem at the moment it comes back around; ninety percent is what the algorithm
is tuned for.

**Pouch** sits in LeetCode's top bar and opens a sheet with four rails — Due, To
solve, Solved, and Templates. Notes are editable there as well as on the
dashboard, because the moment you want to write one is the moment you have just
finished the problem.

### Templates

Code templates are the snippets you paste before you start: a binary search that
gets the boundaries right, a union-find, the import block you always want.
**Nothing ships with the extension** — a bundled library of somebody else's
snippets would be in languages you do not use, and the value of a template is
that it is the version *you* trust.

<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> inside the editor offers the ones
for the language you are in, filtered as you type; with code selected it offers
to save that selection as a new one, using whatever you typed in the filter box
as its name. That shortcut has key handling of its own rather than going through
the extension's usual one, and deliberately: every other shortcut stays out of
the way while you are typing in a field, which is right — and this one has to
fire *inside* the editor, which is the one place that guard is built to cover.

### Mock interview mode

<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> hides what an interview would not
give you — the difficulty, the topic tags, the hints, the similar questions and
the solutions tab — and runs a countdown. Knowing a problem is tagged "binary
search" is most of the work, which is exactly the help that makes practice not
resemble the thing it is practice for. The note pill and the grade card stay out
of the way until it ends.

Nothing is deleted: everything is hidden by one class on `<html>`, so leaving
puts the page back exactly as it was, and LeetCode re-rendering a pane behind you
cannot resurrect what should be hidden.

### The dashboard

**Review** is the queue — what is due, what was opened and never solved, and
what is coming up — with a re-grade control on each row and its note in the
table, since the note is what you read while deciding what to work on. The
headline figures are solved, due, the current streak, and the **median** time per
problem; the median rather than the mean, because one problem left open in a
background tab for two hours drags a mean somewhere nobody's practice actually
is.

**Practice** is a heat map, one square a day in your own time zone, coloured by
submissions, solves or time. Only what Bell Bearer watched is in it — solving
something before you installed it is not, and the history is not pulled from
LeetCode's API.

**Notes** is every problem you have written one on, editable and deletable.

## TypeRacer

Typing practice is the one skill-practice site where the interesting data is not
the score at the end — it is **the shape of the keystrokes**. Which letter pairs
you stall on, which characters you reach for wrongly, and how much of a race
went to backspacing. TypeRacer shows none of that, and the third-party sites
that do want an account and a scrape. Bell Bearer is already sitting in the page
with a capture-phase listener, so it measures it directly.

**The typed stream is the measurement, not the scoreboard.** WPM and accuracy
are read off TypeRacer's result panel as a cross-check and believed when they
parse, because they are the numbers you just saw on screen. Everything the
dashboard is actually *for* is derived from the keystrokes themselves, so it
survives every CSS rename on the site.

**Nothing is sent anywhere and no raw keystrokes are kept.** A race is about
three hundred of them and a hundred races would be thirty thousand rows, which
`chrome.storage.local` is not. Each race is folded into a rolling table of
letter pairs at the end and the stream is thrown away.

**No page-world script.** chess.com and LeetCode each need one because the board
object and `window.fetch` only exist in the page's own world. Keystrokes are DOM
events, which a capture-phase listener in the isolated world sees in full — and
only the ones typed into the race box count, so a word said in TypeRacer's chat
mid-race is not a mistake in the quote.

**A race ends when the keystrokes say it has**: every character of the quote in,
and nothing wrong left in the box. The results panel is waited on for a moment
as the cross-check, and a scoreboard still on screen from the race before is
neither taken as the end of this one nor filed against it.

### What the tables say

**Races** is best, the mean of the last ten, accuracy and races today, over a
line of speed against time — spaced by *when* each race happened rather than
evenly, so a fortnight away from the keyboard shows as a fortnight. Under it, the
recent races with what each one lost to correcting.

**Weak spots** is four blocks:

- **Slowest pairs**, ranked by how slow each one is *for you* — against your own
  mean for anything ending in that character — and never by raw milliseconds,
  which only ever returns every pair containing a comma. An interval is credited
  only when both of its characters were typed correctly first time; one spanning
  a backspace measures how long you spent fixing something, not how fast the
  pair is. Readings over 1.5s (you looked away) and under 10ms (key repeat, or a
  paste) are dropped rather than clamped — a clamped outlier is still an
  invented reading sitting in the mean.
- **Slowest rolls**, the same for three characters, timed across the *second* of
  their two intervals so a roll and the pair inside it are not the same number
  under two names. A roll that is slow when both its pairs are fast is a
  different problem and a different thing to drill.
- **Most mistyped**, sortable between "most often" and "most likely" because
  they are genuinely different questions: `e` is mistyped most in absolute terms
  simply because `e` is everywhere. Each row names what you hit instead.
- **Cost of correction** — the seconds lost in the range, your actual mean
  speed, and your **clean** speed: the same keystrokes with the time spent in
  and getting out of a mistake taken off the clock. Not a projection of what you
  could do; what the race already was, minus the correcting.

**Practice** is a heat map, one square a day in your own time zone, coloured by
races, best speed or time — plus a generated drill built from your worst pairs,
each padded into something that can be typed as a word, since a pair drilled on
its own trains it in an isolation it is never typed in.

Case is folded before anything is counted: an upper-case pair and its lower-case
twin are the same motion for the fingers that matter, and the shift is already
measured as an interval of its own. Digits all fold to `#`, and anything outside
letters, space, apostrophe, comma, period and hyphen to `?`, so a quote full of
accents cannot fill the table with pairs you will never meet twice.

### The caret and the sound

**The typing caret** is the marker showing where you are in the quote — bar,
block, underline or outline, or TypeRacer's own, which is the default. Ours
hides the site's marking while it is up and puts it straight back the moment you
switch away; nothing is removed from the page. Position is read once per typed
character inside an animation frame and written as a transform — not on scroll,
not on a timer. **If the quote's markup cannot be read, no caret is drawn**: a
caret in the wrong place over the word you are reading is worse than none.
<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> cycles the shapes from the page.

**The sounds are synthesised**, so nothing ships and nothing loads before the
first keystroke can click. A key is pitched by its position in the quote, which
is the difference between a typewriter and a smoke alarm; a space ends a word
and a wrong character interrupts. The volume is a percent and above 100 it
really is louder — Web Audio gain is not capped the way an audio element's
volume is — and at 0 nothing is played at all rather than played silently. The
same module now carries the chess low-clock tone.

This is a typing test, so the keystroke path is the whole design: the capture
handler pushes one small object onto an array and returns. No storage, no
layout reads, no DOM writes, nothing that can force a reflow. Everything that
costs anything happens on the shared observer's animation frame or once at the
end of the race.

## ChatGPT and Claude

What goes wrong in a long ChatGPT session is finding your way around it, not
getting answers. The conversation is a tree — every edited prompt and every
regenerate starts a branch — and the page shows one path through it with a
`< 2/3 >` where it splits. A two-hundred-turn debugging chat has no table of
contents. Prompts you reuse are retyped. And you wait for each answer before you
can send the next.

**The panel** opens from a button in the chat's header, or `Shift + P`. On a wide
window it docks in the margin the thread leaves empty — measured off the thread
itself, since the sidebar may be open or shut — and on a narrower one it is an
overlay that goes away on an outside click. It has four tabs:

- **Outline** — every prompt, and under each answer the headings it wrote. Click
  one to go there; the row you are reading follows the scroll. A `#` inside a
  code block is not a heading, which in a Python answer is most of them.
- **Tree** — the branches, drawn. A prompt is a ring, an answer a dot, the path
  the page shows is the accent, and a turn under a fork carries the page's own
  `k/n`. Long runs with no fork fold into one segment with a count. Click any turn
  and the page's own arrows are clicked, fork by fork, until it shows it;
  shift-click two to compare them side by side or in one column, word by word.
- **Pins** — `Ctrl + Alt + P` pins the message you are reading. A pin is kept by
  the turn's own id, not its position, which every edit above it would renumber.
- **Queue** — this chat's queued prompts (below).

**Export** in the panel's header gives the chat as Markdown or JSON, or copies
the Markdown. Code keeps its fence and its language, in a fence longer than any
inside it; `\( \)` and `\[ \]` become `$` and `$$` (Obsidian and GitHub render
those), never inside code; citations become footnotes. Markdown is the path the
page shows; JSON is the whole tree. **Library** lists your history a page at a
time — shift-click for a range — and fetches the ones you pick about one a
second, backing off when ChatGPT answers 429, into one zip with an index.

**Prompt templates** — `Ctrl + Alt + I` offers them, last used first, and types
the one you pick into the box. `{{name}}` asks for a value first; `{{selection}}`
is whatever you had selected on the page. Ten starters ship — seeded only when
there are no templates at all, so deleting them keeps them deleted — and the
dashboard can put any missing ones back.

**The queue** — `Ctrl + Alt + Q` takes what is in the box and sends it when the
answer being written is done. Queued prompts go one at a time, typed into the
page's own box and sent with its own button; nothing is ever posted to ChatGPT
behind its back. Typing in the box yourself always wins, pressing ChatGPT's stop
pauses the queue, and it stops at the first thing it does not understand rather
than guessing. A prompt can be scheduled — in an hour, at a time, or for when a
limit resets — and if its chat is not open then, a background tab is opened for
it. When ChatGPT says a limit has been reached, a chip above the box offers to
hold the queue until the time it names; a notice that blocks sending holds it by
itself.

Conversations are read from ChatGPT's own API with your session and kept in
memory while the chat is open — never stored. What is stored is yours: pins,
prompts, the queue, and whether the panel was open. The Prompts and Queue
buttons beside ChatGPT's own composer buttons are off until **Settings ›
ChatGPT** turns them on; the hotkeys and the panel reach both either way.

### What differs on Claude

claude.ai gets exactly the same panel, queue, pins, prompts and exports — the
chat code never names a site, and Claude is a second adapter onto it rather than
a second copy. What differs is what claude.ai's page is like underneath:

- **Nothing in its markup names a message.** A row of the transcript is tied to
  the tree by its place on the path shown, and that is confirmed by comparing
  the row's words with the turn's. When the two disagree the row is no turn at
  all — a pin mark on the wrong answer is worse than none.
- **Its thread is virtualised,** so reaching a turn forty prompts up means
  scrolling to where it should be, letting the page mount it, and looking again.
  The same code runs on ChatGPT; on Claude it is load-bearing.
- **Its answer stream is watched.** A small script in the page's own world reads
  a copy of the completion stream — never the page's own — for the moment the
  answer ends, which works in a background tab where the page itself runs no
  animation frames, and for the exact time a limit resets. The queue waits on
  that, and falls back to the page only when it is silent.
- **Artifacts are exported as documents.** An artifact is not a message but a
  document the messages edit. The edits are replayed into its final text, which
  is printed once, in full, after the turn that last touched it; earlier edits
  are a line pointing at it. An edit that no longer applies marks it out of date
  rather than guessing. Pasted text on a prompt is exported folded under it.
- **Its limits all block,** and there are two of them — the five-hour session
  and the week. The chip says which one ran out, because they are very different
  waits. Near the limit, it offers to hold the rest of the queue.

Nothing is drawn under `/code` (Claude Code on the web), on the settings pages or
on the artifact pages — none of them is a chat. claude.ai's own search matches
titles only, so a search over what was said is a real gap on Claude; filling it
is left for later.

## Daily time limit

**Any** site can be held to a daily limit. The list is under
**Settings › General › Hold me to a daily limit on**, beside the remembered
cookie sites and working the same way: name a host, say how long it gets, and it
is in. Nothing is in it to begin with, and a host with no row in it is not
counted, not stored and costs nothing at all.

This used to be two settings per site, spelled out in the schema and wired to a
toggle inside that site's own panel — which is why only the two sites that had a
panel could have a limit at all. x.com and reddit.com are now two rows in the
list like any other, and their **Time** tab shows where today stands rather than
setting the limit. Anyone who already had one keeps it: the list seeds itself
once from those old settings the first time it is read.

A row carries one of two kinds of limit:

| What you type | What it means |
| --- | --- |
| `30` minutes | a budget for the day: thirty minutes of that site, whenever you like |
| `7am` to `9am` | an allowance too: the site is yours between those hours and covered the rest of the day |

A pair of times is an *allowance*, not a curfew — the same shape of promise the
budget makes. It could just as reasonably have meant the two hours the site is
blocked, and the difference matters rather a lot at 9:01, so the panel says
which it is in as many words. Times are read the way they are said: `7am`,
`7:30 pm` and `19:00` are all fine. A window whose end is before its start runs
over midnight (`22:00` to `02:00`) rather than being empty.

Time is counted by the page itself, because the page is the only thing that
knows whether it is the one being looked at: the tab has to be on screen
*and* the window has to have the machine's focus. A tab left open behind
another window is not time spent. Seconds are banked every fifteen, and a
single credit is capped, so a laptop closed for three hours cannot charge the
night to the morning.

Past the limit the site is covered by a sheet saying what was spent. It is a
sheet rather than a redirect — being bounced somewhere else tells you
nothing, and closing the tab is meant to be the deliberate part.

The sheet has a way through it: **Snooze ten minutes**, as many times as you
ask. Nothing refuses a fourth one — it just says it is the fourth, on the sheet
and in the Time tab. A limit with no door is a limit you switch off for good the
first time it is wrong about your afternoon, and a snooze you have to admit to
is a better check than one you cannot have. The clock keeps running through it,
so the ten minutes come out of the same day's allowance rather than on top of
it, and a snooze is discarded at midnight with everything else.

The tally is one day deep. It is not aged out or archived at midnight, it is
discarded whole the first time the next day reads it, so the store never
amounts to a record of what was browsed when: a number per limited host and the
date they belong to. The site's card shows today against the limit, live, while
the counting happens in another tab.

## Rosters: your list out to a file, and back

**Twitter › Roster** and **Reddit › Roster** read your own list off the site —
the accounts you follow, the subreddits you have joined — into a plain text
file, one name per line, and read a file back in to follow or join what it
names.

No API, no token, no endpoint. Reading walks the pages you can already see;
applying opens each name's page and clicks the site's own Follow or Join button.
That is the whole of the safety argument, and it is why the two directions are
not offered as one button:

| | Reading | Applying |
| --- | --- | --- |
| What it touches | nothing — it changes no state anywhere | your account, at the site's sufferance |
| Twitter | scrolls `/<you>/following` | 40 a day, 25–55 seconds apart |
| Reddit | pages through `old.reddit.com/subreddits/mine` | 120 a day, 9–20 seconds apart |

Twitter's numbers are deliberately the slower pair. Reddit rate-limits an
account and tells you so; Twitter suspends one and does not, the edge of what it
tolerates is neither documented nor stable, and the way to stay clear of it is
to stay a long way clear rather than to find it. The gap between two actions is
jittered inside its range, because a click at exactly the same interval for an
hour is a signature and a person does not have one.

Before an apply job starts, the panel says how many names it is, how many are
new since your last read, roughly how long today's sitting will take and how
many days the whole thing is. A four-hundred account list is eleven days of
Twitter's cap, which is not something to discover on day three.

A job stops at the first thing it does not understand — a missing Follow button,
a click that silently did nothing, anything the site puts in the way — and says
so, rather than trying again or moving on. A click that does nothing is exactly
what being rate-limited looks like from inside the page, and pressing on from
there is how an account gets suspended. Anything already followed or joined is
skipped and costs nothing against the day, so re-running a list you half applied
yesterday is cheap.

Applying a list *is* a sequence of navigations, so the job lives in storage
rather than in any page: every page of the site picks it up, does one thing,
writes down that it did and moves on. That is what makes it survive a page load,
a closed browser, and the day's cap running out in the middle. One page holds it
at a time — two tabs would otherwise follow the same account twice — and the
dashboard can stop it, or carry on where it left off.

## Activity

Off by default, and nothing is recorded while it is off. The Activity tab is
there either way: with tracking off it explains what it would record and offers
a button to start, which is the same switch as **Settings › General › Track my
activity**. (The tab used to be hidden until that checkbox was found, which made
a whole view invisible to anyone who never went looking.)

Turned on, it shows, for today / 7 days / 30 days: time on screen with its
trend, how many sites and which leads, the longest single page, the busiest
hour, focused time per site, the longest page of each day, and a 24-bar strip of
when the time went.

It buckets by hostname across every http(s) site — nothing about it is
YouTube-specific. Everything stays in `chrome.storage.local` on this machine,
is never sent anywhere and is pruned past 60 days. The only per-URL thing kept
is the title of each day’s single longest page, and that is kept for 7 days,
not 60 — which is also the window the “longest page each day” panel shows,
rolling back from today whatever range the rest of the view is on.

A 30-second alarm in the service worker takes the readings, and it exists only
while tracking is on — nothing is woken while the setting is off. Each reading
credits elapsed wall time to whatever was focused at the *previous* one, so a
suspended MV3 worker cannot inflate a total, and a gap longer than 90 seconds is
dropped rather than counted as time at the screen. That "previous" marker lives
in `chrome.storage.session`, because the worker itself does not survive the gap
between two alarms.

## Chess.com and Lichess

The two sites are mirrors of each other: each has a card on the dashboard, a
Games view, a popup panel on its own pages and a settings panel of its own,
all drawn from one registry, `src/shared/chess-sites.js`. Set the username in
**Settings › Chess.com** or **Settings › Lichess**; games are read from each
site's public API.

The Games view shows today / 7 days / 30 days, win/loss by time control, and
beside it **time management** — of your last 20 bullet, blitz and rapid games,
how many you won on the opponent's clock and lost on your own. Under that is a
year of time at the board as a heat map in the skin's own accent. A year of
Lichess games streams at about twenty a second, so the first read takes a
while; the last 30 days come first, and later reads fetch only what is new.

While you play, per time control:

- **Opponent clock warning** — a toast when the opponent's clock is more than
  N seconds ahead of yours.
- **Speak moves** — every move, yours and your opponent's, read aloud through
  `chrome.tts` ("Knight takes E 5, check"), for learning to follow the board
  by ear. Firefox has no `chrome.tts`, so there the page's own speech is used.

The time control is inferred from the starting clock, since the increment is
not on the page.

## Watch party

Watch a YouTube video or a Netflix episode in sync with other people. Everyone
plays it from their own account, over their own connection. What travels
between you is play, pause, seek, speed and which video, never the picture, so
nothing is streamed, nothing goes near Netflix's DRM, and a member costs the
room about fifty bytes a second.

On a YouTube or Netflix video the popup has **Start a party** and **Join**.
Starting asks how the party connects:

| Way | What you hand out | What carries the party |
| --- | --- | --- |
| **Server** | one code, for anyone | a party server someone hosts, at `wss://…` |
| **Relay** | one code, for anyone | the same server run on your own PC, at `ip:port` |
| **Codes** | an invite per guest, who sends a reply back | nothing: browser to browser |
| **Tracker** | one code, for anyone | nothing once you have met; public WebTorrent trackers introduce you |

It also asks who controls playback, whether the room waits for someone who is
buffering, and the name the room sees. Those three and the server's address are
remembered for next time, and are the same settings as **Settings › Watch
party**.

**Codes** need nothing but a browser, and take the most work. A code party is a
star around the host, one connection per guest, so each guest gets an invite of
their own. The invite *is* your address, and before you send it the popup spells
out which IP and port it carries ("You share public 203.0.113.5:54012 and LAN
192.168.1.14:54012"). It lasts ten minutes. The guest pastes it into **Join** and
gets a reply to send back; you paste that under **Their reply** and they are in.
Once the connection opens, both ends prove they hold the same invite, so someone
who swapped the codes on the way is refused. Behind a symmetric NAT, a guest
outside your network may not reach you at all, and the invite screen warns you
before you hand one out: add a TURN server in Settings, or use a server. A code
party ends with its host, because nothing else is holding it together.

**Tracker** parties meet without the exchange. The code is a secret, and both
the swarm the party meets in and the key its signaling is sealed with are
derived from it, so a tracker sees which addresses connect and when, never the
code or a word of what is said. The Tracker tile says how many of your trackers
are answering before you pick it, and if none does, the start fails and offers
codes instead. When the host leaves, the next in line hosts after about fifteen
seconds and everyone else reconnects to them.

**Server** and **Relay** are the sturdiest. A member who drops (a closed lid,
a Wi-Fi change) comes back as the same member within a minute, and a host who
goes quiet for fifteen seconds hands the room to a co-host, or failing one to
whoever joined first. The server is not
part of this repository; [Watch party protocol](#watch-party-protocol) is what
one has to do.

**Join** takes any code starting `bbp1`. What it is, and for an invite where it
comes from and how long it has left, is read out under the box as you paste.

### In the room

While you are in a party the popup opens on the room: who is watching, how each
of them is doing (ready, buffering, loading, an ad, away, watching solo) and
their round trip. Someone the room has had to wait for too often is marked
*lagging*, and catches up by seeking rather than holding everyone again.

The host can let everyone control playback or only hosts and co-hosts, wait for
whoever buffers or let them catch up, lock the room against new joiners, and
make anyone co-host or host or remove them. The room never waits for an ad:
YouTube shows different people different ones, so an ad is caught up on
afterwards.

### On the page

A chip over the player says one thing at a time, the most pressing first: that
the party ended, that the link is down and you are playing on your own until it
is back, that the party is on another video (with the way there), who the room
is waiting for, or, usually, how closely you are in sync. It goes into
fullscreen and into the reader with the video.

- **Host control.** A guest's play, pause or seek is turned straight back, and
  the chip offers **Request pause**, which appears on the host's page with a
  one-click Pause, and **Watch solo**, which steps out of the room's playback
  until **Rejoin**.
- **Speed.** The `>` and `<` keys step the room's speed rather than yours.
- **The next video.** When the room moves on, you follow, unless **Settings ›
  Watch party › Follow the party to its next video** is off. The address is
  always built here from the video's id; a peer never sends a link.
- **Drift.** A small lag is taken up by playing a few percent faster or slower
  until you are back in step, which nobody notices. Only past 1.5 seconds out
  does it seek.
- **Netflix.** Setting the video's position directly makes Netflix stop with
  error M7375, so seeks go through Netflix's own player. Once Netflix is seen
  putting the speed back after a nudge, every correction there is a seek
  instead, and since each seek rebuffers, the bar for one is higher. If its
  player cannot be found, the chip says so and the party is play and pause
  only.

### Chat

Click the chip to open the party's chat. It sits beside the player where the
page has room, as YouTube's own column would, and otherwise over the player's
right edge, which is also how it goes into fullscreen and the reader. It shows
who is watching (a lit dot is in step and ready) and what has been said, with
notes of its own in between: who joined or left, who stepped out to watch solo
or came back, who hosts now, and who the room is waiting for.

A line said while the chat is shut shows on the chip as "3 new in chat", and in
the popup's room as a strip with **Open on page**, which brings the party's tab
forward with the chat open. Someone who joins late, or whose tab reloads, gets
the last fifty lines. Nothing is kept after the party ends, and what anyone
types is shown as text, never as markup.

### What it costs when you are not in one

Nothing. None of the party is in the manifest. Its page code is injected into
the one tab a party is started or joined from, at that moment, and again only
if that tab reloads; the popup loads its party screens the first time they are
opened. The connection lives in an offscreen document that exists only while a
party does, and is closed when you leave, or half a minute after the party's tab
closes. Firefox has no offscreen documents, so there the same scripts are loaded
into the background page when a party starts.

## Offline Installation

### Method 1: Load as Unpacked Extension (Recommended for Development)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory
5. The extension should now appear in your extensions list

For Firefox, rename `manifest.firefox.json` to `manifest.json` first (it needs
`background.scripts` rather than a service worker, and has no `tabGroups`).

## Project layout

No build step, by design: every file is a classic script that attaches its
exports to a shared `BB` namespace, and the load order is the order in
`manifest.json` (or in the `<script>` tags of `popup.html` / `dashboard.html`).
The watch party is the exception: none of it is listed anywhere a page would
load it, and its load orders are the lists named below.

```
src/shared/     pure logic, used by every surface
  speed.js         the playback-rate ladder — one source of truth
  skin.js          which skin is on; paints data-skin
  activity.js      the activity store: bucketing, pruning, summaries
  bookmarks.js     load/save/merge/import checkpoints
  subscriptions.js topics, channels, new videos
  settings.js      every setting's key and default
  youtube.js       URL parsing
  chess-sites.js   chess.com and Lichess: names, settings keys, time controls
  chess.js         chess.com games and every summary both sites share
  lichess.js       Lichess games, streamed and resumable
  feed.js          channel RSS, cached ten minutes; Refresh asks for fresh
                   resolves /@handle to a UC id by the page's canonical link
  skim.js          where a match comes to rest, and the action table
  limit-sites.js   which sites are held to a daily limit, and what each limit is
  time-limits.js   the day's tally per limited host, and the snooze
  fsrs.js          FSRS-5: when a problem is worth doing again
  leetcode.js      the practice log: one record per problem, one bucket per day
  typeracer.js     the typing log: races, the n-gram tables, the day buckets
  sfx.js           synthesised sound: one context, a voice table, a cheap play()
  leet-templates.js  code templates, and which language each belongs to
  roster.js        a site's own roster: the file format, the pace, and the job
  x-pouch.js       the X pouch: two independent topic lists and their items
  pouch-button.js  the pouch button both YouTube and X inject
  chat-sites.js    the chat sites: names, settings keys, how their URLs and limit notices read
  chat-tree.js     a conversation as a tree of turns, whichever site it came from
  chatgpt-format.js ChatGPT's conversation read into that tree
  claude-format.js claude.ai's conversation read into that tree, artifact edits and all
  chat-diff.js     a word diff of two answers, lines past a cap
  chat-export.js   a chat as Markdown or JSON, and its file name
  chat-pins.js     pinned turns, by site and conversation
  prompt-templates.js the prompt templates and their ten starters
  prompt-queue.js  queued and scheduled prompts, holds and leases, reset times
  zip.js           a store-only zip for the bulk export
  time.js dom.js   formatting and escaping
  party-clock.js   the room clock: its offset from the lowest-latency ping, and when to ping
  party-state.js   the party's state vector, where it says the video is now, the conflict rule
  party-drift.js   how far out of step a member is, and whether to nudge the rate or seek
  party-room.js    the party's authority: policy, holds, liveness, handover, chat
  party-chat.js    party chat: what a line may say and how often, a member's log, its notes
  party-code.js    invite and reply codes: a WebRTC description in ~150 characters, and back
  party-sites.js   YouTube and Netflix to the party: video ids, addresses, what each will take

src/content/    injected into every page
  main.js          bootstrap — decides what runs where
  player.js        speed, skipping, seeking, the temporary boost
  shortcuts.js     the keybinding table
  skim.js          the launcher: page search, the jump, the result list
  link-hints.js    a label on every link and button in view
  time-limit.js    counts the day on any limited site, and covers it
  roster.js        reads a roster off the site's pages, and works through one
  checkpoints.js   recording and saving checkpoints
  transcripts.js   transcript fetching and caching, per video and per language
  reader.js        the reader: the adopted player, layouts, sizing, highlights, notes
  reader-transcript.js  the reader's transcript rows, and which rows a time or a selection covers
  site.js          which site, and which <video> on it
  chess.js         in a chess game: clock warning, spoken moves, clear arrows
  youtube-ui.js    the pouch button, the drawer entry, the topics sheet, the pouch panel
  twitter-page.js  every x.com selector, and reading a post or a profile off one
  twitter-ui.js    the X nav row, the post and profile buttons, the topic picker
  twitter-panel.js the pouch panel over X's navigation column
  twitter-ads.js   hides promoted posts and Premium upsells, when asked to
  leet-read.js     every leetcode.com selector, and reading a problem off one
  leet-ui.js       the clock, the verdict, the grade card, mock mode, the hotkey
  leet-panel.js    the pouch sheet: due, to solve, solved, templates
  typeracer-read.js every typeracer.com selector, and reading a race off one
  typeracer-ui.js  the keystroke capture, the typing caret, the sounds
  chatgpt-read.js  every chatgpt.com selector and request — the site's adapter
  claude-read.js   every claude.ai selector and request; rows tied to the tree by place and words
  chat-ui.js       everything on a chat site: the conversation, the toggle, hotkeys
  chat-panel.js    the docked panel's frame and its tabs' markup
  chat-nav.js      reaching a turn in a virtualised thread; switching branch
  chat-tree-view.js the branch tree as an SVG string
  chat-compare.js  two branches side by side
  chat-library.js  bulk export
  chat-picker.js   the prompt picker
  chat-runner.js   sending the queue, one prompt at a time
  chat-queue-view.js the queue strip and the Queue tab
  composer.js      typing into a chat site's prompt box, and pressing send
  scroll-to.js     landing on something in a page that scrolls inside itself
  dom-watch.js     one throttled MutationObserver for all of the above
  overlay.js notify.js theme.js page-info.js markdown.js

  MAIN-world entries, loaded per site, with no chrome.* and DOM events only:
  chess-page.js    the board's own state, which the isolated world cannot see
  leet-page.js     watches LeetCode's fetches for verdicts; drives Monaco
  claude-page.js   reads Claude's completion stream off a clone: its end, and its exact limit

  Injected into a party's one tab by src/background/party-loader.js
  (CONTENT_FILES, PAGE_FILES, CSS_FILES), never listed in a manifest:
  party-chip.js    the status chip over the player, and the host's pause-request toast
  party-chat-panel.js the chat, beside the player or over it; what was said, set as text
  party-media.js   the party on the player: our writes against the user's, drift, readiness
  netflix-page.js  MAIN world: Netflix's own player, for seeking without error M7375

src/background/ the service worker, pulled in by background.js
  proto.js         the sowon wire format
  sowon.js         focus reporting
  context-menus.js "Copy as Markdown"
  commands.js      keyboard commands and messages, chess moves spoken
  activity-heartbeat.js  the alarm that feeds the activity store
  skim.js          tabs, history, and the actions Skim can run
  prompt-queue.js  the one alarm a scheduled prompt needs, and waking its chat
  party-loader.js  the party's gate: binds it to one tab and injects it there
  party.js         opens and closes the party's offscreen document; start, join, leave

src/offscreen/  the party session, loaded by offscreen.html only while a party is on
  party-loopback.js the room in-process, behind the wire protocol
  party-ws.js      a party server over WebSocket, with resume and backoff
  party-rtc.js     WebRTC invites and replies, channel binding, the NAT probe
  party-host.js    a peer-to-peer host: the room, relayed to each guest's data channel
  party-tracker.js tracker rendezvous, sealed signaling, ICE restart, re-election
  party-session.js what the tab's port plugs into; picks the transport; the popup's status

src/page/       shared by popup.html and dashboard.html
  ui.js            modals, toasts, clipboard, files, theme
  backup-buttons.js the header's Export / Import
  tab-actions.js   driving a video in another tab
  settings-form.js binds the settings form to storage
  skin-picker.js   the Appearance section
  stats.js         the Activity view
  chess-stats.js   a chess site's Games view, dashboard and popup
  chess-settings.js a chess site's settings panel
  heat-map.js      the calendar heat map
  spark.js         a line over time, scaled by when rather than by index
  time-limit-view.js today against a site's daily limit
  limit-sites-panel.js the General list: which sites have a limit, and what it is
  roster-view.js   a site's Roster panel: the file out, the file in, the job
  x-pouch-view.js  the dashboard's People and Posts panels — where X topics are managed
  leet-stats.js    the LeetCode Review, Practice and Notes panels
  typeracer-stats.js the TypeRacer Races, Weak spots and Practice panels
  chat-views.js    a chat site's Pins, Prompts and Queue panels
  chat-settings.js a chat site's settings panel
  popup-width.js   applies the popup size setting, from popup.html's <head>

  The popup's party, appended by popup.js (PARTY_FILES) the first time it is opened:
  party-panel.js   the frame: one status a second from the worker, every screen drawn from it
  party-start-view.js party-join-view.js party-room-view.js party-invite-view.js

offscreen.html  the party session's script list; Firefox reads it into the background page
party.css       the popup's party screens, for every skin
party-page.css  the chip, toast and chat on the page, inserted with them
skins.css       the token layer for every skin — linked before popup/dashboard css
skin-fonts.css  @font-face for the skin families
fonts/          the woff2 subsets those faces load
textures/       parchment, newsprint and grain tiles used by the skins

tests/          zero-dependency browser test suite — see tests/README.md
```

#### Import/Export Data Format
The export is every key in `chrome.storage.local` except the network caches:
```json
{
  "type": "bell-bearer-backup",
  "version": 1,
  "exportedAt": "2026-09-15T06:30:00.000Z",
  "data": { "skin": "deco", "shortcuts": {}, "youtubeBookmarks": [] }
}
```
Importing writes those keys back, replacing what is there.

## Permissions

- `storage`: To save and retrieve bookmarks
- `alarms`: The activity heartbeat — an MV3 worker is suspended a few seconds after it goes idle, taking any setInterval with it — and the one alarm a scheduled chat prompt needs
- `activeTab`: To interact with YouTube pages
- `scripting`: To inject content scripts
- `contextMenus`: For the "Copy as Markdown" right-click items
- `tabs` / `tabGroups`: For the sowon focus report
- `tts`: To read chess moves aloud (Chrome only; Firefox has no such API)
- `history` / `sessions`: Skim’s history search and its “reopen the last tab I closed” action, both read only when you ask for them
- `offscreen`: The watch party's connection, in a document that exists only while you are in a party — a service worker is stopped after thirty idle seconds, and a party is an evening (Chrome only; Firefox holds it in its background page)
- `host_permissions`: To access YouTube.com

## Persistance Storage

Chrome's storage API is used with the following data structure format:
```javascript
{
  youtubeBookmarks: [
    {
      id: "video_id",
      title: "Video Title",
      url: "https://youtube.com/watch?v=video_id",
      bookmarks: [
        {
          id: "cp_…",         // absent on checkpoints from before ids
          time: 120,          // whole seconds, for links
          start: 120.34,      // a span, to the hundredth when highlighted
          end: 131.9,
          timestamp: 1234567890,
          title: "the first sixty characters of what was said",
          subtitle: "what the transcript said over the span",
          note: "your own note, edited in the reader"
        }
      ]
    }
  ],
  // The reader's player size in each layout, a percentage, set by dragging.
  bbReaderSizes: { split: 62, stacked: 55, theatre: 34, focus: 30 }
}
```

Two checkpoints are the same one when their ids match. Records from before ids
still compare by time, exactly as they always did, so re-importing an old export
adds nothing — and a new checkpoint is never swallowed by an old one that merely
begins in the same second. Nothing on disk is rewritten to add an id.

The X pouch is four keys rather than two, because people and posts keep
independent topic lists and array order is the display order:

```javascript
{
  bbXPeopleTopics: [{ id: "xpt_…", name: "CUDA", createdAt: 0 }],
  bbXPostTopics:   [{ id: "xst_…", name: "CUDA", createdAt: 0 }],
  bbXPeople: [
    { id, topic: "xpt_…", handle: "@isorokin", name: "Ilya Sorokin",
      avatar: "https://pbs.twimg.com/profile_images/…_bigger.jpg",
      note: "warp-level tricks", addedAt: 0 }
  ],
  bbXPosts: [
    { id: "<status id>", topic: "xst_…", handle: "@isorokin", name: "Ilya Sorokin",
      text: "…", url: "https://x.com/isorokin/status/…", postedAt: 0, savedAt: 0 }
  ]
}
```

A person's `id` is ours and their `handle` is the key they are recognised by; a
post's `id` *is* its status id, which is the only thing about a post that never
changes. `postedAt` is stored rather than the "6h" X was showing at the time,
because a stored "6h" is wrong by tomorrow.

The LeetCode log is three keys. A problem is kept for as long as you care about
the problem; a day bucket is three numbers for a square on a heat map and is
dropped after four hundred days, which is a year of map plus the slack to scroll
it. Templates are an array, because their order is the display order:

```javascript
{
  bbLeetProblems: {
    "two-sum": {
      slug: "two-sum", title: "Two Sum", difficulty: "Easy",
      tags: ["Array", "Hash Table"], url: "https://leetcode.com/problems/two-sum/",
      note: "two pointers, sorted input only", seenAt: 0, solvedAt: 0,
      attempts: [{ at: 0, status: "Accepted", seconds: 420, runtime: "52 ms" }],
      fsrs: { stability: 3.17, difficulty: 5.28, due: 0, reviewedAt: 0,
              reps: 1, lapses: 0, grade: 3 }
    }
  },
  bbLeetDays: { "2026-09-24": { submitted: 4, solved: 1, seconds: 2730 } },
  bbLeetTemplates: [
    { id: "lt_…", name: "binary search", lang: "python3", body: "lo, hi = 0, n",
      createdAt: 0, usedAt: 0, uses: 0 }
  ]
}
```

A problem is keyed by its slug, which is the only stable name it has — titles
are edited and difficulties are re-rated, and all of those are LeetCode's and are
refreshed from the page on every visit. The note, the attempts and the schedule
are yours and survive every refresh. `attempts` is newest first and capped at
twenty. `fsrs` is `null` until the problem is graded, which is what puts an
ungraded solve under Solved rather than in the queue.

The day key is **local**, not UTC: an evening's practice east of Greenwich would
otherwise light up tomorrow's square, and a morning's west of it yesterday's.

A template's `lang` is LeetCode's own spelling, and `""` means "any language" —
not a fallback for a language with no templates of its own so much as a category,
since a comment header is not Python or C++.

The TypeRacer log is three keys, because they age at three different rates. A
race is a row in a table and the last two hundred is all a table wants. The
n-gram tables have no age at all — they are capped by how many distinct grams
they hold, not by when they were typed. A day bucket is three numbers for a
square on a heat map, and is dropped after four hundred days:

```javascript
{
  bbTyperRaces: [
    { at: 0, wpm: 84, accuracy: 97.4, seconds: 31.2, chars: 260, errors: 6,
      correctionMs: 2400, cleanWpm: 91, quoteId: "3810721", place: 2, of: 5 }
  ],
  bbTyperGrams: {
    bi:  { "th": { n: 412, ms: 51500, err: 3 } },
    tri: { "the": { n: 210, ms: 27300, err: 1 } },
    chars: { "e": { due: 5120, wrong: 41, subs: { "r": 28, "w": 9 },
                    n: 4800, ms: 566400 } },
    totalN: 18400, totalMs: 2392000, updatedAt: 0
  },
  bbTyperDays: { "2026-09-24": { races: 7, seconds: 214, best: 88 } }
}
```

`ms` is a **sum**, not a mean — means do not merge, and these tables are merged
on every race. Everything read off them is derived at read time from `n` and
`ms`. A gram's `n` is how many readings it has; once a table is over its cap the
rarest are evicted, and an entry seen eight times or more never is — meeting
forty new pairs today must not cost you the pair you have two hundred readings
of. `chars` carries both halves of a character's story: `due` and `wrong` are
how often you met it and got it wrong, and `n`/`ms` are the intervals that
landed on it, which is the baseline a pair ending in it is judged against.

The day key is **local**, not UTC, for the same reason the LeetCode one is.

The chat sites keep four keys, and none of them is a conversation: the site has
those, and a copy here would be a second history to go stale. Pins are keyed by
site and conversation, and a pin by the turn's id; the chat's title and address
are kept beside its pins so the dashboard can list and open them without a
session on the site:

```javascript
{
  bbChatPins: {
    "chatgpt:<conversation id>": {
      title: "Flaky login test", url: "https://chatgpt.com/c/…", updatedAt: 0,
      pins: [{ node: "<turn id>", label: "the fix", excerpt: "first 140 characters", at: 0 }]
    }
  },
  bbPromptTemplates: [
    { id: "pt_…", name: "Code review", body: "Review the code below… {{code}}",
      sites: [], createdAt: 0, usedAt: 0, uses: 0 }
  ],
  bbPromptQueue: {
    items: [{ id: "pq_…", site: "chatgpt", conv: "<id>" | null, chain: "pc_…",
              text: "…", model: "", notBefore: 0,
              status: "waiting" | "sending" | "sent" | "held" | "failed",
              note: "", createdAt: 0, sentAt: 0 }],
    holds:  { chatgpt: { until: 0, reason: "GPT-5 limit" } },
    leases: { "chatgpt:<id>": { by: "<page id>", until: 0 } },
    paused: { "chatgpt:<id>": true }
  },
  bbChatPanel: { open: true, tab: "outline" }
}
```

A template's `sites: []` is every chat site. A queued prompt with `conv: null`
was queued on the new-chat page; its `chain` is what keeps "ask these three in a
new chat" in one chat once the first has made it. The lease is how two tabs on
one chat avoid sending the same prompt twice. Sent and failed prompts are kept a
day, so the strip can say what happened, and then let go.

The daily limit is two keys — what the limits are, and what today has gone on —
both keyed by host, so neither knows anything about which sites have a workspace:

```javascript
{
  bbLimitSites: {
    "x.com":      { minutes: 30, savedAt: 0 },
    "reddit.com": { from: "07:00", to: "09:00", savedAt: 0 }
  },
  bbTimeLimits: {
    day: "2026-09-24",
    seconds: { "x.com": 1740 },
    snoozed: { "x.com": { until: 0, count: 2 } }
  }
}
```

A row has `minutes` or it has `from` and `to`, never both. `bbTimeLimits` is one
day deep: anything whose `day` is not today is discarded whole rather than aged
out, which is also what clears a snooze at midnight. An expired snooze keeps its
row inside the day, with `until` left in the past, so the count stays honest —
dropping it the moment it lapsed would say "first" again every ten minutes.

A roster is the list last read off a site, and at most one job in flight:

```javascript
{
  bbRosters: {
    twitter: { names: ["isorokin", "…"], readAt: 0 },
    reddit:  { names: ["rust", "cpp"],   readAt: 0 }
  },
  bbRosterJob: {
    site: "twitter", action: "apply", names: ["…"], found: [],
    at: 12, done: 11, skipped: 1, failed: 0,
    day: "2026-09-24", today: 12, status: "running", note: "",
    nextAt: 0, leaseBy: "k3f9a1", leaseUntil: 0
  }
}
```

`at` is the only thing that moves through the list; `done`, `skipped` and
`failed` are counts rather than lists, because writing two thousand names back
on every step is a storage write per action for something nobody reads. `today`
is against the site's cap and is reset by the `day` turning over, since a job of
four hundred names runs over days by design. `leaseBy` is the page currently
holding the job — two tabs would otherwise follow the same account twice — and it
is handed back before each navigation, with `leaseUntil` covering the case where
the tab is simply closed.

A watch party keeps nothing in `chrome.storage.local` beyond its `party*`
settings. The room, its members and its invites live in the session and are
gone with it. Two keys sit in `chrome.storage.session`, which the browser
empties when it closes:

```javascript
{
  bbPartyTab:   { tabId: 123, site: "youtube" },    // the party's tab, while one is on
  bbPartyEnded: { code: "host-left", at: 0 }        // why the last party ended, until the popup has said so
}
```

`bbPartyTab` is there because the worker is not: it is stopped and started all
evening, and has to know which tab to inject into again when that tab reloads.
`bbPartyEnded` is there because a party usually ends while the popup is closed.

## Watch party protocol

The watch party carries **control, not media**: everyone plays from their own
Netflix or YouTube, and what travels is play, pause, seek, rate and which
video. This is what a party server has to do. The extension's own authority,
`src/shared/party-room.js`, is the reference implementation — a peer-to-peer
party runs it in the host's browser, and a server party expects a server that
behaves the same way — and `tests/party-vectors.json` pins the behaviour down
case by case, the way `src/background/proto.js` pins down sowon's wire format.

A server is checked against those same cases over real sockets with
`node tests/party-conformance.js ws://host:port` (Node 22 or later, no
dependencies). `node tests/party-dev-server.js` is a stand-in to develop the
extension against, and passes it.

### Transport

- WebSocket, text frames, one JSON object per frame, at most **8 KB**. A frame
  that is not a JSON object, or is larger, closes the connection.
- Every message has a string `t`, its type. Unknown types are ignored, so a
  newer client can talk to an older server.
- Times are milliseconds since the Unix epoch on the **server's** clock — the
  room clock. Clients measure their offset from it with `ping`.
- The same messages flow over WebRTC data channels in a peer-to-peer party,
  where the host's browser is the server.

### Joining

| Client sends | Server answers |
| --- | --- |
| `create {v:1, name, policy:{control, wait}}` | `created {room, secret}`, then `welcome` |
| `hello {v:1, room, secret, name}` | `welcome`, or `error {code}` and close |
| `hello {v:1, room, resume}` | `welcome` for the same member id and role, or `error {code:'expired'}` |

`room` is short and shareable; `secret` is 16 random bytes, base64url. The
secret is checked on `hello` and never sent back out. A room is discarded a
minute after its last member is gone.

```
welcome {v:1, you, resume, now,
         room: {id, policy:{control, wait, locked}, members:[…], state:{…}}}
```

`resume` is a token for coming back within the grace period with the same id
and role — after a dropped connection, a reloaded offscreen document, or a
laptop lid.

Error codes: `version`, `no-room`, `bad-secret`, `expired`, `locked`, `full`,
`kicked`.

### The state vector

```
state {seq, media:{site, id} | null, paused, pos, rate, at, by,
       hold:{waiting:[memberId], since} | null, ack?:{member, id}}
```

The position at room time `now` is

```
paused or hold or now <= at   →  pos
otherwise                     →  pos + (now − at) / 1000 × rate
```

An `at` in the future is a scheduled start: the room is playing from `pos`
once that moment arrives. The server only ever broadcasts whole vectors, and a
client keeps the one with the highest `seq`, so loss, duplication and
reordering are all harmless.

### Messages

Client → server:

| Message | Meaning |
| --- | --- |
| `ping {c, seq, rtt?}` | Heartbeat and clock sample; `seq` is the client's latest; `rtt` its own measure, for the member list |
| `intent {id, base, op, pos, at, rate?, media?, paused?}` | "I did this, at this position, at this room time, having seen `base`." `op` is `play`, `pause`, `seek`, `rate` or `media` |
| `ready {ready, why?}` | `ready:false` with `why` of `buffering`, `loading` or `ad` |
| `request {op}` | A guest asking the hosts to do something, in host control |
| `policy {control?, wait?, locked?}` | Host only |
| `role {member, role}` | Host only: `cohost`, `guest`, or `host` to hand over |
| `kick {member}` | Host only |
| `solo {solo}` | Step out of the room's playback, or back in |
| `chat {text}` | A line of chat; see Chat, below |
| `bye` | Leaving |

Server → client:

| Message | Sent to |
| --- | --- |
| `pong {c, s, s2, seq}` | the pinger. `s` when the ping arrived, `s2` when the pong left. If the pinger's `seq` differs, a `state` follows |
| `state {…}` | everyone, on every change. `ack` names the intent that caused it |
| `reject {id, why}` then `state` | the sender only. `why` is `invalid`, `policy`, `rate-limit` or `conflict` |
| `members {list}` | everyone, when anyone arrives, leaves, or changes role, readiness, solo, away or lagging |
| `policy {control, wait, locked}` | everyone, when the host changes it |
| `request {from, op}` | the host and co-hosts |
| `chat {id, from, name, at, text, past?}` | everyone, the sender included, for each line; and after every `welcome`, the room's recent lines to the one welcomed, with `past: true` |
| `error {code}` | the one being refused or kicked, then close |

A member entry is `{id, name, role, ready, why, solo, away, rtt, lagging}`.
Names are trimmed, whitespace collapsed, capped at 32 characters, and default
to `Guest`.

### The authority's rules

An intent is checked in this order, and the first failure rejects it:

1. **Valid.**
   - `op` is known, and `id` and `base` are non-negative integers.
   - `pos` is finite, then clamped to 0 through 86400.
   - `at` is clamped to `[now − 3000, now + 500]`, and is `now` if absent.
   - `rate` (for `rate`) is between 0.25 and 5.
   - `media` (for `media`) matches its site: YouTube `^[A-Za-z0-9_-]{11}$`,
     Netflix `^\d{1,12}$`.

   A peer names a video by id and never by URL. Each client builds the address
   itself.
2. **Permitted.** In `host` control only the host and co-hosts may send
   intents. A solo member may not send them in any mode.
3. **Not too many.** At most 5 intents per member per second.
4. **Not a collision.** An intent collides when all three of these hold:
   - its `base` is not the current `seq`,
   - the last accepted intent came from someone else,
   - that intent was accepted less than 1500 ms ago.

   The first of two simultaneous clicks stands. The second person gets
   `conflict` and snaps to it.

An accepted intent sets `pos` and `at` from the intent, and then:

- `play` sets `paused` to false, and `pause` sets it to true.
- `rate` sets `rate`.
- `media` sets `media`, and sets `paused` from the intent (default true).
- Every op except `rate` clears a hold.
- `by` becomes the sender and `seq` goes up by one.
- The resulting state is broadcast with `ack`.

A `play` accepted while members are still not ready starts the room already
held on them (see holds).

Changes the room makes itself (holds and releases) also raise `seq`, and they
count as the latest `seq` for the collision rule. A member who saw the hold is
not colliding with anything by acting on it.

### Holds

With `wait` on, the room may wait for a member who reports `ready:false`,
unless any of these is true:

- The reason is `ad`.
- The room is paused.
- The member is solo, away, or lagging.
- More than 6 members are present.

A hold works like this:

- **Starting.** The first such member starts a hold: `pos` becomes the
  position at that moment, `at` becomes now, and `hold` becomes
  `{waiting:[id], since:now}`. Later ones are added to `waiting`.
- **Leaving it.** Being ready again, leaving, going away or going solo removes
  a member from `waiting`.
- **Release.** When `waiting` empties, the room releases. `hold` becomes null
  and `at` becomes `now + lead`, where
  `lead = clamp(max present rtt / 2 + 150, 250, 1000)` ms.
- **Timeout.** A hold older than **8 s** releases anyway. Whoever it was still
  waiting for is marked `lagging` for 2 minutes.
- **Anti-flap.** A member's third hold within 2 minutes does not hold the
  room. It marks them `lagging` for 5 minutes.

A lagging member catches up by seeking instead of stopping everyone.

### Chat

- **Cleaning.** Control characters other than whitespace (U+0000–U+0008,
  U+000E–U+001F, U+007F–U+009F) and U+FEFF are removed, every run of Unicode
  White_Space becomes one space, the ends are trimmed, and the line is cut to
  **500** code points. A line with nothing left is dropped.
- **Budget.** At most **5** lines per member in any **5 s**. Past that a line
  is dropped without an answer. It is a budget of its own, apart from the
  intents' five a second: chatting must never get a pause refused.
- **A line** is broadcast as `chat {id, from, name, at, text}`: `id` minted
  (unique, never a count — a new host carries old lines into a new room, and
  a counter starting again would reuse ids members already hold), `from` the
  sender, `name` their name when they said it, `at` the room time.
- **History.** The server keeps the last **50** lines and sends them, oldest
  first with `past: true`, right after every `welcome`, a resume included.
  Not inside the welcome: fifty lines of five hundred characters is far past
  the 8 KB frame. A client drops a line whose `id` it already has.
- Nothing is kept once the room is discarded.

### Liveness

The server runs its timeouts about once a second.

- **Away.** A member not heard from for **15 s** is `away`. Any message brings
  them back.
- **Removed.** At **60 s** the member is removed, which also ends their resume
  grace.
- **Handover.** A host who goes away, or leaves, hands the room to the first
  present co-host, else the earliest present member. An away host becomes a
  co-host. If everyone is away, the host keeps the role.
- **Kicked.** A kicked member gets `error {code:'kicked'}` and is removed.

### Constants

| Name | Value |
| --- | --- |
| max members | 16 |
| max frame | 8 KB |
| intents per second | 5 |
| collision window | 1500 ms |
| `at` accepted | −3000 / +500 ms |
| away / removed | 15 s / 60 s |
| hold timeout | 8 s |
| holds only up to | 6 members present |
| anti-flap | 3 holds in 120 s → lagging 5 min |
| timed-out straggler | lagging 2 min |
| release lead | 250–1000 ms, max rtt / 2 + 150 |
| chat line | 500 code points |
| chat lines | 5 per member in any 5 s |
| chat history | 50 lines |

## Tests

```bash
node tests/serve.js
```

Then open <http://localhost:5601/tests/>. Opening `tests/index.html` directly
works too, if your browser allows `file://` sub-resource loads. **Run it in a
tab you can see** — a browser throttles timers hard in a background tab and the
suite is built on them, so hidden it takes minutes instead of seconds.

For the parts that are pure logic there is also a fast gate that needs no
browser at all:

```bash
node tests/node-check.js
```

See [tests/README.md](tests/README.md).

inspired by:
https://github.com/NabokD/pockettube
https://github.com/jdepoix/youtube-transcript-api.git
