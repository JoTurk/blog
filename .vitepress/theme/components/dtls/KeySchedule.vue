<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import DemoFrame from './DemoFrame.vue'
import {
	type Bytes,
	concat,
	hex,
	hkdfExpandLabel,
	hkdfExtract,
	random,
	sha256,
	utf8,
} from './dtlsCrypto'

type Kind = 'input' | 'hash' | 'stage' | 'salt' | 'secret'

interface KNode {
	id: string
	title: string
	formula: string
	kind: Kind
	from: string[]
	epoch?: number
	about: string
	traffic?: 'handshake' | 'application' | 'early'
}

const withPsk = ref(false)
const updates = ref(0)
const MAX_UPDATES = 3

function trafficName(side: 'c' | 's', n: number) {
	return `${side === 'c' ? 'client' : 'server'}_application_traffic_secret_${n}`
}

const nodes = computed(() => {
	const psk = withPsk.value
	const list: KNode[] = [
		{
			id: 'salt0',
			title: '0',
			formula: '32 zero bytes, used as the salt',
			kind: 'input',
			from: [],
			about:
				'There is nothing to salt the first step with yet, so it is zeros.',
		},
		{
			id: 'psk',
			title: psk ? 'PSK' : '0 (no PSK)',
			formula: psk ? 'pre-shared key, 32 bytes' : '32 zero bytes',
			kind: 'input',
			from: [],
			about: psk
				? 'A key both sides already have, usually a ticket from an earlier connection.'
				: 'No pre-shared key, so zeros go in instead.',
		},
		{
			id: 'hCH',
			title: 'H(ClientHello)',
			formula: 'SHA-256 of the transcript so far',
			kind: 'hash',
			from: [],
			about:
				'A hash of every handshake message so far (a sample one here). It ties the keys to exactly this conversation.',
		},
		{
			id: 'early',
			title: 'Early Secret',
			formula: `HKDF-Extract(salt = 0, IKM = ${psk ? 'PSK' : '0'})`,
			kind: 'stage',
			from: ['salt0', 'psk'],
			about: psk
				? 'Comes only from the PSK, so it is the same on every connection that uses that PSK. Press “new handshake” and watch it stay put.'
				: 'With no PSK this is a constant: 33ad0a1c… for every TLS 1.3 and DTLS 1.3 connection in the world. Check the value.',
		},
		{
			id: 'binder',
			title: 'binder_key',
			formula: 'Derive-Secret(Early Secret, "res binder", "")',
			kind: 'secret',
			from: ['early'],
			about: 'Signs the ClientHello to prove the client really holds the PSK.',
		},
		{
			id: 'cets',
			title: 'client_early_traffic_secret',
			formula: 'Derive-Secret(Early Secret, "c e traffic", ClientHello)',
			kind: 'secret',
			from: ['early', 'hCH'],
			epoch: 1,
			traffic: 'early',
			about:
				'Encrypts 0-RTT data, sent before the server has even answered. No fresh (EC)DHE in it, so a leaked PSK exposes it.',
		},
		{
			id: 'eems',
			title: 'early_exporter_master_secret',
			formula: 'Derive-Secret(Early Secret, "e exp master", ClientHello)',
			kind: 'secret',
			from: ['early', 'hCH'],
			about: 'Lets an app pull its own keys out of the 0-RTT stage.',
		},
		{
			id: 'd1',
			title: 'derived',
			formula: 'Derive-Secret(Early Secret, "derived", "")',
			kind: 'salt',
			from: ['early'],
			about:
				'A stepping stone: turns the Early Secret into the salt for the next Extract.',
		},
		{
			id: 'ecdhe',
			title: '(EC)DHE shared secret',
			formula: 'X25519 / X25519MLKEM768 output',
			kind: 'input',
			from: [],
			about:
				'The fresh secret from the key exchange, new every handshake. It is why everything below it stays safe even if the PSK or long-term keys leak later.',
		},
		{
			id: 'hSH',
			title: 'H(ClientHello..ServerHello)',
			formula: 'SHA-256 of the transcript so far',
			kind: 'hash',
			from: [],
			about: 'The transcript hash once both hellos are on the table.',
		},
		{
			id: 'hs',
			title: 'Handshake Secret',
			formula: 'HKDF-Extract(salt = derived, IKM = (EC)DHE)',
			kind: 'stage',
			from: ['d1', 'ecdhe'],
			about: 'Where the fresh (EC)DHE secret gets mixed in.',
		},
		{
			id: 'chts',
			title: 'client_handshake_traffic_secret',
			formula:
				'Derive-Secret(Handshake Secret, "c hs traffic", ClientHello..ServerHello)',
			kind: 'secret',
			from: ['hs', 'hSH'],
			epoch: 2,
			traffic: 'handshake',
			about:
				'Encrypts the client’s side of the rest of the handshake: its Certificate, CertificateVerify and Finished.',
		},
		{
			id: 'shts',
			title: 'server_handshake_traffic_secret',
			formula:
				'Derive-Secret(Handshake Secret, "s hs traffic", ClientHello..ServerHello)',
			kind: 'secret',
			from: ['hs', 'hSH'],
			epoch: 2,
			traffic: 'handshake',
			about:
				'Encrypts the server’s EncryptedExtensions, Certificate, CertificateVerify and Finished.',
		},
		{
			id: 'd2',
			title: 'derived',
			formula: 'Derive-Secret(Handshake Secret, "derived", "")',
			kind: 'salt',
			from: ['hs'],
			about: 'Same trick again: the Handshake Secret becomes the next salt.',
		},
		{
			id: 'zero',
			title: '0',
			formula: '32 zero bytes',
			kind: 'input',
			from: [],
			about: 'Nothing new to add at this stage, so zeros go in.',
		},
		{
			id: 'hSF',
			title: 'H(ClientHello..server Finished)',
			formula: 'SHA-256 of the transcript so far',
			kind: 'hash',
			from: [],
			about: 'The transcript hash after the server’s Finished.',
		},
		{
			id: 'hCF',
			title: 'H(ClientHello..client Finished)',
			formula: 'SHA-256 of the whole handshake',
			kind: 'hash',
			from: [],
			about: 'The transcript hash of the whole handshake.',
		},
		{
			id: 'ms',
			title: 'Master Secret',
			formula: 'HKDF-Extract(salt = derived, IKM = 0)',
			kind: 'stage',
			from: ['d2', 'zero'],
			about:
				'One more Extract with nothing new in it. It keeps handshake keys and data keys cleanly apart.',
		},
		{
			id: 'cats0',
			title: trafficName('c', 0),
			formula:
				'Derive-Secret(Master Secret, "c ap traffic", ClientHello..server Finished)',
			kind: 'secret',
			from: ['ms', 'hSF'],
			epoch: 3,
			traffic: 'application',
			about: 'Encrypts the client’s application data.',
		},
		{
			id: 'sats0',
			title: trafficName('s', 0),
			formula:
				'Derive-Secret(Master Secret, "s ap traffic", ClientHello..server Finished)',
			kind: 'secret',
			from: ['ms', 'hSF'],
			epoch: 3,
			traffic: 'application',
			about: 'Encrypts the server’s application data.',
		},
		{
			id: 'ems',
			title: 'exporter_master_secret',
			formula:
				'Derive-Secret(Master Secret, "exp master", ClientHello..server Finished)',
			kind: 'secret',
			from: ['ms', 'hSF'],
			about:
				'Hands keys to other protocols. WebRTC gets its SRTP keys for audio and video from here.',
		},
		{
			id: 'rms',
			title: 'resumption_master_secret',
			formula:
				'Derive-Secret(Master Secret, "res master", ClientHello..client Finished)',
			kind: 'secret',
			from: ['ms', 'hCF'],
			about:
				'Mints tickets for next time. The next connection uses it as its PSK.',
		},
	]
	for (let n = 1; n <= updates.value; n++) {
		for (const side of ['c', 's'] as const) {
			list.push({
				id: `${side}ats${n}`,
				title: trafficName(side, n),
				formula: `HKDF-Expand-Label(${side === 'c' ? 'client' : 'server'}_…_${n - 1}, "traffic upd", "", 32)`,
				kind: 'secret',
				from: [`${side}ats${n - 1}`],
				epoch: 3 + n,
				traffic: 'application',
				about: `After KeyUpdate number ${n}: new keys from the old secret, no new handshake. Each side updates its own.`,
			})
		}
	}
	return new Map(list.map((n) => [n.id, n]))
})

