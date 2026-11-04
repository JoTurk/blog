<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

type Early = 'menu' | 'pay'
type Kind = 'hs' | 'cookie' | 'data'

interface Message {
	from: 'c' | 's'
	at: number
	label: string
	kind: Kind
	below?: boolean
}

interface Handshake {
	title: string
	sub?: string
	wait: number
	messages: Message[]
}

const EARLY: Record<Early, string> = {
	menu: 'GET /menu',
	pay: 'PAY $10',
}

const early = ref<Early>('menu')

const handshakes = computed<Handshake[]>(() => [
	{
		title: 'DTLS 1.2',
		wait: 2,
		messages: [
			{ from: 'c', at: 0, label: 'ClientHello', kind: 'hs' },
			{ from: 's', at: 0.5, label: 'ServerHello…Done', kind: 'hs' },
			{ from: 'c', at: 1, label: 'KeyExch, Finished', kind: 'hs' },
			{ from: 's', at: 1.5, label: 'Finished', kind: 'hs' },
			{ from: 'c', at: 2, label: 'app data', kind: 'data' },
		],
	},
	{
		title: 'DTLS 1.2 + cookie',
		wait: 3,
		messages: [
			{ from: 'c', at: 0, label: 'ClientHello', kind: 'hs' },
			{ from: 's', at: 0.5, label: 'HelloVerifyReq', kind: 'cookie' },
			{ from: 'c', at: 1, label: 'ClientHello+cookie', kind: 'cookie' },
			{ from: 's', at: 1.5, label: 'ServerHello…Done', kind: 'hs' },
			{ from: 'c', at: 2, label: 'KeyExch, Finished', kind: 'hs' },
			{ from: 's', at: 2.5, label: 'Finished', kind: 'hs' },
			{ from: 'c', at: 3, label: 'app data', kind: 'data' },
		],
	},
	{
		title: 'DTLS 1.3',
		wait: 1,
		messages: [
			{ from: 'c', at: 0, label: 'ClientHello+key', kind: 'hs' },
			{ from: 's', at: 0.5, label: 'ServerHello…Fin', kind: 'hs' },
			{ from: 'c', at: 1, label: 'Finished, app data', kind: 'data' },
		],
	},
	{
		title: 'DTLS 1.3 + 0-RTT',
		sub: 'resumed',
		wait: 0,
		messages: [
			{ from: 'c', at: 0, label: 'ClientHello+PSK', kind: 'hs' },
			{
				from: 'c',
				at: 0,
				label: EARLY[early.value],
				kind: 'data',
				below: true,
			},
			{ from: 's', at: 0.5, label: 'ServerHello…Fin', kind: 'hs' },
			{ from: 'c', at: 1, label: 'Finished', kind: 'hs' },
		],
	},
])

// Diagram geometry
const CX = 16
const SX = 86
const TOP = 16
const PER_RTT = 44
const END = 3.6
const HEIGHT = TOP + END * PER_RTT + 6
const WALL_PER_RTT = 1100

const rtt = ref(100)
const t = ref(0)
const racing = ref(false)
let frame = 0
let lastWall = 0

function y(rtts: number) {
	return TOP + rtts * PER_RTT
}

function ms(rtts: number) {
	return `${Math.round(rtts * rtt.value)} ms`
}

function lands(h: Handshake) {
	return h.wait + 0.5
}

function arrow(m: Message) {
	const f = Math.max(0, Math.min((t.value - m.at) / 0.5, 1))
	const x1 = m.from === 'c' ? CX : SX
	const x2 = m.from === 'c' ? SX : CX
	const y1 = y(m.at)
	const x = x1 + (x2 - x1) * f
	const yy = y1 + (y(m.at + 0.5) - y1) * f
	const angle = Math.atan2(yy - y1, x - x1)
	const head = [0, 2.6, -2.6]
		.map((side, i) => {
			const back = i === 0 ? 0 : 5
			const px = x - back * Math.cos(angle) - side * Math.sin(angle)
			const py = yy - back * Math.sin(angle) + side * Math.cos(angle)
			return `${px.toFixed(2)},${py.toFixed(2)}`
		})
		.join(' ')
	return {
		shown: f > 0,
		x1,
		y1,
		x2: x,
		y2: yy,
		head,
		mid: { x: (CX + SX) / 2, y: (y1 + y(m.at + 0.5)) / 2 },
	}
}

