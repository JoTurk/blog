<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { AnimationName } from './characters'
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
import PixelSprite from './PixelSprite.vue'

type Attack = 'none' | 'downgrade' | 'forward' | 'own'

const attacks: { id: Attack; label: string }[] = [
	{ id: 'none', label: 'no attack' },
	{ id: 'downgrade', label: 'downgrade' },
	{ id: 'forward', label: 'MITM, forward the signature' },
	{ id: 'own', label: 'MITM, bring her own cert' },
]

const SUITES = [
	'TLS_AES_256_GCM_SHA384',
	'TLS_CHACHA20_POLY1305_SHA256',
	'TLS_AES_128_GCM_SHA256',
	'TLS_AES_128_CCM_8_SHA256',
]
const WEAKEST = SUITES[SUITES.length - 1]
const DELAY = 1100

const pretty = (suite: string) =>
	suite.replace(/^TLS_/, '').replace(/_SHA(256|384)$/, '')

interface Field {
	k: string
	v: string
	hex?: boolean
	list?: boolean
	was?: string
}

interface Msg {
	name: string
	enc: boolean
	fields: Field[]
}

interface Check {
	label: string
	name: string
	ok: boolean
	alert: string
	caught?: boolean
}

interface Side {
	hash: string
	diverged: boolean
	secret?: string
	note?: string
	checks: Check[]
}

interface Row {
	dir: 'cs' | 'sc'
	msgs: Msg[]
	mallory?: string
	client: Side
	server: Side
}

interface Sim {
	rows: Row[]
	caught?: string
	clientHash: string
	serverHash: string
}

const SENTENCE: Record<Attack, string> = {
	none: 'Both sides hashed the same bytes, so the signature and both Finished MACs check out. The handshake is done.',
	downgrade:
		'The client hashed the ClientHello it sent, the server hashed the one it received. The transcripts don’t match, so the server’s signature and Finished MAC are both wrong. The client hangs up.',
	forward:
		'The server signed its own transcript, which has Mallory’s key share in it instead of the client’s. That signature doesn’t match what the client saw. The client hangs up.',
	own: 'Mallory’s certificate claims Example CA, but Example CA never signed it. The client hangs up.',
}

const EXTRA: Record<Attack, string> = {
	none: 'Mallory saw both hellos and both key shares, and that’s all she gets: everything after ServerHello is encrypted.',
	downgrade:
		'In real TLS 1.3 the transcript also goes into the handshake encryption keys, so the client couldn’t even decrypt this flight. And TLS 1.3 only has strong suites left (CCM_8 has a short tag); in older versions this trick reached export-grade crypto.',
	forward:
		'Notice Finished passed: Mallory holds the client’s handshake keys, so she can compute a valid MAC. A MAC proves you know the key, not who you are. The signature is the part she can’t fake.',
	own: 'Her CertificateVerify is a perfectly valid signature, by her own key. That proves nothing, because the client only trusts keys a CA vouched for.',
}

// Crypto helpers

const EC = { name: 'ECDSA', namedCurve: 'P-256' }
const SIG = { name: 'ECDSA', hash: 'SHA-256' }

const raw = async (k: CryptoKey) =>
	new Uint8Array(await crypto.subtle.exportKey('raw', k)) as Bytes

const ecKeys = () =>
	crypto.subtle.generateKey(EC, true, [
		'sign',
		'verify',
	]) as Promise<CryptoKeyPair>

const sign = async (k: CryptoKey, data: Bytes) =>
	new Uint8Array(await crypto.subtle.sign(SIG, k, data)) as Bytes

async function verify(pub: Bytes, sig: Bytes, data: Bytes) {
	try {
		const k = await crypto.subtle.importKey('raw', pub, EC, false, ['verify'])
		return await crypto.subtle.verify(SIG, k, sig, data)
	} catch {
		return false
	}
}

async function hmac(key: Bytes, data: Bytes) {
	const k = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)) as Bytes
}

const fromHex = (s: string) =>
	new Uint8Array(
		(s.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)),
	) as Bytes

const hex8 = (b: Uint8Array) => hex(b.subarray(0, 8), '')