const sections = [
	{
		id: 'early',
		name: 'Early',
		inputs: ['salt0', 'psk'],
		hashes: ['hCH'],
		outputs: ['binder', 'cets', 'eems'],
		salt: 'd1',
	},
	{
		id: 'hs',
		name: 'Handshake',
		inputs: ['ecdhe'],
		hashes: ['hSH'],
		outputs: ['chts', 'shts'],
		salt: 'd2',
	},
	{
		id: 'ms',
		name: 'Master',
		inputs: ['zero'],
		hashes: ['hSF', 'hCF'],
		outputs: ['cats0', 'sats0', 'ems', 'rms'],
	},
]

const rows = computed(() => {
	const out = sections.flatMap((sec) => [
		[sec.id, ...sec.inputs, ...sec.hashes, ...sec.outputs],
		sec.salt ? [sec.salt] : [],
	])
	out.push([...nodes.value.keys()].filter((id) => /ats[1-9]/.test(id)))
	return out
})

const detailOrder = computed(() => {
	const i = rows.value.findIndex((r) => r.includes(selected.value))
	return 2 * (i < 0 ? rows.value.length : i) + 1
})

function breakable(text = '') {
	return text.replaceAll('_', '_\u200b')
}

const PSK_ONLY = new Set(['binder', 'cets', 'eems'])