function tick() {
	const wall = performance.now()
	t.value = Math.min(
		END,
		t.value + Math.min(wall - lastWall, 50) / WALL_PER_RTT,
	)
	lastWall = wall
	if (t.value >= END) {
		racing.value = false
		return
	}
	frame = requestAnimationFrame(tick)
}

function go() {
	cancelAnimationFrame(frame)
	t.value = 0
	racing.value = true
	lastWall = performance.now()
	frame = requestAnimationFrame(tick)
}

const gridlines = [1, 2, 3]

// Replay scene

interface Flying {
	id: number
	from: 'client' | 'mallory'
	sentAt: number
}

const REPLAY_TRIP = 1300
const replay = reactive({
	packets: [] as Flying[],
	processed: [] as { replayed: boolean }[],
	recorded: false,
	running: false,
})
let replayFrame = 0
let replayIds = 0
const now = ref(0)

function replayTick() {
	now.value = performance.now()
	for (const p of replay.packets) {
		if (now.value - p.sentAt >= REPLAY_TRIP) {
			replay.processed.push({ replayed: p.from === 'mallory' })
			if (p.from === 'client') {
				replay.recorded = true
				replay.packets.push({
					id: replayIds++,
					from: 'mallory',
					sentAt: now.value + 250,
				})
			}
		}
	}
	replay.packets = replay.packets.filter(
		(p) => now.value - p.sentAt < REPLAY_TRIP,
	)
	if (!replay.packets.length) {
		replay.running = false
		return
	}
	replayFrame = requestAnimationFrame(replayTick)
}

const recording = computed(() => !replay.recorded && replay.packets.length > 0)

function mallory() {
	if (recording.value) return
	now.value = performance.now()
	replay.packets.push({
		id: replayIds++,
		from: replay.recorded ? 'mallory' : 'client',
		sentAt: now.value,
	})
	if (!replay.running) {
		replay.running = true
		replayFrame = requestAnimationFrame(replayTick)
	}
}

function pickEarly(next: Early) {
	early.value = next
	cancelAnimationFrame(replayFrame)
	replay.packets = []
	replay.processed = []
	replay.recorded = false
	replay.running = false
}

onBeforeUnmount(() => {
	cancelAnimationFrame(frame)
	cancelAnimationFrame(replayFrame)
})

function packetX(p: Flying) {
	const f = Math.max(0, Math.min((now.value - p.sentAt) / REPLAY_TRIP, 1))
	const start = p.from === 'client' ? 0 : 50
	return start + (100 - start) * f
}

function packetY(p: Flying) {
	const f = Math.max(0, Math.min((now.value - p.sentAt) / REPLAY_TRIP, 1))
	return p.from === 'client' ? 50 : 100 - 50 * f
}

const times = computed(() => replay.processed.length)

const serverMood = computed<AnimationName>(() => {
	if (times.value < 2) return times.value ? 'yay' : 'idle'
	return early.value === 'pay' ? 'wow' : 'idle'
})

function outcome(i: number) {
	if (early.value === 'menu') return 'sends the menu'
	return `charges $10 (total $${(i + 1) * 10})`
}
</script>

