<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

type Tab = 'move' | 'replay'
type Addr = 'wifi' | 'cell' | 'victim'
interface Pos {
	x: number
	y: number
}

const ADDR: Record<Addr, string> = {
	wifi: '192.0.2.10:5000',
	cell: '198.51.100.7:61022',
	victim: '203.0.113.7:5000',
}
const CID = '7f3a'

// Scene layout
const LAYOUT: Record<Tab, Record<'home' | 'out' | 'server', Pos>> & {
	replay: Record<'mallory' | 'victim', Pos>
} = {
	move: {
		home: { x: 13, y: 40 },
		out: { x: 44, y: 76 },
		server: { x: 87, y: 40 },
	},
	replay: {
		home: { x: 12, y: 20 },
		out: { x: 34, y: 50 },
		server: { x: 87, y: 38 },
		mallory: { x: 58, y: 80 },
		victim: { x: 12, y: 80 },
	},
}

// Timing (ms)
const TRIP = 1400
const WALK = 1600
const DEAD_AFTER = 4500
const CHALLENGE_TIMEOUT = 3500
const VIDEO_BYTES = 1200
const CHALLENGE_BYTES = 40

interface Packet {
	id: number
	kind: 'up' | 'down' | 'copy' | 'challenge' | 'response'
	from: Pos
	to: Pos
	sentAt: number
	dur: number
	label: string
	seq: number
	copied: boolean
	done: boolean
	missedAt?: number
	arrive: () => boolean
}

const tab = ref<Tab>('move')
const cid = ref(false)
const rrc = ref(false)
const playing = ref(false)
const visible = ref(false)
const clock = ref(0)
const packets = ref<Packet[]>([])

function fresh() {
	return {
		where: 'home' as 'home' | 'walking' | 'out',
		walkStart: 0,
		addr: 'wifi' as Addr,
		peer: 'wifi' as Addr,
		frames: 0,
		lastVideo: 0,
		lastUp: 0,
		dead: false,
		nextUp: 0,
		nextDown: 250,
		seq: 40,
		highest: 40,
		seen: [] as number[],
		bubble: '',
		bubbleUntil: 0,
		happyUntil: 0,
		log: [] as string[],
		mallory: false,
		victimBytes: 0,
		lastVictimVideo: -1e9,
		lastVictimChallenge: -1e9,
		challenges: [] as { addr: Addr; cookie: string; sentAt: number }[],
		failedAt: {} as Partial<Record<Addr, number>>,
	}
}

const s = reactive(fresh())
let ids = 0
let frame = 0
let lastWall = 0
let observer: IntersectionObserver | undefined
const reducedMotion = ref(false)

const L = computed(() => LAYOUT[tab.value])

