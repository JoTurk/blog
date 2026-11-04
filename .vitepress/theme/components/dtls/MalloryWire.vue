<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

const MESSAGE = 'PAY BOB $10'
const encoder = new TextEncoder()
const PLAIN = encoder.encode(MESSAGE)
const AT = MESSAGE.indexOf('10')
const FROM = encoder.encode('10')
const TO = encoder.encode('99')
const MASK = FROM.map((b, i) => b ^ TO[i])

type Mode = 'plain' | 'ctr' | 'gcm'
type Action = 'none' | 'pass' | 'amount' | 'tag'

const modes: { id: Mode; label: string }[] = [
	{ id: 'plain', label: 'Plaintext' },
	{ id: 'ctr', label: 'Encrypted (AES-CTR)' },
	{ id: 'gcm', label: 'Encrypted + authenticated (AES-GCM)' },
]

const mode = ref<Mode>('plain')
const action = ref<Action>('none')
const reading = ref(false)
const packetId = ref(0)
const unsupported = ref(false)

interface Sealed {
	ctr: Uint8Array<ArrayBuffer>
	gcm: Uint8Array<ArrayBuffer>
	tag: Uint8Array<ArrayBuffer>
	counter: Uint8Array<ArrayBuffer>
	iv: Uint8Array<ArrayBuffer>
}
const sealed = ref<Sealed>()
const forgedTag = ref<Uint8Array<ArrayBuffer>>()

const received = ref<string | null>()

let ctrKey: CryptoKey | undefined
let gcmKey: CryptoKey | undefined
let sealing = 0
let delivering = 0

const hex = (b: number) => b.toString(16).padStart(2, '0')
const printable = (b: number) =>
	b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·'

async function seal() {
	if (!ctrKey || !gcmKey) return
	const run = ++sealing
	const counter = crypto.getRandomValues(new Uint8Array(16))
	counter.fill(0, 12)
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const ctr = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-CTR', counter, length: 32 },
			ctrKey,
			PLAIN,
		),
	)
	const both = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, gcmKey, PLAIN),
	)
	if (run !== sealing) return
	sealed.value = {
		ctr,
		gcm: both.slice(0, PLAIN.length),
		tag: both.slice(PLAIN.length),
		counter,
		iv,
	}
}

onMounted(async () => {
	try {
		const raw = crypto.getRandomValues(new Uint8Array(16))
		ctrKey = await crypto.subtle.importKey('raw', raw, 'AES-CTR', false, [
			'encrypt',
			'decrypt',
		])
		gcmKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
			'encrypt',
			'decrypt',
		])
		await seal()
	} catch {
		unsupported.value = true
	}
})

const original = computed(() => {
	if (mode.value === 'plain') return PLAIN
	if (!sealed.value) return undefined
	return mode.value === 'ctr' ? sealed.value.ctr : sealed.value.gcm
})

const tampered = computed(
	() => action.value === 'amount' || action.value === 'tag',
)

const body = computed(() => {
	const bytes = original.value
	if (!bytes) return undefined
	if (!tampered.value) return bytes
	const out = bytes.slice()
	MASK.forEach((m, i) => {
		out[AT + i] ^= m
	})
	return out
})

const tag = computed(() =>
	action.value === 'tag' ? forgedTag.value : sealed.value?.tag,
)

async function deliver() {
	const run = ++delivering
	const bytes = body.value
	const keys = sealed.value
	received.value = undefined
	if (!bytes) return
	if (mode.value === 'plain') {
		received.value = new TextDecoder().decode(bytes)
		return
	}
	if (!keys) return
	let result: string | null
	try {
		const out =
			mode.value === 'ctr'
				? await crypto.subtle.decrypt(
						{ name: 'AES-CTR', counter: keys.counter, length: 32 },
						ctrKey as CryptoKey,
						bytes,
					)
				: await crypto.subtle.decrypt(
						{ name: 'AES-GCM', iv: keys.iv },
						gcmKey as CryptoKey,
						new Uint8Array([...bytes, ...(tag.value ?? [])]),
					)
		result = new TextDecoder().decode(out)
	} catch {
		result = null
	}
	if (run === delivering) received.value = result
}

function act(next: Action) {
	if (!body.value) return
	if (next === 'tag')
		forgedTag.value = crypto.getRandomValues(new Uint8Array(16))
	action.value = next
	reading.value = false
	deliver()
}

function read() {
	reading.value = true
}

async function resend() {
	delivering++
	action.value = 'none'
	reading.value = false
	received.value = undefined
	if (ctrKey) sealed.value = undefined
	packetId.value++
	await seal()
}

function pick(next: Mode) {
	mode.value = next
	resend()
}

