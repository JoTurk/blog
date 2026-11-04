<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { AnimationName } from './characters'
import DemoFrame from './DemoFrame.vue'
import PixelSprite from './PixelSprite.vue'

const MAX = 32
const encoder = new TextEncoder()

const m1 = ref('MEET AT DAWN, BRING KEYS')
const m2 = ref('THE PASSWORD IS HUNTER2')
const guess = ref('PASSWORD')
const pos = ref(0)
const freshNonce = ref(false)
const knowP1 = ref(false)
const unsupported = ref(false)

let key: CryptoKey | undefined
const nonceA = ref<Uint8Array<ArrayBuffer>>()
const nonceB = ref<Uint8Array<ArrayBuffer>>()
const c1 = ref<Uint8Array<ArrayBuffer>>()
const c2 = ref<Uint8Array<ArrayBuffer>>()

const clean = (s: string) =>
	s
		.toUpperCase()
		.replace(/[^\x20-\x7e]/g, '')
		.slice(0, MAX)

const hex = (b?: number) =>
	b === undefined ? '' : b.toString(16).padStart(2, '0')
const readable = (b: number) => b >= 0x20 && b < 0x7f
const show = (b?: number) =>
	b === undefined ? '' : readable(b) ? String.fromCharCode(b) : '·'
const xor = (a: Uint8Array, b: Uint8Array) =>
	a.slice(0, Math.min(a.length, b.length)).map((v, i) => v ^ b[i])

const live1 = computed(() => encoder.encode(m1.value))
const live2 = computed(() => encoder.encode(m2.value))
const sealed1 = ref<Uint8Array<ArrayBuffer>>()
const sealed2 = ref<Uint8Array<ArrayBuffer>>()
const p1 = computed(() => sealed1.value ?? live1.value)
const p2 = computed(() => sealed2.value ?? live2.value)

let run = 0
async function encrypt() {
	if (!key || !nonceA.value || !nonceB.value) return
	const mine = ++run
	const seal = async (
		iv: Uint8Array<ArrayBuffer>,
		data: Uint8Array<ArrayBuffer>,
	) => {
		const out = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key as CryptoKey,
			data,
		)
		return new Uint8Array(out).slice(0, data.length)
	}
	const q1 = live1.value
	const q2 = live2.value
	const [a, b] = await Promise.all([
		seal(nonceA.value, q1),
		seal(freshNonce.value ? nonceB.value : nonceA.value, q2),
	])
	if (mine !== run) return
	c1.value = a
	c2.value = b
	sealed1.value = q1
	sealed2.value = q2
}

onMounted(async () => {
	try {
		key = await crypto.subtle.generateKey(
			{ name: 'AES-GCM', length: 128 },
			false,
			['encrypt'],
		)
		nonceA.value = crypto.getRandomValues(new Uint8Array(12))
		nonceB.value = crypto.getRandomValues(new Uint8Array(12))
		await encrypt()
	} catch {
		unsupported.value = true
	}
})

watch([m1, m2, freshNonce], encrypt)

function edit(which: 1 | 2, e: Event) {
	const input = e.target as HTMLInputElement
	const value = clean(input.value)
	input.value = value
	if (which === 1) m1.value = value
	else m2.value = value
}

function editGuess(e: Event) {
	const input = e.target as HTMLInputElement
	guess.value = clean(input.value)
	input.value = guess.value
}

const n = computed(() => Math.min(p1.value.length, p2.value.length))
const cols = computed(() => [...Array(n.value).keys()])

const cx = computed(() =>
	c1.value && c2.value ? xor(c1.value, c2.value) : undefined,
)
const px = computed(() => xor(p1.value, p2.value))
const matches = computed(() =>
	cols.value.map((i) => cx.value !== undefined && cx.value[i] === px.value[i]),
)
const allMatch = computed(() => n.value > 0 && matches.value.every(Boolean))

