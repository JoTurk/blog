<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

// Server flight
const RECORDS = [
	{ name: 'SH', bytes: 250 },
	{ name: 'EE', bytes: 250 },
	{ name: 'CT1', bytes: 1200 },
	{ name: 'CT2', bytes: 1200 },
	{ name: 'CV', bytes: 250 },
	{ name: 'FIN', bytes: 250 },
]
// ACK size
const ACK_OVERHEAD = 25
const ACK_PER_RECORD = 16

// Timing (ms)
const ONE_WAY = 50
const PACE = 8
const FIRST_TIMER = 1000
const ACK_QUIET = 16
const ACK_LATE = FIRST_TIMER / 4

const SLOW = 28
const FAST = 4
const FALL = 700

type Version = '12' | '13'
type Kind = 'rec' | 'ack' | 'fin'

interface Packet {
	id: number
	kind: Kind
	rec: number
	attempt: number
	seq: number
	acks: number[]
	sentAt: number
	dropAt?: number
	dropT?: number
	droppedWall?: number
	done: boolean
	retransmit: boolean
}

interface Lane {
	v: Version
	t: number
	packets: Packet[]
	queue: { at: number; run: () => void }[]
	nextSeq: number
	attempts: number[]
	seqRec: Record<number, number>
	got: boolean[]
	gotSeqs: number[]
	acked: boolean[]
	rto: number
	timerSet: number
	timerAt?: number
	ackAt?: number
	ackGap: boolean
	deliveredAt?: number
	doneAt?: number
	lastFinAt: number
	sent: number
	bytes: number
	acksSent: number
	fast: boolean
	note: string
}

function lane(v: Version): Lane {
	return {
		v,
		t: 0,
		packets: [],
		queue: [],
		nextSeq: 0,
		attempts: RECORDS.map(() => 0),
		seqRec: {},
		got: RECORDS.map(() => false),
		gotSeqs: [],
		acked: RECORDS.map(() => false),
		rto: FIRST_TIMER,
		timerSet: 0,
		ackGap: false,
		lastFinAt: -1000,
		sent: 0,
		bytes: 0,
		acksSent: 0,
		fast: false,
		note: 'waiting for you to press start',
	}
}

const lanes = reactive({ v12: lane('12'), v13: lane('13') })
const loss = ref(20)
const running = ref(false)
const started = ref(false)
let ids = 0
let frame = 0
let lastWall = 0

let fates: { dropAt?: number }[][] = []

function fate(rec: number, attempt: number) {
	while (fates[rec].length <= attempt) {
		const dropped = Math.random() * 100 < loss.value
		fates[rec].push({
			dropAt: dropped ? 0.3 + Math.random() * 0.4 : undefined,
		})
	}
	return fates[rec][attempt]
}

function schedule(l: Lane, at: number, run: () => void) {
	l.queue.push({ at, run })
}

function launch(l: Lane, p: Omit<Packet, 'id' | 'done' | 'sentAt'>) {
	l.packets.push({ ...p, id: ids++, done: false, sentAt: l.t })
}

function sendRecord(l: Lane, rec: number, retransmit: boolean) {
	const attempt = l.attempts[rec]++
	fate(rec, attempt)
	const seq = l.nextSeq++
	l.seqRec[seq] = rec
	l.sent++
	l.bytes += RECORDS[rec].bytes
	launch(l, { kind: 'rec', rec, attempt, seq, acks: [], retransmit })
}

function sendFlight(l: Lane, recs: number[], retransmit: boolean) {
	recs.forEach((rec, i) => {
		schedule(l, l.t + i * PACE, () => sendRecord(l, rec, retransmit))
	})
	l.timerSet = l.t
	l.timerAt = l.t + l.rto
}

function sendAck(l: Lane) {
	l.ackAt = undefined
	l.ackGap = false
	const acks = [...l.gotSeqs].sort((a, b) => a - b)
	l.acksSent++
	l.bytes += ACK_OVERHEAD + ACK_PER_RECORD * acks.length
	l.note = `client: “I got ${acks.join(', ')}”`
	launch(l, {
		kind: 'ack',
		rec: -1,
		attempt: 0,
		seq: -1,
		acks,
		retransmit: false,
	})
}

function sendFin(l: Lane) {
	l.lastFinAt = l.t
	launch(l, {
		kind: 'fin',
		rec: -1,
		attempt: 0,
		seq: -1,
		acks: [],
		retransmit: false,
	})
}

function names(recs: number[]) {
	return recs.map((r) => RECORDS[r].name).join(', ')
}

function missing(flags: boolean[]) {
	return flags.flatMap((ok, i) => (ok ? [] : [i]))
}