const cvInput = (hash: Bytes) =>
	concat(
		new Uint8Array(64).fill(0x20),
		utf8('TLS 1.3, server CertificateVerify'),
		new Uint8Array(1),
		hash,
	)

const certBody = (pub: Bytes) =>
	utf8(`subject=server.example\nissuer=Example CA\npublic_key=${hex(pub, '')}`)

async function finishedKey(secret: Bytes, hellos: Bytes, label: string) {
	const hs = await hkdfExtract(new Uint8Array(0), secret)
	const traffic = await hkdfExpandLabel(hs, label, await sha256(hellos), 32)
	return hkdfExpandLabel(traffic, 'finished', new Uint8Array(0), 32)
}

const encode = (m: Msg) =>
	utf8(`${m.name}\n${m.fields.map((f) => `${f.k}=${f.v}`).join('\n')}\n`)

function transcript() {
	let bytes = new Uint8Array(0) as Bytes
	return {
		get bytes() {
			return bytes
		},
		add(m: Msg) {
			bytes = concat(bytes, encode(m))
		},
		hash: () => sha256(bytes),
	}
}
type Transcript = ReturnType<typeof transcript>

const field = (m: Msg, k: string) => m.fields.find((f) => f.k === k)?.v ?? ''

function change(m: Msg, k: string, v: string): Msg {
	return {
		...m,
		fields: m.fields.map((f) => (f.k === k ? { ...f, v, was: f.v } : f)),
	}
}

function diff(forged: Msg, real: Msg): Msg {
	return {
		...forged,
		fields: forged.fields.map((f, i) =>
			f.v === real.fields[i]?.v ? f : { ...f, was: real.fields[i]?.v },
		),
	}
}

interface Party {
	pub: Bytes
	key?: CryptoKeyPair
}

const realX25519 = ref(true)

async function party(): Promise<Party> {
	if (!realX25519.value) return { pub: random(32) }
	const key = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
		'deriveBits',
	])) as CryptoKeyPair
	return { pub: await raw(key.publicKey), key }
}

async function agree(own: Party, peer: Party): Promise<Bytes> {
	if (own.key && peer.key)
		return new Uint8Array(
			await crypto.subtle.deriveBits(
				{ name: 'X25519', public: peer.key.publicKey },
				own.key.privateKey,
				256,
			),
		) as Bytes
	const [a, b] = [own.pub, peer.pub].sort((x, y) =>
		hex(x).localeCompare(hex(y)),
	)
	return sha256(concat(a, b))
}

