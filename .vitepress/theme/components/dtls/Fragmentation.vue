<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

const HANDSHAKE_HEADER = 12
const RECORD_HEADER = 13
const OVERHEAD = HANDSHAKE_HEADER + RECORD_HEADER

const TRIP = 2600
const GAP = 320
const FALL = 700

const messages = {
	hello: {
		tab: 'ClientHello (post-quantum)',
		name: 'ClientHello',
		seq: 0,
		size: 1538,
		from: 'client',
	},
	cert: {
		tab: 'Certificate chain',
		name: 'Certificate',
		seq: 1,
		size: 3207,
		from: 'server',
	},
} as const

type MessageKey = keyof typeof messages
type Range = [start: number, end: number]

interface Fragment {
	id: number
	n: number
	off: number
	len: number
	state: 'ready' | 'queued' | 'flying' | 'lost' | 'arrived'
	slot: number
	sentAt: number
	duration: number
	droppedAt?: number
	retransmit: boolean
}

const which = ref<MessageKey>('hello')
const mtu = ref(1200)
const message = computed(() => messages[which.value])
const payload = computed(() => mtu.value - OVERHEAD)

const received = ref<Range[]>([])
const flight = ref<Fragment[]>([])
const arrivals = ref<number[]>([])
const sent = ref(false)
const now = ref(0)
const reducedMotion = ref(false)
let ids = 0
let frame = 0

function merge(ranges: Range[]): Range[] {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0])
	const out: Range[] = []
	for (const [s, e] of sorted) {
		const last = out[out.length - 1]
		if (last && s <= last[1]) last[1] = Math.max(last[1], e)
		else out.push([s, e])
	}
	return out
}

function gaps(have: Range[], total: number): Range[] {
	const out: Range[] = []
	let at = 0
	for (const [s, e] of have) {
		if (s > at) out.push([at, s])
		at = Math.max(at, e)
	}
	if (at < total) out.push([at, total])
	return out
}

function cut(ranges: Range[], max: number) {
	const out: { off: number; len: number }[] = []
	for (const [s, e] of ranges) {
		for (let off = s; off < e; off += max) {
			out.push({ off, len: Math.min(max, e - off) })
		}
	}
	return out
}

const missing = computed(() => gaps(received.value, message.value.size))
const complete = computed(() => sent.value && missing.value.length === 0)
const busy = computed(() =>
	flight.value.some((f) => f.state === 'queued' || f.state === 'flying'),
)
const partial = computed(() => sent.value && !complete.value)

const plan = computed<Fragment[]>(() => {
	const ranges = partial.value
		? missing.value
		: ([[0, message.value.size]] as Range[])
	return cut(ranges, payload.value).map((p, i) => ({
		id: -1 - i,
		n: i + 1,
		...p,
		state: 'ready',
		slot: 0,
		sentAt: 0,
		duration: 0,
		retransmit: partial.value,
	}))
})

const pieces = computed(() => Math.ceil(message.value.size / payload.value))

const chips = computed(() => (flight.value.length ? flight.value : plan.value))
const onWire = computed(() =>
	flight.value.filter(
		(f) =>
			f.state === 'flying' ||
			(f.state === 'lost' &&
				f.droppedAt !== undefined &&
				now.value - f.droppedAt < FALL),
	),
)

function shuffle<T>(items: T[]): T[] {
	const out = [...items]
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[out[i], out[j]] = [out[j], out[i]]
	}
	return out
}

function launch(pieces: { off: number; len: number }[], retransmit: boolean) {
	const t = performance.now()
	const order = shuffle(pieces.map((_, i) => i))
	flight.value = pieces.map((p, i) => {
		const k = order.indexOf(i)
		return {
			id: ids++,
			n: i + 1,
			...p,
			state: 'queued',
			slot: (k + 1) / (pieces.length + 1),
			sentAt: t + k * GAP,
			duration: TRIP * (1 + Math.random() * 0.6),
			retransmit,
		}
	})
	arrivals.value = []
	sent.value = true
	now.value = t
	cancelAnimationFrame(frame)
	frame = requestAnimationFrame(tick)
}

function send() {
	received.value = []
	launch(cut([[0, message.value.size]], payload.value), false)
}

function retransmit() {
	launch(cut(missing.value, payload.value), true)
}

function tick() {
	const t = performance.now()
	now.value = t
	for (const f of flight.value) {
		if (f.state === 'queued' && t >= f.sentAt) f.state = 'flying'
		if (f.state === 'flying' && t >= f.sentAt + f.duration) {
			f.state = 'arrived'
			arrivals.value.push(f.n)
			received.value = merge([...received.value, [f.off, f.off + f.len]])
		}
	}
	const settling = flight.value.some(
		(f) => f.state === 'lost' && f.droppedAt && t - f.droppedAt < FALL,
	)
	if (busy.value || settling) frame = requestAnimationFrame(tick)
}

function drop(f: Fragment) {
	if (f.state !== 'flying' && f.state !== 'queued') return
	f.state = 'lost'
	f.droppedAt = performance.now()
	if (!busy.value) {
		cancelAnimationFrame(frame)
		frame = requestAnimationFrame(tick)
	}
}

