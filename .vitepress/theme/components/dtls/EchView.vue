<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AnimationName, CharacterName } from './characters'
import DemoFrame from './DemoFrame.vue'
import {
	aesGcm,
	type Bytes,
	hex,
	hkdfExpand,
	hkdfExtract,
	random,
	utf8,
} from './dtlsCrypto'
import PixelSprite from './PixelSprite.vue'

const SECRET_NAME = 'secret-meeting.example'
const PUBLIC_NAME = 'public.example'
const ALPN = 'webrtc'
const PADDED = 160

const ech = ref(false)
const view = ref<'mallory' | 'server'>('mallory')
const stale = ref(false)

// HPKE stand-in
interface EchKey {
	seal(plaintext: Bytes): Promise<{ enc: Bytes; payload: Bytes }>
	open(enc: Bytes, payload: Bytes): Promise<Bytes>
}

const NONCE = new Uint8Array(12)

async function aeadKey(shared: Bytes, enc: Bytes) {
	return hkdfExpand(await hkdfExtract(enc, shared), utf8('ech demo key'), 16)
}

async function makeEchKey(): Promise<EchKey> {
	try {
		const server = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
			'deriveBits',
		])) as CryptoKeyPair
		const dh = async (priv: CryptoKey, pub: CryptoKey) =>
			new Uint8Array(
				await crypto.subtle.deriveBits(
					{ name: 'X25519', public: pub },
					priv,
					256,
				),
			) as Bytes
		return {
			async seal(plaintext) {
				const eph = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
					'deriveBits',
				])) as CryptoKeyPair
				const enc = new Uint8Array(
					await crypto.subtle.exportKey('raw', eph.publicKey),
				) as Bytes
				const key = await aeadKey(
					await dh(eph.privateKey, server.publicKey),
					enc,
				)
				return { enc, payload: await aesGcm('encrypt', key, NONCE, plaintext) }
			},
			async open(enc, payload) {
				const pub = await crypto.subtle.importKey(
					'raw',
					enc,
					{ name: 'X25519' },
					false,
					[],
				)
				const key = await aeadKey(await dh(server.privateKey, pub), enc)
				return aesGcm('decrypt', key, NONCE, payload)
			},
		}
	} catch {
		const secret = random(32)
		return {
			async seal(plaintext) {
				const enc = random(32)
				const key = await aeadKey(secret, enc)
				return { enc, payload: await aesGcm('encrypt', key, NONCE, plaintext) }
			},
			async open(enc, payload) {
				return aesGcm('decrypt', await aeadKey(secret, enc), NONCE, payload)
			},
		}
	}
}

// Hellos
interface Inner {
	sni: string
	alpn: string
	random: string
}

const outerRandom = ref('')
const keyShare = ref('')
const sealed = ref<{ enc: Bytes; payload: Bytes }>()
const opened = ref<Inner | 'failed'>()
let current: EchKey | undefined
let rotatedAway: EchKey | undefined
let innerBytes: Bytes | undefined

async function newHello() {
	outerRandom.value = hex(random(32), '')
	keyShare.value = hex(random(8), '')
	const inner: Inner = {
		sni: SECRET_NAME,
		alpn: ALPN,
		random: hex(random(32), ''),
	}
	const json = utf8(JSON.stringify(inner))
	innerBytes = new Uint8Array(Math.max(PADDED, json.length)) as Bytes
	innerBytes.set(json)
	await reseal()
}

let generation = 0

async function reseal() {
	if (!current || !rotatedAway || !innerBytes) return
	const mine = ++generation
	const next = await (stale.value ? rotatedAway : current).seal(innerBytes)
	if (mine !== generation) return
	const result = await serverOpens(next)
	if (mine !== generation) return
	sealed.value = next
	opened.value = result
}

async function serverOpens(msg: {
	enc: Bytes
	payload: Bytes
}): Promise<Inner | 'failed'> {
	if (!current) return 'failed'
	try {
		const plain = await current.open(msg.enc, msg.payload)
		let end = plain.length
		while (end > 0 && plain[end - 1] === 0) end--
		return JSON.parse(new TextDecoder().decode(plain.subarray(0, end)))
	} catch {
		return 'failed'
	}
}

onMounted(async () => {
	current = await makeEchKey()
	rotatedAway = await makeEchKey()
	await newHello()
})

watch(stale, reseal)

// Rendering
type Tone = 'leak' | 'public' | 'opaque' | 'secret' | 'plain'

interface Row {
	name: string
	value: string
	tone: Tone
	tag?: string
}