<template>
	<DemoFrame>
		<div class="race">
			<div v-for="h of handshakes" :key="h.title" class="col">
				<p class="head">
					<strong>{{ h.title }}</strong>
					<span class="demo-mono"
						><template v-if="h.sub">{{ h.sub }} · </template>{{ h.wait }} RTT wait<template v-if="h.wait"
							> · {{ ms(h.wait) }}</template
						></span
					>
				</p>
				<svg
					class="diagram"
					:viewBox="`0 0 100 ${HEIGHT}`"
					role="img"
					:aria-label="`${h.title}: the client waits ${h.wait} round trips before it can send data, so the first data reaches the server after ${ms(lands(h))}`"
				>
					<text :x="CX" y="7" class="who">client</text>
					<text :x="SX" y="7" class="who">server</text>
					<g v-for="g of gridlines" :key="g">
						<line x1="0" :x2="100" :y1="y(g)" :y2="y(g)" class="grid" />
						<text x="0" :y="y(g) - 1.5" class="tick">{{ g * rtt }}</text>
					</g>
					<line :x1="CX" :x2="CX" :y1="TOP - 4" :y2="HEIGHT" class="life" />
					<line :x1="SX" :x2="SX" :y1="TOP - 4" :y2="HEIGHT" class="life" />
					<template v-for="m of h.messages" :key="m.label + m.at">
						<g v-if="arrow(m).shown" :class="['msg', m.kind]">
							<line
								:x1="arrow(m).x1"
								:y1="arrow(m).y1"
								:x2="arrow(m).x2"
								:y2="arrow(m).y2"
							/>
							<polygon :points="arrow(m).head" />
							<text
								:x="arrow(m).mid.x"
								:y="arrow(m).mid.y + (m.below ? 7 : -2.5)"
							>
								{{ m.label }}
							</text>
						</g>
					</template>
					<line
						v-if="racing"
						x1="0"
						x2="100"
						:y1="y(t)"
						:y2="y(t)"
						class="now"
					/>
					<g v-if="t >= lands(h)" class="landed">
						<line x1="0" x2="100" :y1="y(lands(h))" :y2="y(lands(h))" />
						<circle :cx="SX" :cy="y(lands(h))" r="3.2" />
					</g>
				</svg>
				<p class="foot">
					first data at
					<b
						:class="{ 'demo-ok': t >= lands(h) }"
						class="demo-mono"
						>{{ ms(lands(h)) }}</b
					>
				</p>
			</div>
		</div>
		<p class="demo-note">
			Times are for the client's first application data to reach the server
			(handshake wait plus half a round trip). 1.3 adds a round trip if the
			server answers with HelloRetryRequest.
		</p>

		<section class="replay" aria-label="0-RTT replay">
			<h4>What can Mallory do with early data?</h4>
			<div class="demo-tabs" role="group" aria-label="Early data">
				<button :aria-pressed="early === 'menu'" @click="pickEarly('menu')">
					early data = GET /menu
				</button>
				<button :aria-pressed="early === 'pay'" @click="pickEarly('pay')">
					early data = PAY $10
				</button>
			</div>
			<div class="track">
				<PixelSprite character="client" :size="48" label="Client" />
				<div class="wire">
					<span
						v-for="p of replay.packets"
						:key="p.id"
						class="packet"
						:class="{ copy: p.from === 'mallory' }"
						:style="{ left: `${packetX(p)}%`, top: `${packetY(p)}%` }"
						>{{ EARLY[early] }}</span
					>
					<div class="mallory">
						<PixelSprite
							character="mallory"
							:animation="replay.recorded ? 'sneak' : 'idle'"
							:size="40"
							label="Mallory"
						/>
					</div>
				</div>
				<PixelSprite
					character="server"
					:animation="serverMood"
					:size="48"
					flip
					label="Server"
				/>
			</div>
			<button
				class="demo-btn danger replay-btn"
				data-longest="Mallory replays the early data"
				:disabled="recording"
				@click="mallory"
			>
				{{ times ? 'Mallory replays it again' : 'Mallory replays the early data' }}
			</button>
			<ol class="ledger demo-mono" aria-live="polite">
				<li v-if="!times" class="empty">
					server hasn't processed anything yet
				</li>
				<li
					v-for="(p, i) of replay.processed"
					:key="i"
					:class="{ 'demo-bad': p.replayed && early === 'pay' }"
				>
					{{ p.replayed ? 'replay' : 'client' }}: {{ EARLY[early] }} → server
					{{ outcome(i) }}
				</li>
			</ol>
			<p v-if="times > 1" class="verdict">
				<span v-if="early === 'menu'" class="demo-ok"
					>Served the menu {{ times }} times. Nobody cares: doing it twice is
					the same as doing it once.</span
				>
				<span v-else class="demo-bad"
					>The client ordered once and paid ${{ times * 10 }}.</span
				>
			</p>
		</section>

		<template #controls>
			<button class="demo-btn" data-longest="race again" @click="go">
				{{ t > 0 ? 'race again' : 'go' }}
			</button>
			<label>
				RTT <output>{{ rtt }} ms</output>
				<input v-model.number="rtt" type="range" min="20" max="300" step="10" />
			</label>
		</template>
		<template #caption>
			Race them, then drag the RTT slider: the gaps grow with distance. Then
			let Mallory replay the 0-RTT early data, once as a menu request and
			once as a payment. Early data uses keys from an earlier session, with
			nothing fresh from the server, so the server can't tell a copy from
			the original.
		</template>
	</DemoFrame>
