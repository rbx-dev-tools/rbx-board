# rbx-board

[![CI](https://github.com/rbx-dev-tools/rbx-board/actions/workflows/ci.yml/badge.svg)](https://github.com/rbx-dev-tools/rbx-board/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](./LICENSE)

A local board of your Roblox experiences: who is playing, visits, favourites,
rating, at a glance.

```sh
rbx-board
```

One executable. It serves a page on this machine, opens your browser at it, and
refreshes every fifteen seconds. Nothing to install beside it: the page is
inside the binary.

## It holds no credentials, and that is the design

Everything on this board is what a logged-out visitor already sees on the
experience's own page. No cookie, no API key, nothing in this process is worth
stealing.

That is what makes a local server safe to leave running. A server on
`127.0.0.1` is reachable by every other program on the machine and by any page
open in a browser. One holding a `.ROBLOSECURITY` cookie would be worth
attacking, and would need a token, an origin check, and a considered answer
about DNS rebinding. One that forwards public numbers needs none of that.

The cost is real and worth stating: **this board shows, it does not act.**
Publishing, renaming, and taking an experience private live in the CLIs, where
the credential already is.

## Which experiences

Three sources, and you rarely need more than one.

```sh
rbx-board --universe 1234567890 --universe 9876543210
```

Or an `rbxboard.toml`, which is the one to keep:

```toml
[[game]]
universe_id = 1234567890
label = "brainrot, main"

[[game]]
universe_id = 9876543210
label = "brainrot, second account"
```

`label` is your name for it. Roblox's own name is shown underneath when the two
differ, which is exactly the case when you publish the same game more than once.

And if there is an `rbxplace.toml` beside it, the file the deploy tools already
keep, its universes are picked up too, labelled by env name. A game you added to
a deploy shows up here without being typed twice.

## Flags

| | |
| --- | --- |
| `-u, --universe <ID>` | an experience to show, repeatable |
| `--config <PATH>` | the board's own file, default `rbxboard.toml` |
| `--places-file <PATH>` | the deploy env file, default `rbxplace.toml` |
| `-p, --port <PORT>` | default 0, which takes whatever is free |
| `--no-open` | print the address instead of opening a browser |

It binds the loopback and nothing else. The board holds nothing secret, but
"nothing secret" is not a reason to publish a service to the wifi a laptop
happens to be on.

## Install

With [Rokit](https://github.com/rojo-rbx/rokit):

```toml
[tools]
rbx-board = "rbx-dev-tools/rbx-board@0.1.0"
```

then `rokit install`. Or take a binary from the
[releases page](https://github.com/rbx-dev-tools/rbx-board/releases), which
ships one zip per platform with a `SHA256SUMS` beside them, or build from source
with `cargo install --git`.

macOS, Windows and Linux. The only per-platform behaviour is opening the
browser, and if that fails the address is printed for you to open yourself.

## Where this sits

| tool | does |
| --- | --- |
| **rbx-board** | **shows your experiences, read-only, no credentials** |
| [rbx-cli](https://github.com/rbx-forge/rbx-cli) | Open Cloud: metadata, shop, place upload, live ops |
| [rbx-inject](https://github.com/rbx-dev-tools/rbx-inject) | writes asset ids into a `.rbxl` before upload |
| [rbx-questionnaire](https://github.com/rbx-dev-tools/rbx-questionnaire) | the content questionnaire and the age rating |
| [rbx-observe](https://github.com/rbx-forge/rbx-observe) | the same kind of public data, for other people's games |

`rbx-observe` reads other people's storefronts for market research and prints to
a terminal. This one reads yours and draws them. Same source of truth, different
question.

## License

[MPL-2.0](./LICENSE).