function reset() {
	cancelAnimationFrame(frame)
	flight.value = []
	received.value = []
	arrivals.value = []
	sent.value = false
}

watch(which, reset)

watch(mtu, () => {
	if (!busy.value) flight.value = []
})

let motionQuery: MediaQueryList | undefined
function onMotionChange() {
	reducedMotion.value = motionQuery?.matches ?? false
}

onMounted(() => {
	motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
	motionQuery.addEventListener('change', onMotionChange)
	onMotionChange()
})

onBeforeUnmount(() => {
	cancelAnimationFrame(frame)
	motionQuery?.removeEventListener('change', onMotionChange)
})

function x(f: Fragment) {
	let p: number
	if (reducedMotion.value) p = f.slot
	else {
		const t = f.droppedAt ?? now.value
		p = Math.min(Math.max((t - f.sentAt) / f.duration, 0), 1)
	}
	return (message.value.from === 'client' ? p : 1 - p) * 100
}

const percent = (bytes: number) => (bytes / message.value.size) * 100

const fromClient = computed(() => message.value.from === 'client')
const receiver = computed(() => (fromClient.value ? 'server' : 'client'))

const senderMood = computed(() => (busy.value ? 'send' : 'idle'))
const receiverMood = computed(() => {
	if (complete.value) return 'yay'
	if (sent.value && !busy.value) return 'sleep'
	return 'idle'
})

const chipsTitle = computed(() => {
	if (busy.value) return 'on the wire'
	if (flight.value.length) return 'last flight'
	if (partial.value) return `resend plan at MTU ${mtu.value}`
	return `cut to fit MTU ${mtu.value}`
})

function chipState(f: Fragment) {
	return {
		ready: '',
		queued: 'queued',
		flying: 'in flight',
		lost: 'lost',
		arrived: 'arrived',
	}[f.state]
}

const status = computed(() => {
	if (!sent.value) return ''
	if (complete.value) return 'complete'
	if (busy.value) return 'waiting…'
	const shown = missing.value
		.slice(0, 3)
		.map(([s, e]) => `${s}–${e - 1}`)
		.join(', ')
	const more = missing.value.length > 3 ? ` +${missing.value.length - 3}` : ''
	return `missing bytes ${shown}${more}`
})

const overhead = computed(() => chips.value.length * OVERHEAD)
</script>

<template>
	<DemoFrame>
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Handshake message">
				<button
					v-for="(m, key) in messages"
					:key="key"
					type="button"
					:aria-pressed="which === key"
					@click="which = key"
				>
					{{ m.tab }}
				</button>
			</div>
		</template>

		<p class="summary demo-mono">
			{{ message.name }} · {{ message.size.toLocaleString('en') }} B ·
			{{ pieces }} fragment{{ pieces === 1 ? '' : 's' }} of up to
			{{ payload.toLocaleString('en') }} B
		</p>

		<p class="chips-title">{{ chipsTitle }}</p>
		<ul class="chips">
			<li v-for="f of chips" :key="f.id" :style="{ flexGrow: f.len }">
				<button
					type="button"
					:class="[f.state, { retransmit: f.retransmit }]"
					:disabled="f.state !== 'flying'"
					:aria-label="`Fragment ${f.n}, offset ${f.off}, length ${f.len}, ${chipState(f) || 'not sent'}${f.state === 'flying' ? '. Drop it' : ''}`"
					@click="drop(f)"
				>
					<span class="chip-top">
						<strong>#{{ f.n }}</strong>
						<span>{{ chipState(f) }}</span>
					</span>
					<span class="demo-mono"
						>seq={{ message.seq }} off={{ f.off }} len={{ f.len }}</span
					>
				</button>
			</li>
		</ul>

		<div class="track">
			<PixelSprite
				character="client"
				:animation="fromClient ? senderMood : receiverMood"
				:size="56"
				label="Client"
			/>
			<div class="wire">
				<button
					v-for="f of onWire"
					:key="f.id"
					type="button"
					class="packet"
					:class="{ dropped: f.state === 'lost', retransmit: f.retransmit }"
					:style="{ left: `${x(f)}%` }"
					:aria-label="`Drop fragment ${f.n}`"
					@click="drop(f)"
				>
					{{ f.n }}
				</button>
			</div>
			<PixelSprite
				character="server"
				:animation="fromClient ? receiverMood : senderMood"
				:size="56"
				label="Server"
				flip
			/>
		</div>

		<div class="buffer">
			<p class="buffer-head">
				<span>{{ receiver }}'s reassembly buffer</span>
				<span
					class="demo-mono"
					:class="{
						'demo-ok': complete,
						'demo-bad': partial && !busy,
					}"
					>{{ status }}</span
				>
			</p>
			<div
				class="bar"
				:class="{ holes: partial && !busy, done: complete }"
				role="img"
				:aria-label="
					sent
						? `${message.size} byte buffer, ${status}`
						: `${message.size} byte buffer, empty`
				"
			>
				<span
					v-for="[s, e] of received"
					:key="s"
					class="fill"
					:style="{ left: `${percent(s)}%`, width: `${percent(e - s)}%` }"
				/>
			</div>
			<p class="scale demo-mono">
				<span>0</span>
				<span v-if="arrivals.length" class="order"
					>arrived: {{ arrivals.map((n) => `#${n}`).join(' ') }}</span
				>
				<span>{{ message.size - 1 }}</span>
			</p>
		</div>

		<p class="demo-note">
			headers: {{ chips.length }} × ({{ HANDSHAKE_HEADER }} B handshake +
			{{ RECORD_HEADER }} B record) = {{ overhead }} B extra. TLS sends it in
			one piece with a 4 B header.
		</p>

		<template #controls>
			<button
				type="button"
				class="demo-btn"
				data-longest="send again"
				@click="send"
			>
				{{ sent ? 'send again' : 'send' }}
			</button>
			<button
				type="button"
				class="demo-btn secondary"
				:disabled="!partial || busy"
				@click="retransmit"
			>
				retransmit missing
			</button>
			<label>
				MTU <output>{{ mtu }}</output>
				<input v-model.number="mtu" type="range" min="300" max="1500" step="10" />
			</label>
		</template>
		<template #caption>
			Tap fragments on the wire to drop them, then retransmit only the
			missing bytes. Try changing the MTU before you do: the receiver doesn't
			care how the gap gets filled. (DTLS 1.2 just resends the whole flight
			on a timer. ACKs fix that, later.)
		</template>
	</DemoFrame>
