<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

type Mode = '12' | '13' | 'dual'
type Era = '12' | '13' | 'both'
type Kind = 'ok13' | 'ok12' | 'alert' | 'caught'

const modes: { id: Mode; label: string }[] = [
	{ id: '12', label: '1.2 only' },
	{ id: '13', label: '1.3 only' },
	{ id: 'dual', label: 'dual' },
]

const clientMode = ref<Mode>('dual')
const serverMode = ref<Mode>('dual')
const mallory = ref(false)
const bug = ref(false)

// Client offer
const SUITE_12 = 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256'
const SUITE_13 = 'TLS_AES_128_GCM_SHA256'
const EXT_BOTH = ['supported_groups', 'signature_algorithms', 'use_srtp']
const EXT_12 = [
	'extended_master_secret',
	'renegotiation_info',
	'ec_point_formats',
]
const DROPPED = ['extended_master_secret', 'renegotiation_info']
const EXT_13 = ['supported_versions', 'key_share']

interface Chip {
	name: string
	era: Era
	gone?: 'mallory' | 'bug'
}

function hello(c: Mode, strip: boolean, buggy: boolean) {
	const suites: Chip[] = []
	if (c !== '13') suites.push({ name: SUITE_12, era: '12' })
	if (c !== '12') suites.push({ name: SUITE_13, era: '13' })
	const exts: Chip[] = EXT_BOTH.map((name) => ({ name, era: 'both' }))
	if (c !== '13')
		for (const name of EXT_12)
			exts.push({
				name,
				era: '12',
				gone:
					buggy && c === 'dual' && DROPPED.includes(name) ? 'bug' : undefined,
			})
	if (c !== '12')
		for (const name of EXT_13)
			exts.push({
				name,
				era: '13',
				gone: strip && name === 'supported_versions' ? 'mallory' : undefined,
			})
	const versions =
		c === '12'
			? '(not sent)'
			: c === '13'
				? 'fe fc (DTLS 1.3)'
				: 'fe fc (DTLS 1.3), fe fd (DTLS 1.2)'
	return { suites, exts, versions }
}

const breakable = (name: string) => name.replaceAll('_', '_\u200b')

const offered = computed(() =>
	hello(clientMode.value, mallory.value, bug.value),
)

// Outcomes
interface Result {
	kind: Kind
	reply: 'sh13' | 'sh12' | 'alert'
	serverAlert?: string
	clientAlert?: string
	sentinel: boolean
	headline: string
	why: string
	after?: string
}

const ALERTS: Record<string, number> = {
	handshake_failure: 40,
	illegal_parameter: 47,
	protocol_version: 70,
}

function outcome(c: Mode, s: Mode, strip: boolean, buggy: boolean): Result {
	const stripped = strip && c !== '12'
	const onWire = c !== '12' && !stripped
	if (s !== '12' && onWire)
		return {
			kind: 'ok13',
			reply: 'sh13',
			sentinel: false,
			headline: 'DTLS 1.3 ✓',
			why:
				c === 'dual'
					? 'supported_versions lists fe fc and the server speaks 1.3, so it picks the newest version both sides have.'
					: 'Both sides speak 1.3, and supported_versions says so.',
			after:
				'Locked to 1.3: encrypted records use the unified header (first bits 001), and a 1.2-style record (17 fe fd …) is now dropped.',
		}
	if (s === '13')
		return {
			kind: 'alert',
			reply: 'alert',
			serverAlert: 'protocol_version',
			sentinel: false,
			headline: 'protocol_version alert ✗',
			why: stripped
				? 'With supported_versions gone, the 1.3-only server thinks the client is 1.2-only and gives up: Mallory can break the connection, but she can’t downgrade it.'
				: 'No supported_versions means a 1.2-only client, and a 1.3-only server has no version in common with it.',
		}
	if (c === '13')
		return {
			kind: 'alert',
			reply: 'alert',
			serverAlert: 'handshake_failure',
			sentinel: false,
			headline: 'handshake_failure alert ✗',
			why:
				s === '12'
					? 'The 1.2 server ignores supported_versions and finds only 1.3 cipher suites it doesn’t know. (Had it answered, the client would refuse a fe fd ServerHello with protocol_version.)'
					: 'Without supported_versions the server has to pick 1.2, but a 1.3-only client offered no 1.2 cipher suites.',
		}
	if (buggy && c === 'dual' && s === '12')
		return {
			kind: 'alert',
			reply: 'alert',
			serverAlert: 'handshake_failure',
			sentinel: false,
			headline: 'handshake_failure alert ✗',
			why: '1.3 state leaked into the 1.2 fallback: the hello was built for 1.3 and left out extended_master_secret, which this strict 1.2 server requires.',
		}
	const sentinel = s === 'dual'
	if (sentinel && c === 'dual')
		return {
			kind: 'caught',
			reply: 'sh12',
			clientAlert: 'illegal_parameter',
			sentinel,
			headline: 'downgrade detected ✓ (attack stopped)',
			why: 'The server’s random ends in DOWNGRD\\x01, so a client that offered 1.3 knows its supported_versions went missing. That random is covered by the server’s 1.2 signature, so Mallory can’t erase it.',
		}
	return {
		kind: 'ok12',
		reply: 'sh12',
		sentinel,
		headline: c === 'dual' ? 'fell back to DTLS 1.2 ✓' : 'DTLS 1.2 ✓',
		why:
			c === '12'
				? s === 'dual'
					? 'The client never offered 1.3, so the server picks 1.2 and marks its random with DOWNGRD\\x01, which a 1.2-only client doesn’t check.'
					: 'Both sides only speak 1.2.'
				: `The 1.2 server ignored supported_versions${strip ? ' (so Mallory’s strip changed nothing)' : ''}. The client’s hello was also a complete 1.2 hello, so it drops its 1.3 key_share and carries on as a clean 1.2 handshake.`,
		after:
			'Locked to 1.2: every record has the 13-byte header (… fe fd …), and a 1.3 unified-header record is now dropped.',
	}
}

