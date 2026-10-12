# Production batch audit: `bruh-wtf-production-batch-001`

- **Review date:** 2026-10-13
- **Pack:** `content/bruh-wtf-production-batch-001.json`
- **Pack type / format:** `production` / version `1`
- **Candidates:** 25 accepted; 2 rejected drafts retained in `question-history.json`
- **Reviewer:** Internal first-pass editorial review for this task; no second
  human reviewer or external playtest
- **Disposition:** Accepted for the calibration pack, pending player playtest

## Questions and validation

Question IDs:

`bruh-b001-warning-label`, `bruh-b001-vending-advice`,
`bruh-b001-self-checkout-case`, `bruh-b001-towel-exhibit`,
`bruh-b001-crossing-button`, `bruh-b001-almost-worked-museum`,
`bruh-b001-basket-announcement`, `bruh-b001-room-entry-rule`,
`bruh-b001-dragon-expense`, `bruh-b001-object-spokesperson`,
`bruh-b001-office-supply-diner`, `bruh-b001-goldfish-map-case`,
`bruh-b001-gnome-treaty`, `bruh-b001-mystery-parcel`,
`bruh-b001-shared-coat`, `bruh-b001-potato-float`,
`bruh-b001-elevator-anthem`, `bruh-b001-tavern-soup`,
`bruh-b001-party-expertise`, `bruh-b001-flatpack-cooking-show`,
`bruh-b001-reply-all-job`, `bruh-b001-haunted-office-gear`,
`bruh-b001-fridge-podcast`, `bruh-b001-barely-prepared`,
`bruh-b001-terms-curse`.

Commands and results:

```sh
npm run validate:bruh-wtf -- games/bruh-wtf/content/bruh-wtf-production-batch-001.json
npm run validate:bruh-wtf -- --all
```

Both pass. The individual validator checks the candidate against the existing
content library; all-pack validation reports 2 packs and 36 questions. There
are no structural, placeholder, ID, pack-reference, supported-category/tag,
or text-integrity errors. No exact normalized prompt duplicates were found.

## Coverage and originality

Category distribution (descriptive, no quotas):

- `group-chaos`: 3
- `ordinary-life`: 3
- `technology`: 3
- `creative-chaos`: 2
- `mystery`: 2
- `pop-culture`: 2
- `work-life`: 2
- `fantasy-roles`: 2
- `absurd-hypotheticals`, `confessions`, `competition`, `friend-roasts`,
  `money`, and `survival-missions`: 1 each

Target distribution: 17 one-player, 5 pair, and 3 three-player prompts. All
are tagged `evergreen`; none is adult-content or trend-dependent. Social
flirting was omitted to keep the default calibration batch non-suggestive.

The accepted prompt concepts were compared with all 11 development fixtures
and the existing template-family ledger. Intentional boundaries include a
haunted-office survival prompt rather than another emergency-kit prompt, a
pair mystery rather than a heist, and a new creative food concept rather than
another band-name or startup prompt. Exact matching cannot establish semantic
originality; one editor made this first-pass comparison and playtest feedback
may reveal weak or repetitive items.

Rejected drafts:

- `b001-reject-wish-prompt`: repeats `dev-wish`'s wish-grant premise.
- `b001-reject-bad-startup-pitch`: repeats `dev-startup`'s bad-startup pitch.

Both decisions and their family links are preserved in the history and ledger.
Neither rejection prohibits future questions in the associated category.

## Editorial and trend review

Prompts are fictional, open-ended scenarios. The party-confession prompt says
the party is fictional and asks for a harmless invented performance; it does
not request a truthful disclosure. The roast focuses on a player's reaction to
a minor inconvenience rather than any protected trait. No existing franchise,
source claim, trend reference, or external evidence is used. The elevator
prompt requests an original anthem chorus and does not ask players to reproduce
existing lyrics.

This is a calibration draft, not player-tested. The current game does not
provide adult-content opt-in filtering; the batch contains no adult or
suggestive prompts. Structural validation does not certify humour quality or
audience suitability.