function atClient(l: Lane, p: Packet) {
	if (l.deliveredAt !== undefined) {
		if (l.t - l.lastFinAt > 30) sendFin(l)
		return
	}
	if (l.got[p.rec]) return
	l.got[p.rec] = true
	l.gotSeqs.push(p.seq)
	if (l.got.every(Boolean)) {
		l.deliveredAt = l.t
		l.ackAt = undefined
		l.note = 'client has the whole flight and replies'
		sendFin(l)
		return
	}
	if (l.v === '12') return
	const gap = l.got.some((ok, i) => !ok && i < p.rec)
	if (gap || l.ackGap) {
		l.ackGap = true
		l.ackAt = l.t + ACK_QUIET
		const gone = missing(l.got).filter((i) => i < p.rec)
		if (gone.length)
			l.note = `client notices ${names(gone)} ${gone.length > 1 ? 'are' : 'is'} missing`
	} else if (l.ackAt === undefined) {
		l.ackAt = l.t + ACK_LATE
	}
}

function atServer(l: Lane, p: Packet) {
	if (l.doneAt !== undefined) return
	if (p.kind === 'fin') {
		l.doneAt = l.t
		l.timerAt = undefined
		l.queue = []
		return
	}
	for (const seq of p.acks) l.acked[l.seqRec[seq]] = true
	const resend = missing(l.acked)
	if (resend.length) {
		l.note = `server resends only ${names(resend)}`
		sendFlight(l, resend, true)
	}
}

function onTimer(l: Lane) {
	const waited = l.rto
	l.rto = Math.min(l.rto * 2, 16000)
	const resend = l.v === '12' ? RECORDS.map((_, i) => i) : missing(l.acked)
	l.note = `timer fired after ${waited / 1000} s: resend ${
		resend.length === RECORDS.length ? 'all 6' : names(resend)
	}`
	sendFlight(l, resend, true)
}

function dropPoint(p: Packet) {
	return p.kind === 'rec' ? fates[p.rec][p.attempt].dropAt : p.dropAt
}

function progress(l: Lane, p: Packet) {
	return Math.min((l.t - p.sentAt) / ONE_WAY, 1)
}

function step(l: Lane) {
	for (const p of l.packets) {
		if (p.done) continue
		const at = progress(l, p)
		const dropAt = dropPoint(p)
		if (dropAt !== undefined && at >= dropAt) {
			p.done = true
			p.dropT = p.sentAt + dropAt * ONE_WAY
			p.droppedWall = performance.now()
		} else if (at >= 1) {
			p.done = true
			if (p.kind === 'rec') atClient(l, p)
			else atServer(l, p)
		}
	}
	const due = l.queue.filter((q) => q.at <= l.t).sort((a, b) => a.at - b.at)
	l.queue = l.queue.filter((q) => q.at > l.t)
	for (const q of due) q.run()
	if (l.timerAt !== undefined && l.t >= l.timerAt) onTimer(l)
	if (l.ackAt !== undefined && l.t >= l.ackAt) sendAck(l)
}

function idle(l: Lane) {
	return l.packets.every((p) => p.done) && l.queue.length === 0
}

function advance(l: Lane, wall: number) {
	let budget = wall
	while (budget > 1e-6 && l.doneAt === undefined) {
		l.fast = idle(l)
		const rate = l.fast ? FAST : SLOW
		const dt = Math.min(1, budget / rate)
		l.t += dt
		budget -= dt * rate
		step(l)
	}
	if (l.doneAt !== undefined) {
		l.fast = false
		l.t += wall / SLOW
		step(l)
	}
}

function tick() {
	const wall = performance.now()
	const dt = Math.min(wall - lastWall, 50)
	lastWall = wall
	for (const l of [lanes.v12, lanes.v13]) {
		advance(l, dt)
		l.packets = l.packets.filter(
			(p) =>
				!p.done || (p.droppedWall !== undefined && wall - p.droppedWall < FALL),
		)
	}
	const settled = (l: Lane) =>
		(l.doneAt !== undefined || l.t > 30000) && l.packets.length === 0
	if (settled(lanes.v12) && settled(lanes.v13)) {
		running.value = false
		return
	}
	frame = requestAnimationFrame(tick)
}

function start() {
	cancelAnimationFrame(frame)
	fates = RECORDS.map(() => [])
	Object.assign(lanes.v12, lane('12'))
	Object.assign(lanes.v13, lane('13'))
	for (const l of [lanes.v12, lanes.v13]) {
		l.note = 'server sends its flight'
		sendFlight(l, [0, 1, 2, 3, 4, 5], false)
	}
	started.value = true
	running.value = true
	lastWall = performance.now()
	frame = requestAnimationFrame(tick)
}