// Run
type Phase = 'idle' | 'hello' | 'reply' | 'answer' | 'done'

interface Packet {
	id: number
	label: string
	dir: 'right' | 'left'
	tone: 'hello' | 'reply' | 'alert' | 'tampered'
}

const phase = ref<Phase>('idle')
const result = ref<Result>()
const packet = ref<Packet>()
const serverRandom = ref<string[]>([])
const mood = reactive<Record<'client' | 'server' | 'mallory', AnimationName>>({
	client: 'idle',
	server: 'idle',
	mallory: 'sneak',
})
const grid = ref<
	Record<string, { kind: Kind; mallory: boolean; bug: boolean }>
>({})
const STEP = 900
let gen = 0
let packets = 0
let timers: ReturnType<typeof setTimeout>[] = []

function later(run: number, ms: number, fn: () => void) {
	const go = () => {
		if (run === gen) fn()
	}
	timers.push(setTimeout(go, ms))
}

function send(label: string, dir: Packet['dir'], tone: Packet['tone']) {
	packet.value = { id: ++packets, label, dir, tone }
}

function stop() {
	gen++
	for (const t of timers) clearTimeout(t)
	timers = []
	phase.value = 'idle'
	result.value = undefined
	packet.value = undefined
	Object.assign(mood, { client: 'idle', server: 'idle', mallory: 'sneak' })
}

const SENTINEL = [0x44, 0x4f, 0x57, 0x4e, 0x47, 0x52, 0x44, 0x01]
const hex = (b: number) => b.toString(16).padStart(2, '0')

function connect() {
	stop()
	const run = gen
	const c = clientMode.value
	const s = serverMode.value
	const strip = mallory.value
	const buggy = bug.value
	const r = outcome(c, s, strip, buggy)
	const bytes = [...crypto.getRandomValues(new Uint8Array(32))]
	if (r.sentinel) bytes.splice(24, 8, ...SENTINEL)
	serverRandom.value = bytes.map(hex)
	const tamper = strip && c !== '12'

	phase.value = 'hello'
	mood.client = 'send'
	send('ClientHello', 'right', 'hello')
	if (tamper)
		later(run, STEP / 2, () => {
			mood.mallory = 'type'
			if (packet.value) packet.value.label = 'ClientHello, stripped'
			if (packet.value) packet.value.tone = 'tampered'
		})
	later(run, STEP, () => {
		result.value = r
		phase.value = 'reply'
		mood.client = 'idle'
		mood.server = 'send'
		if (tamper) mood.mallory = 'sneak'
		send(
			r.reply === 'alert' ? `alert: ${r.serverAlert}` : 'ServerHello',
			'left',
			r.reply === 'alert' ? 'alert' : 'reply',
		)
		later(run, STEP, () => {
			mood.server = 'idle'
			if (r.clientAlert) {
				phase.value = 'answer'
				mood.client = 'send'
				send(`alert: ${r.clientAlert}`, 'right', 'alert')
				later(run, STEP, () => finish(r, c, s, strip, buggy))
			} else finish(r, c, s, strip, buggy)
		})
	})
}

