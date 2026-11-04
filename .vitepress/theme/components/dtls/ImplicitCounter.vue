<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import { aesGcm, type Bytes, hexList, random, utf8 } from './dtlsCrypto'
import PixelSprite from './PixelSprite.vue'

const WORDS = [
	'one',
	'lost',
	'postcard',
	'breaks',
	'every',
	'message',
	'after',
	'it',
]
// Timing (ms)
const TRIP = 2400
const GAP = 550
const FALL = 700

type Kind = 'tls' | 'dtls'

interface Flight {
	id: number
	n: number
	ct: Bytes
	sentAt: number
	duration: number
	dropAt?: number
	droppedAt?: number
	landed: boolean
}

interface Cell {
	id: number
	n: number
	used: number
	state: 'pending' | 'ok' | 'bad'
	word: string
}

interface Lane {
	kind: Kind
	cells: Cell[]
	counter: number
}

const lane = (kind: Kind): Lane => ({ kind, cells: [], counter: 0 })

const lanes = reactive({ tls: lane('tls'), dtls: lane('dtls') })
const flights = ref<Flight[]>([])
const shuffle = ref(false)
const ready = ref(false)
const started = ref(false)
const sending = ref(false)
const lost = ref(0)
const now = ref(0)
const reducedMotion = ref(false)

let key: Bytes | undefined
let iv: Bytes | undefined
let ids = 0
let frame = 0
let gen = 0
let loseNext = false
let timers: ReturnType<typeof setTimeout>[] = []

const info = {
	tls: {
		name: 'TLS on UDP',
		how: 'implicit counter',
		idle: 'nonce = IV ⊕ record number. The number itself is never sent.',
	},
	dtls: {
		name: 'DTLS',
		how: 'explicit sequence number',
		idle: 'Same nonce, but the record number rides in the header, in the clear.',
	},
}

function nonce(n: number): Bytes {
	const out = new Uint8Array(iv ?? new Uint8Array(12)) as Bytes
	let rest = BigInt(n)
	for (let i = 11; i >= 4; i--) {
		out[i] ^= Number(rest & 0xffn)
		rest >>= 8n
	}
	return out
}

function later(ms: number, fn: () => void) {
	const timer = setTimeout(() => {
		timers = timers.filter((t) => t !== timer)
		fn()
	}, ms)
	timers.push(timer)
}

function stop() {
	gen++
	cancelAnimationFrame(frame)
	for (const t of timers) clearTimeout(t)
	timers = []
	sending.value = false
}

function reset() {
	stop()
	Object.assign(lanes.tls, lane('tls'))
	Object.assign(lanes.dtls, lane('dtls'))
	flights.value = []
	lost.value = 0
	loseNext = false
	started.value = false
}

let motionQuery: MediaQueryList | undefined
function onMotionChange() {
	reducedMotion.value = motionQuery?.matches ?? false
}

onMounted(() => {
	key = random(16)
	iv = random(12)
	ready.value = true
	motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
	motionQuery.addEventListener('change', onMotionChange)
	onMotionChange()
})

onBeforeUnmount(() => {
	stop()
	motionQuery?.removeEventListener('change', onMotionChange)
})

async function send() {
	if (!key) return
	reset()
	const run = gen
	started.value = true
	sending.value = true
	const sealed = await Promise.all(
		WORDS.map((w, n) => aesGcm('encrypt', key as Bytes, nonce(n), utf8(w))),
	)
	if (run !== gen) return
	now.value = performance.now()
	sealed.forEach((ct, n) => {
		later(n * GAP, () => {
			const duration = shuffle.value
				? TRIP * (0.55 + Math.random() * 1.1)
				: TRIP
			const dropAt = loseNext ? 0.4 : undefined
			loseNext = false
			flights.value.push({
				id: ids++,
				n,
				ct,
				sentAt: performance.now(),
				duration,
				dropAt,
				landed: false,
			})
			if (n === WORDS.length - 1) sending.value = false
		})
	})
	frame = requestAnimationFrame(tick)
}

function progress(f: Flight, t: number) {
	return Math.min((t - f.sentAt) / f.duration, 1)
}

function tick() {
	const t = performance.now()
	now.value = t
	for (const f of flights.value) {
		if (f.droppedAt !== undefined || f.landed) continue
		const p = progress(f, t)
		if (f.dropAt !== undefined && p >= f.dropAt) drop(f)
		else if (p >= 1) {
			f.landed = true
			arrive(lanes.tls, f)
			arrive(lanes.dtls, f)
		}
	}
	flights.value = flights.value.filter(
		(f) => !f.landed && (f.droppedAt === undefined || t - f.droppedAt < FALL),
	)
	if (!sending.value && flights.value.length === 0) return
	frame = requestAnimationFrame(tick)
}

function drop(f: Flight) {
	if (f.droppedAt !== undefined || f.landed) return
	f.droppedAt = performance.now()
	lost.value++
}

