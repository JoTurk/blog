<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import PixelSprite from './PixelSprite.vue'

const MESSAGE = 'HELLO, PION!'
// Timing (ms)
const TRIP = 1800
const GAP = 280
const RTO = TRIP * 2.2
const FALL = 700

const loss = ref(15)
const jitter = ref(40)

interface Flight {
	id: number
	seq: number
	sentAt: number
	duration: number
	dropAt?: number
	droppedAt?: number
	retransmit: boolean
}

interface Lane {
	kind: 'tcp' | 'udp'
	flights: Flight[]
	delivered: number[]
	held: number[]
	next: number
	resends: { seq: number; at: number }[]
	lost: number
	doneAt?: number
}

function lane(kind: Lane['kind']): Lane {
	return {
		kind,
		flights: [],
		delivered: [],
		held: [],
		next: 0,
		resends: [],
		lost: 0,
		doneAt: undefined,
	}
}

const lanes = reactive({ tcp: lane('tcp'), udp: lane('udp') })
const now = ref(0)
const startedAt = ref(0)
const running = ref(false)
const sending = ref(false)
let ids = 0
let frame = 0
let sendTimers: ReturnType<typeof setTimeout>[] = []

function fate() {
	const duration = TRIP * (1 + (Math.random() * jitter.value) / 100)
	const dropped = Math.random() * 100 < loss.value
	return { duration, dropAt: dropped ? 0.25 + Math.random() * 0.5 : undefined }
}

function launch(
	l: Lane,
	seq: number,
	f: ReturnType<typeof fate>,
	retransmit = false,
) {
	l.flights.push({
		id: ids++,
		seq,
		sentAt: performance.now(),
		duration: f.duration,
		dropAt: f.dropAt,
		retransmit,
	})
}

function progress(f: Flight, t: number) {
	return Math.min((t - f.sentAt) / f.duration, 1)
}

function drop(l: Lane, f: Flight, t: number) {
	f.droppedAt = t
	l.lost++
	if (l.kind === 'tcp') l.resends.push({ seq: f.seq, at: f.sentAt + RTO })
}

function arrive(l: Lane, seq: number) {
	if (l.kind === 'udp') {
		l.delivered.push(seq)
		return
	}
	if (seq < l.next || l.held.includes(seq)) return
	l.held.push(seq)
	while (l.held.includes(l.next)) {
		l.held.splice(l.held.indexOf(l.next), 1)
		l.delivered.push(l.next)
		l.next++
	}
}

function tick() {
	const t = performance.now()
	now.value = t
	for (const l of [lanes.tcp, lanes.udp]) {
		for (const f of l.flights) {
			if (f.droppedAt !== undefined) continue
			const p = progress(f, t)
			if (f.dropAt !== undefined && p >= f.dropAt) drop(l, f, t)
			else if (p >= 1) {
				f.droppedAt = -1
				arrive(l, f.seq)
			}
		}
		l.flights = l.flights.filter(
			(f) =>
				f.droppedAt === undefined ||
				(f.droppedAt > 0 && t - f.droppedAt < FALL),
		)
		for (const r of l.resends.filter((r) => t >= r.at)) {
			launch(l, r.seq, fate(), true)
		}
		l.resends = l.resends.filter((r) => t < r.at)

		const finished =
			!sending.value && l.flights.length === 0 && l.resends.length === 0
		if (finished && l.doneAt === undefined) l.doneAt = t
	}
	if (lanes.tcp.doneAt !== undefined && lanes.udp.doneAt !== undefined) {
		running.value = false
		return
	}
	frame = requestAnimationFrame(tick)
}

function send() {
	stop()
	lanes.tcp = lane('tcp')
	lanes.udp = lane('udp')
	startedAt.value = performance.now()
	now.value = startedAt.value
	running.value = true
	sending.value = true
	sendTimers = [...MESSAGE].map((_, seq) =>
		setTimeout(() => {
			const f = fate()
			launch(lanes.tcp, seq, f)
			launch(lanes.udp, seq, f)
			if (seq === MESSAGE.length - 1) {
				sendTimers = []
				sending.value = false
			}
		}, seq * GAP),
	)
	frame = requestAnimationFrame(tick)
}

function stop() {
	cancelAnimationFrame(frame)
	frame = 0
	for (const timer of sendTimers) clearTimeout(timer)
	sendTimers = []
	sending.value = false
	running.value = false
}

onBeforeUnmount(stop)

function zap(l: Lane, f: Flight) {
	if (f.droppedAt === undefined) drop(l, f, performance.now())
}

function x(f: Flight) {
	const t = f.droppedAt && f.droppedAt > 0 ? f.droppedAt : now.value
	return progress(f, t) * 100
}

function lateSeqs(l: Lane) {
	return l.delivered.filter((seq, i) => i > 0 && seq < l.delivered[i - 1])
}

function outOfOrder(l: Lane) {
	return lateSeqs(l).length
}

function postcard(l: Lane, seq: number) {
	return l.kind === 'udp' ? seq + 1 : undefined
}

function shown(l: Lane) {
	const late = lateSeqs(l)
	const got = l.delivered.map((seq) => ({
		key: seq,
		n: postcard(l, seq),
		char: MESSAGE[seq],
		kind: late.includes(seq) ? 'late' : '',
	}))
	const held = l.held.map((seq) => ({
		key: `h${seq}`,
		n: undefined,
		char: MESSAGE[seq],
		kind: 'held',
	}))
	return [...got, ...held]
}

