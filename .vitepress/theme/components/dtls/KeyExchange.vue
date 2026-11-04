<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

// Paint colors
const COMMON = { name: 'yellow', hex: '#f2cf3a' }
const SECRETS = [
	{ name: 'red', hex: '#d42a3c' },
	{ name: 'blue', hex: '#2152c4' },
	{ name: 'teal', hex: '#14a394' },
	{ name: 'purple', hex: '#7a3cc0' },
	{ name: 'pink', hex: '#e8559c' },
]

type Rgb = [number, number, number]

const toLinear = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toSrgb = (c: number) =>
	c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

function parse(hex: string): Rgb {
	const n = Number.parseInt(hex.slice(1), 16)
	return [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
		Math.max(toLinear(v / 255), 0.02),
	) as Rgb
}

function format(rgb: Rgb) {
	return `#${rgb
		.map((v) =>
			Math.round(toSrgb(v) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`
}

function mix(...parts: [string, number][]) {
	const total = parts.reduce((sum, [, w]) => sum + w, 0)
	const out: Rgb = [1, 1, 1]
	for (const [hex, w] of parts) {
		parse(hex).forEach((v, i) => {
			out[i] *= v ** (w / total)
		})
	}
	return format(out)
}

const tab = ref<'paint' | 'real'>('paint')
const clientSecret = ref(SECRETS[0].hex)
const serverSecret = ref(SECRETS[1].hex)

const paint = computed(() => {
	const c = COMMON.hex
	const a = clientSecret.value
	const b = serverSecret.value
	return {
		clientMix: mix([c, 1], [a, 1]),
		serverMix: mix([c, 1], [b, 1]),
		shared: mix([c, 1], [a, 1], [b, 1]),
		mallory: mix([c, 2], [a, 1], [b, 1]),
	}
})

const nameOf = (hex: string) =>
	SECRETS.find((s) => s.hex === hex)?.name ?? 'paint'

// X25519
interface Keys {
	clientPrivate: Uint8Array
	serverPrivate: Uint8Array
	clientPublic: Uint8Array
	serverPublic: Uint8Array
	clientShared: Uint8Array
	serverShared: Uint8Array
}

const support = ref<'checking' | 'yes' | 'no'>('checking')
const keys = ref<Keys>()
const fresh = ref(false)
let generation = 0

async function newKeys() {
	const run = ++generation
	const generate = () =>
		crypto.subtle.generateKey({ name: 'X25519' }, true, [
			'deriveBits',
		]) as Promise<CryptoKeyPair>
	const raw = async (k: CryptoKey) =>
		new Uint8Array(await crypto.subtle.exportKey('raw', k))
	const secret = async (k: CryptoKey) =>
		new Uint8Array(await crypto.subtle.exportKey('pkcs8', k)).slice(-32)
	const derive = async (own: CryptoKey, theirs: CryptoKey) =>
		new Uint8Array(
			await crypto.subtle.deriveBits(
				{ name: 'X25519', public: theirs },
				own,
				256,
			),
		)

	const [client, server] = await Promise.all([generate(), generate()])
	const next: Keys = {
		clientPrivate: await secret(client.privateKey),
		serverPrivate: await secret(server.privateKey),
		clientPublic: await raw(client.publicKey),
		serverPublic: await raw(server.publicKey),
		clientShared: await derive(client.privateKey, server.publicKey),
		serverShared: await derive(server.privateKey, client.publicKey),
	}
	if (run !== generation) return
	keys.value = next
	fresh.value = true
}

onMounted(async () => {
	try {
		await newKeys()
		fresh.value = false
		support.value = 'yes'
	} catch {
		support.value = 'no'
	}
})

function groups(bytes?: Uint8Array) {
	if (!bytes) return []
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
	return hex.match(/.{8}/g) ?? []
}

const same = computed(
	() =>
		!!keys.value &&
		groups(keys.value.clientShared).join() ===
			groups(keys.value.serverShared).join(),
)
</script>