function loseOne() {
	const f = flights.value.find((f) => f.droppedAt === undefined && !f.landed)
	if (f) drop(f)
	else loseNext = true
}

function arrive(l: Lane, f: Flight) {
	const run = gen
	const used = l.kind === 'tls' ? l.counter++ : f.n
	l.cells.push({ id: ids++, n: f.n, used, state: 'pending', word: '' })
	const cell = l.cells[l.cells.length - 1]
	aesGcm('decrypt', key as Bytes, nonce(used), f.ct).then(
		(pt) => {
			if (run !== gen) return
			cell.state = 'ok'
			cell.word = new TextDecoder().decode(pt)
		},
		() => {
			if (run !== gen) return
			cell.state = 'bad'
		},
	)
}

const inAir = computed(
	() =>
		sending.value ||
		flights.value.some((f) => f.droppedAt === undefined && !f.landed),
)

const settled = computed(
	() =>
		started.value &&
		!sending.value &&
		flights.value.length === 0 &&
		[lanes.tls, lanes.dtls].every((l) =>
			l.cells.every((c) => c.state !== 'pending'),
		),
)

const count = (l: Lane, state: Cell['state']) =>
	l.cells.filter((c) => c.state === state).length

function last(l: Lane) {
	for (let i = l.cells.length - 1; i >= 0; i--) {
		if (l.cells[i].state !== 'pending') return l.cells[i]
	}
}

function x(f: Flight) {
	const t = f.droppedAt ?? now.value
	const p = progress(f, t)
	if (reducedMotion.value)
		return ((Math.min(Math.floor(p * 3), 2) * 2 + 1) / 6) * 100
	return p * 100
}

function tagHex(f: Flight) {
	return hexList(f.ct.subarray(0, 2))
}

function check(l: Lane) {
	const c = last(l)
	if (!c) return
	const sent = hexList(nonce(c.n)).slice(-4)
	const used = hexList(nonce(c.used)).slice(-4)
	const row = (who: string, mine: string[], other: string[]) => ({
		who,
		bytes: mine.map((hex, i) => ({ hex, diff: hex !== other[i] })),
	})
	return {
		ok: c.state === 'ok',
		rows: [
			row(`sender: IV ⊕ ${c.n}`, sent, used),
			row(`receiver: IV ⊕ ${c.used}`, used, sent),
		],
	}
}

function serverMood(l: Lane): AnimationName {
	const bad = count(l, 'bad')
	if (l.kind === 'tls') return bad ? (settled.value ? 'sad' : 'wow') : 'idle'
	return settled.value && !bad && count(l, 'ok') ? 'yay' : 'idle'
}

function status(l: Lane) {
	if (!started.value) return 'waiting for you to press send'
	const parts = [`decrypted ${count(l, 'ok')}`, `failed ${count(l, 'bad')}`]
	if (lost.value) parts.push(`lost ${lost.value}`)
	return parts.join(' · ')
}
</script>

<template>
	<DemoFrame label="the counter nobody sends">
		<div
			v-for="l of [lanes.tls, lanes.dtls]"
			:key="l.kind"
			class="lane"
			:class="l.kind"
		>
			<div class="lane-head">
				<strong>{{ info[l.kind].name }}</strong>
				<span class="how">{{ info[l.kind].how }}</span>
				<span class="counter demo-mono">
					<template v-if="l.kind === 'tls'">
						expects record
						<b :class="{ 'demo-warn': count(l, 'bad') }">{{ l.counter }}</b>
					</template>
					<template v-else>reads seq from header</template>
				</span>
			</div>
			<div class="track">
				<PixelSprite
					character="client"
					:animation="sending ? 'send' : 'idle'"
					:size="52"
				/>
				<div class="wire">
					<button
						v-for="f of flights"
						:key="f.id"
						type="button"
						class="packet"
						:class="{ dropped: f.droppedAt !== undefined }"
						:style="{ left: `${x(f)}%`, zIndex: f.n }"
						:aria-label="`Drop record ${f.n} (${WORDS[f.n]})`"
						@click="drop(f)"
					>
						<span v-if="l.kind === 'dtls'" class="hdr"
							><span class="wide">seq </span>{{ f.n }}</span
						>
						<span class="ct"
							>{{ tagHex(f)[0] }}<span class="wide">{{ tagHex(f)[1] }}</span></span
						>
					</button>
				</div>
				<PixelSprite
					character="server"
					:animation="serverMood(l)"
					:size="52"
					flip
				/>
			</div>

			<div class="received">
				<span class="label">server reads</span>
				<ol class="cells">
					<li
						v-for="c of l.cells"
						:key="c.id"
						:class="c.state"
					>
						<span class="word">{{
							c.state === 'bad'
								? '✗ can’t decrypt'
								: c.state === 'ok'
									? c.word
									: '…'
						}}</span>
						<span class="as">{{
							l.kind === 'tls' ? `as #${c.used}` : `seq ${c.used}`
						}}</span>
					</li>
				</ol>
			</div>

			<div class="nonces demo-mono" aria-live="polite">
				<template v-if="check(l)">
					<div
						v-for="(row, r) of check(l)?.rows"
						:key="r"
						class="row"
					>
						<span class="who">{{ row.who }}</span>
						<span class="demo-bytes">
							<span>…</span>
							<span
								v-for="(b, i) of row.bytes"
								:key="i"
								:class="{ diff: b.diff }"
								>{{ b.hex }}</span
							>
						</span>
						<template v-if="r === 1">
							<span v-if="check(l)?.ok" class="demo-ok">✓ match</span>
							<span v-else class="demo-bad">✗ tag mismatch</span>
						</template>
					</div>
				</template>
				<p v-else class="idle">{{ info[l.kind].idle }}</p>
			</div>

			<p class="status demo-mono">{{ status(l) }}</p>
		</div>

		<template #controls>
			<button
				type="button"
				class="demo-btn"
				data-longest="send again"
				:disabled="!ready"
				@click="send"
			>
				{{ started ? 'send again' : 'send' }}
			</button>
			<button
				type="button"
				class="demo-btn secondary"
				:disabled="!inAir"
				@click="loseOne"
			>
				lose one
			</button>
			<label>
				<input v-model="shuffle" type="checkbox" />
				shuffle order
			</label>
		</template>
		<template #caption>
			Press send, then tap one record early on (or press lose one) to drop
			it. The same records fly in both lanes. TLS never learns a record went
			missing, so it opens every later one with the wrong nonce. Real TLS
			would hang up at the first ✗. DTLS reads the number off the header and
			just carries on.
		</template>
	</DemoFrame>
