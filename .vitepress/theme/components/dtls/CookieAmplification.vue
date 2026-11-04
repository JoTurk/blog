<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

const VICTIM = '203.0.113.7'
// Sizes (bytes)
const CLIENT_HELLO = 200
const FLIGHT = 3600
const HVR = 60
const CLIENT_HELLO_COOKIE = CLIENT_HELLO + 32
const SLOTS = 100
const TRIP = 500

interface Dot {
	id: number
	lane: 'in' | 'out'
	big: boolean
}

interface Step {
	dir: 'up' | 'down'
	what: string
	bytes: number
	note?: string
}

const cookies = ref(false)
const sent = ref(0)
const received = ref(0)
const held = ref(0)
const answered = ref(0)
const dots = ref<Dot[]>([])
const last = ref('')
const ladder = ref<Step[]>([])
const ladderDone = ref(false)
const pending = ref(0)
const mood = reactive<
	Record<'mallory' | 'server' | 'victim' | 'client', AnimationName>
>({ mallory: 'idle', server: 'idle', victim: 'idle', client: 'idle' })
const reducedMotion = ref(false)
let ids = 0
let ladderRun = 0
let timers: ReturnType<typeof setTimeout>[] = []

function later(ms: number, fn: () => void) {
	if (ms <= 0 || reducedMotion.value) return fn()
	const timer = setTimeout(() => {
		timers = timers.filter((t) => t !== timer)
		fn()
	}, ms)
	timers.push(timer)
}

const reply = computed(() => (cookies.value ? HVR : FLIGHT))

function dot(lane: Dot['lane'], big = false) {
	if (reducedMotion.value) return
	const d = { id: ids++, lane, big }
	dots.value = [...dots.value, d]
	later(TRIP, () => {
		dots.value = dots.value.filter((x) => x.id !== d.id)
	})
}

function spoof(n: number) {
	const batches = Math.min(n, 10)
	const per = n / batches
	pending.value += batches
	mood.mallory = 'sneak'
	for (let k = 0; k < batches; k++) {
		later(k * 130, () => {
			sent.value += per * CLIENT_HELLO
			dot('in')
			later(TRIP, () => {
				if (!cookies.value) {
					held.value += per
					mood.server = 'wow'
				}
				dot('out', !cookies.value)
				later(TRIP, () => {
					received.value += per * reply.value
					answered.value += per
					if (!cookies.value) mood.victim = 'sad'
					if (--pending.value === 0) settle()
				})
			})
		})
	}
}

function settle() {
	if (cookies.value) {
		mood.mallory = 'sad'
		mood.server = 'idle'
		last.value = `The server mailed a ${HVR} B cookie to ${VICTIM} and kept nothing. Mallory never sees that cookie, so she can't go further.`
	} else {
		mood.mallory = 'yay'
		mood.server = held.value >= SLOTS / 2 ? 'sad' : 'idle'
		last.value = `The server believed the source address, sent ${fmt(FLIGHT)} to ${VICTIM} per ClientHello, and is holding state for handshakes that will never finish.`
	}
}

function realClient() {
	const steps: Step[] = cookies.value
		? [
				{ dir: 'up', what: 'ClientHello', bytes: CLIENT_HELLO },
				{
					dir: 'down',
					what: 'HelloVerifyRequest + cookie',
					bytes: HVR,
					note: 'server keeps nothing',
				},
				{
					dir: 'up',
					what: 'ClientHello + cookie',
					bytes: CLIENT_HELLO_COOKIE,
					note: 'cookie checks out, server commits',
				},
				{ dir: 'down', what: 'ServerHello, certificates…', bytes: FLIGHT },
			]
		: [
				{ dir: 'up', what: 'ClientHello', bytes: CLIENT_HELLO },
				{ dir: 'down', what: 'ServerHello, certificates…', bytes: FLIGHT },
			]
	const run = ++ladderRun
	ladder.value = []
	ladderDone.value = false
	mood.client = 'send'
	steps.forEach((step, i) => {
		later(i * 700, () => {
			if (run !== ladderRun) return
			ladder.value = [...ladder.value, step]
			if (i === steps.length - 1) {
				ladderDone.value = true
				mood.client = 'yay'
				later(1500, () => {
					if (run === ladderRun) mood.client = 'idle'
				})
			}
		})
	})
}