<template>
	<DemoFrame>
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="Which version">
				<button
					type="button"
					:aria-pressed="tab === 'paint'"
					@click="tab = 'paint'"
				>
					Paint
				</button>
				<button
					type="button"
					:aria-pressed="tab === 'real'"
					@click="tab = 'real'"
				>
					For real (X25519)
				</button>
			</div>
		</template>

		<div class="cast" aria-hidden="true">
			<div>
				<PixelSprite
					character="client"
					:animation="tab === 'real' && fresh ? 'yay' : 'idle'"
					:size="48"
				/>
				<span>Client</span>
			</div>
			<div>
				<PixelSprite
					character="mallory"
					:animation="tab === 'real' && fresh ? 'sad' : 'sneak'"
					:size="48"
				/>
				<span>Mallory</span>
			</div>
			<div>
				<PixelSprite
					character="server"
					:animation="tab === 'real' && fresh ? 'yay' : 'idle'"
					:size="48"
					flip
				/>
				<span>Server</span>
			</div>
		</div>

		<div v-if="tab === 'paint'" class="paint">
			<p class="step">1. a common paint, public</p>
			<div class="row">
				<div class="cell" aria-label="Client has yellow">
					<span class="blob" :style="{ background: COMMON.hex }" />
				</div>
				<div class="cell" aria-label="Mallory has yellow">
					<span class="blob" :style="{ background: COMMON.hex }" />
				</div>
				<div class="cell" aria-label="Server has yellow">
					<span class="blob" :style="{ background: COMMON.hex }" />
				</div>
			</div>

			<p class="step">2. a secret paint each, never sent</p>
			<div class="row">
				<div
					v-for="side of (['client', 'server'] as const)"
					:key="side"
					class="cell picker"
					:class="side"
					role="group"
					:aria-label="`${side === 'client' ? 'Client' : 'Server'}’s secret paint`"
				>
					<span
						class="blob"
						:style="{
							background: side === 'client' ? clientSecret : serverSecret,
						}"
					/>
					<span class="swatches">
						<button
							v-for="s of SECRETS"
							:key="s.hex"
							type="button"
							class="swatch"
							:style="{ background: s.hex }"
							:aria-label="s.name"
							:aria-pressed="
								(side === 'client' ? clientSecret : serverSecret) === s.hex
							"
							@click="
								side === 'client'
									? (clientSecret = s.hex)
									: (serverSecret = s.hex)
							"
						/>
					</span>
				</div>
				<div class="cell unknown mallory-cell">?</div>
			</div>

			<p class="step">3. mix and send it over the wire</p>
			<div class="row">
				<div class="cell eq" aria-label="Client mixes yellow and its secret">
					<span class="blob sm" :style="{ background: COMMON.hex }" />+
					<span class="blob sm" :style="{ background: clientSecret }" />=
					<span class="blob sm sent" :style="{ background: paint.clientMix }" />
				</div>
				<div class="cell eq" aria-label="Mallory sees both mixes">
					<span class="arrow">→</span>
					<span class="blob sm" :style="{ background: paint.clientMix }" />
					<span class="blob sm" :style="{ background: paint.serverMix }" />
					<span class="arrow">←</span>
				</div>
				<div class="cell eq" aria-label="Server mixes yellow and its secret">
					<span class="blob sm" :style="{ background: COMMON.hex }" />+
					<span class="blob sm" :style="{ background: serverSecret }" />=
					<span class="blob sm sent" :style="{ background: paint.serverMix }" />
				</div>
			</div>

			<p class="step">4. mix what arrived with your own secret</p>
			<div class="row">
				<div class="cell eq final" aria-label="Client's final color">
					<span class="blob sm" :style="{ background: paint.serverMix }" />+
					<span class="blob sm" :style="{ background: clientSecret }" />=
					<span class="blob" :style="{ background: paint.shared }" />
					<code class="demo-ok">{{ paint.shared }}</code>
				</div>
				<div class="cell eq final" aria-label="Mallory's best guess">
					<span class="blob sm" :style="{ background: paint.clientMix }" />+
					<span class="blob sm" :style="{ background: paint.serverMix }" />=
					<span class="blob" :style="{ background: paint.mallory }" />
					<code class="demo-bad">{{ paint.mallory }}</code>
				</div>
				<div class="cell eq final" aria-label="Server's final color">
					<span class="blob sm" :style="{ background: paint.clientMix }" />+
					<span class="blob sm" :style="{ background: serverSecret }" />=
					<span class="blob" :style="{ background: paint.shared }" />
					<code class="demo-ok">{{ paint.shared }}</code>
				</div>
			</div>

			<p class="demo-note">
				<span class="demo-ok">✓ Client and Server match:</span> yellow +
				{{ nameOf(clientSecret) }} + {{ nameOf(serverSecret) }}, one part
				each.<br />
				<span class="demo-bad">✗ Mallory is off:</span> her mix has two parts
				yellow, and paint doesn’t un-mix.
			</p>
		</div>

		<div v-else class="real">
			<p v-if="support === 'no'" class="demo-note demo-warn">
				This browser doesn’t support X25519 in WebCrypto yet. The paint
				version still works, and the idea is the same.
			</p>
			<p v-else-if="!keys" class="demo-note">generating keys…</p>
			<dl v-else class="keys">
				<div class="key private">
					<dt>Client’s private key <span>stays on Client</span></dt>
					<dd>
						<span v-for="(g, i) of groups(keys.clientPrivate)" :key="i">{{ g }}</span>
					</dd>
				</div>
				<div class="key private">
					<dt>Server’s private key <span>stays on Server</span></dt>
					<dd>
						<span v-for="(g, i) of groups(keys.serverPrivate)" :key="i">{{ g }}</span>
					</dd>
				</div>
				<div class="key public">
					<dt>
						Client’s public key → <span class="demo-warn">Mallory sees it</span>
					</dt>
					<dd>
						<span v-for="(g, i) of groups(keys.clientPublic)" :key="i">{{ g }}</span>
					</dd>
				</div>
				<div class="key public">
					<dt>
						← Server’s public key <span class="demo-warn">Mallory sees it</span>
					</dt>
					<dd>
						<span v-for="(g, i) of groups(keys.serverPublic)" :key="i">{{ g }}</span>
					</dd>
				</div>
				<div class="key shared">
					<dt>
						Client computes
						<span>X25519(client private, server public)</span>
					</dt>
					<dd>
						<span v-for="(g, i) of groups(keys.clientShared)" :key="i">{{ g }}</span>
					</dd>
				</div>
				<div class="key shared">
					<dt>
						Server computes
						<span>X25519(server private, client public)</span>
					</dt>
					<dd>
						<span v-for="(g, i) of groups(keys.serverShared)" :key="i">{{ g }}</span>
					</dd>
				</div>
				<div class="key mallory">
					<dt>Mallory computes <span>two public keys, no private one</span></dt>
					<dd>???</dd>
				</div>
			</dl>
			<p v-if="keys" class="demo-note" aria-live="polite">
				<span v-if="same" class="demo-ok"
					>✓ same 32-byte secret on both sides, and it never crossed the
					wire</span
				>
				<span v-else class="demo-bad">✗ secrets differ</span>
			</p>
		</div>

		<template v-if="tab === 'real' && support === 'yes'" #controls>
			<button type="button" class="demo-btn" @click="newKeys">new keys</button>
		</template>

		<template #caption>
			<template v-if="tab === 'paint'">
				Pick a secret paint for each side. Their final colors always match;
				Mallory’s never does.
			</template>
			<template v-else>
				Hit “new keys” a few times. Every byte changes, and both sides still
				land on the same secret.
			</template>
			In TLS 1.3 this happens in the very first message (the key_share in
			ClientHello), which is why the handshake takes one round trip. Pion’s
			DTLS 1.3 actually defaults to X25519MLKEM768, which adds a post-quantum
			exchange on top.
		</template>
	</DemoFrame>