// Crib dragging
const g = computed(() => encoder.encode(guess.value).slice(0, n.value))
const maxPos = computed(() => Math.max(0, n.value - g.value.length))
watch(maxPos, (m) => {
	if (pos.value > m) pos.value = m
})

const revealed = computed(() => {
	if (!cx.value) return undefined
	const window = cx.value.slice(pos.value, pos.value + g.value.length)
	return xor(g.value, window)
})

const revealedText = computed(() =>
	[...(revealed.value ?? [])].map(show).join(''),
)

const hit = computed(() => {
	if (!revealed.value || !g.value.length) return undefined
	const at = (p: Uint8Array) =>
		new TextDecoder().decode(p.slice(pos.value, pos.value + g.value.length))
	if (
		guess.value.slice(0, g.value.length) === at(p2.value) &&
		revealedText.value === at(p1.value)
	)
		return 1
	if (
		guess.value.slice(0, g.value.length) === at(p1.value) &&
		revealedText.value === at(p2.value)
	)
		return 2
	return undefined
})

const inWindow = (i: number) => i >= pos.value && i < pos.value + g.value.length

const fullReveal = computed(() => {
	if (!cx.value) return ''
	return [...xor(p1.value, cx.value)].map(show).join('')
})

const malloryMood = computed<AnimationName>(() => {
	if (hit.value || (knowP1.value && !freshNonce.value)) return 'yay'
	if (freshNonce.value) return 'sad'
	return 'sneak'
})

function step(by: number) {
	pos.value = Math.min(maxPos.value, Math.max(0, pos.value + by))
}

const scroller = ref<HTMLElement>()
watch(pos, async () => {
	await nextTick()
	const el = scroller.value
	const cell = el?.querySelector<HTMLElement>('.in-window')
	const label = el?.querySelector<HTMLElement>('.label')
	if (!el || !cell || !label) return
	const left = cell.offsetLeft - label.offsetWidth - 8
	const right = left + g.value.length * cell.offsetWidth
	if (
		left < el.scrollLeft ||
		right > el.scrollLeft + el.clientWidth - label.offsetWidth
	)
		el.scrollLeft = left
})

const nonceHex = (b?: Uint8Array) => [...(b ?? [])].map(hex).join(' ')
</script>