function lerp(a: Pos, b: Pos, f: number): Pos {
	return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

function clientPos(): Pos {
	if (s.where === 'home') return L.value.home
	if (s.where === 'out') return L.value.out
	return lerp(
		L.value.home,
		L.value.out,
		Math.min((clock.value - s.walkStart) / WALK, 1),
	)
}

function addrPos(a: Addr): Pos {
	if (a === 'victim') return LAYOUT.replay.victim
	return a === 'wifi' ? L.value.home : L.value.out
}

function log(line: string) {
	if (s.log[0] === line) return
	s.log.unshift(line)
	s.log.length = Math.min(s.log.length, 3)
}

function say(text: string, ms = 1100) {
	s.bubble = text
	s.bubbleUntil = clock.value + ms
}

function launch(
	p: Omit<
		Packet,
		'id' | 'sentAt' | 'dur' | 'done' | 'copied' | 'seq' | 'label'
	> & { label?: string; seq?: number; dur?: number },
) {
	packets.value.push({
		label: '',
		seq: 0,
		...p,
		id: ids++,
		sentAt: clock.value,
		dur: p.dur ?? flight(p.from, p.to),
		done: false,
		copied: false,
	})
}

function flight(from: Pos, to: Pos) {
	const dist = Math.hypot(to.x - from.x, (to.y - from.y) * 0.5)
	return Math.max(500, (TRIP * dist) / 74)
}

function sendVideo() {
	const dest = s.peer
	launch({
		kind: 'down',
		from: L.value.server,
		to: addrPos(dest),
		label: tab.value === 'move' && cid.value ? CID : '',
		arrive: () => {
			if (dest === 'victim') {
				s.victimBytes += VIDEO_BYTES
				s.lastVictimVideo = clock.value
				return true
			}
			if (dest !== s.addr || s.where === 'walking') return false
			s.frames++
			s.lastVideo = clock.value
			return true
		},
	})
}

function sendUp() {
	const src = s.addr
	const seq = ++s.seq
	launch({
		kind: 'up',
		from: clientPos(),
		to: L.value.server,
		seq,
		label: tab.value === 'move' ? (cid.value ? CID : '') : `#${seq}`,
		arrive: () => {
			if (tab.value === 'move') atServerMove(src)
			else atServerReplay(src, seq)
			return true
		},
	})
}

function atServerMove(src: Addr) {
	if (s.dead) return
	if (cid.value) {
		if (src !== s.peer) {
			s.peer = src
			s.happyUntil = clock.value + 1200
			say(`CID ${CID}: it's you!`)
			log(`CID ${CID} matches a call I know, so I now send to ${ADDR[src]}`)
		}
		s.lastUp = clock.value
		return
	}
	if (src === s.peer) {
		s.lastUp = clock.value
		return
	}
	say("who's this?")
	log(`a packet from ${ADDR[src]}? I don't know that address. Dropped.`)
}

function atServerReplay(src: Addr, seq: number) {
	if (s.seen.includes(seq)) {
		log(`#${seq} from ${ADDR[src]}: already seen, dropped as a replay`)
		return
	}
	s.seen.push(seq)
	const newest = seq > s.highest
	s.highest = Math.max(s.highest, seq)
	if (!newest || src === s.peer) return
	if (!rrc.value) {
		s.peer = src
		log(`#${seq} is genuine and the newest, from ${ADDR[src]}: switching there`)
		return
	}
	if (s.challenges.some((c) => c.addr === src)) return
	const failed = s.failedAt[src]
	if (failed !== undefined && clock.value - failed < 10000) return
	challenge(src)
}

function challenge(addr: Addr) {
	const cookie = Math.floor(Math.random() * 0xffff)
		.toString(16)
		.padStart(4, '0')
	s.challenges.push({ addr, cookie, sentAt: clock.value })
	say('prove it')
	log(
		`new address ${ADDR[addr]}: path_challenge ${cookie}, video stays on ${ADDR[s.peer]}`,
	)
	launch({
		kind: 'challenge',
		from: L.value.server,
		to: addrPos(addr),
		label: cookie,
		arrive: () => {
			if (addr === 'victim') {
				s.victimBytes += CHALLENGE_BYTES
				s.lastVictimChallenge = clock.value
				log(`victim: “a challenge? I never talked to you.” Ignored.`)
				return true
			}
			if (addr !== s.addr || s.where === 'walking') return false
			launch({
				kind: 'response',
				from: clientPos(),
				to: L.value.server,
				label: cookie,
				arrive: () => {
					const i = s.challenges.findIndex(
						(c) => c.addr === addr && c.cookie === cookie,
					)
					if (i < 0) return true
					s.challenges.splice(i, 1)
					s.peer = addr
					s.happyUntil = clock.value + 1200
					log(
						`path_response ${cookie} from ${ADDR[addr]} matches: video moves there`,
					)
					return true
				},
			})
			return true
		},
	})
}

function copy(p: Packet) {
	p.copied = true
	const seq = p.seq
	const left = p.sentAt + p.dur - clock.value
	launch({
		kind: 'copy',
		from: LAYOUT.replay.mallory,
		to: L.value.server,
		dur: Math.min(flight(LAYOUT.replay.mallory, L.value.server), left * 0.7),
		seq,
		label: `#${seq}`,
		arrive: () => {
			atServerReplay('victim', seq)
			return true
		},
	})
}

function progress(p: Packet) {
	return Math.min((clock.value - p.sentAt) / p.dur, 1)
}

function update() {
	const t = clock.value
	if (s.dead) return
	if (s.where === 'walking' && t - s.walkStart >= WALK) {
		s.where = 'out'
		s.addr = 'cell'
		s.nextUp = t
		log(`phone is on cellular now: ${ADDR.cell}`)
	}
	if (t >= s.nextUp) {
		s.nextUp = t + (tab.value === 'move' ? 500 : 1600)
		if (s.where !== 'walking') sendUp()
	}
	if (t >= s.nextDown) {
		s.nextDown = t + (tab.value === 'move' ? 500 : 380)
		sendVideo()
	}
	if (tab.value === 'move' && t - s.lastUp > DEAD_AFTER) {
		s.dead = true
		log(
			'nothing from the phone for 4 s: the call is dead. Time for an ICE restart and a whole new handshake.',
		)
	}
	for (const c of s.challenges.filter(
		(c) => t - c.sentAt > CHALLENGE_TIMEOUT,
	)) {
		s.failedAt[c.addr] = t
		log(`no path_response from ${ADDR[c.addr]}: not moving the video`)
	}
	s.challenges = s.challenges.filter((c) => t - c.sentAt <= CHALLENGE_TIMEOUT)
	if (s.mallory) {
		for (const p of packets.value) {
			if (p.kind !== 'up' || p.copied || p.done) continue
			const f = progress(p)
			if (f >= 0.3 && f <= 0.6) copy(p)
		}
	}
}

function tick() {
	const wall = performance.now()
	clock.value += Math.min(wall - lastWall, 50)
	lastWall = wall
	update()
	const t = clock.value
	for (const p of packets.value) {
		if (p.done || t - p.sentAt < p.dur) continue
		p.done = true
		if (!p.arrive()) p.missedAt = t
	}
	packets.value = packets.value.filter(
		(p) => !p.done || (p.missedAt !== undefined && t - p.missedAt < 700),
	)
	frame = requestAnimationFrame(tick)
}

function run() {
	cancelAnimationFrame(frame)
	if (!playing.value || !visible.value) return
	lastWall = performance.now()
	frame = requestAnimationFrame(tick)
}

function reset() {
	packets.value = []
	Object.assign(s, fresh())
	clock.value = 0
}

function play() {
	playing.value = true
	run()
}

function pause() {
	playing.value = false
	run()
}

function pick(next: Tab) {
	if (tab.value === next) return
	tab.value = next
	reset()
}

function toggleCid() {
	reset()
}

function walk() {
	if (s.where !== 'home' || s.dead) return
	s.where = 'walking'
	s.walkStart = clock.value
	log('phone leaves the house, and the Wi-Fi')
	play()
}

function toggleMallory() {
	s.mallory = !s.mallory
	log(
		s.mallory
			? `Mallory races a copy of each phone packet to the server, from ${ADDR.victim}`
			: 'Mallory stops',
	)
	play()
}

onMounted(() => {
	reducedMotion.value = window.matchMedia(
		'(prefers-reduced-motion: reduce)',
	).matches
	if (!reducedMotion.value) playing.value = true
	observer = new IntersectionObserver(([entry]) => {
		visible.value = entry.isIntersecting
		run()
	})
	if (root.value) observer.observe(root.value)
})

onBeforeUnmount(() => {
	cancelAnimationFrame(frame)
	observer?.disconnect()
})

const root = ref<HTMLElement>()

function at(p: Packet) {
	const pos = lerp(p.from, p.to, progress(p))
	return { left: `${pos.x}%`, top: `${pos.y}%` }
}

function place(pos: Pos) {
	return { left: `${pos.x}%`, top: `${pos.y}%` }
}

const videoLive = computed(
	() => !s.dead && s.frames > 0 && clock.value - s.lastVideo < 1000,
)
const silent = computed(() => (clock.value - s.lastVideo) / 1000)

const clientMood = computed<AnimationName>(() => {
	if (s.where === 'walking') return 'walk'
	if (s.dead) return 'sad'
	if (s.frames > 0 && !videoLive.value) return 'wow'
	return 'idle'
})

const serverMood = computed<AnimationName>(() => {
	if (s.dead) return 'sad'
	if (clock.value < s.happyUntil) return 'yay'
	if (clock.value < s.bubbleUntil) return 'wow'
	return 'idle'
})

const victimMood = computed<AnimationName>(() => {
	if (clock.value - s.lastVictimVideo < 900) return 'sad'
	if (clock.value - s.lastVictimChallenge < 1500) return 'wow'
	return 'idle'
})

function bytes(n: number) {
	return n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)} kB`
}

function packetName(p: Packet) {
	const names = {
		up: 'phone packet',
		down: 'video packet',
		copy: "Mallory's spoofed copy",
		challenge: 'path_challenge',
		response: 'path_response',
	}
	return names[p.kind]
}
</script>

<template>
	<DemoFrame>
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Scene">
				<button :aria-pressed="tab === 'move'" @click="pick('move')">
					phone changes networks
				</button>
				<button :aria-pressed="tab === 'replay'" @click="pick('replay')">
					Mallory redirects the stream
				</button>
			</div>
		</template>

		<div ref="root" class="cid">
			<div
				class="scene"
				:class="tab"
				role="img"
				:aria-label="
					tab === 'move'
						? 'A phone streaming video with a server'
						: 'A phone streaming video with a server, with Mallory on the path and a victim nearby'
				"
			>
				<svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none">
					<line
						:x1="L.home.x"
						:y1="L.home.y"
						:x2="L.server.x"
						:y2="L.server.y"
					/>
					<line
						v-if="s.where !== 'home'"
						:x1="L.out.x"
						:y1="L.out.y"
						:x2="L.server.x"
						:y2="L.server.y"
					/>
					<template v-if="tab === 'replay'">
						<line
							class="faint"
							:x1="LAYOUT.replay.victim.x"
							:y1="LAYOUT.replay.victim.y"
							:x2="L.server.x"
							:y2="L.server.y"
						/>
						<line
							v-if="s.mallory"
							class="evil"
							:x1="LAYOUT.replay.mallory.x"
							:y1="LAYOUT.replay.mallory.y"
							:x2="L.server.x"
							:y2="L.server.y"
						/>
					</template>
				</svg>

				<div class="house" :style="place(L.home)">
					<span>home Wi-Fi</span>
				</div>

				<div
					v-for="p of packets"
					:key="p.id"
					class="packet"
					:class="[p.kind, { missed: p.missedAt !== undefined, blank: !p.label }]"
					:style="at(p)"
					:title="packetName(p)"
				>
					{{ p.label }}
				</div>

				<div class="actor" :style="place(clientPos())">
					<PixelSprite
						character="client"
						:animation="clientMood"
						:size="44"
						:gone="s.dead"
					/>
					<span class="tag">{{
						s.where === 'walking'
							? 'no signal'
							: s.addr === 'wifi'
								? 'Wi-Fi'
								: 'cellular'
					}}</span>
				</div>
				<div class="actor" :style="place(L.server)">
					<span v-if="clock < s.bubbleUntil" class="bubble">{{ s.bubble }}</span>
					<PixelSprite
						character="server"
						:animation="serverMood"
						:size="44"
						:gone="s.dead"
						flip
					/>
					<span class="tag">server</span>
				</div>
				<template v-if="tab === 'replay'">
					<div class="actor" :style="place(LAYOUT.replay.mallory)">
						<PixelSprite
							character="mallory"
							:animation="s.mallory ? 'sneak' : 'idle'"
							:size="44"
						/>
						<span class="tag">Mallory</span>
					</div>
					<div class="actor" :style="place(LAYOUT.replay.victim)">
						<PixelSprite character="jo" :animation="victimMood" :size="44" />
						<span class="tag">victim</span>
					</div>
				</template>
			</div>

			<dl class="facts">
				<template v-if="tab === 'move'">
					<dt>phone is on</dt>
					<dd>
						{{ s.addr === 'wifi' ? 'Wi-Fi' : 'cellular' }}
						<span class="demo-mono">{{ ADDR[s.addr] }}</span>
					</dd>
					<dt>server finds the call by</dt>
					<dd>
						<template v-if="cid"
							>Connection ID <span class="demo-mono">{{ CID }}…</span></template
						>
						<template v-else
							>source address
							<span class="demo-mono">{{ ADDR.wifi }}</span></template
						>
					</dd>
				</template>
				<dt>server sends video to</dt>
				<dd class="demo-mono" :class="{ 'demo-bad': s.peer === 'victim' }">
					{{ ADDR[s.peer] }}{{ s.peer === 'victim' ? ' (the victim!)' : '' }}
				</dd>
				<dt>video on the phone</dt>
				<dd>
					<span v-if="s.dead" class="demo-bad">dead</span>
					<span v-else-if="!playing && !s.frames">paused</span>
					<span v-else-if="videoLive || !s.frames" class="demo-ok">live</span>
					<span v-else class="demo-warn"
						>frozen for {{ silent.toFixed(1) }} s</span
					>
					<span class="frames"> · {{ s.frames }} frames</span>
				</dd>
				<template v-if="tab === 'replay'">
					<dt>victim has received</dt>
					<dd
						class="demo-mono"
						:class="{ 'demo-bad': s.victimBytes > CHALLENGE_BYTES * 3 }"
					>
						{{ bytes(s.victimBytes) }}
					</dd>
				</template>
			</dl>
			<ol class="log demo-note" aria-live="polite">
				<li v-for="(line, i) of s.log" :key="`${i}${line}`">{{ line }}</li>
			</ol>
		</div>

		<template #controls>
			<button
				class="demo-btn secondary"
				data-longest="pause"
				@click="playing ? pause() : play()"
			>
				{{ playing ? 'pause' : 'play' }}
			</button>
			<button class="demo-btn secondary" @click="reset">reset</button>
			<template v-if="tab === 'move'">
				<button
					class="demo-btn"
					:disabled="s.where !== 'home' || s.dead"
					@click="walk"
				>
					walk out of the house
				</button>
				<label>
					<input v-model="cid" type="checkbox" @change="toggleCid" />
					Connection ID
				</label>
			</template>
			<template v-else>
				<button
					class="demo-btn"
					:class="{ danger: !s.mallory }"
					data-longest="Mallory replays packets"
					:disabled="!s.mallory && s.where === 'walking'"
					@click="toggleMallory"
				>
					{{ s.mallory ? 'stop Mallory' : 'Mallory replays packets' }}
				</button>
				<button
					class="demo-btn secondary"
					:disabled="s.where !== 'home' || s.mallory"
					:title="
						s.mallory && s.where === 'home' ? 'stop Mallory first' : undefined
					"
					@click="walk"
				>
					phone really moves
				</button>
				<label>
					<input v-model="rrc" type="checkbox" @change="reset" />
					Return Routability Check
				</label>
			</template>
		</template>
		<template #caption>
			<template v-if="tab === 'move'">
				Walk out of the house with Connection IDs off, then turn them on and
				try again.
			</template>
			<template v-else>
				Connection IDs are on here. Let Mallory loose with the check off, then
				with it on. With the check on, the phone can still really move. Video
				packets are 1,200 B, a path_challenge about 40 B.
			</template>
		</template>
	</DemoFrame>
</template>

<style scoped>
.scene {
	position: relative;
	height: 180px;
	margin: 4px 0 12px;
}

.scene.replay {
	height: 260px;
}

.lines {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
}

.lines line {
	stroke: var(--rule);
	stroke-width: 2;
	vector-effect: non-scaling-stroke;
}

.lines .faint {
	stroke-dasharray: 4 4;
}

.lines .evil {
	stroke: var(--danger);
	stroke-dasharray: 4 4;
}

.house {
	position: absolute;
	width: 76px;
	height: 84px;
	transform: translate(-50%, -54%);
	border: 1px dashed var(--rule);
	border-radius: 0;
}

.house span {
	position: absolute;
	top: -0.75em;
	left: 50%;
	transform: translateX(-50%);
	padding: 0 4px;
	background: var(--code);
	color: var(--muted);
	font: 0.6875rem / 1.4 var(--font-mono);
	white-space: nowrap;
}

.actor {
	position: absolute;
	display: flex;
	flex-direction: column;
	align-items: center;
	transform: translate(-50%, -50%);
	line-height: 0;
}

.tag {
	margin-top: 4px;
	color: var(--muted);
	font: 0.6875rem / 1 var(--font-mono);
	white-space: nowrap;
}

.bubble {
	position: absolute;
	bottom: calc(100% + 2px);
	right: 0;
	padding: 4px 8px;
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 600 0.75rem / 1.2 var(--font-sans);
	white-space: nowrap;
}

.packet {
	position: absolute;
	z-index: 1;
	transform: translate(-50%, calc(-50% + 9px));
	min-width: 14px;
	height: 18px;
	padding: 0 3px;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 700 0.625rem / 14px var(--font-mono);
	white-space: nowrap;
	transition:
		transform 0.7s ease-in,
		opacity 0.7s ease-in;
}

.packet.blank {
	width: 14px;
	height: 14px;
	padding: 0;
}

.packet.up,
.packet.response {
	transform: translate(-50%, calc(-50% - 9px));
	border-color: var(--info);
	background: var(--bg);
	color: var(--info);
}

.packet.copy {
	border-style: dashed;
	border-color: var(--danger);
	background: var(--bg);
	color: var(--danger);
}

.packet.challenge,
.packet.response {
	border-color: var(--warning);
	color: var(--warning);
	background: var(--bg);
}

.packet.missed {
	transform: translate(-50%, 60%) rotate(25deg);
	opacity: 0;
	border-color: var(--danger);
}

.facts {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 2px 14px;
	margin: 0;
	font-size: 0.8125rem;
}

.facts dt {
	color: var(--muted);
}

.facts dd {
	margin: 0;
}

.frames {
	color: var(--muted);
}

.log {
	min-height: 4.5em;
	padding: 0;
	list-style: none;
}

.log li {
	margin: 0;
}

.log li + li {
	opacity: 0.6;
}

@media (max-width: 520px) {
	.facts {
		grid-template-columns: 1fr;
	}

	.facts dd + dt {
		margin-top: 6px;
	}
}
</style>