function reset() {
	for (const t of timers) clearTimeout(t)
	timers = []
	ladderRun++
	sent.value = 0
	received.value = 0
	held.value = 0
	answered.value = 0
	pending.value = 0
	dots.value = []
	last.value = ''
	ladder.value = []
	ladderDone.value = false
	Object.assign(mood, {
		mallory: 'idle',
		server: 'idle',
		victim: 'idle',
		client: 'idle',
	})
}

function setCookies(on: boolean) {
	cookies.value = on
	reset()
}

function fmt(bytes: number) {
	if (bytes < 10_000) return `${Math.round(bytes).toLocaleString('en')} B`
	const kb = bytes / 1000
	return `${kb < 100 ? kb.toFixed(1) : Math.round(kb).toLocaleString('en')} KB`
}

const ratio = computed(() =>
	answered.value ? received.value / (answered.value * CLIENT_HELLO) : 0,
)

const factor = computed(() => {
	const x = ratio.value
	if (!x) return '–'
	return `${x < 1 ? x.toFixed(1) : Math.round(x)}×`
})

const stats = computed(() => [
	{ label: 'Mallory sent', value: fmt(sent.value), tone: '' },
	{
		label: 'victim got',
		value: fmt(received.value),
		tone: ratio.value > 1 ? 'demo-bad' : '',
	},
	{
		label: 'amplification',
		value: factor.value,
		tone: !ratio.value ? '' : ratio.value > 1 ? 'demo-bad' : 'demo-ok',
	},
	{
		label: 'server state',
		value: `${held.value} held`,
		tone: held.value ? 'demo-warn' : '',
	},
])

const roundTrips = computed(() => ladder.value.length / 2)

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
	for (const t of timers) clearTimeout(t)
	motionQuery?.removeEventListener('change', onMotionChange)
})
</script>

