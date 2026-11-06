<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

const W = 32
const OLD = 3
const NEW = 3
const CELLS = OLD + W + NEW
const START = 47
const LATE = [41, 44]
const FLY = 650

type Mode = 'safe' | 'naive'
type Sender = 'client' | 'mallory'

interface Flying {
	id: number
	seq: number
	from: Sender
}

interface Entry {
	id: number
	seq: number
	from: Sender
	ok: boolean
	text: string
}

const mode = ref<Mode>('safe')
const top = ref(START)
const seen = reactive(new Set<number>())
const nextSeq = ref(START + 1)
const flying = ref<Flying[]>([])
const log = ref<Entry[]>([])
const flash = ref<{ seq: number; ok: boolean; id: number }>()
const mood = reactive<Record<'client' | 'server' | 'mallory', AnimationName>>({
	client: 'idle',
	server: 'idle',
	mallory: 'idle',
})
let ids = 0
let moodId = 0
let timers: ReturnType<typeof setTimeout>[] = []

const low = computed(() => top.value - W + 1)

function later(ms: number, fn: () => void) {
	if (ms <= 0) return fn()
	const timer = setTimeout(() => {
		timers = timers.filter((t) => t !== timer)
		fn()
	}, ms)
	timers.push(timer)
}

function reset() {
	for (const t of timers) clearTimeout(t)
	timers = []
	top.value = START
	nextSeq.value = START + 1
	seen.clear()
	for (let s = START - W + 1; s <= START; s++) {
		if (!LATE.includes(s)) seen.add(s)
	}
	flying.value = []
	log.value = []
	flash.value = undefined
	Object.assign(mood, { client: 'idle', server: 'idle', mallory: 'idle' })
}
reset()

function slide(to: number) {
	top.value = to
	for (const s of seen) if (s < to - W + 1) seen.delete(s)
}

function record(seq: number, from: Sender, ok: boolean, text: string) {
	log.value = [{ id: ids++, seq, from, ok, text }, ...log.value].slice(0, 5)
	const id = ids++
	flash.value = { seq, ok, id }
	later(900, () => {
		if (flash.value?.id === id) flash.value = undefined
	})
}

function receive(seq: number, from: Sender, authentic: boolean) {
	const before = top.value
	if (seq < low.value) {
		record(seq, from, false, 'left of the window: too old, dropped')
	} else if (seq <= top.value && seen.has(seq)) {
		record(seq, from, false, 'already seen: replay, dropped')
	} else if (!authentic) {
		if (mode.value === 'naive') {
			slide(seq)
			record(
				seq,
				from,
				false,
				'window slid, THEN it failed authentication. Too late',
			)
		} else {
			record(
				seq,
				from,
				false,
				'fails authentication: dropped, window stays put',
			)
		}
	} else if (seq > top.value) {
		slide(seq)
		seen.add(seq)
		const by = seq - before
		record(seq, from, true, `new highest: accepted, window slides ${by}`)
	} else {
		seen.add(seq)
		record(seq, from, true, 'in the window, not seen yet: accepted')
	}

	const ok = log.value[0].ok
	if (from === 'mallory') {
		const won = mode.value === 'naive' && !authentic && seq >= top.value
		mood.mallory = won ? 'yay' : 'sad'
		mood.server = won ? 'idle' : 'wow'
	} else {
		mood.server = ok ? 'idle' : seq < low.value ? 'sad' : 'wow'
	}
	const id = ++moodId
	later(1400, () => {
		if (id !== moodId) return
		mood.server = clientBroken.value ? 'sad' : 'idle'
		mood.mallory = clientBroken.value ? 'yay' : 'idle'
	})
}

function send(seq: number, from: Sender, authentic = true, delay = 0) {
	later(delay, () => {
		if (from === 'client') mood.client = 'send'
		else mood.mallory = 'sneak'
		const flight = { id: ids++, seq, from }
		flying.value = [...flying.value, flight]
		later(FLY, () => {
			flying.value = flying.value.filter((f) => f.id !== flight.id)
			receive(seq, from, authentic)
			if (!flying.value.some((f) => f.from === from)) {
				if (from === 'client') mood.client = 'idle'
			}
		})
	})
}

function next() {
	send(nextSeq.value++, 'client')
}

function shuffled() {
	const base = nextSeq.value
	nextSeq.value += 4
	const order = [base + 2, base, base + 3, base + 1]
	order.forEach((seq, i) => {
		send(seq, 'client', true, i * 260)
	})
}

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)]
}

const replayable = computed(() => [...seen].filter((s) => s >= low.value))

function replayOld() {
	if (!replayable.value.length) return
	send(pick(replayable.value), 'mallory')
}

function replayAncient() {
	const hi = low.value - 1
	send(Math.max(0, hi - Math.floor(Math.random() * 20)), 'mallory')
}