onBeforeUnmount(() => cancelAnimationFrame(frame))

function zap(l: Lane, p: Packet) {
	if (p.done) return
	const at = Math.max(progress(l, p), 0.02)
	if (p.kind === 'rec') fates[p.rec][p.attempt].dropAt = at
	else p.dropAt = at
}

function x(l: Lane, p: Packet) {
	const t = p.dropT ?? l.t
	const at = Math.min((t - p.sentAt) / ONE_WAY, 1)
	return p.kind === 'rec' ? 100 - at * 100 : at * 100
}

function label(p: Packet) {
	if (p.kind === 'ack') return `ACK ${p.acks.join(',')}`
	if (p.kind === 'fin') return 'reply'
	return RECORDS[p.rec].name
}

function ariaLabel(p: Packet) {
	if (p.kind === 'ack') return `Drop the ACK for records ${p.acks.join(', ')}`
	if (p.kind === 'fin') return "Drop the client's reply"
	return `Drop record ${RECORDS[p.rec].name}`
}

function recent(l: Lane, kinds: Kind[]) {
	return l.packets.some(
		(p) => kinds.includes(p.kind) && !p.done && l.t - p.sentAt < 12,
	)
}

function serverMood(l: Lane): AnimationName {
	if (!started.value) return 'idle'
	if (l.doneAt !== undefined) return 'yay'
	if (recent(l, ['rec']) || l.queue.length) return 'send'
	if (l.timerAt !== undefined && idle(l)) return 'sleep'
	return 'idle'
}

function clientMood(l: Lane): AnimationName {
	if (!started.value) return 'idle'
	if (recent(l, ['ack', 'fin'])) return 'send'
	if (l.deliveredAt !== undefined) return 'yay'
	if (l.ackGap) return 'wow'
	if (idle(l) && l.got.some(Boolean)) return 'sleep'
	return 'idle'
}

function timerLeft(l: Lane) {
	if (l.timerAt === undefined || l.doneAt !== undefined) return 0
	return Math.max(0, (l.timerAt - l.t) / (l.timerAt - l.timerSet))
}

function note(l: Lane) {
	const gaps = missing(l.got)
	if (
		l.v === '12' &&
		l.deliveredAt === undefined &&
		gaps.length < RECORDS.length &&
		idle(l)
	)
		return `client is missing ${names(gaps)}, but has no way to say so`
	return l.note
}

function seconds(ms: number) {
	return `${(ms / 1000).toFixed(2)} s`
}

function kb(bytes: number) {
	return `${(bytes / 1000).toFixed(1)} kB`
}

const RING = 2 * Math.PI * 9
</script>