async function build(attack: Attack): Promise<Sim> {
	const mitm = attack === 'forward' || attack === 'own'
	const [ca, srv, mal] = await Promise.all([ecKeys(), ecKeys(), ecKeys()])
	const caPub = await raw(ca.publicKey)
	const srvPub = await raw(srv.publicKey)
	const malPub = await raw(mal.publicKey)
	const [cP, sP, mcP, msP] = await Promise.all([
		party(),
		party(),
		party(),
		party(),
	])
	const tc = transcript()
	const ts = transcript()
	const rows: Row[] = []

	async function snap(client: Partial<Side> = {}, server: Partial<Side> = {}) {
		const [c, s] = await Promise.all([tc.hash(), ts.hash()])
		const diverged = hex8(c) !== hex8(s)
		return {
			client: { checks: [], ...client, hash: hex8(c), diverged },
			server: { checks: [], ...server, hash: hex8(s), diverged },
		}
	}

	// 1. ClientHello
	const ch: Msg = {
		name: 'ClientHello',
		enc: false,
		fields: [
			{ k: 'random', v: hex(random(32), ''), hex: true },
			{ k: 'cipher_suites', v: SUITES.join(', '), list: true },
			{ k: 'supported_groups', v: 'x25519' },
			{ k: 'key_share', v: hex(cP.pub, ''), hex: true },
		],
	}
	let chIn = ch
	let note: string | undefined
	if (attack === 'downgrade') {
		chIn = change(ch, 'cipher_suites', WEAKEST)
		note = 'Mallory deletes every cipher suite except the weakest.'
	}
	if (mitm) {
		chIn = change(ch, 'key_share', hex(msP.pub, ''))
		note = 'Mallory swaps the client’s key share for her own.'
	}
	tc.add(ch)
	ts.add(chIn)
	rows.push({ dir: 'cs', msgs: [chIn], mallory: note, ...(await snap()) })

	// 2. ServerHello
	const offered = field(chIn, 'cipher_suites').split(', ')
	const suite = SUITES.find((s) => offered.includes(s)) ?? WEAKEST
	const sh: Msg = {
		name: 'ServerHello',
		enc: false,
		fields: [
			{ k: 'random', v: hex(random(32), ''), hex: true },
			{ k: 'cipher_suite', v: suite },
			{ k: 'key_share', v: hex(sP.pub, ''), hex: true },
		],
	}
	const shIn = mitm ? change(sh, 'key_share', hex(mcP.pub, '')) : sh
	ts.add(sh)
	tc.add(shIn)
	const cSecret = await agree(cP, mitm ? mcP : sP)
	const sSecret = await agree(sP, mitm ? msP : cP)
	note = mitm
		? 'And the server’s for hers. Now she shares one key with each side.'
		: attack === 'downgrade'
			? `The server picks ${pretty(suite)}, the only one left. Mallory didn’t touch the key shares, so the keys still match.`
			: undefined
	rows.push({
		dir: 'sc',
		msgs: [shIn],
		mallory: note,
		...(await snap({ secret: hex8(cSecret) }, { secret: hex8(sSecret) })),
	})

	const [sFinS, cFinS, sFinC, cFinC] = await Promise.all([
		finishedKey(sSecret, ts.bytes, 's hs traffic'),
		finishedKey(sSecret, ts.bytes, 'c hs traffic'),
		finishedKey(cSecret, tc.bytes, 's hs traffic'),
		finishedKey(cSecret, tc.bytes, 'c hs traffic'),
	])

	// 3. Server flight
	const certMsg = async (pub: Bytes, signer: CryptoKey): Promise<Msg> => ({
		name: 'Certificate',
		enc: true,
		fields: [
			{ k: 'subject', v: 'server.example' },
			{ k: 'issuer', v: 'Example CA' },
			{ k: 'public_key', v: hex(pub, ''), hex: true },
			{
				k: 'ca_signature',
				v: hex(await sign(signer, certBody(pub)), ''),
				hex: true,
			},
		],
	})
	const cvMsg = async (key: CryptoKey, t: Transcript): Promise<Msg> => ({
		name: 'CertificateVerify',
		enc: true,
		fields: [
			{ k: 'algorithm', v: 'ecdsa_secp256r1_sha256' },
			{
				k: 'signature',
				v: hex(await sign(key, cvInput(await t.hash())), ''),
				hex: true,
			},
		],
	})
	const finMsg = async (key: Bytes, t: Transcript): Promise<Msg> => ({
		name: 'Finished',
		enc: true,
		fields: [
			{
				k: 'verify_data',
				v: hex(await hmac(key, await t.hash()), ''),
				hex: true,
			},
		],
	})

	const ee: Msg = {
		name: 'EncryptedExtensions',
		enc: true,
		fields: [{ k: 'use_srtp', v: 'SRTP_AEAD_AES_128_GCM' }],
	}
	const cert = await certMsg(srvPub, ca.privateKey)
	ts.add(ee)
	ts.add(cert)
	const cv = await cvMsg(srv.privateKey, ts)
	ts.add(cv)
	const fin = await finMsg(sFinS, ts)
	ts.add(fin)

	const checks: Check[] = []
	tc.add(ee)
	const certIn =
		attack === 'own' ? diff(await certMsg(malPub, mal.privateKey), cert) : cert
	tc.add(certIn)
	const certPub = fromHex(field(certIn, 'public_key'))
	checks.push({
		label: 'certificate signed by Example CA',
		name: 'certificate check',
		ok: await verify(
			caPub,
			fromHex(field(certIn, 'ca_signature')),
			certBody(certPub),
		),
		alert: 'bad_certificate',
	})
	const cvIn = attack === 'own' ? diff(await cvMsg(mal.privateKey, tc), cv) : cv
	checks.push({
		label: 'CertificateVerify signature',
		name: 'CertificateVerify signature',
		ok: await verify(
			certPub,
			fromHex(field(cvIn, 'signature')),
			cvInput(await tc.hash()),
		),
		alert: 'decrypt_error',
	})
	tc.add(cvIn)
	const expected = hex(await hmac(sFinC, await tc.hash()), '')
	const finIn = mitm ? diff(await finMsg(sFinC, tc), fin) : fin
	checks.push({
		label: 'server Finished MAC',
		name: 'server’s Finished MAC',
		ok: field(finIn, 'verify_data') === expected,
		alert: 'decrypt_error',
	})
	tc.add(finIn)
	const failed = checks.filter((c) => !c.ok)
	for (const c of failed) c.caught = true
	const caught = failed[0]
	note = {
		none: undefined,
		downgrade:
			'Mallory can’t read or change these: they’re encrypted with keys she doesn’t have.',
		forward:
			'Mallory decrypts with her server-side key and re-encrypts with her client-side key. She forwards the real signature and writes a new Finished.',
		own: 'Mallory swaps in her own certificate, signs the client’s transcript with her own key, and writes a new Finished.',
	}[attack]
	rows.push({
		dir: 'sc',
		msgs: [ee, certIn, cvIn, finIn],
		mallory: note,
		...(await snap({ checks }, { note: 'sent, waits for the client' })),
	})

	// 4. Client Finished
	if (caught) {
		const alert: Msg = {
			name: 'Alert',
			enc: true,
			fields: [
				{ k: 'level', v: 'fatal' },
				{ k: 'description', v: caught.alert },
			],
		}
		rows.push({
			dir: 'cs',
			msgs: [alert],
			...(await snap({ note: 'hangs up' }, { note: 'handshake aborted' })),
		})
	} else {
		const cfin = await finMsg(cFinC, tc)
		const want = hex(await hmac(cFinS, await ts.hash()), '')
		tc.add(cfin)
		ts.add(cfin)
		rows.push({
			dir: 'cs',
			msgs: [cfin],
			...(await snap(
				{},
				{
					checks: [
						{
							label: 'client Finished MAC',
							name: 'client’s Finished MAC',
							ok: field(cfin, 'verify_data') === want,
							alert: 'decrypt_error',
						},
					],
				},
			)),
		})
	}

	return {
		rows,
		caught: failed.map((c) => c.name).join(' and '),
		clientHash: rows[rows.length - 1].client.hash,
		serverHash: rows[rows.length - 1].server.hash,
	}
}