function short(h: string, bytes = 12) {
	return h ? `${h.slice(0, bytes * 2)}…` : '…'
}

const common = computed<Row[]>(() => [
	{
		name: 'legacy_version',
		value: 'fe fd (claims DTLS 1.2, for old middleboxes)',
		tone: 'plain',
	},
	{ name: 'random', value: short(outerRandom.value), tone: 'plain' },
	{
		name: 'cipher_suites',
		value:
			'TLS_AES_128_GCM_SHA256, TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256',
		tone: 'plain',
	},
	{
		name: 'supported_versions',
		value: 'fe fc (DTLS 1.3)',
		tone: 'plain',
	},
	{
		name: 'supported_groups',
		value: 'X25519MLKEM768, X25519, secp256r1',
		tone: 'plain',
	},
	{
		name: 'key_share',
		value: `X25519MLKEM768, 1216 bytes: ${short(keyShare.value, 6)}`,
		tone: 'plain',
	},
])

const payloadHex = computed(() =>
	sealed.value ? hex(sealed.value.payload, '') : '',
)

const rows = computed<Row[]>(() => {
	if (!ech.value)
		return [
			...common.value,
			{
				name: 'server_name',
				value: SECRET_NAME,
				tone: 'leak',
				tag: 'Mallory reads this',
			},
			{
				name: 'alpn',
				value: ALPN,
				tone: 'leak',
				tag: 'it’s a video call',
			},
		]
	if (view.value === 'mallory')
		return [
			...common.value,
			{
				name: 'server_name',
				value: PUBLIC_NAME,
				tone: 'public',
				tag: 'shared by many sites',
			},
			{
				name: 'encrypted_client_hello',
				value: sealed.value
					? `outer · config_id 2a · HPKE X25519, HKDF-SHA256, AES-128-GCM · enc ${short(hex(sealed.value.enc, ''), 8)} · payload ${sealed.value.payload.length} bytes`
					: '…',
				tone: 'opaque',
				tag: 'encrypted to the server’s ECH key',
			},
		]
	const inner = opened.value
	if (!inner) return []
	if (inner === 'failed')
		return [
			{
				name: 'encrypted_client_hello',
				value: 'decryption failed: this was sealed to a key I no longer have',
				tone: 'leak',
			},
			{
				name: 'so I use',
				value: `the outer hello, as ${PUBLIC_NAME}`,
				tone: 'public',
			},
			{
				name: 'and reply with',
				value: 'retry_configs: my current ECH config. Try again with this.',
				tone: 'secret',
			},
		]
	return [
		{
			name: 'legacy_version',
			value: 'fe fd',
			tone: 'plain',
		},
		{
			name: 'random',
			value: `${short(inner.random)} (its own, not the outer one)`,
			tone: 'plain',
		},
		...common.value.slice(2),
		{
			name: 'server_name',
			value: inner.sni,
			tone: 'secret',
			tag: 'decrypted',
		},
		{ name: 'alpn', value: inner.alpn, tone: 'secret', tag: 'decrypted' },
		{
			name: 'encrypted_client_hello',
			value: 'inner (marks this as the real hello)',
			tone: 'plain',
		},
	]
})

// Who's talking
const surprised = ref(false)
let surpriseTimer: ReturnType<typeof setTimeout> | undefined

watch(ech, (on) => {
	clearTimeout(surpriseTimer)
	surprised.value = on
	if (on) surpriseTimer = setTimeout(() => (surprised.value = false), 1400)
})

onBeforeUnmount(() => clearTimeout(surpriseTimer))

const speaker = computed<{
	character: CharacterName
	animation: AnimationName
	line: string
}>(() => {
	if (!ech.value)
		return {
			character: 'mallory',
			animation: 'sneak',
			line: `${SECRET_NAME}, and it’s WebRTC. Noted.`,
		}
	if (view.value === 'mallory')
		return {
			character: 'mallory',
			animation: surprised.value ? 'wow' : 'sad',
			line: `${PUBLIC_NAME}? That could be anyone.`,
		}
	if (opened.value === 'failed')
		return {
			character: 'server',
			animation: 'wow',
			line: 'I can’t open this one. Finishing as the public name, and sending fresh keys.',
		}
	return {
		character: 'server',
		animation: 'yay',
		line: `I hold the ECH key, so I see where you really want to go: ${SECRET_NAME}.`,
	}
})
</script>

