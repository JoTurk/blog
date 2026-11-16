<script setup lang="ts">
import { getScrollOffset, useRoute } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Tick {
	id: string
	text: string
	level: number
	target: number
	pos: number
}

const QUERY =
	'(hover: hover) and (pointer: fine) and (min-width: 1024px) and (prefers-reduced-motion: no-preference)'

const route = useRoute()
const enabled = ref(false)
const scrollable = ref(false)
const progress = ref(0)
const label = ref('0%')
const ticks = ref<Tick[]>([])
const active = ref(-1)

let maxScroll = 0
let raf = 0
let resizeObserver: ResizeObserver | undefined
let media: MediaQueryList | undefined

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))

function collect() {
	const root = document.documentElement
	maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
	scrollable.value = maxScroll > 120

	const offset = getScrollOffset()
	const seen = new Set<string>()
	const found: Tick[] = []
	document.querySelectorAll<HTMLElement>('h2[id], h3[id]').forEach((h) => {
		if (h.closest('nav, aside, header, footer') || seen.has(h.id)) return
		if (h.getClientRects().length === 0) return
		seen.add(h.id)
		const pad = Number.parseInt(getComputedStyle(h).paddingTop, 10) || 0
		const top = h.getBoundingClientRect().top + window.scrollY
		const target = clamp(top - offset + pad, 0, maxScroll)
		found.push({
			id: h.id,
			text: (h.textContent || '').replace(/[#\u200b]+$/, '').trim(),
			level: h.tagName === 'H2' ? 2 : 3,
			target,
			pos: maxScroll ? target / maxScroll : 0,
		})
	})
	ticks.value = found
}

function update() {
	raf = 0
	const y = window.scrollY
	progress.value = maxScroll ? clamp(y / maxScroll) : 0
	label.value = `${Math.round(progress.value * 100)}%`

	let idx = -1
	ticks.value.forEach((t, i) => {
		if (t.target <= y + 1) idx = i
	})
	active.value = idx
}

function onScroll() {
	if (!raf) raf = requestAnimationFrame(update)
}

function refresh() {
	collect()
	update()
}

function start() {
	refresh()
	window.addEventListener('scroll', onScroll, { passive: true })
	window.addEventListener('resize', refresh)
	resizeObserver = new ResizeObserver(refresh)
	resizeObserver.observe(document.body)
}

function stop() {
	window.removeEventListener('scroll', onScroll)
	window.removeEventListener('resize', refresh)
	resizeObserver?.disconnect()
	resizeObserver = undefined
	cancelAnimationFrame(raf)
	raf = 0
}

// Live: crossing 1024px or toggling reduced motion adds/removes the rail
function onMediaChange() {
	const matches = media?.matches ?? false
	if (matches === enabled.value) return
	enabled.value = matches
	if (matches) start()
	else stop()
}

onMounted(() => {
	media = window.matchMedia(QUERY)
	media.addEventListener('change', onMediaChange)
	onMediaChange()
})

onBeforeUnmount(() => {
	media?.removeEventListener('change', onMediaChange)
	stop()
})

watch(
	() => route.path,
	() =>
		nextTick(() =>
			setTimeout(() => {
				if (enabled.value) refresh()
			}, 120),
		),
)
</script>

<template>
	<nav
		v-if="enabled && scrollable"
		class="scroll-rail"
		:style="{ '--p': progress }"
		aria-label="Page sections"
	>
		<span class="track" aria-hidden="true"></span>
		<span class="fill" aria-hidden="true"></span>

		<a
			v-for="(t, i) in ticks"
			:key="t.id"
			:href="`#${t.id}`"
			class="tick"
			:class="{ passed: i <= active, current: i === active, minor: t.level === 3 }"
			:style="{ '--t': t.pos }"
			:aria-current="i === active ? 'location' : undefined"
		>
			<span class="tick-label">{{ t.text }}</span>
		</a>

		<span class="knob" aria-hidden="true"></span>
		<span class="thumb" aria-hidden="true">{{ label }}</span>
	</nav>
</template>

<style>
pre,
table {
	scrollbar-width: thin;
	scrollbar-color: var(--rule) transparent;
}
</style>

<style scoped>
.scroll-rail {
	--thumb: 26px;
	position: fixed;
	top: 20px;
	/* Inset from the edge so it never sits under an overlay scrollbar (macOS etc.) */
	right: 14px;
	bottom: 20px;
	z-index: 60;
	width: 22px;
	user-select: none;
	opacity: 0.25;
	transition: opacity 0.25s;
}

/* Scrolling never changes the rail's look; it only brightens under the cursor. */
.scroll-rail:hover,
.scroll-rail:has(.tick:focus-visible) {
	opacity: 1;
}

.track,
.fill {
	position: absolute;
	left: 50%;
	width: 4px;
	margin-left: -2px;
	background-size: 4px 8px;
	background-repeat: repeat-y;
	pointer-events: none;
}

.track {
	top: 0;
	bottom: 0;
	background-image: radial-gradient(circle at 50% 50%, var(--rule) 1.25px, transparent 1.75px);
}

.fill {
	top: 0;
	height: calc(var(--p) * (100% - var(--thumb)) + var(--thumb) / 2);
	background-image: radial-gradient(circle at 50% 50%, var(--accent) 1.25px, transparent 1.75px);
}

.tick {
	position: absolute;
	left: 0;
	top: calc(var(--t) * (100% - var(--thumb)) + var(--thumb) / 2 - 8px);
	width: 100%;
	height: 16px;
	pointer-events: auto;
	cursor: pointer;
	text-decoration: none;
	outline: none;
}

.tick::before {
	content: "";
	position: absolute;
	top: 50%;
	left: 50%;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--muted);
	box-shadow: 0 0 0 2px var(--bg);
	transform: translate(-50%, -50%);
	transition: transform 0.15s, background 0.15s;
}

.tick.minor::before {
	width: 5px;
	height: 5px;
}

.tick.passed::before {
	background: var(--accent);
}

/* Current section is marked by size only. A halo ring here gets scaled by
   the hover rule right after a click and reads as a muddy shadow. */
.tick.current::before {
	transform: translate(-50%, -50%) scale(1.3);
}

.tick:hover::before,
.tick:focus-visible::before {
	transform: translate(-50%, -50%) scale(1.5);
}

.tick:focus-visible::before {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}

.tick-label {
	position: absolute;
	top: 50%;
	right: calc(100% + 4px);
	max-width: 240px;
	padding: 4px 10px;
	border-radius: 6px 6px 0 6px;
	background: var(--bubble);
	color: var(--bubbletext);
	font-family: var(--font-sans);
	font-size: 0.8125rem;
	font-weight: 400;
	line-height: 1.4;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;
	opacity: 0;
	transform: translateY(-50%);
	z-index: 2;
}

.tick:hover .tick-label,
.tick:focus-visible .tick-label {
	opacity: 1;
}

.knob {
	position: absolute;
	left: 50%;
	top: calc(var(--p) * (100% - var(--thumb)) + var(--thumb) / 2);
	width: 11px;
	height: 11px;
	border-radius: 50%;
	background: var(--accent);
	box-shadow: 0 0 0 3px var(--bg);
	transform: translate(-50%, -50%);
	pointer-events: none;
}

.thumb {
	position: absolute;
	right: 20px;
	top: calc(var(--p) * (100% - var(--thumb)));
	min-width: 48px;
	height: var(--thumb);
	padding: 0 10px;
	border-radius: 6px 6px 0 6px;
	background: var(--bubble);
	color: var(--bubbletext);
	font-family: var(--font-mono);
	font-size: 0.75rem;
	line-height: var(--thumb);
	text-align: center;
	font-variant-numeric: tabular-nums;
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.1s;
}

/* % bubble on rail hover, but give way to a dot's own label */
.scroll-rail:hover:not(:has(.tick:hover)) .thumb {
	opacity: 1;
	transition: opacity 0.2s 0.2s;
}

.scroll-rail:has(.tick:hover) .thumb {
	transition: none;
}

</style>