function garbage() {
	send(top.value + 1_000_000, 'mallory', false)
}

function deliver(seq: number) {
	if (seq >= nextSeq.value) nextSeq.value = seq + 1
	send(seq, 'client')
}

function setMode(m: Mode) {
	mode.value = m
	reset()
}

const cells = computed(() => {
	const base = low.value - OLD
	return Array.from({ length: CELLS }, (_, i) => {
		const seq = base + i
		let state: 'old' | 'future' | 'seen' | 'open'
		if (seq < low.value) state = 'old'
		else if (seq > top.value) state = 'future'
		else if (seen.has(seq)) state = 'seen'
		else state = 'open'
		const hit =
			flash.value?.seq === seq ? (flash.value.ok ? 'hit-ok' : 'hit-bad') : ''
		return { seq, i, state, hit }
	})
})

function cellLabel(seq: number, state: string) {
	const meaning = {
		old: 'too old',
		future: 'not sent yet',
		seen: 'seen',
		open: 'in window, not seen',
	}[state]
	return `Deliver sequence number ${seq} (${meaning})`
}

const bitmap = computed(() => {
	let bits = ''
	for (let s = low.value; s <= top.value; s++) {
		bits += seen.has(s) ? '1' : '0'
		if ((s - low.value) % 8 === 7 && s < top.value) bits += ' '
	}
	return bits
})

const clientBroken = computed(
	() => mode.value === 'naive' && nextSeq.value < low.value,
)

const percent = (cells: number) => (cells / CELLS) * 100

onBeforeUnmount(() => {
	for (const t of timers) clearTimeout(t)
})
</script>

<template>
	<DemoFrame>
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Receiver logic">
				<button
					type="button"
					:aria-pressed="mode === 'safe'"
					@click="setMode('safe')"
				>
					authenticate, then slide
				</button>
				<button
					type="button"
					:aria-pressed="mode === 'naive'"
					@click="setMode('naive')"
				>
					slide, then authenticate
				</button>
			</div>
		</template>

		<div class="scene">
			<PixelSprite
				character="client"
				:animation="mood.client"
				:size="56"
				label="Client"
			/>
			<div class="wire">
				<span
					v-for="f of flying"
					:key="f.id"
					class="packet"
					:class="f.from"
					aria-hidden="true"
					>{{ f.seq }}</span
				>
				<PixelSprite
					class="mallory-sprite"
					character="mallory"
					:animation="mood.mallory"
					:size="44"
					label="Mallory"
				/>
			</div>
			<PixelSprite
				character="server"
				:animation="mood.server"
				:size="56"
				label="Server"
				flip
			/>
		</div>

		<div class="window-head">
			<span>too old</span>
			<span class="demo-mono">window {{ low }}–{{ top }}</span>
			<span>new</span>
		</div>
		<div class="strip">
			<button
				v-for="c of cells"
				:key="c.seq"
				type="button"
				class="cell"
				:class="[c.state, c.hit, { top: c.seq === top }]"
				:style="{
					width: `${percent(1)}%`,
					transform: `translateX(${c.i * 100}%)`,
				}"
				:disabled="c.seq < 0"
				:aria-label="cellLabel(c.seq, c.state)"
				:title="String(c.seq)"
				@click="deliver(c.seq)"
			>
				<span />
			</button>
			<span
				class="bracket"
				:style="{ left: `${percent(OLD)}%`, width: `${percent(W)}%` }"
			/>
		</div>
		<div class="ticks demo-mono">
			<span :style="{ left: `${percent(OLD)}%` }">{{ low }}</span>
			<span :style="{ left: `${percent(OLD + W)}%` }">{{ top }}</span>
		</div>
		<p class="bitmap demo-mono" aria-label="Window bitmap">{{ bitmap }}</p>

		<ol class="log demo-mono" aria-live="polite">
			<li v-if="!log.length" class="empty">nothing received yet</li>
			<li v-for="e of log" :key="e.id">
				<span class="who">{{ e.from === 'mallory' ? 'Mallory' : 'client' }}</span>
				<span class="seq">{{ e.seq }}</span>
				<span :class="e.ok ? 'demo-ok' : 'demo-bad'">{{ e.text }}</span>
			</li>
		</ol>
		<p v-if="clientBroken" class="demo-note demo-bad">
			Every real packet from here on is “too old”. Mallory broke the
			connection with one forged packet.
		</p>
		<p class="demo-note">
			Real DTLS keeps 64 slots. It only slides the window for records that
			pass authentication, so forged junk can't push it forward.
		</p>

		<template #controls>
			<div class="group">
				<button type="button" class="demo-btn" @click="next">
					next packet
				</button>
				<button type="button" class="demo-btn secondary" @click="shuffled">
					send a few out of order
				</button>
			</div>
			<div class="group" role="group" aria-label="Mallory">
				<span class="group-label">Mallory:</span>
				<button
					type="button"
					class="demo-btn danger"
					:disabled="!replayable.length"
					@click="replayOld"
				>
					replay an old packet
				</button>
				<button type="button" class="demo-btn danger" @click="replayAncient">
					replay a really old one
				</button>
				<button type="button" class="demo-btn danger" @click="garbage">
					send garbage with a huge seq
				</button>
			</div>
			<button type="button" class="demo-btn secondary" @click="reset">
				reset
			</button>
		</template>
		<template #caption>
			Green slots are sequence numbers already received. Tap any slot to
			deliver that number, or let Mallory replay things. Then switch to
			“slide, then authenticate” and send Mallory's garbage.
		</template>
	</DemoFrame>