</template>

<style scoped>
.summary {
	margin: 0 0 14px;
	font-size: 0.8125rem;
}

.chips-title,
.buffer-head {
	margin: 0 0 6px;
	color: var(--muted);
	font-size: 0.8125rem;
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 0 0 12px;
	padding: 0;
	list-style: none;
}

.chips li {
	display: flex;
	flex-basis: 0;
	margin: 0;
}

.chips button {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 2px;
	padding: 4px 8px;
	border: 1px solid var(--rule);
	border-radius: 0;
	background: var(--bg);
	color: var(--text);
	font: 0.6875rem / 1.3 var(--font-sans);
	text-align: left;
	white-space: nowrap;
}

.chips button:disabled {
	cursor: default;
}

.chips button.flying {
	cursor: pointer;
}

.chip-top {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	color: var(--muted);
}

.chip-top strong {
	color: var(--text);
}

.chips button.flying,
.chips button.queued {
	border-color: var(--accent);
	background: var(--bubble);
	color: var(--bubbletext);
}

.chips button.retransmit.flying,
.chips button.retransmit.queued {
	border-style: dashed;
	border-color: var(--info);
	color: var(--info);
}

.chips button.lost {
	border-style: dashed;
	border-color: var(--danger);
	opacity: 0.7;
}

.chips button.lost .chip-top span {
	color: var(--danger);
}

.chips button.arrived {
	border-color: var(--tip);
}

.chips button.arrived .chip-top span {
	color: var(--tip);
}

.track {
	display: flex;
	align-items: center;
	gap: 8px;
}

.wire {
	position: relative;
	flex: 1;
	height: 56px;
	background: linear-gradient(var(--rule), var(--rule)) center / 100% 2px
		no-repeat;
}

.packet {
	position: absolute;
	top: 50%;
	transform: translate(-50%, -50%);
	min-width: 28px;
	height: 28px;
	padding: 0 4px;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 700 0.8125rem / 1 var(--font-mono);
	cursor: pointer;
	transition:
		transform 0.7s ease-in,
		opacity 0.7s ease-in;
}

.packet.retransmit {
	border-style: dashed;
	border-color: var(--info);
	color: var(--info);
}

.packet.dropped {
	transform: translate(-50%, 80%) rotate(25deg);
	opacity: 0;
	border-color: var(--danger);
	pointer-events: none;
}

.buffer {
	margin-top: 10px;
}

.buffer-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 4px 12px;
}

.bar {
	position: relative;
	height: 28px;
	overflow: hidden;
	border: 1px solid var(--rule);
	border-radius: 0;
	background: var(--bg);
}

.bar.holes {
	border-color: var(--danger);
	background: repeating-linear-gradient(
		-45deg,
		var(--bg) 0 6px,
		color-mix(in srgb, var(--danger) 35%, var(--bg)) 6px 9px
	);
}

.bar.done {
	border-color: var(--tip);
}

.fill {
	position: absolute;
	top: 0;
	bottom: 0;
	background: var(--tip);
	box-shadow: inset -1px 0 0 var(--bg);
}

.scale {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	margin: 4px 0 0;
	color: var(--muted);
	font-size: 0.6875rem;
}

.order {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

@media (max-width: 520px) {
	.track {
		gap: 4px;
	}

	.chips button {
		padding: 3px 6px;
		font-size: 0.625rem;
	}

	.packet {
		min-width: 24px;
		height: 24px;
		font-size: 0.75rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.packet {
		transition: none;
	}
}
</style>
