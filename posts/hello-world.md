---
title: Hello, world!
date: 2026-10-27
---

Another blog, 17 years after my first one -- which 9-year-old me built using CUTTING-EDGE XSLT™ while pretending to "teach" PHP and WordPress hacks.

Let's see how long I'll keep this one alive before I get bored and delete it.

<script setup>
import { ref } from 'vue'
const show = ref(false)
</script>

<button @click="show = !show">{{ show ? 'Hide' : 'Show' }} test elements</button>

<div id="test-elements" v-show="show">

## Inline text

Lorem ipsum **bold text** dolor sit amet, _italic text_ consectetur adipiscing elit. Sed do ***bold italic*** eiusmod tempor ~~strikethrough~~ incididunt ut labore. Here is `inline code` in a sentence, an [external link](https://example.com), and an [internal link](/) back home.

Some HTML-only bits: <kbd>Ctrl</kbd> + <kbd>C</kbd>, <mark>highlighted text</mark>, H<sub>2</sub>O, x<sup>2</sup>, <abbr title="Lorem Ipsum Dolor">LID</abbr>, and <small>small print</small>.

A very long text to test wrapping: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

## Headings

### Heading level 3

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

#### Heading level 4

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

##### Heading level 5

###### Heading level 6

## Lists

Unordered:

- Lorem ipsum dolor sit amet
- Consectetur adipiscing elit, with a longer item that wraps onto a second line so you can check the hanging indent looks right
  - Nested item one
  - Nested item two
    - Third level
- Sed do eiusmod tempor

Ordered:

1. First step
2. Second step
   1. Sub-step a
   2. Sub-step b
3. Third step

## Blockquote

> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

> A multi-paragraph quote.
>
> With a second paragraph and **bold** and `code` inside.

With an author:

<figure>
  <blockquote cite="https://example.com/source">
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.</p>
  </blockquote>
  <figcaption>Jane Joe, <cite>Lorem Ipsum: A Novel</cite></figcaption>
</figure>

## Code

```rust
fn main() {
    let items = vec!["lorem", "ipsum", "dolor"];

    for (i, item) in items.iter().enumerate() {
        println!("{i}: {item}");
    }
}
```

With highlighted lines:

```ts{2,3}
import { createContentLoader } from 'vitepress'
const loader = createContentLoader('posts/*.md')
const posts = await loader.load()
console.log(posts.length)
```

With line numbers:

```go:line-numbers
package main

import "fmt"

func main() {
	fmt.Println("hello, world")
}
```

No language:

```
plain text block
  with indentation preserved
```

A long line to test horizontal scrolling:

```bash
curl -sSL https://example.com/a/very/long/url/that/should/not/wrap/but/scroll/horizontally/inside/the/code/block?with=query&params=true
```

## Table

| Name   | Left aligned | Centered | Right aligned |
| ------ | :----------- | :------: | ------------: |
| Lorem  | Ipsum dolor  |    1     |         10.00 |
| Sit    | Amet         |    22    |        200.50 |
| Tempor | Incididunt   |   333    |      3,000.75 |

## Separator

Lorem ipsum above the line.

***

Lorem ipsum below the line.

## Alerts

> [!NOTE]
> Note alert. Lorem ipsum dolor sit amet.

> [!TIP]
> Tip alert with `code` and a [link](/).

> [!IMPORTANT]
> Important alert.

> [!WARNING]
> Warning alert.

> [!CAUTION]
> Caution alert.

## Details

::: details Click to expand
Hidden content.
:::

## Emoji

:tada: :rocket: :cat:

</div>