<template>
	<DemoFrame>
		<div class="ack-race">
			<div v-for="l of [lanes.v12, lanes.v13]" :key="l.v" class="lane">
				<div class="lane-head">
					<strong>DTLS {{ l.v === '12' ? '1.2' : '1.3' }}</strong>
					<span>{{
						l.v === '12'
							? 'no ACKs, a timer resends everything'
							: 'ACKs say exactly what arrived'
					}}</span>
					<span v-if="running && l.fast && l.doneAt === undefined" class="ff"
						>fast-forwarding the wait</span
					>
				</div>
				<div class="track">
					<PixelSprite
						character="client"
						:animation="clientMood(l)"
						:size="52"
						label="Client"
					/>
					<div class="wire">
						<button
							v-for="p of l.packets"
							:key="p.id"
							class="packet"
							:class="[
								p.kind,
								{
									dropped: p.droppedWall !== undefined,
									retransmit: p.retransmit,
									low: p.kind === 'rec' && p.rec % 2 === 1,
								},
							]"
							:style="{ left: `${x(l, p)}%` }"
							:aria-label="ariaLabel(p)"
							@click="zap(l, p)"
						>
							{{ label(p) }}
						</button>
					</div>
					<div class="server">
						<PixelSprite
							character="server"
							:animation="serverMood(l)"
							:size="52"
							flip
							label="Server"
						/>
						<svg
							v-if="timerLeft(l) > 0"
							class="ring"
							viewBox="0 0 24 24"
							role="img"
							:aria-label="`Retransmission timer: ${seconds(
								(l.timerAt ?? 0) - l.t,
							)} left`"
						>
							<circle cx="12" cy="12" r="9" class="ring-bg" />
							<circle
								cx="12"
								cy="12"
								r="9"
								class="ring-fg"
								:stroke-dasharray="RING"
								:stroke-dashoffset="RING * (1 - timerLeft(l))"
							/>
						</svg>
					</div>
				</div>
				<div class="has">
					<span class="label">client has</span>
					<span class="demo-bytes">
						<span
							v-for="(r, i) of RECORDS"
							:key="r.name"
							:class="{ got: l.got[i] }"
							>{{ r.name }}</span
						>
					</span>
				</div>
				<p class="stats demo-mono">
					<span
						>flight in
						<b :class="{ 'demo-ok': l.deliveredAt !== undefined }">{{
							seconds(l.deliveredAt ?? l.t)
						}}</b></span
					>
					<span><b>{{ l.sent }}</b> records</span>
					<span v-if="l.v === '13'"
						><b>{{ l.acksSent }}</b> ACK{{ l.acksSent === 1 ? '' : 's' }}</span
					>
					<span><b>{{ kb(l.bytes) }}</b> sent</span>
				</p>
				<p class="note-line">
					{{ note(l)
					}}<template v-if="l.timerAt !== undefined && l.doneAt === undefined && started">
						· timer {{ seconds(Math.max(0, l.timerAt - l.t)) }}</template
					>
				</p>
			</div>
			<p class="demo-note">
				Same flight in both lanes, so only the repair differs. 50 ms each
				way, first timer 1 s. Records ~250 B, certificate fragments 1,200 B,
				ACKs ~25 B + 16 B per record number.
			</p>
		</div>

		<template #controls>
			<button class="demo-btn" data-longest="again" @click="start">
				{{ started ? 'again' : 'start' }}
			</button>
			<label>
				loss <output>{{ loss }}%</output>
				<input v-model.number="loss" type="range" min="0" max="50" />
			</label>
		</template>
		<template #caption>
			Tap a record in flight to lose it in both lanes. Try losing just one
			certificate fragment, then try losing the last record, FIN.
		</template>
	</DemoFrame>
</template>

<style scoped>
.lane + .lane {
	margin-top: 18px;
	padding-top: 18px;
	border-top: 1px dashed var(--rule);
}

.lane-head {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 10px;
	align-items: baseline;
	font-size: 0.875rem;
}

.lane-head span,
.label,
.note-line {
	color: var(--muted);
	font-size: 0.8125rem;
}

.lane-head .ff {
	color: var(--warning);
	font-family: var(--font-mono);
	font-size: 0.75rem;
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
	height: 64px;
	background: linear-gradient(var(--rule), var(--rule)) center / 100% 2px
		no-repeat;
}

.packet {
	position: absolute;
	top: 32%;
	transform: translate(-50%, -50%);
	min-width: 30px;
	height: 22px;
	padding: 0 4px;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 700 0.6875rem / 1 var(--font-mono);
	white-space: nowrap;
	cursor: pointer;
	transition:
		transform 0.7s ease-in,
		opacity 0.7s ease-in;
}

.packet.low {
	top: 68%;
}

.packet.retransmit {
	border-style: dashed;
	border-color: var(--info);
	color: var(--info);
}

.packet.ack {
	top: 50%;
	border-color: var(--tip);
	background: var(--bg);
	color: var(--tip);
}

.packet.fin {
	top: 50%;
	border-color: var(--text);
	background: var(--bg);
	color: var(--text);
}

.packet.dropped {
	transform: translate(-50%, 80%) rotate(25deg);
	opacity: 0;
	border-color: var(--danger);
	pointer-events: none;
}

.server {
	position: relative;
	line-height: 0;
}

.ring {
	position: absolute;
	top: -6px;
	right: -6px;
	width: 22px;
	height: 22px;
	transform: rotate(-90deg);
}

.ring-bg,
.ring-fg {
	fill: var(--bg);
	stroke-width: 4;
}

.ring-bg {
	stroke: var(--rule);
}

.ring-fg {
	fill: none;
	stroke: var(--warning);
}

.has {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 12px;
	align-items: center;
	margin-top: 6px;
}

.has .demo-bytes > * {
	min-width: 34px;
	color: var(--muted);
	opacity: 0.45;
	outline: 1px dashed var(--rule);
	font-size: 0.75rem;
}

.has .demo-bytes > .got {
	color: var(--text);
	opacity: 1;
	outline: 0;
}

.stats {
	display: flex;
	flex-wrap: wrap;
	gap: 2px 14px;
	margin: 8px 0 0;
	font-size: 0.8125rem;
}

.stats b {
	font-weight: 700;
}

.note-line {
	min-height: 1.5em;
	margin: 2px 0 0;
	font-family: var(--font-mono);
}

@media (max-width: 520px) {
	.track {
		gap: 4px;
	}

	.packet {
		min-width: 24px;
		height: 20px;
		padding: 0 2px;
		font-size: 0.625rem;
	}
}
</style>