function finish(r: Result, c: Mode, s: Mode, strip: boolean, buggy: boolean) {
	phase.value = 'done'
	packet.value = undefined
	const ok = r.kind === 'ok13' || r.kind === 'ok12'
	if (r.kind === 'caught') {
		mood.client = 'wow'
		mood.server = 'wow'
		mood.mallory = 'sad'
	} else if (ok) {
		mood.client = 'yay'
		mood.server = 'yay'
	} else {
		mood.client = r.serverAlert ? 'sad' : 'wow'
		mood.server = r.serverAlert ? 'wow' : 'sad'
	}
	grid.value = {
		...grid.value,
		[`${c}/${s}`]: {
			kind: r.kind,
			mallory: strip && c !== '12',
			bug: buggy && c === 'dual' && s === '12',
		},
	}
}

function reset() {
	stop()
	grid.value = {}
	serverRandom.value = []
	clientMode.value = 'dual'
	serverMode.value = 'dual'
	mallory.value = false
	bug.value = false
}

function pick(c: Mode, s: Mode) {
	clientMode.value = c
	serverMode.value = s
}

watch([clientMode, serverMode, mallory, bug], stop)

onBeforeUnmount(() => {
	gen++
	for (const t of timers) clearTimeout(t)
})

// Rendering
const modeName = (m: Mode) => modes.find((x) => x.id === m)?.label ?? m

const strictServer = computed(
	() => bug.value && serverMode.value === '12' && clientMode.value === 'dual',
)

const serverName = computed(() =>
	strictServer.value
		? 'strict 1.2 server'
		: `${modeName(serverMode.value)} server`,
)

const showReply = computed(
	() => phase.value === 'answer' || phase.value === 'done',
)

const replyRows = computed(() => {
	const r = result.value
	if (!r || !showReply.value) return []
	if (r.reply === 'alert')
		return [
			{ name: 'level', value: 'fatal (2)' },
			{
				name: 'description',
				value: `${r.serverAlert} (${ALERTS[r.serverAlert ?? '']})`,
				tone: 'bad',
			},
		]
	if (r.reply === 'sh13')
		return [
			{ name: 'legacy_version', value: 'fe fd (ignored)' },
			{ name: 'cipher_suite', value: SUITE_13 },
			{
				name: 'supported_versions',
				value: 'fe fc: DTLS 1.3',
				tone: 'ok',
			},
			{ name: 'key_share', value: 'x25519, 32 bytes' },
		]
	return [
		{ name: 'server_version', value: 'fe fd: DTLS 1.2', tone: 'ok' },
		{ name: 'cipher_suite', value: SUITE_12 },
		{
			name: 'extensions',
			value:
				'extended_master_secret, renegotiation_info, ec_point_formats, use_srtp',
		},
	]
})

const cellText: Record<Kind, string> = {
	ok13: '1.3',
	ok12: '1.2',
	alert: '✗',
	caught: '✗',
}

const cellWords: Record<Kind, string> = {
	ok13: 'DTLS 1.3',
	ok12: 'DTLS 1.2',
	alert: 'failed with an alert',
	caught: 'downgrade detected',
}

function cellLabel(c: Mode, s: Mode) {
	const cell = grid.value[`${c}/${s}`]
	const what = cell
		? `${cellWords[cell.kind]}${cell.mallory ? ', with Mallory' : ''}${cell.bug ? ', with the fallback bug' : ''}`
		: 'not tried yet'
	return `client ${modeName(c)}, server ${modeName(s)}: ${what}`
}

const strippedNothing = computed(
	() => mallory.value && clientMode.value === '12',
)
</script>