// Demo

const attack = ref<Attack>('none')
const sim = shallowRef<Sim>()
const shown = ref(0)
const running = ref(false)
const broken = ref(false)
const runId = ref(0)
let gen = 0
let timer: ReturnType<typeof setTimeout> | undefined
const wantRun = ref(false)

const rows = computed(() => sim.value?.rows.slice(0, shown.value) ?? [])
const done = computed(() => !!sim.value && shown.value >= sim.value.rows.length)
const caughtAt = computed(() =>
	rows.value.some((r) => r.client.checks.some((c) => !c.ok)),
)

function stop() {
	clearTimeout(timer)
	timer = undefined
	running.value = false
}

function prepare() {
	stop()
	const g = ++gen
	runId.value = g
	sim.value = undefined
	shown.value = 0
	wantRun.value = false
	build(attack.value).then(
		(s) => {
			if (g !== gen) return
			sim.value = s
			if (wantRun.value) run()
		},
		() => {
			if (g === gen) broken.value = true
		},
	)
}

function advance() {
	if (!sim.value) return
	shown.value = Math.min(shown.value + 1, sim.value.rows.length)
}

function tick() {
	advance()
	if (done.value) {
		stop()
		return
	}
	timer = setTimeout(tick, DELAY)
}

function run() {
	if (done.value) {
		prepare()
		wantRun.value = true
		return
	}
	if (!sim.value) {
		wantRun.value = true
		return
	}
	if (running.value) return
	running.value = true
	tick()
}

function step() {
	stop()
	advance()
}

function pick(next: Attack) {
	attack.value = next
	prepare()
}