</template>

<style scoped>
.lane + .lane {
	margin-top: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--demo-rule);
}

.lane-head {
	display: flex;
	flex-wrap: wrap;
	gap: 2px 10px;
	align-items: baseline;
	font-size: 0.875rem;
}

.how,
.label,
.status,
.idle,
.who,
.as {
	color: var(--muted);
	font-size: 0.8125rem;
}

.counter {
	margin-left: auto;
	color: var(--muted);
	font-size: 0.8125rem;
}

.counter b {
	color: var(--text);
}

.counter b.demo-warn {
	color: var(--warning);
}

.track {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 4px;
}

.wire {
	position: relative;
	flex: 1;
	min-width: 0;
	height: 52px;
	background: linear-gradient(var(--rule), var(--rule)) center / 100% 2px
		no-repeat;
}

.packet {
	position: absolute;
	top: 50%;
	display: flex;
	align-items: stretch;
	height: 26px;
	padding: 0;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 700 0.75rem / 1 var(--font-mono);
	transform: translate(-50%, -50%);
	white-space: nowrap;
	cursor: pointer;
	transition:
		transform 0.7s ease-in,
		opacity 0.7s ease-in;
}

.packet > span {
	display: flex;
	align-items: center;
	white-space: pre;
	padding: 0 4px;
}

.hdr {
	background: var(--accent);
	color: var(--bg);
}

.packet.dropped {
	border-color: var(--danger);
	opacity: 0;
	transform: translate(-50%, 80%) rotate(25deg);
	pointer-events: none;
}

.received {
	display: flex;
	gap: 12px;
	align-items: flex-start;
	margin-top: 6px;
	min-height: 32px;
}

.label {
	flex: none;
	padding-top: 4px;
}

.cells {
	display: flex;
	flex-wrap: wrap;
	gap: 3px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.cells li {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-width: 40px;
	padding: 3px 6px;
	border-bottom: 1px solid var(--rule);
	line-height: 1.2;
}

.word {
	font: 700 0.875rem var(--font-mono);
}

.as {
	font: 0.6875rem var(--font-mono);
}

.cells .bad {
	border-bottom-color: var(--danger);
	color: var(--danger);
}

.cells .bad .word {
	font-size: 0.75rem;
}

.cells .pending {
	color: var(--muted);
}

.nonces {
	margin-top: 8px;
	min-height: 52px;
	font-size: 0.8125rem;
}

.row {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 10px;
	align-items: center;
}

.row + .row {
	margin-top: 4px;
}

.who {
	min-width: 16ch;
}

.demo-bytes .diff {
	background: var(--danger);
	color: var(--bg);
	font-weight: 700;
}

.idle {
	margin: 0;
	line-height: 1.5;
}

.status {
	margin: 4px 0 0;
}

@media (max-width: 520px) {
	.track {
		gap: 4px;
	}

	.wide {
		display: none;
	}

	.packet > span {
		padding: 0 3px;
	}

	.received {
		flex-direction: column;
		gap: 4px;
	}

	.label {
		padding-top: 0;
	}

	.counter {
		margin-left: 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.packet {
		transition: none;
	}

	.packet.dropped {
		opacity: 0.5;
		transform: translate(-50%, -50%);
		border-style: dashed;
		text-decoration: line-through;
	}
}
</style>