function seconds(l: Lane) {
	const end = l.doneAt ?? now.value
	return ((end - startedAt.value) / 1000).toFixed(1)
}

function serverMood(l: Lane) {
	if (!running.value && l.doneAt === undefined) return 'idle'
	if (l.doneAt !== undefined) {
		const perfect = l.delivered.length === MESSAGE.length && !outOfOrder(l)
		return perfect ? 'yay' : 'wow'
	}
	if (l.kind === 'tcp' && l.held.length > 0) return 'sleep'
	return 'idle'
}

const clientMood = computed(() => (sending.value ? 'send' : 'idle'))

function status(l: Lane) {
	if (!running.value && l.doneAt === undefined)
		return 'waiting for you to press send'
	const parts = [`${seconds(l)}s`]
	if (l.kind === 'tcp') {
		if (l.held.length) parts.push(`stuck waiting for “${MESSAGE[l.next]}”`)
		const resent = l.lost - l.resends.length
		if (l.resends.length) parts.push(`${l.resends.length} lost`)
		if (resent) parts.push(`${resent} resent`)
	} else {
		if (l.lost) parts.push(`${l.lost} lost`)
		if (outOfOrder(l)) parts.push(`${outOfOrder(l)} out of order`)
	}
	return parts.join(' · ')
}
</script>

<template>
	<figure class="demo lossy-wire">
		<div class="demo-controls">
			<button class="demo-btn" data-longest="send again" @click="send">
				{{ running ? 'send again' : 'send' }}
			</button>
			<label>
				loss <output>{{ loss }}%</output>
				<input v-model.number="loss" type="range" min="0" max="50" />
			</label>
			<label>
				jitter <output>{{ jitter }}%</output>
				<input v-model.number="jitter" type="range" min="0" max="150" />
			</label>
		</div>

		<div v-for="l of [lanes.tcp, lanes.udp]" :key="l.kind" class="lane">
			<div class="lane-head">
				<strong>{{ l.kind.toUpperCase() }}</strong>
				<span>{{ l.kind === 'tcp' ? 'a phone call' : 'postcards' }}</span>
			</div>
			<div class="track">
				<PixelSprite character="client" :animation="clientMood" :size="56" />
				<div class="wire">
					<button
						v-for="f of l.flights"
						:key="f.id"
						class="packet"
						:class="{
							dropped: f.droppedAt && f.droppedAt > 0,
							retransmit: f.retransmit,
						}"
						:style="{ left: `${x(f)}%` }"
						:data-n="postcard(l, f.seq)"
						:aria-label="`Drop packet ${MESSAGE[f.seq]}`"
						@click="zap(l, f)"
					>
						{{ MESSAGE[f.seq] }}
					</button>
				</div>
				<PixelSprite
					character="server"
					:animation="serverMood(l)"
					:size="56"
					flip
				/>
			</div>
			<div class="received" :class="{ numbered: l.kind === 'udp' }">
				<span class="label">app sees</span>
				<span class="chars">
					<span
						v-for="c of shown(l)"
						:key="c.key"
						:class="c.kind"
						:data-n="c.n"
						>{{ c.char }}</span
					>
				</span>
			</div>
			<p class="status">{{ status(l) }}</p>
		</div>
		<figcaption class="demo-caption">
			Tap a packet in flight to drop it. TCP holds back everything after a
			gap until the missing packet is resent. UDP hands over whatever shows
			up, in whatever order it shows up. If the app numbers its postcards, it
			can sort them afterwards, but it can't fill the gaps.
		</figcaption>
	</figure>
</template>

<style scoped>
.lane + .lane {
	margin-top: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--demo-rule);
}

.lane-head {
	display: flex;
	gap: 10px;
	align-items: baseline;
	font-size: 0.875rem;
}

.lane-head span,
.status,
.label {
	color: var(--muted);
	font-size: 0.8125rem;
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
	min-width: 26px;
	height: 26px;
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

.received {
	display: flex;
	gap: 12px;
	min-width: 0;
	align-items: center;
	margin-top: 6px;
	min-height: 26px;
}

.chars {
	display: flex;
	flex-wrap: wrap;
	gap: 3px;
	min-width: 0;
	font: 700 1rem / 1 var(--font-mono);
}

.chars span {
	position: relative;
	display: grid;
	place-items: center;
	min-width: 22px;
	height: 26px;
	border-radius: 0;
	border-bottom: 1px solid var(--rule);
	white-space: pre;
}

.chars .late {
	color: var(--warning);
}

.chars .held {
	opacity: 0.35;
	outline: 1px dashed var(--muted);
}

.packet[data-n]::before,
.chars [data-n]::after {
	content: attr(data-n);
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	color: var(--muted);
	font: 400 0.625rem / 1 var(--font-mono);
}

.packet[data-n]::before {
	bottom: calc(100% + 4px);
}

.chars [data-n]::after {
	top: calc(100% + 3px);
}

.received.numbered {
	padding-bottom: 14px;
}

.numbered .chars {
	row-gap: 17px;
}

.status {
	margin: 4px 0 0;
}

@media (max-width: 520px) {
	.track {
		gap: 4px;
	}

	.packet {
		min-width: 20px;
		height: 22px;
		padding: 0 2px;
		font-size: 0.75rem;
	}
}
</style>