onMounted(async () => {
	if (!globalThis.crypto?.subtle) {
		broken.value = true
		return
	}
	try {
		await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
	} catch {
		realX25519.value = false
	}
	prepare()
})

onBeforeUnmount(() => {
	gen++
	stop()
})

const runLabel = computed(() => {
	if (done.value) return 'run again'
	if (running.value) return 'running…'
	if (wantRun.value && !sim.value) return 'making keys…'
	return shown.value ? 'keep running' : 'run the handshake'
})

const mallorySays = computed(() => {
	const a = attack.value
	const n = shown.value
	if (a === 'none')
		return done.value ? 'They’re in. Nothing for me.' : 'I’ll just watch.'
	if (done.value || (n >= 3 && caughtAt.value))
		return {
			downgrade: 'They compared transcripts. Ugh.',
			forward: 'The signature covers my key shares!',
			own: 'The CA never signed my cert.',
		}[a]
	if (n === 0)
		return a === 'downgrade'
			? 'Let’s make them pick the weakest cipher.'
			: 'I’ll sit in the middle and talk to both.'
	if (n === 1)
		return a === 'downgrade' ? 'Snip, snip, snip.' : 'My key share now.'
	return a === 'downgrade'
		? 'They’ll never know.'
		: 'One key with each of them.'
})

const malloryMood = computed<AnimationName>(() => {
	if (attack.value === 'none') return 'idle'
	return caughtAt.value ? 'sad' : 'sneak'
})

const clientMood = computed<AnimationName>(() => {
	if (caughtAt.value) return 'wow'
	return done.value ? 'yay' : 'idle'
})

const serverMood = computed<AnimationName>(() =>
	done.value && !sim.value?.caught ? 'yay' : 'idle',
)

const title = (m: Msg) => (m.enc ? `{${m.name}}` : m.name)
function short(f: Field, v: string) {
	if (f.hex) return `${v.slice(0, 16)}…`
	return f.k === 'cipher_suite' ? pretty(v) : v
}
const items = (f: Field) => (f.was ?? f.v).split(', ')
const kept = (f: Field, item: string) => f.v.split(', ').includes(item)
</script>