</template>

<style scoped>
.demo-controls output {
	min-width: 6ch;
}

.race {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 16px 12px;
}

.col {
	min-width: 0;
}

.head {
	display: flex;
	flex-direction: column;
	min-height: 3em;
	margin: 0 0 4px;
	font-size: 0.8125rem;
	line-height: 1.35;
}

.head span,
.foot {
	color: var(--muted);
	font-size: 0.75rem;
}

.diagram {
	display: block;
	width: 100%;
	height: auto;
	overflow: visible;
}

.who,
.tick,
.msg text {
	font-family: var(--font-sans);
	font-size: 5.5px;
}

.who {
	fill: var(--muted);
	text-anchor: middle;
}

.tick {
	fill: var(--muted);
	font-family: var(--font-mono);
	font-size: 4.5px;
}

.grid {
	stroke: var(--rule);
	stroke-width: 0.4;
	stroke-dasharray: 1.5 1.5;
}

.life {
	stroke: var(--muted);
	stroke-width: 0.8;
}

.msg line {
	stroke: var(--accent);
	stroke-width: 1;
}

.msg polygon {
	fill: var(--accent);
}

.msg text {
	fill: var(--text);
	text-anchor: middle;
	paint-order: stroke;
	stroke: var(--code);
	stroke-width: 2px;
}

.msg.cookie line {
	stroke: var(--warning);
}

.msg.cookie polygon {
	fill: var(--warning);
}

.msg.data line {
	stroke: var(--tip);
	stroke-width: 1.6;
}

.msg.data polygon {
	fill: var(--tip);
}

.msg.data text {
	fill: var(--tip);
	font-weight: 700;
}

.now {
	stroke: var(--info);
	stroke-width: 0.6;
}

.landed circle {
	fill: var(--tip);
}

.landed line {
	stroke: var(--tip);
	stroke-width: 0.6;
	stroke-dasharray: 2 1.5;
}

.foot {
	margin: 4px 0 0;
}

.foot b {
	font-size: 0.875rem;
}

.replay {
	margin-top: 16px;
	padding-top: 12px;
	border-top: 1px dashed var(--rule);
}

.replay h4 {
	margin: 0 0 10px;
	font-size: 0.9375rem;
}

.track {
	display: flex;
	align-items: center;
	gap: 8px;
}

.wire {
	position: relative;
	flex: 1;
	min-width: 0;
	height: 96px;
	background: linear-gradient(var(--rule), var(--rule)) center / 100% 2px
		no-repeat;
}

.mallory {
	position: absolute;
	bottom: -6px;
	left: 50%;
	transform: translateX(-50%);
	line-height: 0;
}

.packet {
	position: absolute;
	z-index: 1;
	transform: translate(-50%, -50%);
	padding: 2px 6px;
	border: 2px solid var(--tip);
	border-radius: 0;
	background: var(--bg);
	color: var(--tip);
	font: 700 0.6875rem / 1.2 var(--font-mono);
	white-space: nowrap;
}

.packet.copy {
	border-style: dashed;
	border-color: var(--danger);
	color: var(--danger);
}

.replay-btn {
	margin-top: 12px;
}

.ledger {
	min-height: 1.5em;
	margin: 10px 0 0;
	padding-left: 1.5em;
	font-size: 0.8125rem;
}

.ledger li {
	margin: 0;
}

.ledger .empty {
	color: var(--muted);
	list-style: none;
	margin-left: -1.5em;
}

.verdict {
	margin: 8px 0 0;
	font-size: 0.875rem;
}

@media (max-width: 640px) {
	.race {
		grid-template-columns: repeat(2, 1fr);
	}
}
</style>