function off(id: string) {
	return !withPsk.value && PSK_ONLY.has(id)
}

const selected = ref('shts')
const picked = computed(
	() => nodes.value.get(selected.value) ?? nodes.value.get('early'),
)

async function select(id: string, e: MouseEvent) {
	const node = e.currentTarget as HTMLElement
	const before = node.getBoundingClientRect().top
	selected.value = id
	await nextTick()
	const moved = node.getBoundingClientRect().top - before
	if (moved) window.scrollBy({ top: moved, behavior: 'instant' })
}

const ancestors = computed(() => {
	const seen = new Set<string>()
	const walk = (id: string) => {
		for (const p of nodes.value.get(id)?.from ?? []) {
			if (!seen.has(p)) {
				seen.add(p)
				walk(p)
			}
		}
	}
	walk(selected.value)
	return seen
})

function state(id: string) {
	if (id === selected.value) return 'picked'
	if (ancestors.value.has(id)) return 'ancestor'
	return 'rest'
}

// Real values
const values = shallowRef(new Map<string, Bytes>())
const extra = ref<{ name: string; value: string }[]>([])
let psk: Bytes | undefined
let ecdhe: Bytes | undefined
let clientRandom: Bytes | undefined
let serverRandom: Bytes | undefined
let token = 0
let shown = 0
const handshakes = ref(0)
const note = ref('')

function deriveSecret(secret: Bytes, label: string, hash: Bytes) {
	return hkdfExpandLabel(secret, label, hash, 32)
}

async function compute() {
	if (!psk || !ecdhe || !clientRandom || !serverRandom) return
	const mine = ++token
	const zeros = new Uint8Array(32) as Bytes
	const empty = await sha256(new Uint8Array(0))
	const ch = concat(utf8('ClientHello'), clientRandom)
	const sh = concat(ch, utf8('ServerHello'), serverRandom)
	const sf = concat(
		sh,
		utf8('EncryptedExtensions Certificate CertificateVerify Finished'),
	)
	const cf = concat(sf, utf8('Finished'))
	const v = new Map<string, Bytes>([
		['salt0', zeros],
		['psk', withPsk.value ? psk : zeros],
		['zero', zeros],
		['ecdhe', ecdhe],
		['hCH', await sha256(ch)],
		['hSH', await sha256(sh)],
		['hSF', await sha256(sf)],
		['hCF', await sha256(cf)],
	])
	const get = (id: string) => v.get(id) as Bytes
	v.set('early', await hkdfExtract(zeros, get('psk')))
	v.set('binder', await deriveSecret(get('early'), 'res binder', empty))
	v.set('cets', await deriveSecret(get('early'), 'c e traffic', get('hCH')))
	v.set('eems', await deriveSecret(get('early'), 'e exp master', get('hCH')))
	v.set('d1', await deriveSecret(get('early'), 'derived', empty))
	v.set('hs', await hkdfExtract(get('d1'), ecdhe))
	v.set('chts', await deriveSecret(get('hs'), 'c hs traffic', get('hSH')))
	v.set('shts', await deriveSecret(get('hs'), 's hs traffic', get('hSH')))
	v.set('d2', await deriveSecret(get('hs'), 'derived', empty))
	v.set('ms', await hkdfExtract(get('d2'), zeros))
	v.set('cats0', await deriveSecret(get('ms'), 'c ap traffic', get('hSF')))
	v.set('sats0', await deriveSecret(get('ms'), 's ap traffic', get('hSF')))
	v.set('ems', await deriveSecret(get('ms'), 'exp master', get('hSF')))
	v.set('rms', await deriveSecret(get('ms'), 'res master', get('hCF')))
	for (let n = 1; n <= updates.value; n++) {
		for (const side of ['c', 's']) {
			v.set(
				`${side}ats${n}`,
				await hkdfExpandLabel(
					get(`${side}ats${n - 1}`),
					'traffic upd',
					new Uint8Array(0),
					32,
				),
			)
		}
	}
	if (mine === token) {
		values.value = v
		shown = mine
	}
}