<template>
	<DemoFrame label="attack the handshake">
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Mallory’s move">
				<button
					v-for="a of attacks"
					:key="a.id"
					type="button"
					:aria-pressed="attack === a.id"
					@click="pick(a.id)"
				>
					{{ a.label }}
				</button>
			</div>
		</template>

		<div class="cast">
			<div class="who">
				<PixelSprite
					character="client"
					:animation="clientMood"
					:size="48"
					label="Client"
				/>
				<span>Client</span>
			</div>
			<div class="who">
				<PixelSprite
					character="mallory"
					:animation="malloryMood"
					:size="48"
					label="Mallory"
				/>
				<span>Mallory, on the wire</span>
				<p class="says" aria-live="polite">
					<span class="bubble">{{ mallorySays }}</span>
				</p>
			</div>
			<div class="who">
				<PixelSprite
					character="server"
					:animation="serverMood"
					:size="48"
					flip
					label="Server"
				/>
				<span>Server</span>
			</div>
		</div>

		<p v-if="broken" class="demo-note demo-warn">
			This browser can’t run WebCrypto here, so the demo can’t make keys.
		</p>
		<p v-else-if="!realX25519" class="demo-note demo-warn">
			No X25519 in this browser’s WebCrypto, so key shares are random bytes and
			the shared keys are simulated. Hashes and signatures are still real.
		</p>

		<ol class="ladder" aria-label="Handshake messages" aria-live="polite">
			<li v-if="!rows.length" class="empty demo-note">
				Pick Mallory’s move, then run the handshake.
			</li>
			<li
				v-for="(row, i) of rows"
				:key="`${runId}-${i}`"
				class="row"
				:class="row.dir"
			>
				<div class="wire">
					<p class="arrow" aria-hidden="true">
						<span class="line" /><span class="head" />
					</p>
					<p class="sr-only">
						{{ row.dir === 'cs' ? 'Client to server' : 'Server to client' }}
					</p>
					<div
						v-for="m of row.msgs"
						:key="m.name"
						class="msg"
						:class="{ enc: m.enc, touched: m.fields.some((f) => f.was) }"
					>
						<p class="msg-name">{{ title(m) }}</p>
						<dl>
							<template v-for="f of m.fields" :key="f.k">
								<dt>{{ f.k }}</dt>
								<dd v-if="f.list">
									<template v-for="item of items(f)" :key="item">
										<del v-if="!kept(f, item)">{{
											pretty(item)
										}}</del>
										<span v-else :class="{ 'demo-warn': f.was }">{{
											pretty(item)
										}}</span>
									</template>
								</dd>
								<dd v-else-if="f.was">
									<del>{{ short(f, f.was) }}</del>
									<span class="demo-warn">{{ short(f, f.v) }}</span>
								</dd>
								<dd v-else>{{ short(f, f.v) }}</dd>
							</template>
						</dl>
					</div>
					<p v-if="row.mallory" class="tamper">{{ row.mallory }}</p>
				</div>
				<div
					v-for="who of (['client', 'server'] as const)"
					:key="who"
					class="side"
					:class="who"
				>
					<p class="side-name">{{ who }}</p>
					<p>
						<span class="k">transcript</span>
						<code :class="row[who].diverged ? 'demo-bad' : 'demo-ok'">{{
							row[who].hash
						}}</code>
					</p>
					<p v-if="row[who].secret">
						<span class="k">shared key</span>
						<code
							:class="
								row.client.secret === row.server.secret
									? 'demo-ok'
									: 'demo-bad'
							"
							>{{ row[who].secret }}</code
						>
					</p>
					<ul v-if="row[who].checks.length" class="checks">
						<li
							v-for="c of row[who].checks"
							:key="c.label"
							:class="c.ok ? 'demo-ok' : 'demo-bad'"
						>
							{{ c.ok ? '✓' : '✗' }} {{ c.label
							}}<strong v-if="c.caught"> ← caught her</strong>
						</li>
					</ul>
					<p v-if="row[who].note" class="note">{{ row[who].note }}</p>
				</div>
			</li>
		</ol>

		<div class="outcome" aria-live="polite">
			<template v-if="done && sim">
				<p class="verdict">
					<strong v-if="sim.caught" class="demo-bad"
						>✗ caught by the {{ sim.caught }}</strong
					>
					<strong v-else class="demo-ok">✓ handshake complete</strong>
				</p>
				<p class="sentence">{{ SENTENCE[attack] }}</p>
				<dl class="final">
					<div>
						<dt>client’s transcript hash</dt>
						<dd
							:class="
								sim.clientHash === sim.serverHash ? 'demo-ok' : 'demo-bad'
							"
						>
							{{ sim.clientHash }}
						</dd>
					</div>
					<div>
						<dt>server’s transcript hash</dt>
						<dd
							:class="
								sim.clientHash === sim.serverHash ? 'demo-ok' : 'demo-bad'
							"
						>
							{{ sim.serverHash }}
						</dd>
					</div>
				</dl>
				<p class="demo-note">{{ EXTRA[attack] }}</p>
			</template>
		</div>

		<template #controls>
			<button
				type="button"
				class="demo-btn"
				data-longest="run the handshake"
				:disabled="running || broken"
				@click="run"
			>
				{{ runLabel }}
			</button>
			<button
				type="button"
				class="demo-btn secondary"
				:disabled="!sim || done"
				@click="step"
			>
				step
			</button>
			<button
				type="button"
				class="demo-btn secondary"
				:disabled="broken"
				@click="prepare"
			>
				reset
			</button>
		</template>

		<template #caption>
			Pick a move for Mallory and run the handshake. Each attack slips past some
			checks, never all of them. The crypto is real (SHA-256 transcripts, ECDSA
			P-256 signatures, HMAC Finished, X25519 keys), but messages are hashed as
			text fields rather than wire bytes, and the certificate is a toy: one CA
			signature over a name and a key.
		</template>
	</DemoFrame>
</template>

<style scoped>
.cast {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1fr);
	gap: 12px;
	align-items: start;
	text-align: center;
}

.who {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
}

.who > span {
	color: var(--muted);
	font-size: 0.75rem;
}

.says {
	margin: 6px 0 0;
	font-size: 0.8125rem;
	line-height: 1.4;
}