const delivered = computed(() => action.value !== 'none')
const rejected = computed(() => received.value === null)

const asText = computed(() => [...(body.value ?? [])].map(printable).join(''))

const packetLabel = computed(() => {
	if (!body.value) return '…'
	if (mode.value === 'plain') return asText.value
	return `${[...body.value.slice(0, 3)].map(hex).join(' ')}…`
})

const mallorySays = computed(() => {
	if (rejected.value) return 'Ugh. The tag gave me away.'
	if (tampered.value && received.value) return 'Ninety-nine dollars. Thank you.'
	if (reading.value)
		return mode.value === 'plain'
			? `“${MESSAGE}”. Easy.`
			: 'Just noise. I can’t read it.'
	return ''
})

const malloryMood = computed<AnimationName>(() => {
	if (rejected.value) return 'sad'
	if (tampered.value) return received.value ? 'yay' : 'type'
	if (reading.value) return mode.value === 'plain' ? 'yay' : 'sad'
	return 'sneak'
})

const serverMood = computed<AnimationName>(() => {
	if (rejected.value) return 'wow'
	if (received.value) return 'yay'
	return 'idle'
})

const verdict = computed(() => {
	if (!delivered.value || received.value === undefined)
		return { text: 'waiting for the packet', tone: '' }
	if (received.value === null)
		return { text: 'tag mismatch, record dropped', tone: 'demo-bad' }
	if (received.value === MESSAGE)
		return { text: `pays Bob $10`, tone: 'demo-ok' }
	return {
		text: 'pays Bob $99. Nobody noticed.',
		tone: 'demo-bad',
	}
})

const xorRows = computed(() => {
	const before = original.value?.slice(AT, AT + 2)
	const after = body.value?.slice(AT, AT + 2)
	if (!before || !after) return undefined
	const fmt = (b: Uint8Array) => [...b].map(hex).join(' ')
	return {
		from: fmt(FROM),
		to: fmt(TO),
		mask: fmt(MASK),
		before: fmt(before),
		after: fmt(after),
	}
})
</script>

<template>
	<DemoFrame>
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="How the message is protected">
				<button
					v-for="m of modes"
					:key="m.id"
					type="button"
					:aria-pressed="mode === m.id"
					@click="pick(m.id)"
				>
					{{ m.label }}
				</button>
			</div>
		</template>

		<div class="stage">
			<div class="track">
				<PixelSprite character="client" :size="56" label="Client" />
				<div class="wire">
					<span
						:key="packetId"
						class="packet"
						:class="{
							delivered,
							tampered,
							rejected,
							sealed: mode !== 'plain',
						}"
						aria-hidden="true"
						>{{ packetLabel }}</span
					>
					<span v-if="rejected" class="drop-mark demo-bad" aria-hidden="true"
						>✕</span
					>
				</div>
				<PixelSprite
					character="server"
					:animation="serverMood"
					:size="56"
					flip
					label="Server"
				/>
			</div>
			<div class="mallory">
				<span class="tap" aria-hidden="true" />
				<PixelSprite
					character="mallory"
					:animation="malloryMood"
					:size="48"
					label="Mallory"
				/>
				<p class="says" aria-live="polite">
					<span v-if="mallorySays" class="bubble">{{ mallorySays }}</span>
				</p>
			</div>
		</div>

		<p v-if="unsupported" class="demo-note demo-warn">
			This browser has no WebCrypto here, so only the plaintext tab works.
		</p>

		<section class="panel" aria-label="What Mallory sees on the wire">
			<p class="panel-head">
				on the wire <span>(what Mallory sees)</span>
			</p>
			<div class="demo-bytes" :aria-label="`${body?.length ?? 0} bytes`">
				<span
					v-for="(b, i) of body ?? []"
					:key="i"
					:class="{ changed: tampered && i >= AT && i < AT + 2 }"
					>{{ hex(b) }}</span
				>
			</div>
			<template v-if="mode === 'gcm'">
				<p class="panel-head tag-head">tag <span>(16 bytes)</span></p>
				<div class="demo-bytes tag">
					<span
						v-for="(b, i) of tag ?? []"
						:key="i"
						:class="{ changed: action === 'tag' }"
						>{{ hex(b) }}</span
					>
				</div>
			</template>
			<p class="demo-note">
				as text:
				<span class="ascii" :class="{ noise: mode !== 'plain' }">{{
					asText
				}}</span>
			</p>
		</section>

		<section
			v-if="tampered && mode !== 'plain' && xorRows"
			class="panel xor"
			aria-label="Mallory's bit flip"
		>
			<p class="panel-head">Mallory’s bit flip <span>(no key needed)</span></p>
			<dl class="demo-mono">
				<dt>“10” ⊕ “99”</dt>
				<dd>{{ xorRows.from }} ⊕ {{ xorRows.to }} = {{ xorRows.mask }}</dd>
				<dt>bytes {{ AT }}–{{ AT + 1 }}</dt>
				<dd>
					{{ xorRows.before }} ⊕ {{ xorRows.mask }} =
					<span class="demo-warn">{{ xorRows.after }}</span>
				</dd>
			</dl>
			<p v-if="mode === 'ctr'" class="demo-note">
				ciphertext = plaintext ⊕ keystream, so flipping a ciphertext bit flips
				the same plaintext bit.
			</p>
			<p v-else class="demo-note">
				Same flip, but the tag was computed over the original bytes{{
					action === 'tag' ? ', and guessing a 128-bit tag is hopeless' : ''
				}}.
			</p>
		</section>

		<p class="outcome" aria-live="polite">
			<span class="who">server got</span>
			<span class="demo-mono got">{{
				received === undefined
					? '…'
					: received === null
						? '(nothing)'
						: `“${received}”`
			}}</span>
			<span :class="verdict.tone">{{ verdict.text }}</span>
		</p>

		<template #controls>
			<button type="button" class="demo-btn secondary" @click="resend">
				send a new one
			</button>
			<button
				type="button"
				class="demo-btn secondary"
				:disabled="!body"
				@click="act('pass')"
			>
				let it through
			</button>
			<button type="button" class="demo-btn secondary" @click="read">
				read it
			</button>
			<button
				type="button"
				class="demo-btn danger"
				:disabled="!body"
				@click="act('amount')"
			>
				change $10 to $99
			</button>
			<button
				v-if="mode === 'gcm'"
				type="button"
				class="demo-btn danger"
				:disabled="!body"
				@click="act('tag')"
			>
				…and forge the tag
			</button>
		</template>

		<template #caption>
			Have Mallory read the packet, then change it, on each tab. With AES-CTR
			she can’t read a thing, yet she still rewrites the amount. Only AES-GCM’s
			tag catches her.
		</template>
	</DemoFrame>