<template>
	<DemoFrame label="three modes">
		<template #tabs>
			<div class="pickers">
				<div class="picker">
					<span class="who">client</span>
					<div class="demo-tabs" role="group" aria-label="Client mode">
						<button
							v-for="m of modes"
							:key="m.id"
							type="button"
							:aria-pressed="clientMode === m.id"
							@click="clientMode = m.id"
						>
							{{ m.label }}
						</button>
					</div>
				</div>
				<div class="picker">
					<span class="who">server</span>
					<div class="demo-tabs" role="group" aria-label="Server mode">
						<button
							v-for="m of modes"
							:key="m.id"
							type="button"
							:aria-pressed="serverMode === m.id"
							@click="serverMode = m.id"
						>
							{{ m.label }}
						</button>
					</div>
				</div>
			</div>

			<div class="grid-wrap">
				<p class="msg-title demo-mono">
					outcomes so far <span>(click a cell to set both modes)</span>
				</p>
				<div class="grid" role="group" aria-label="Outcome grid, client mode by server mode">
					<span class="corner demo-mono">client \ server</span>
					<span v-for="s of modes" :key="s.id" class="head demo-mono">{{
						s.label
					}}</span>
					<template v-for="c of modes" :key="c.id">
						<span class="head row demo-mono">{{ c.label }}</span>
						<button
							v-for="s of modes"
							:key="s.id"
							type="button"
							class="cell demo-mono"
							:class="[
								grid[`${c.id}/${s.id}`]?.kind,
								{ current: clientMode === c.id && serverMode === s.id },
							]"
							:aria-current="clientMode === c.id && serverMode === s.id ? 'true' : undefined"
							:aria-label="cellLabel(c.id, s.id)"
							@click="pick(c.id, s.id)"
						>
							{{ grid[`${c.id}/${s.id}`] ? cellText[grid[`${c.id}/${s.id}`].kind] : '·'
							}}<sup v-if="grid[`${c.id}/${s.id}`]?.mallory">M</sup
							><sup v-if="grid[`${c.id}/${s.id}`]?.bug">B</sup>
						</button>
					</template>
				</div>
				<p class="demo-note">
					M: Mallory was stripping. B: the fallback bug was on.
				</p>
			</div>
		</template>

		<div class="stage">
			<div class="end">
				<PixelSprite
					character="client"
					:animation="mood.client"
					:size="48"
					label="Client"
				/>
				<span class="demo-mono">{{ modeName(clientMode) }} client</span>
			</div>
			<div class="wire">
				<span
					v-if="packet"
					:key="packet.id"
					class="packet"
					:class="[packet.dir, packet.tone]"
					aria-hidden="true"
					>{{ packet.label }}</span
				>
				<div v-if="mallory" class="mallory">
					<PixelSprite
						character="mallory"
						:animation="mood.mallory"
						:size="40"
						label="Mallory"
					/>
				</div>
			</div>
			<div class="end">
				<PixelSprite
					character="server"
					:animation="mood.server"
					:size="48"
					flip
					label="Server"
				/>
				<span class="demo-mono" :class="{ 'demo-warn': strictServer }">{{
					serverName
				}}</span>
			</div>
		</div>

		<div class="messages">
			<section aria-label="ClientHello">
				<p class="msg-title demo-mono">
					ClientHello <span>client → server</span>
				</p>
				<ul class="fields">
					<li>
						<span class="name">legacy_version</span>
						<span class="value"
							>fe fd
							<span class="muted">{{
								clientMode === '12' ? '(DTLS 1.2, meant)' : '(DTLS 1.2, for old servers)'
							}}</span></span
						>
					</li>
					<li class="v13" :class="{ struck: mallory && clientMode !== '12' }">
						<span class="name">supported_versions</span>
						<span class="value"
							><s v-if="mallory && clientMode !== '12'">{{ offered.versions }}</s
							><template v-else>{{ offered.versions }}</template>
							<span v-if="mallory && clientMode !== '12'" class="tag mallory-tag"
								>stripped by Mallory</span
							></span
						>
					</li>
					<li>
						<span class="name">cipher_suites</span>
						<span class="chips">
							<span
								v-for="s of offered.suites"
								:key="s.name"
								class="chip"
								:class="`era-${s.era}`"
								>{{ breakable(s.name) }}</span
							>
						</span>
					</li>
					<li>
						<span class="name">extensions</span>
						<span class="chips">
							<span
								v-for="e of offered.exts"
								:key="e.name"
								class="chip"
								:class="[`era-${e.era}`, { gone: e.gone }]"
								:title="
									e.gone === 'bug'
										? 'left out by the fallback bug'
										: e.gone === 'mallory'
											? 'stripped by Mallory'
											: undefined
								"
								>{{ breakable(e.name)
								}}<template v-if="e.gone === 'bug'"> (missing)</template
								><template v-if="e.gone === 'mallory'">
									(stripped)</template
								></span
							>
						</span>
					</li>
				</ul>
				<p class="legend demo-note">
					<span class="key era-12">1.2 only</span>
					<span class="key era-13">1.3 only</span>
					<span class="key era-both">both</span>
				</p>
				<p v-if="strippedNothing" class="demo-note">
					A 1.2-only hello has no supported_versions, so Mallory has nothing
					to strip.
				</p>
			</section>

			<section :aria-label="result?.reply === 'alert' ? 'Alert' : 'ServerHello'">
				<p class="msg-title demo-mono">
					{{ showReply ? (result?.reply === 'alert' ? 'Alert' : 'ServerHello') : 'reply' }}
					<span>server → client</span>
				</p>
				<p v-if="!showReply" class="demo-note">
					{{ phase === 'idle' ? 'press connect' : '…' }}
				</p>
				<template v-else>
					<ul class="fields">
						<li
							v-for="row of replyRows"
							:key="row.name"
							:class="row.tone"
						>
							<span class="name">{{ row.name }}</span>
							<span class="value">{{ row.value }}</span>
						</li>
					</ul>
					<template v-if="result?.reply === 'sh12' || result?.reply === 'sh13'">
						<p class="demo-note">
							random<template v-if="result.sentinel">
								(last 8 bytes: <span class="demo-warn">DOWNGRD\x01</span
								>)</template
							>
						</p>
						<div class="demo-bytes random" aria-label="ServerHello random">
							<span
								v-for="(b, i) of serverRandom"
								:key="i"
								:class="{ sentinel: result.sentinel && i >= 24 }"
								>{{ b }}</span
							>
						</div>
					</template>
					<p v-if="result?.clientAlert && phase !== 'reply'" class="client-alert demo-mono">
						client → alert: fatal,
						<span class="demo-bad"
							>{{ result.clientAlert }} ({{ ALERTS[result.clientAlert] }})</span
						>
					</p>
				</template>
			</section>
		</div>

		<div class="verdict" aria-live="polite">
			<template v-if="phase === 'done' && result">
				<p
					class="headline demo-mono"
					:class="
						result.kind === 'alert'
							? 'demo-bad'
							: result.kind === 'caught'
								? 'demo-warn'
								: 'demo-ok'
					"
				>
					{{ result.headline }}
				</p>
				<p class="why">{{ result.why }}</p>
				<p v-if="result.after" class="demo-note">{{ result.after }}</p>
			</template>
		</div>

		<template #controls>
			<button type="button" class="demo-btn" @click="connect">connect</button>
			<label class="danger-label">
				<input v-model="mallory" type="checkbox" />
				Mallory: strip supported_versions
			</label>
			<label>
				<input v-model="bug" type="checkbox" />
				the fallback bug
			</label>
			<button type="button" class="demo-btn secondary" @click="reset">
				reset
			</button>
		</template>

		<template #caption>
			Try every cell, then switch Mallory on. The fallback bug is a simplified
			reconstruction of the one fixed in pion/dtls#1030, where the 1.2 fallback
			dropped 1.2 extensions or offered 1.3-only ones; here a strict 1.2 server
			refuses a hello without extended_master_secret.
		</template>
	</DemoFrame>