.bubble {
	display: inline-block;
	padding: 3px 10px;
	background: var(--bubble);
	color: var(--bubbletext);
}

.ladder {
	margin: 12px 0 0;
	padding: 0;
	list-style: none;
}

.empty {
	padding: 16px 0;
	border-top: 2px dotted var(--rule);
	text-align: center;
}

.row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1fr);
	grid-template-areas: 'client wire server';
	gap: 12px;
	margin: 0;
	padding: 12px 0;
	border-top: 2px dotted var(--rule);
	animation: appear 0.3s ease-out;
}

@keyframes appear {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
}

.wire {
	grid-area: wire;
	min-width: 0;
}

.arrow {
	display: flex;
	align-items: center;
	margin: 0 0 8px;
}

.arrow .line {
	flex: 1;
	height: 2px;
	background: var(--accent);
}

.arrow .head {
	width: 0;
	height: 0;
	border-top: 6px solid transparent;
	border-bottom: 6px solid transparent;
	border-left: 9px solid var(--accent);
}

.row.sc .arrow {
	flex-direction: row-reverse;
}

.row.sc .arrow .head {
	border-right: 9px solid var(--accent);
	border-left: 0;
}

.msg {
	margin-top: 6px;
	padding: 6px 8px;
	border-left: 3px solid var(--accent);
	background: var(--bg);
}

.msg.enc {
	border-left-color: var(--info);
}

.msg.touched {
	border-left-color: var(--warning);
}

.msg-name {
	margin: 0 0 2px;
	font: 700 0.8125rem / 1.4 var(--font-mono);
}

.msg.enc .msg-name {
	color: var(--info);
}

.msg.touched .msg-name {
	color: var(--warning);
}

.msg dl {
	display: grid;
	grid-template-columns: max-content minmax(0, 1fr);
	gap: 0 10px;
	margin: 0;
	font: 0.75rem / 1.5 var(--font-mono);
}

.msg dt {
	color: var(--muted);
}

.msg dd > del,
.msg dd > span {
	white-space: nowrap;
}

.msg dd {
	display: flex;
	flex-wrap: wrap;
	gap: 0 8px;
	margin: 0;
	overflow-wrap: anywhere;
}

.msg del {
	color: var(--danger);
	text-decoration-thickness: 2px;
}

.tamper {
	margin: 6px 0 0;
	color: var(--warning);
	font-size: 0.8125rem;
	line-height: 1.45;
}

.side {
	min-width: 0;
	font: 0.75rem / 1.5 var(--font-mono);
}

.side.client {
	grid-area: client;
}

.side.server {
	grid-area: server;
	text-align: right;
}

.side p {
	margin: 0;
}

.side-name {
	display: none;
	color: var(--text);
	font-weight: 700;
}

.k {
	display: block;
	color: var(--muted);
}

.side code {
	display: block;
	padding: 0;
	background: none;
	font-size: inherit;
	font-family: var(--font-mono);
	overflow-wrap: anywhere;
}

.checks {
	margin: 6px 0 0;
	padding: 0;
	list-style: none;
}

.checks li {
	margin: 0 0 4px;
}

.note {
	margin-top: 4px;
	color: var(--muted);
}

.outcome {
	margin-top: 4px;
}

.outcome:not(:empty) {
	padding-top: 12px;
	border-top: 2px solid var(--rule);
}

.verdict,
.sentence {
	margin: 0 0 6px;
	font-size: 0.9375rem;
}

.final {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px 16px;
	margin: 10px 0 0;
}

.final dt {
	color: var(--muted);
	font-size: 0.75rem;
}

.final dd {
	margin: 0;
	font: 700 0.875rem var(--font-mono);
	overflow-wrap: anywhere;
}

.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

@media (max-width: 600px) {
	.cast {
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
		gap: 6px;
	}

	.row {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		grid-template-areas:
			'wire wire'
			'client server';
		gap: 10px 12px;
	}

	.side-name {
		display: block;
	}

	.final {
		grid-template-columns: 1fr;
	}
}

@media (prefers-reduced-motion: reduce) {
	.row {
		animation: none;
	}
}
</style>