let extraToken = 0
watch([values, selected], async () => {
	const mine = ++extraToken
	const node = picked.value
	const secret = node && values.value.get(node.id)
	if (!node?.traffic || !secret) {
		extra.value = []
		return
	}
	const empty = new Uint8Array(0)
	const out = [
		{
			name: 'key',
			value: hex(await hkdfExpandLabel(secret, 'key', empty, 16)),
		},
		{ name: 'iv', value: hex(await hkdfExpandLabel(secret, 'iv', empty, 12)) },
		{
			name: 'sn_key',
			value: hex(await hkdfExpandLabel(secret, 'sn', empty, 16)),
		},
	]
	if (node.traffic === 'handshake')
		out.push({
			name: 'finished_key',
			value: hex(await hkdfExpandLabel(secret, 'finished', empty, 32)),
		})
	if (mine === extraToken) extra.value = out
})

function short(id: string) {
	const v = values.value.get(id)
	return v ? hex(v.subarray(0, 8), '') : '················'
}

function newHandshake() {
	ecdhe = random(32)
	clientRandom = random(32)
	serverRandom = random(32)
	handshakes.value++
	note.value = ''
	compute()
}

function setPsk(on: boolean) {
	if (withPsk.value === on) return
	note.value = ''
	withPsk.value = on
}

async function resume() {
	const rms = values.value.get('rms')
	if (!rms || shown !== token) return
	const before = handshakes.value
	const next = await hkdfExpandLabel(rms, 'resumption', new Uint8Array([0]), 32)
	if (handshakes.value !== before) return
	psk = next
	withPsk.value = true
	newHandshake()
	note.value =
		'New connection, resumed: its PSK came from the last one’s resumption_master_secret.'
	selected.value = 'early'
}

onMounted(() => {
	psk = random(32)
	newHandshake()
})

watch([withPsk, updates], () => {
	if (!nodes.value.has(selected.value)) selected.value = 'cats0'
	compute()
})
</script>