</template>

<style scoped>
.pickers {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 32px;
	margin-bottom: 8px;
}

.picker {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	align-items: baseline;
}

.picker .demo-tabs {
	margin-bottom: 10px;
}

.who {
	min-width: 6ch;
	color: var(--accent);
	font: 0.8125rem var(--font-mono);
}

.stage {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	margin: 8px 0 16px;
}

.end {
	display: flex;
	flex: none;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	width: 8.5rem;
	font-size: 0.75rem;
	text-align: center;
}

.wire {
	position: relative;
	flex: 1;
	min-width: 0;
	height: 92px;
	background: linear-gradient(var(--rule), var(--rule)) center 24px / 100% 2px
		no-repeat;
}

.packet {
	position: absolute;
	top: 24px;
	padding: 3px 6px;
	border: 2px solid var(--accent);
	background: var(--bubble);
	color: var(--bubbletext);
	width: max-content;
	max-width: 100%;
	font: 700 0.6875rem / 1.2 var(--font-mono);
	transform: translate(0, -50%);
	animation: 0.9s linear forwards;
}

.packet.right {
	animation-name: to-right;
}

.packet.left {
	animation-name: to-left;
}

.packet.reply {
	border-color: var(--info);
	color: var(--info);
}

.packet.tampered {
	border-style: dashed;
	border-color: var(--warning);
	color: var(--warning);
}