<template>
	<DemoFrame>
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Cookies">
				<button
					type="button"
					:aria-pressed="!cookies"
					@click="setCookies(false)"
				>
					cookies off
				</button>
				<button type="button" :aria-pressed="cookies" @click="setCookies(true)">
					cookies on
				</button>
			</div>
		</template>

		<div class="scene">
			<div class="who mallory">
				<PixelSprite
					character="mallory"
					:animation="mood.mallory"
					:size="52"
					label="Mallory"
				/>
				<span>Mallory</span>
			</div>
			<div class="lane in">
				<span class="lane-label demo-mono"
					>ClientHello · {{ CLIENT_HELLO }} B<br />
					<span class="demo-warn">from {{ VICTIM }} (spoofed)</span></span
				>
				<span class="line">
					<span
						v-for="d of dots.filter((d) => d.lane === 'in')"
						:key="d.id"
						class="dot"
					/>
				</span>
			</div>
			<div class="who server">
				<PixelSprite
					character="server"
					:animation="mood.server"
					:size="52"
					label="Server"
					flip
				/>
				<span>server</span>
			</div>
			<div class="who victim">
				<PixelSprite
					character="jo"
					:animation="mood.victim"
					:size="52"
					:label="`Victim at ${VICTIM}`"
				/>
				<span class="demo-mono">victim<br />{{ VICTIM }}</span>
			</div>
			<div class="lane out" :class="{ big: !cookies }">
				<span class="lane-label demo-mono">
					{{ cookies ? 'HelloVerifyRequest' : 'ServerHello + certificates…' }}
					· {{ fmt(reply) }}
				</span>
				<span class="line">
					<span
						v-for="d of dots.filter((d) => d.lane === 'out')"
						:key="d.id"
						class="dot"
						:class="{ big: d.big }"
					/>
				</span>
			</div>
		</div>

		<dl class="stats">
			<div v-for="s of stats" :key="s.label">
				<dt>{{ s.label }}</dt>
				<dd class="demo-mono" :class="s.tone">{{ s.value }}</dd>
			</div>
		</dl>

		<div class="slots-wrap">
			<p class="slots-label">
				server memory: half-open handshakes
				<span class="demo-mono">{{ held }}</span>
				<span v-if="held >= SLOTS" class="demo-bad"> and counting</span>
			</p>
			<div
				class="slots"
				role="img"
				:aria-label="`${held} half-open handshakes held`"
			>
				<span
					v-for="i in SLOTS"
					:key="i"
					:class="{ used: i <= held }"
				/>
			</div>
		</div>

		<p v-if="last" class="demo-note" aria-live="polite">{{ last }}</p>

		<div v-if="ladder.length" class="ladder">
			<p class="ladder-head">
				<PixelSprite
					character="client"
					:animation="mood.client"
					:size="32"
					label="Real client"
				/>
				a real client connects
			</p>
			<ol>
				<li v-for="(s, i) of ladder" :key="i" :class="s.dir">
					<span class="end">client</span>
					<span class="msg">
						<span class="demo-mono"
							>{{ s.what }}
							<span class="nowrap">· {{ fmt(s.bytes) }}</span></span
						>
						<span class="arrow" />
						<span v-if="s.note" class="step-note">{{ s.note }}</span>
					</span>
					<span class="end">server</span>
				</li>
			</ol>
			<p v-if="ladderDone" class="demo-note">
				<template v-if="cookies">
					<span class="demo-warn">{{ roundTrips }} round trips.</span> One
					extra, the price of the defence. DTLS 1.3 does the same with a
					HelloRetryRequest carrying a cookie.
				</template>
				<template v-else>
					1 round trip. Fast, but the server can't tell a real client from
					a forged address.
				</template>
			</p>
		</div>

		<template #controls>
			<div class="group">
				<button type="button" class="demo-btn danger" @click="spoof(1)">
					spoof 1
				</button>
				<button type="button" class="demo-btn danger" @click="spoof(100)">
					spoof 100
				</button>
			</div>
			<button type="button" class="demo-btn" @click="realClient">
				real client
			</button>
			<button type="button" class="demo-btn secondary" @click="reset">
				reset
			</button>
		</template>
		<template #caption>
			Spoof a few ClientHellos with cookies off and watch what lands on the
			victim. Then turn cookies on and try again. WebRTC already checks the
			peer with ICE/STUN before DTLS starts, which is why Pion's WebRTC stack
			skips HelloVerifyRequest by default.
		</template>
	</DemoFrame>
</template>

<style scoped>
.scene {
	display: grid;
	grid-template-columns: auto 1fr auto;
	grid-template-areas:
		'mallory in server'
		'victim out server';
	gap: 10px;
	align-items: center;
}

.who {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	color: var(--muted);
	font-size: 0.6875rem;
	line-height: 1.3;
	text-align: center;
}

.mallory {
	grid-area: mallory;
}

.victim {
	grid-area: victim;
}

.server {
	grid-area: server;
	align-self: stretch;
	justify-content: center;
}

.lane {
	position: relative;
	display: flex;
	flex-direction: column;
	justify-content: center;
	min-height: 56px;
	--thick: 2px;
}

.lane.in {
	grid-area: in;
}

.lane.out {
	grid-area: out;
}

.lane.out.big {
	--thick: 8px;
}

.lane-label {
	margin-bottom: 6px;
	font-size: 0.6875rem;
	line-height: 1.35;
	text-align: center;
}

.line {
	position: relative;
	height: var(--thick);
	margin: 0 8px;
	border-radius: 0;
	background: var(--rule);
	transition: height 0.3s;
}

.lane.out.big .line {
	background: var(--danger);
}