<template>
	<DemoFrame label="the key schedule">
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Pre-shared key">
				<button :aria-pressed="!withPsk" @click="setPsk(false)">no PSK</button>
				<button :aria-pressed="withPsk" @click="setPsk(true)">with PSK</button>
			</div>
		</template>

		<div class="schedule">
			<template v-for="(sec, i) of sections" :key="sec.id">
				<section
					class="stage-row"
					:aria-label="`${sec.name} stage`"
					:style="{ order: 4 * i }"
				>
					<div class="col inputs">
						<button
							v-for="id of sec.inputs"
							:key="id"
							class="node"
							:class="[nodes.get(id)?.kind, state(id)]"
							:aria-pressed="selected === id"
							@click="select(id, $event)"
						>
							<span class="title">{{ breakable(nodes.get(id)?.title) }}</span>
							<code :key="short(id)" class="val">{{ short(id) }}</code>
						</button>
					</div>
					<div class="arrow" aria-hidden="true" />
					<div class="col spine">
						<button
							class="node stage"
							:class="state(sec.id)"
							:aria-pressed="selected === sec.id"
							@click="select(sec.id, $event)"
						>
							<span class="kicker">HKDF-Extract</span>
							<span class="title">{{ nodes.get(sec.id)?.title }}</span>
							<code :key="short(sec.id)" class="val">{{ short(sec.id) }}</code>
						</button>
						<button
							v-for="id of sec.hashes"
							:key="id"
							class="node hash"
							:class="state(id)"
							:aria-pressed="selected === id"
							@click="select(id, $event)"
						>
							<span class="kicker">+ transcript</span>
							<span class="title">{{ breakable(nodes.get(id)?.title) }}</span>
							<code :key="short(id)" class="val">{{ short(id) }}</code>
						</button>
					</div>
					<div class="arrow" aria-hidden="true" />
					<div class="col outputs">
						<button
							v-for="id of sec.outputs"
							:key="id"
							class="node secret"
							:class="[state(id), { off: off(id) }]"
							:aria-pressed="selected === id"
							@click="select(id, $event)"
						>
							<span class="title">{{ breakable(nodes.get(id)?.title) }}</span>
							<span class="meta">
								<code :key="short(id)" class="val">{{ short(id) }}</code>
								<span v-if="nodes.get(id)?.epoch && !off(id)" class="epoch">
									epoch {{ nodes.get(id)?.epoch }}
								</span>
								<span v-if="off(id)" class="epoch unused">unused</span>
							</span>
						</button>
					</div>
				</section>
				<div v-if="sec.salt" class="derived-row" :style="{ order: 4 * i + 2 }">
					<button
						class="node salt"
						:class="state(sec.salt)"
						:aria-pressed="selected === sec.salt"
						@click="select(sec.salt, $event)"
					>
						<span class="title">↓ “derived”: salt for the next stage</span>
						<code :key="short(sec.salt)" class="val">{{ short(sec.salt) }}</code>
					</button>
				</div>
			</template>

			<section
				v-if="updates"
				class="updates"
				aria-label="Key updates"
				:style="{ order: 4 * sections.length }"
			>
				<p class="row-label">KeyUpdate: “traffic upd”</p>
				<div class="update-grid">
					<template v-for="n of updates" :key="n">
						<button
							v-for="side of ['c', 's']"
							:key="`${side}${n}`"
							class="node secret"
							:class="state(`${side}ats${n}`)"
							:aria-pressed="selected === `${side}ats${n}`"
							@click="select(`${side}ats${n}`, $event)"
						>
							<span class="title">{{
								breakable(nodes.get(`${side}ats${n}`)?.title)
							}}</span>
							<span class="meta">
								<code :key="short(`${side}ats${n}`)" class="val">{{
									short(`${side}ats${n}`)
								}}</code>
								<span class="epoch">epoch {{ 3 + n }}</span>
							</span>
						</button>
					</template>
				</div>
			</section>
			<div
				v-if="picked"
				class="detail"
				aria-live="polite"
				:style="{ order: detailOrder }"
			>
				<p class="detail-head">
					<strong>{{ breakable(picked.title) }}</strong>
					<span v-if="picked.epoch" class="epoch">protects epoch {{ picked.epoch }}</span>
				</p>
				<p class="formula demo-mono">{{ picked.formula }}</p>
				<p class="about">
					{{ off(picked.id) ? 'Only used with a PSK. ' : '' }}{{ picked.about }}
				</p>
				<dl class="demo-mono vals">
					<dt>value</dt>
					<dd>{{ values.get(picked.id) ? hex(values.get(picked.id) as Bytes, '') : '…' }}</dd>
					<template v-for="e of extra" :key="e.name">
						<dt>{{ e.name }}</dt>
						<dd>{{ e.value.replaceAll(' ', '') }}</dd>
					</template>
				</dl>
				<button
					v-if="picked.id === 'rms'"
					class="demo-btn secondary"
					@click="resume"
				>
					resume with it
				</button>
				<p v-if="note" class="demo-note demo-ok">{{ note }}</p>
			</div>
		</div>

		<template #controls>
			<button class="demo-btn" @click="newHandshake">new handshake</button>
			<button
				class="demo-btn secondary"
				:disabled="updates >= MAX_UPDATES"
				@click="updates++"
			>
				KeyUpdate
			</button>
			<button
				v-if="updates"
				class="demo-btn secondary"
				@click="updates = 0"
			>
				clear updates
			</button>
		</template>
		<template #caption>
			Tap any value to see where it comes from. Every value is real HKDF with
			SHA-256 and the “dtls13” labels, computed in your browser. Press “new
			handshake” and see which values change, and which don’t.
		</template>
	</DemoFrame>
</template>

<style scoped>
.schedule {
	display: flex;
	flex-direction: column;
}

.stage-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 20px minmax(0, 1.25fr);
	align-items: center;
	padding: 8px 0;
}

.col {
	display: grid;
	gap: 4px;
	min-width: 0;
}

.arrow {
	position: relative;
	align-self: stretch;
}