<template>
	<DemoFrame>
		<div class="messages">
			<label>
				<span>connection A sends</span>
				<input
					:value="m1"
					class="demo-mono"
					maxlength="32"
					spellcheck="false"
					autocomplete="off"
					@input="edit(1, $event)"
				/>
			</label>
			<label>
				<span>connection B sends</span>
				<input
					:value="m2"
					class="demo-mono"
					maxlength="32"
					spellcheck="false"
					autocomplete="off"
					@input="edit(2, $event)"
				/>
			</label>
			<p class="demo-note">
				same key, nonce A:
				<span class="nonce">{{ nonceHex(nonceA) }}</span><br />
				same key, nonce B:
				<span class="nonce" :class="freshNonce ? 'demo-ok' : 'demo-bad'">{{
					nonceHex(freshNonce ? nonceB : nonceA)
				}}</span>
				<span :class="freshNonce ? 'demo-ok' : 'demo-bad'">
					{{ freshNonce ? ' (fresh)' : ' (reused!)' }}</span
				>
			</p>
		</div>

		<p v-if="unsupported" class="demo-note demo-warn">
			This browser has no WebCrypto here, so the demo can’t encrypt.
		</p>

		<div
			ref="scroller"
			class="grid-scroll"
			tabindex="0"
			aria-label="Bytes of both messages, lined up"
		>
			<div class="grid" :style="{ '--n': n }">
				<span class="label secret">P1 <small>secret</small></span>
				<span v-for="i of cols" :key="`p1${i}`" class="cell ch">{{
					show(p1[i])
				}}</span>

				<span class="label secret">P2 <small>secret</small></span>
				<span v-for="i of cols" :key="`p2${i}`" class="cell ch">{{
					show(p2[i])
				}}</span>

				<span class="label">C1</span>
				<span v-for="i of cols" :key="`c1${i}`" class="cell">{{
					c1 ? hex(c1[i]) : ''
				}}</span>

				<span class="label">C2</span>
				<span v-for="i of cols" :key="`c2${i}`" class="cell">{{
					c2 ? hex(c2[i]) : ''
				}}</span>

				<span class="label mallory">C1⊕C2</span>
				<span
					v-for="i of cols"
					:key="`cx${i}`"
					class="cell mallory"
					:class="{ 'in-window': inWindow(i) }"
					>{{ cx ? hex(cx[i]) : '' }}</span
				>

				<span class="label secret">P1⊕P2</span>
				<span v-for="i of cols" :key="`px${i}`" class="cell">{{
					hex(px[i])
				}}</span>

				<span class="label">same?</span>
				<span
					v-for="i of cols"
					:key="`ok${i}`"
					class="cell mark"
					:class="matches[i] ? 'demo-ok' : 'demo-bad'"
					>{{ matches[i] ? '✓' : '✗' }}</span
				>

				<span class="label mallory">guess</span>
				<span
					v-for="i of cols"
					:key="`g${i}`"
					class="cell ch"
					:class="{ guess: inWindow(i) }"
					>{{ inWindow(i) ? show(g[i - pos]) : '' }}</span
				>

				<span class="label mallory">reveals</span>
				<span
					v-for="i of cols"
					:key="`r${i}`"
					class="cell ch"
					:class="{
						reveal: inWindow(i),
						junk: inWindow(i) && revealed && !readable(revealed[i - pos]),
						hit: inWindow(i) && hit,
					}"
					>{{ inWindow(i) && revealed ? show(revealed[i - pos]) : '' }}</span
				>
			</div>
		</div>

		<p class="demo-note summary" aria-live="polite">
			<span v-if="allMatch" class="demo-ok"
				>✓ C1⊕C2 = P1⊕P2. The keystream cancels out, no key needed.</span
			>
			<span v-else class="demo-bad"
				>✗ C1⊕C2 has nothing to do with P1⊕P2. It’s noise.</span
			>
		</p>

		<div class="crib">
			<PixelSprite
				character="mallory"
				:animation="malloryMood"
				:size="48"
				label="Mallory"
			/>
			<div class="crib-body">
				<p class="crib-line">
					<span class="muted">guess ⊕ (C1⊕C2) at {{ pos }}:</span>
					<strong
						class="demo-mono reveal-text"
						:class="{ 'demo-ok': hit }"
						>“{{ revealedText }}”</strong
					>
				</p>
				<p class="demo-note">
					<span v-if="hit" class="demo-ok"
						>That’s real text from message {{ hit }}. Her guess was in the
						other one.</span
					>
					<span v-else-if="freshNonce">Garbage at every position.</span>
					<span v-else>Slide the guess until the other line reads.</span>
				</p>
				<p v-if="knowP1" class="crib-line full">
					<span class="muted">P1 ⊕ (C1⊕C2) =</span>
					<strong
						class="demo-mono reveal-text"
						:class="freshNonce ? 'demo-bad' : 'demo-ok'"
						>“{{ fullReveal }}”</strong
					>
				</p>
			</div>
		</div>

		<template #controls>
			<label>
				guess
				<input
					:value="guess"
					class="demo-mono guess-input"
					maxlength="32"
					spellcheck="false"
					autocomplete="off"
					@input="editGuess"
				/>
			</label>
			<span class="slide">
				<button
					type="button"
					class="demo-btn secondary arrow"
					aria-label="Move guess left"
					:disabled="pos === 0"
					@click="step(-1)"
				>
					◀
				</button>
				<input
					v-model.number="pos"
					type="range"
					min="0"
					:max="maxPos"
					aria-label="Guess position"
				/>
				<button
					type="button"
					class="demo-btn secondary arrow"
					aria-label="Move guess right"
					:disabled="pos >= maxPos"
					@click="step(1)"
				>
					▶
				</button>
			</span>
			<button
				type="button"
				class="demo-btn secondary"
				data-longest="Mallory knows message 1"
				:aria-pressed="knowP1"
				@click="knowP1 = !knowP1"
			>
				{{ knowP1 ? 'forget message 1' : 'Mallory knows message 1' }}
			</button>
			<label>
				<input v-model="freshNonce" type="checkbox" />
				use a fresh nonce for each message
			</label>
		</template>

		<template #caption>
			Slide Mallory’s guess along until the “reveals” row turns into words. Then
			tick “fresh nonce” and try again.
		</template>
	</DemoFrame>