<template>
	<DemoFrame label="what Mallory sees in your ClientHello">
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Encrypted Client Hello">
				<button :aria-pressed="!ech" @click="ech = false">without ECH</button>
				<button :aria-pressed="ech" @click="ech = true">with ECH</button>
			</div>
		</template>

		<div v-if="ech" class="demo-tabs" role="group" aria-label="Whose view">
			<button :aria-pressed="view === 'mallory'" @click="view = 'mallory'">
				Mallory’s view
			</button>
			<button :aria-pressed="view === 'server'" @click="view = 'server'">
				server’s view
			</button>
		</div>

		<div class="speaker" aria-live="polite">
			<PixelSprite
				:character="speaker.character"
				:animation="speaker.animation"
				:size="56"
				:label="speaker.character === 'mallory' ? 'Mallory' : 'Server'"
			/>
			<p class="bubble">{{ speaker.line }}</p>
		</div>

		<p class="hello-title demo-mono">
			{{
				!ech
					? 'ClientHello'
					: view === 'mallory'
						? 'ClientHelloOuter (on the wire)'
						: opened === 'failed'
							? 'ClientHelloInner: can’t decrypt'
							: 'ClientHelloInner (decrypted)'
			}}
		</p>
		<ul class="hello">
			<li v-for="r of rows" :key="r.name" :class="r.tone">
				<span class="name">{{ r.name }}</span>
				<span class="value">
					{{ r.value }}
					<span v-if="r.tag" class="tag">{{ r.tag }}</span>
				</span>
			</li>
		</ul>

		<div v-if="ech && view === 'mallory'" class="blob">
			<p class="demo-note">
				ECH payload ({{ sealed?.payload.length ?? '…' }} bytes, the real
				ClientHelloInner inside):
			</p>
			<p class="demo-mono payload">{{ payloadHex || '…' }}</p>
		</div>

		<template #controls>
			<button class="demo-btn" @click="newHello">new ClientHello</button>
			<label v-if="ech && view === 'server'">
				<input v-model="stale" type="checkbox" />
				client has a stale ECH key
			</label>
		</template>
		<template #caption>
			Switch ECH on, then flip between Mallory’s view and the server’s. The
			payload is really encrypted in your browser (X25519 and AES-GCM standing
			in for HPKE), and the server’s view is really decrypted from it.
		</template>
	</DemoFrame>
</template>

<style scoped>
.speaker {
	display: flex;
	gap: 10px;
	align-items: center;
	margin-bottom: 12px;
}

.speaker > :first-child {
	flex: none;
}

.bubble {
	margin: 0;
	padding-left: 12px;
	border-left: 1px solid var(--accent);
	color: var(--bubbletext);
	font-size: 0.9375rem;
	line-height: 1.45;
}

.hello-title {
	margin: 0 0 8px;
	color: var(--accent);
	font-size: 0.8125rem;
}

.hello {
	display: grid;
	gap: 2px;
	margin: 0;
	padding: 0;
	list-style: none;
	font: 0.8125rem / 1.45 var(--font-mono);
}

.hello li {
	display: grid;
	grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
	gap: 4px 12px;
	padding: 5px 0 5px 10px;
	border-left: 1px solid var(--rule);
}

.name {
	color: var(--muted);
	overflow-wrap: anywhere;
}

.value {
	overflow-wrap: anywhere;
}

.tag {
	display: inline-block;
	margin-left: 6px;
	padding: 0 6px;
	border-radius: 0;
	font-size: 0.6875rem;
	white-space: nowrap;
}

.hello .leak {
	border-left-color: var(--danger);
}

.leak .value {
	color: var(--danger);
	font-weight: 700;
}

.leak .tag {
	color: var(--danger);
	font-weight: 400;
}

.hello .public {
	border-left-color: var(--warning);
}

.public .value {
	color: var(--warning);
}

.public .tag {
	color: var(--warning);
}

.hello .opaque {
	border-left-color: var(--info);
}

.opaque .value {
	color: var(--muted);
}

.opaque .tag {
	color: var(--info);
}

.hello .secret {
	border-left-color: var(--tip);
}

.secret .value {
	color: var(--tip);
	font-weight: 700;
}

.secret .tag {
	color: var(--tip);
	font-weight: 400;
}

.blob {
	margin-top: 12px;
}

.payload {
	margin: 6px 0 0;
	padding: 8px 10px;
	border-radius: 0;
	background: var(--bg);
	color: var(--muted);
	font-size: 0.75rem;
	line-height: 1.5;
	overflow-wrap: anywhere;
}

@media (max-width: 520px) {
	.hello li {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
}
</style>