.arrow::before {
	content: '';
	position: absolute;
	top: 50%;
	left: 2px;
	right: 6px;
	border-top: 2px solid var(--rule);
}

.arrow::after {
	content: '';
	position: absolute;
	top: calc(50% - 4px);
	right: 2px;
	border: 5px solid transparent;
	border-left-color: var(--rule);
	border-right-width: 0;
}

.node {
	display: grid;
	gap: 2px;
	width: 100%;
	min-width: 0;
	padding: 6px 8px;
	border: 0;
	border-left: 2px solid var(--rule);
	border-radius: 0;
	background: transparent;
	color: var(--text);
	font: 0.75rem / 1.3 var(--font-mono);
	text-align: left;
	cursor: pointer;
	transition: opacity 0.2s;
}

.node .title {
	overflow-wrap: anywhere;
}

.node.input,
.node.hash {
	color: var(--muted);
}

.node.hash {
	margin-top: 2px;
	border-left: 0;
	border-top: 1px dotted var(--rule);
	text-align: center;
}

.node.hash .title {
	font-size: 0.6875rem;
}

.node.stage {
	padding: 8px 10px;
	border: 1px solid var(--rule);
	border-left: 2px solid var(--accent);
	text-align: center;
}

.node.stage .title {
	font: 700 0.9375rem var(--font-sans);
}

.kicker {
	color: var(--muted);
	font-size: 0.625rem;
}

.node.salt {
	width: auto;
	border-left: 0;
	border-bottom: 1px dashed var(--rule);
	text-align: center;
}

.val {
	color: var(--muted);
	font: 0.6875rem var(--font-mono);
}

.node.stage .val {
	color: var(--accent);
}

@media (prefers-reduced-motion: no-preference) {
	.val {
		animation: flash 0.9s ease-out;
	}
}

@keyframes flash {
	from {
		color: var(--warning);
	}
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 8px;
	align-items: center;
}

.epoch {
	color: var(--muted);
	font: 0.6875rem var(--font-mono);
	white-space: nowrap;
}

.epoch.unused {
	color: var(--muted);
}

.node.off {
	border-style: dashed;
	color: var(--muted);
}

.node.picked {
	border-color: var(--accent);
	background: var(--bubble);
	color: var(--bubbletext);
}

.node.ancestor {
	border-color: var(--info);
	color: var(--text);
}

.node.ancestor .val {
	color: var(--info);
}

.node.rest {
	opacity: 0.55;
}

.node.rest.stage {
	opacity: 0.75;
}

.derived-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 20px minmax(0, 1.25fr);
}

.derived-row .node {
	grid-column: 3;
	justify-self: center;
}

.updates {
	padding-top: 12px;
	border-top: 1px dashed var(--rule);
}

.row-label {
	margin: 0 0 8px;
	color: var(--muted);
	font: 0.75rem var(--font-mono);
}

.update-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 6px;
}

.detail {
	margin: 4px 0 8px;
	padding: 10px 0;
	border-block: 1px solid var(--rule);
}

.detail p {
	margin: 0 0 8px;
}

.detail-head {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 10px;
	align-items: center;
	overflow-wrap: anywhere;
}

.formula {
	color: var(--accent);
	font-size: 0.8125rem;
	overflow-wrap: anywhere;
}

.about {
	font-size: 0.9375rem;
	line-height: 1.5;
}

.vals {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	gap: 4px 12px;
	margin: 8px 0;
	font-size: 0.75rem;
}

.vals dt {
	color: var(--muted);
}

.vals dd {
	margin: 0;
	overflow-wrap: anywhere;
}

@media (max-width: 640px) {
	.stage-row {
		grid-template-columns: minmax(0, 1fr);
		gap: 4px;
		padding: 6px 0;
	}

	.inputs {
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
	}

	.arrow {
		height: 14px;
	}

	.arrow::before {
		top: 2px;
		bottom: 6px;
		left: 50%;
		right: auto;
		border-top: 0;
		border-left: 2px solid var(--rule);
	}

	.arrow::after {
		top: auto;
		bottom: 2px;
		right: auto;
		left: calc(50% - 4px);
		border: 5px solid transparent;
		border-top-color: var(--rule);
		border-bottom-width: 0;
	}

	.derived-row {
		grid-template-columns: minmax(0, 1fr);
	}

	.derived-row .node {
		grid-column: 1;
	}

	.update-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