</template>

<style scoped>
.messages {
	display: grid;
	gap: 8px;
}

.messages label {
	display: grid;
	gap: 2px;
	color: var(--muted);
	font-size: 0.8125rem;
}

input:not([type]) {
	width: 100%;
	padding: 6px 10px;
	border: 1px solid var(--rule);
	border-radius: 0;
	background: var(--bg);
	color: var(--text);
	font-size: 0.875rem;
}

.guess-input {
	width: 13ch !important;
}

.nonce {
	word-break: break-word;
}

.grid-scroll {
	margin-top: 16px;
	overflow-x: auto;
	padding-bottom: 6px;
	scroll-behavior: smooth;
}

.grid {
	display: grid;
	grid-template-columns: max-content repeat(var(--n), 21px);
	gap: 2px;
	width: max-content;
	font: 0.75rem / 1 var(--font-mono);
}

.label {
	position: sticky;
	left: 0;
	z-index: 1;
	display: flex;
	gap: 4px;
	align-items: center;
	padding-right: 8px;
	background: var(--code);
	color: var(--text);
	font-weight: 700;
}

.label small {
	color: var(--muted);
	font-weight: 400;
	font-size: 0.625rem;
}

.label.mallory {
	color: var(--accent);
}

.cell {
	display: grid;
	place-items: center;
	height: 22px;
	border-radius: 0;
	background: transparent;
	white-space: pre;
}

.cell.ch {
	font-weight: 700;
}

.cell.mallory {
	color: var(--bubbletext);
}

.cell.in-window {
	box-shadow: inset 0 -1px var(--accent);
}

.cell.mark {
	background: transparent;
}

.cell.guess {
	background: var(--bubble);
	color: var(--bubbletext);
}

.cell.reveal {
	border-bottom: 1px dashed var(--accent);
	color: var(--text);
}

.cell.junk {
	color: var(--muted);
}

.cell.hit {
	border-bottom: 1px solid var(--tip);
	color: var(--tip);
}

.summary {
	margin-top: 4px;
}

.crib {
	display: flex;
	gap: 12px;
	align-items: flex-start;
	margin-top: 16px;
	padding: 12px;
	border: 0;
	border-radius: 0;
}

.crib-body {
	flex: 1;
	min-width: 0;
}

.crib-line {
	display: flex;
	flex-wrap: wrap;
	gap: 2px 8px;
	align-items: baseline;
	margin: 0;
	font-size: 0.875rem;
}

.crib-line.full {
	margin-top: 10px;
}

.muted {
	color: var(--muted);
	font-size: 0.8125rem;
}

.reveal-text {
	white-space: pre-wrap;
	word-break: break-all;
}

.slide {
	display: flex;
	gap: 8px;
	align-items: center;
}

.slide input {
	width: 140px;
}

.arrow {
	padding: 4px 10px;
	font-size: 0.75rem;
}

@media (max-width: 520px) {
	.slide input {
		width: 120px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.grid-scroll {
		scroll-behavior: auto;
	}
}
</style>