</template>

<style scoped>
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
	left: 50%;
	max-width: 100%;
	padding: 4px 6px;
	border: 2px solid var(--accent);
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 700 0.75rem / 1 var(--font-mono);
	white-space: pre;
	transform: translate(-50%, -50%);
	transition:
		left 0.6s ease-in-out,
		transform 0.6s ease-in-out;
}

.packet.sealed {
	border-color: var(--info);
	color: var(--info);
}

.packet.tampered {
	border-color: var(--warning);
	border-style: dashed;
}

.packet.delivered {
	left: 100%;
	transform: translate(-100%, -50%);
}

.packet.rejected {
	border-color: var(--danger);
	opacity: 0.5;
}

.drop-mark {
	position: absolute;
	top: -2px;
	right: 4px;
	font: 700 0.875rem var(--font-mono);
}

.mallory {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	margin-top: -4px;
}

.tap {
	width: 0;
	height: 10px;
	border-left: 2px dashed var(--rule);
}

.says {
	min-height: 1.6em;
	margin: 6px 0 0;
	font-size: 0.8125rem;
	text-align: center;
}

.bubble {
	padding: 3px 10px;
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
}

.panel {
	margin-top: 16px;
	padding: 12px;
	border: 0;
	border-radius: 0;
}

.panel-head {
	margin: 0 0 8px;
	font: 700 0.75rem var(--font-mono);
}

.panel-head span {
	color: var(--muted);
	font-weight: 400;
}

.tag-head {
	margin-top: 12px;
}

.demo-bytes.tag > * {
	color: var(--info);
}

.demo-bytes > .changed,
.demo-bytes.tag > .changed {
	outline: 2px solid var(--warning);
	outline-offset: -2px;
	color: var(--warning);
}

.ascii {
	color: var(--text);
	white-space: pre-wrap;
	word-break: break-all;
}

.ascii.noise {
	color: var(--muted);
}

.xor dl {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 12px;
	margin: 0;
	font-size: 0.8125rem;
}

.xor dt {
	color: var(--muted);
}

.xor dd {
	margin: 0;
}

.outcome {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	align-items: baseline;
	margin: 16px 0 0;
	font-size: 0.875rem;
}

.who {
	color: var(--muted);
	font-size: 0.8125rem;
}

.got {
	font-weight: 700;
}

@media (max-width: 520px) {
	.track {
		gap: 4px;
	}

	.xor dl {
		grid-template-columns: 1fr;
		gap: 0;
	}

	.xor dd + dt {
		margin-top: 6px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.packet {
		transition: none;
	}
}
</style>