.line::after {
	position: absolute;
	top: 50%;
	width: 0;
	height: 0;
	border-top: calc(var(--thick) + 4px) solid transparent;
	border-bottom: calc(var(--thick) + 4px) solid transparent;
	content: '';
	transform: translateY(-50%);
}

.in .line::after {
	right: -8px;
	border-left: 10px solid var(--rule);
}

.out .line::after {
	left: -8px;
	border-right: 10px solid var(--rule);
}

.out.big .line::after {
	border-right-color: var(--danger);
}

.dot {
	position: absolute;
	top: 50%;
	width: 10px;
	height: 10px;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	transform: translate(-50%, -50%);
	animation: fly-right 0.5s linear forwards;
}

.out .dot {
	width: 8px;
	height: 8px;
	border-color: var(--tip);
	animation-name: fly-left;
}

.out .dot.big {
	width: 22px;
	height: 18px;
	border-color: var(--danger);
	background: color-mix(in srgb, var(--danger) 30%, var(--bg));
}

@keyframes fly-right {
	from {
		left: 0;
	}
	to {
		left: 100%;
	}
}

@keyframes fly-left {
	from {
		left: 100%;
	}
	to {
		left: 0;
	}
}

.stats {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 8px;
	margin: 12px 0 0;
}

.stats div {
	padding: 6px 0;
	border-top: 1px solid var(--rule);
}

.stats dt {
	color: var(--muted);
	font-size: 0.6875rem;
	line-height: 1.3;
}

.stats dd {
	margin: 2px 0 0;
	font-size: 1rem;
	font-weight: 700;
	line-height: 1.3;
}

.slots-wrap {
	margin-top: 12px;
}

.slots-label {
	margin: 0 0 6px;
	color: var(--muted);
	font-size: 0.75rem;
}

.slots-label .demo-mono {
	color: var(--text);
}

.slots {
	display: grid;
	grid-template-columns: repeat(25, 1fr);
	gap: 2px;
}

.slots span {
	height: 8px;
	border-radius: 0;
	background: var(--bg);
}

.slots span.used {
	background: var(--warning);
}

.ladder {
	margin-top: 12px;
	padding-top: 8px;
	border-top: 1px solid var(--demo-rule);
}

.ladder-head {
	display: flex;
	gap: 8px;
	align-items: center;
	margin: 0 0 6px;
	font-size: 0.8125rem;
}

.ladder ol {
	margin: 0;
	padding: 0;
	list-style: none;
}

.ladder li {
	display: grid;
	grid-template-columns: auto 1fr auto;
	gap: 8px;
	align-items: center;
	margin: 0;
	padding: 4px 0;
	animation: appear 0.3s ease-out;
}

.end {
	color: var(--muted);
	font-size: 0.6875rem;
}

.msg {
	display: flex;
	flex-direction: column;
	align-items: center;
	font-size: 0.6875rem;
	line-height: 1.35;
	text-align: center;
}

.arrow {
	position: relative;
	align-self: stretch;
	height: 2px;
	margin: 3px 6px;
	background: var(--accent);
}

.down .arrow {
	background: var(--info);
}

.arrow::after {
	position: absolute;
	top: -4px;
	border-top: 5px solid transparent;
	border-bottom: 5px solid transparent;
	content: '';
}

.up .arrow::after {
	right: -6px;
	border-left: 8px solid var(--accent);
}

.down .arrow::after {
	left: -6px;
	border-right: 8px solid var(--info);
}

.nowrap {
	white-space: nowrap;
}

.step-note {
	color: var(--muted);
}

.group {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

@keyframes appear {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
}

@media (max-width: 520px) {
	.stats {
		grid-template-columns: repeat(2, 1fr);
	}

	.slots {
		grid-template-columns: repeat(20, 1fr);
	}
}

@media (prefers-reduced-motion: reduce) {
	.dot,
	.ladder li {
		animation: none;
	}

	.line {
		transition: none;
	}
}
</style>