.packet.alert {
	border-color: var(--danger);
	color: var(--danger);
}

@keyframes to-right {
	from {
		left: 0;
		transform: translate(0, -50%);
	}
	to {
		left: 100%;
		transform: translate(-100%, -50%);
	}
}

@keyframes to-left {
	from {
		left: 100%;
		transform: translate(-100%, -50%);
	}
	to {
		left: 0;
		transform: translate(0, -50%);
	}
}

.mallory {
	position: absolute;
	top: 44px;
	left: 50%;
	transform: translateX(-50%);
}

.messages {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
}

.msg-title {
	margin: 0 0 8px;
	color: var(--accent);
	font-size: 0.8125rem;
}

.msg-title span {
	color: var(--muted);
}

.fields {
	display: grid;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
	font: 0.75rem / 1.45 var(--font-mono);
}

.fields li {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	padding: 6px 10px;
	border-left: 3px solid var(--rule);
	background: var(--bg);
}

.fields li + li {
	margin-top: 0;
}

.fields .v13 {
	border-left-color: var(--info);
}

.fields .struck {
	border-left-color: var(--warning);
}

.fields .ok {
	border-left-color: var(--tip);
}

.fields .ok .value {
	color: var(--tip);
	font-weight: 700;
}

.fields .bad {
	border-left-color: var(--danger);
}

.fields .bad .value {
	color: var(--danger);
	font-weight: 700;
}

.name,
.muted {
	color: var(--muted);
}

.value {
	overflow-wrap: anywhere;
}

.tag {
	display: inline-block;
	margin-left: 6px;
	padding: 0 6px;
	font-size: 0.6875rem;
	white-space: nowrap;
}

.mallory-tag {
	background: var(--warning);
	color: var(--bg);
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 2px;
	min-width: 0;
}

.chip,
.key {
	padding: 0 6px;
	border-left: 3px solid;
	overflow-wrap: anywhere;
}

.era-12 {
	border-color: var(--warning);
	color: var(--warning);
}

.era-13 {
	border-color: var(--info);
	color: var(--info);
}

.era-both {
	border-color: var(--muted);
	color: var(--text);
}

.chip.gone {
	border-left-style: dashed;
	color: var(--muted);
	text-decoration: line-through;
	text-decoration-color: var(--danger);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
}

.random {
	font-size: 0.6875rem;
}

.random > * {
	min-width: 22px;
	height: 20px;
}

.random .sentinel {
	background: var(--warning);
	color: var(--bg);
	font-weight: 700;
}

.client-alert {
	margin: 10px 0 0;
	font-size: 0.75rem;
}

.verdict {
	min-height: 3em;
	margin-top: 16px;
}

.headline {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
}

.why {
	margin: 4px 0 0;
	font-size: 0.9375rem;
	line-height: 1.5;
}

.grid-wrap {
	margin: 4px 0 14px;
}

.grid {
	display: grid;
	grid-template-columns: max-content repeat(3, minmax(0, 6rem));
	gap: 4px;
	align-items: center;
	font-size: 0.75rem;
}

.corner,
.head {
	color: var(--muted);
}

.head:not(.row) {
	text-align: center;
}

.cell {
	height: 36px;
	padding: 0;
	border: 2px solid transparent;
	border-radius: 0;
	background: var(--bg);
	color: var(--muted);
	font: 700 0.875rem var(--font-mono);
	cursor: pointer;
}

.cell:hover {
	border-color: var(--rule);
}

.cell:focus-visible {
	outline: 2px dashed var(--accent);
	outline-offset: 2px;
}

.cell.current {
	border-color: var(--accent);
}

.cell.ok13 {
	color: var(--tip);
}

.cell.ok12 {
	color: var(--info);
}

.cell.alert {
	color: var(--danger);
}

.cell.caught {
	color: var(--warning);
}

.cell sup {
	margin-left: 1px;
	font-size: 0.625rem;
}

.danger-label {
	color: var(--danger);
}

@media (max-width: 640px) {
	.messages {
		grid-template-columns: minmax(0, 1fr);
	}
}

@media (max-width: 520px) {
	.end {
		width: 5.5rem;
		font-size: 0.6875rem;
	}

	.corner {
		font-size: 0.625rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.packet {
		animation-timing-function: steps(3, jump-both);
	}
}
</style>