</template>

<style scoped>
.scene {
	display: flex;
	align-items: center;
	gap: 8px;
}

.wire {
	position: relative;
	flex: 1;
	height: 76px;
	background: linear-gradient(var(--rule), var(--rule)) center 22px / 100% 2px
		no-repeat;
}

.mallory-sprite {
	position: absolute;
	bottom: -4px;
	left: 50%;
	transform: translateX(-50%);
}

.packet {
	position: absolute;
	top: 23px;
	padding: 3px 5px;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 700 0.6875rem / 1 var(--font-mono);
	white-space: nowrap;
	animation: fly 0.65s ease-in forwards;
	--from: 0%;
}

.packet.mallory {
	border-color: var(--danger);
	color: var(--danger);
	--from: 50%;
}

@keyframes fly {
	from {
		left: var(--from);
		transform: translate(-50%, -50%);
	}
	to {
		left: 100%;
		transform: translate(-100%, -50%);
	}
}

.window-head {
	display: flex;
	justify-content: space-between;
	margin: 14px 0 4px;
	color: var(--muted);
	font-size: 0.75rem;
}

.window-head .demo-mono {
	color: var(--text);
}

.strip {
	position: relative;
	height: 40px;
	overflow: hidden;
}

.cell {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	padding: 4px 1px;
	border: 0;
	background: none;
	cursor: pointer;
	transition: transform 0.35s ease;
}

.cell span {
	display: block;
	height: 100%;
	border: 1px solid var(--rule);
	border-radius: 0;
	background: var(--bg);
	transition:
		background 0.2s,
		box-shadow 0.2s;
}

.cell.seen span {
	border-color: var(--tip);
	background: var(--tip);
}

.cell.old span {
	opacity: 0.45;
	background: repeating-linear-gradient(
		-45deg,
		var(--bg) 0 3px,
		var(--rule) 3px 5px
	);
}

.cell.future span {
	border-style: dashed;
	background: none;
}

.cell.top span {
	box-shadow: 0 0 0 1px var(--accent);
}

.cell.hit-ok span {
	box-shadow: 0 0 0 2px var(--tip);
}

.cell.hit-bad span {
	border-color: var(--danger);
	background: var(--danger);
	box-shadow: 0 0 0 2px var(--danger);
	opacity: 1;
}

.cell:disabled {
	visibility: hidden;
}

.bracket {
	position: absolute;
	top: 0;
	bottom: 0;
	border: 2px solid var(--accent);
	border-radius: 0;
	pointer-events: none;
}

.ticks {
	position: relative;
	height: 1.4em;
	color: var(--muted);
	font-size: 0.6875rem;
}

.ticks span {
	position: absolute;
	top: 2px;
	transform: translateX(-50%);
}

.ticks span:last-child {
	transform: translateX(-100%);
}

.ticks span:first-child {
	transform: none;
}

.bitmap {
	margin: 6px 0 0;
	color: var(--muted);
	font-size: 0.6875rem;
}

.log {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-height: 9em;
	margin: 12px 0 0;
	padding: 8px 10px;
	border-radius: 0;
	background: var(--bg);
	font-size: 0.75rem;
	line-height: 1.4;
	list-style: none;
}

.log li {
	display: flex;
	flex-wrap: wrap;
	gap: 0 8px;
	margin: 0;
}

.log li:first-child:not(.empty) {
	font-weight: 700;
}

.log .empty,
.who {
	color: var(--muted);
}

.who {
	min-width: 7ch;
}

.seq {
	min-width: 7ch;
}

.group {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}

.group-label {
	color: var(--danger);
	font: 700 0.8125rem var(--font-mono);
}

@media (max-width: 520px) {
	.scene {
		gap: 4px;
	}

	.who,
	.seq {
		min-width: 0;
	}

	.log {
		min-height: 16em;
	}
}

@media (prefers-reduced-motion: reduce) {
	.packet {
		animation-timing-function: steps(3, jump-both);
	}

	.cell,
	.cell span {
		transition: none;
	}
}
</style>