</template>

<style scoped>
.cast,
.row {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 8px;
}

.cast {
	margin-bottom: 8px;
	text-align: center;
}

.cast div {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
}

.cast span {
	color: var(--muted);
	font-size: 0.75rem;
}

.step {
	margin: 14px 0 6px;
	padding-top: 10px;
	border-top: 1px dashed var(--rule);
	color: var(--muted);
	font: 0.75rem var(--font-mono);
}

.cell {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	align-items: center;
	justify-content: center;
	min-height: 40px;
	color: var(--muted);
	font: 700 0.875rem var(--font-mono);
}

.picker.client {
	grid-column: 1;
	grid-row: 1;
}

.picker.server {
	grid-column: 3;
	grid-row: 1;
}

.mallory-cell {
	grid-column: 2;
	grid-row: 1;
}

.picker {
	flex-direction: column;
}

.unknown {
	font-size: 1.25rem;
}

.blob {
	display: inline-block;
	width: 36px;
	height: 36px;
	border: 2px solid var(--rule);
	border-radius: 0;
}

.blob.sm {
	width: 24px;
	height: 24px;
}

.blob.sent {
	border-color: var(--accent);
}

.swatches {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	justify-content: center;
}

.swatch {
	width: 22px;
	height: 22px;
	padding: 0;
	border: 2px solid var(--rule);
	border-radius: 0;
	cursor: pointer;
}

.swatch[aria-pressed="true"] {
	border-color: var(--text);
	outline: 2px solid var(--accent);
	outline-offset: 1px;
}

.arrow {
	color: var(--accent);
}

.final code {
	flex-basis: 100%;
	text-align: center;
	font: 0.75rem var(--font-mono);
}

.keys {
	display: grid;
	gap: 12px;
	margin: 0;
}

.key {
	padding: 8px 10px;
	border-left: 3px solid var(--rule);
	border-radius: 0;
	background: var(--bg);
}

.key dt {
	margin-bottom: 4px;
	font-size: 0.8125rem;
	font-weight: 600;
}

.key dt span {
	margin-left: 6px;
	color: var(--muted);
	font-weight: 300;
}

.key dt span.demo-warn {
	color: var(--warning);
}

.key dd {
	display: grid;
	grid-template-columns: repeat(4, max-content);
	gap: 2px 12px;
	margin: 0;
	font: 0.8125rem / 1.5 var(--font-mono);
}

.key.private dd {
	color: var(--muted);
}

.key.public {
	border-left-color: var(--warning);
}

.key.shared {
	border-left-color: var(--tip);
}

.key.shared dd {
	color: var(--tip);
}

.key.mallory {
	border-left-color: var(--danger);
}

.key.mallory dd {
	color: var(--danger);
}

@media (max-width: 520px) {
	.cast,
	.row {
		gap: 4px;
	}

	.blob {
		width: 28px;
		height: 28px;
	}

	.blob.sm {
		width: 18px;
		height: 18px;
	}

	.cell {
		gap: 2px;
		font-size: 0.75rem;
	}

	.swatch {
		width: 18px;
		height: 18px;
	}

	.final code {
		font-size: 0.6875rem;
	}

	.key dt span {
		display: block;
		margin-left: 0;
	}

	.key dd {
		gap: 2px 8px;
		font-size: 0.75rem;
	}
}
</style>
